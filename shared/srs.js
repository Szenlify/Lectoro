/**
 * Lectoro – Spaced Repetition System (Anki-style SM-2)
 */

const MINS_IN_DAY = 1440;
const MS_IN_DAY = 86400000;

/** Fixed graduation ladder for consecutive "Good" answers, in days */
const LEARNING_STEPS = [
    10 / MINS_IN_DAY, // 0. 10 minutes (First correct answer)
    2 / 24, // 1. 2 hours
    10 / 24, // 2. 10 hours
    1, // 3. 24h / 1 day
    3, // 4. 3 days
    7, // 5. 7 days
    14, // 6. 14 days
    30, // 7. 30 days – then maintenance mode
];

const SRS = {
    /** Fresh SR state for a word that has never been reviewed */
    defaultState: () => ({
        interval: 0,
        step: 0,
        easeFactor: 2.5,
        nextReview: 0,
        lastReview: null,
    }),

    update(sr, grade) {
        let { interval = 0, step = 0, easeFactor = 2.5 } = sr;
        const isFail = grade === 1; // 1 = "Again"

        if (isFail) {
            easeFactor = Math.max(1.3, easeFactor - 0.2); // Ease factor penalty

            if (step === 0) {
                interval = 1 / MINS_IN_DAY; // 1 minute (if failed on first step)
            } else {
                step = Math.max(0, step - 2); // Demote by 2 steps
                interval =
                    step < LEARNING_STEPS.length
                        ? LEARNING_STEPS[step]
                        : interval / Math.pow(easeFactor, 2);
            }
        } else {
            // Good -> Take step from ladder or multiply (maintenance mode)
            interval =
                step < LEARNING_STEPS.length
                    ? LEARNING_STEPS[step]
                    : interval * easeFactor;
            step++;
        }

        return {
            interval,
            step,
            easeFactor,
            nextReview: Date.now() + interval * MS_IN_DAY,
            lastReview: Date.now(),
        };
    },

    /** Preview what the next review time label will be for a given grade */
    previewLabel(sr, grade) {
        return SRS.formatInterval(SRS.update(sr, grade).interval);
    },

    /** Format interval to a human-readable label */
    formatInterval(days) {
        const mins = Math.round(days * MINS_IN_DAY);
        if (mins < 60) return mins === 1 ? "1 min" : `${mins} mins`;

        const h = Math.round(mins / 60);
        if (h < 24) return h === 1 ? "1 hr" : `${h} hrs`;

        const d = Math.round(days);
        if (d < 7) return d === 1 ? "1 day" : `${d} days`;

        const w = Math.round(days / 7);
        if (d < 30) return w === 1 ? "1 wk" : `${w} wks`;

        const m = Math.round(days / 30);
        return m === 1 ? "1 mo" : `${m} mos`;
    },

    /** Ensure a word has SR metadata, migrating the old step-based format if present */
    ensure(word) {
        if (!word.sr) {
            word.sr = SRS.defaultState();
        } else {
            word.sr.step = word.sr.step ?? 0;
            word.sr.easeFactor = word.sr.easeFactor ?? 2.5;
            word.sr.interval = word.sr.interval ?? 0;
            word.sr.nextReview = word.sr.nextReview ?? 0;
            word.sr.lastReview = word.sr.lastReview ?? null;
        }

        return word;
    },
};
