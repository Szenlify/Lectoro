/**
 * Lectoro – Spaced Repetition System (Anki-style SM-2)
 */

const MINS_IN_DAY = 1440;
const MS_IN_DAY = 86400000;

/** Fixed graduation ladder for consecutive "Znam" answers, in days */
const LEARNING_STEPS = [
    10 / MINS_IN_DAY, // 0. 10 minut (Pierwsza poprawna odpowiedź)
    2 / 24, // 1. 2 godziny
    10 / 24, // 2. 10h
    1, // 3. 24h / 1 dzień
    3, // 4. 3 dni
    7, // 5. 7 dni
    14, // 6. 14 dni
    30, // 7. 30 dni – potem tryb utrzymania
];

const SRS = {
    /** Fresh SR state for a word that has never been reviewed */
    defaultState: () => ({
        interval: 0,
        reps: 0,
        easeFactor: 2.5,
        nextReview: 0,
        lastReview: null,
    }),

    update(sr, grade) {
        let { interval = 0, reps = 0, easeFactor = 2.5 } = sr;
        const isFail = grade === 1; // 1 = "Nie znam"

        if (isFail) {
            easeFactor = Math.max(1.3, easeFactor - 0.2); // Kara do ease factor

            if (reps === 0) {
                interval = 1 / MINS_IN_DAY; // 1 minuta (jeśli nie znam za pierwszym razem)
            } else {
                reps = Math.max(0, reps - 2); // Degradacja o 2 stopnie w dół
                // Jeśli cofnęliśmy się do fazy nauki, bierzemy krok. Jeśli jesteśmy dalej w trybie utrzymania, cofamy mnożnik dwukrotnie.
                interval =
                    reps < LEARNING_STEPS.length
                        ? LEARNING_STEPS[reps]
                        : interval / Math.pow(easeFactor, 2);
            }
        } else {
            // Znam -> Bierzemy krok z tablicy lub mnożymy (tryb utrzymania)
            interval =
                reps < LEARNING_STEPS.length
                    ? LEARNING_STEPS[reps]
                    : interval * easeFactor;
            reps++;
        }

        return {
            interval,
            reps,
            easeFactor,
            nextReview: Date.now() + interval * MS_IN_DAY,
            lastReview: Date.now(),
        };
    },

    /** Preview what the next review time label will be for a given grade */
    previewLabel(sr, grade) {
        return SRS.formatInterval(SRS.update(sr, grade).interval);
    },

    /** Uniwersalna funkcja formatująca interwał do przyjaznej etykiety (DRY) */
    formatInterval(days) {
        const mins = Math.round(days * MINS_IN_DAY);
        if (mins < 60) return `${mins} min`;

        const h = Math.round(mins / 60);
        if (h < 24) return h === 1 ? "1 godz." : `${h} godz.`;

        const d = Math.round(days);
        if (d < 7) return d === 1 ? "1 dzień" : `${d} dni`;

        const w = Math.round(days / 7);
        if (d < 30) return w === 1 ? "1 tydz." : `${w} tyg.`;

        const m = Math.round(days / 30);
        return m === 1 ? "1 mies." : `${m} mies.`;
    },

    /** Ensure a word has SR metadata, migrating the old step-based format if present */
    ensure(word) {
        if (!word.sr) {
            word.sr = SRS.defaultState();
        } else if (word.sr.step !== undefined) {
            // Czysta migracja bez zbędnych modyfikacji obiektu
            word.sr = {
                ...SRS.defaultState(),
                ...word.sr, // Zachowaj m.in. lastReview i nextReview
                interval: word.sr.interval || 0,
                reps: (word.sr.interval || 0) > 0 ? 1 : 0,
                step: undefined, // Usuwamy stary format
            };
            delete word.sr.step;
        }
        return word;
    },
};
