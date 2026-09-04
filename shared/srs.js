/**
 * Lectoro – Spaced Repetition System (Multiplier-based Exponential SRS)
 *
 * Single Source of Truth for SRS calculations and scheduling.
 * Binary grading model:
 *   1 = "Nie znam" (Again / Fail) -> 10-minute immediate relearn, multiplier penalty, streak reset
 *   2 = "Znam" (Know / Good)      -> Graduated interval growth via multiplier (ease factor)
 */
(function initSrs(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.SRS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSrs() {
    "use strict";

    const MINS_IN_DAY = 1440;
    const MS_IN_DAY = 86400000;
    const RELEARN_INTERVAL_DAYS = 1 / MINS_IN_DAY; // 1 minute immediate relearning on lapse
    const INTRA_DAY_LEARN_INTERVAL_DAYS = 10 / MINS_IN_DAY; // 10 minutes confirmation on first success
    const BASE_GRADUATING_INTERVAL_DAYS = 1; // 1 day graduation to daily reviews
    const DEFAULT_EASE_FACTOR = 2.5;
    const MIN_EASE_FACTOR = 1.3;
    const MAX_EASE_FACTOR = 3.5;
    const MAX_INTERVAL_DAYS = 730; // 2 years safety cap

    const SRS = {
        CONSTANTS: Object.freeze({
            MINS_IN_DAY,
            MS_IN_DAY,
            RELEARN_INTERVAL_DAYS,
            INTRA_DAY_LEARN_INTERVAL_DAYS,
            BASE_GRADUATING_INTERVAL_DAYS,
            DEFAULT_EASE_FACTOR,
            MIN_EASE_FACTOR,
            MAX_EASE_FACTOR,
            MAX_INTERVAL_DAYS,
        }),

        /** Fresh SR state for a word that has never been reviewed */
        defaultState: () => ({
            interval: 0,
            reps: 0,
            step: 0, // Retained as synchronized alias to reps for 100% backward & Firestore compatibility
            easeFactor: DEFAULT_EASE_FACTOR,
            lapses: 0,
            nextReview: 0,
            lastReview: null,
        }),

        /**
         * Compute updated SR state for a given rating.
         * @param {Object} sr - Current SR state
         * @param {number} grade - 1 = "Nie znam" (Again/Fail), 2 = "Znam" (Know/Good)
         * @param {number} [now=Date.now()] - Timestamp of the review
         */
        update(sr = {}, grade = 2, now = Date.now()) {
            let {
                interval = 0,
                reps = 0,
                step = 0,
                easeFactor = DEFAULT_EASE_FACTOR,
                lapses = 0,
            } = sr || {};

            // Normalize reps from step if legacy card
            reps = reps || step || 0;
            easeFactor =
                Number.isFinite(easeFactor) && easeFactor >= MIN_EASE_FACTOR
                    ? easeFactor
                    : DEFAULT_EASE_FACTOR;
            interval = Number.isFinite(interval) ? interval : 0;
            lapses = Number.isFinite(lapses) ? lapses : 0;

            const isFail = grade === 1; // 1 = "Nie znam"

            if (isFail) {
                // Retention failure: immediate 1-minute relearn, penalize easeFactor, record lapse, reset streak
                easeFactor = Math.max(
                    MIN_EASE_FACTOR,
                    Math.round((easeFactor - 0.2) * 100) / 100,
                );
                lapses += 1;
                reps = 0;
                interval = RELEARN_INTERVAL_DAYS; // 1 minute
            } else {
                // Retention success ("Znam")
                if (interval < INTRA_DAY_LEARN_INTERVAL_DAYS || reps === 0) {
                    // New card (0) or failed card (1 min) -> first "Znam" advances to 10 minutes
                    interval = INTRA_DAY_LEARN_INTERVAL_DAYS; // 10 minutes
                    reps = 1;
                } else if (interval < BASE_GRADUATING_INTERVAL_DAYS) {
                    // Was at 10 minutes -> second "Znam" graduates to 1 day
                    interval = BASE_GRADUATING_INTERVAL_DAYS; // 1 day
                    reps = 2;
                } else {
                    // Graduated card (>= 1 day) -> grows strictly via multiplier
                    const multiplied = Math.round(interval * easeFactor);
                    const nextInterval = Math.max(
                        Math.round(interval) + 1,
                        multiplied,
                    );
                    interval = Math.min(nextInterval, MAX_INTERVAL_DAYS);
                    reps += 1;

                    // Subtle reward (+0.05) to ease factor for consistently known cards
                    if (reps >= 4) {
                        easeFactor = Math.min(
                            MAX_EASE_FACTOR,
                            Math.round((easeFactor + 0.05) * 100) / 100,
                        );
                    }
                }
            }

            return {
                interval,
                reps,
                step: reps, // keep step in sync for backward compatibility
                easeFactor,
                lapses,
                nextReview: now + Math.round(interval * MS_IN_DAY),
                lastReview: now,
            };
        },

        /** Preview what the next review time label will be for a given grade */
        previewLabel(sr, grade) {
            return SRS.formatInterval(SRS.update(sr, grade).interval);
        },

        /** Format interval in days to a human-readable label */
        formatInterval(days) {
            if (!days || days <= 0) return "0 mins";
            const mins = Math.round(days * MINS_IN_DAY);
            if (mins < 60) return mins === 1 ? "1 min" : `${mins} mins`;

            const h = Math.round(mins / 60);
            if (h < 24) return h === 1 ? "1 hr" : `${h} hrs`;

            const d = Math.round(days);
            if (d < 14) return d === 1 ? "1 day" : `${d} days`;

            const w = Math.round(days / 7);
            if (d < 60) return w === 1 ? "1 wk" : `${w} wks`;

            const m = Math.round(days / 30);
            if (d < 365) return m === 1 ? "1 mo" : `${m} mos`;

            const y = Math.round((days / 365) * 10) / 10;
            return y === 1 ? "1 yr" : `${y} yrs`;
        },

        /** Check if a word is due for review */
        isDue(word, now = Date.now()) {
            if (!word || !word.sr) return true;
            return (word.sr.nextReview || 0) <= now;
        },

        /** Ensure a word has SR metadata, migrating legacy structures if present */
        ensure(word) {
            if (!word) return word;
            if (!word.sr) {
                word.sr = SRS.defaultState();
            } else {
                const reps = word.sr.reps ?? word.sr.step ?? 0;
                word.sr.reps = reps;
                word.sr.step = reps;
                word.sr.easeFactor = word.sr.easeFactor ?? DEFAULT_EASE_FACTOR;
                word.sr.interval = word.sr.interval ?? 0;
                word.sr.lapses = word.sr.lapses ?? 0;
                word.sr.nextReview = word.sr.nextReview ?? 0;
                word.sr.lastReview = word.sr.lastReview ?? null;
            }

            return word;
        },
    };

    return SRS;
});
