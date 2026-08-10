/**
 * Lectoro – Spaced Repetition System (Anki-style SM-2)
 * Self-contained scheduling algorithm + helpers, extracted from popup.js so
 * it can be read/tuned/tested in isolation without touching the UI code.
 *
 * A word's `sr` state shape: { interval (days), reps, easeFactor, nextReview
 * (epoch ms), lastReview (epoch ms|null) }.
 */

/** Fixed graduation ladder for consecutive "Znam" answers, in days (see the
 *  comment inside SRS.update() for the reasoning behind each step). */
const LEARNING_STEPS = [
    10 / 1440, // 1. 10 minut
    2 / 24, // 2. 2 godziny
    10 / 24, // 3. 8-12h, uśrednione do 10h dla przewidywalnego podglądu
    1, // 4. 24h / 1 dzień
    3, // 5. 3 dni
    7, // 6. 7 dni
    14, // 7. 14 dni
    30, // 8. 30 dni – potem tryb utrzymania (mnożenie przez easeFactor)
];

const SRS = {
    /** Fresh SR state for a word that has never been reviewed */
    defaultState() {
        return {
            interval: 0,
            reps: 0,
            easeFactor: 2,
            nextReview: 0,
            lastReview: null,
        };
    },

    /**
     * Simplified 2-grade SM-2 (only "know" / "don't know" is exposed in the UI).
     * Grade 1: Nie znam (Again) — reset progress, review again very soon.
     * Grade 2: Znam (Good) — graduate through fixed learning steps, then
     *          grow the interval by the ease factor each time after that.
     */
    // ═══════════════════════════════════════════════════════════════
    //  DRABINKA POWTÓREK dla "Znam" (kolejne DOBRE odpowiedzi z rzędu)
    // ═══════════════════════════════════════════════════════════════
    //
    // Zamiast czystego mnożenia przez easeFactor od samego początku,
    // pierwsze 8 dobrych odpowiedzi przechodzi po sprawdzonej, ustalonej
    // drabince (LEARNING_STEPS niżej) — dopiero po niej karta wchodzi
    // w tryb "utrzymania" i rośnie dalej przez easeFactor:
    //
    //   1. 10 minut        – Pamięć krótkotrwała. Klasyczny pierwszy krok,
    //      mózg jeszcze pamięta kontekst, ale info zaczyna już blaknąć.
    //   2. 2 godziny       – Wczesne utrwalanie. Kluczowy krok pomijany
    //      przez standardowe programy — wyłapuje trudne słówka, zanim
    //      wylecą z głowy jeszcze tego samego dnia.
    //   3. 8–12h (śr. 10h) – Przed snem / koniec dnia. Mózg konsoliduje
    //      wspomnienia w fazie REM — 4. kontakt z materiałem tego samego
    //      dnia mocno go betonuje w głowie.
    //   4. 24h (1 dzień)   – Pierwszy test długoterminowy: czy informacja
    //      przetrwała sen? Jeśli tak, połączenie neuronowe jest już silne.
    //   5. 3 dni           – Pamięć długotrwała. Standardowy mnożnik SM-2
    //      to ok. 2.5x, tu stosujemy bezpieczniejszy skok 3x (24h * 3).
    //   6. 7 dni           – Pogłębianie śladu. Odpowiedź przychodzi już
    //      bez wysiłku.
    //   7. 14 dni          – Stabilizacja. Przy poprawnej odpowiedzi
    //      ryzyko zapomnienia drastycznie spada.
    //   8. 30 dni          – Wiedza trwała. Dalej karta wchodzi w tryb
    //      rzadkich powtórek utrzymujących (maintenance, przez easeFactor).
    //
    // Dla "Nie znam" (grade 1) zawsze wraca do 1 minuty i zeruje reps
    // (słowo wraca na sam początek drabinki), a easeFactor maleje o 0.2
    // (min. 1.3) – słowo "trudne" będzie potem wolniej rosło w trybie
    // utrzymania po ukończeniu całej drabinki.
    //
    // ── Żeby powtórki pokazywały się CZĘŚCIEJ, można zmienić: ────────
    //
    // 1) Dodać jeszcze wcześniejszy krok na początku LEARNING_STEPS
    //    (np. "5 / 1440" dla 5 minut), jeśli drabinka ma się zaczynać
    //    jeszcze szybciej.
    //
    // 2) Zmniejszyć same wartości w LEARNING_STEPS (np. "7 dni" → "5 dni")
    //    – im mniejsze liczby w tablicy, tym częściej słowo wraca.
    //
    // 3) Zmniejszyć domyślny easeFactor (obecnie 2 – ustawiany
    //    w defaultState() oraz w destrukturyzacji "easeFactor = 2.5"
    //    poniżej, to drugie tylko jako zapasowa wartość dla starych/
    //    migrowanych słów bez zapisanego easeFactor). Mniejszy easeFactor
    //    wpływa tylko na tryb utrzymania PO ukończeniu drabinki (czyli
    //    po 8. dobrej odpowiedzi / 30 dniach).
    //
    // 4) Zmienić karę za "Nie znam" (obecnie easeFactor - 0.2) – większa
    //    kara sprawia, że po pomyłce tryb utrzymania rośnie wolniej
    //    (słowo częściej wraca), mniejsza kara – że szybciej wraca do
    //    normalnego tempa.
    //
    // Uwaga: wszystkie powyższe zmiany dotyczą WYŁĄCZNIE LEARNING_STEPS
    // i ciała funkcji update() poniżej – reszta pliku (previewLabel,
    // formatIntervalDays/Minutes, ensure) tylko wyświetla/migruje to,
    // co zwróci update(), więc nie wymaga żadnych zmian.
    update(sr, grade) {
        let { interval = 0, reps = 0, easeFactor = 2.5 } = sr;

        if (grade === 1) {
            reps = 0;
            interval = 1 / (24 * 60); // 1 minute
            easeFactor = Math.max(1.3, easeFactor - 0.2);
        } else {
            interval =
                reps < LEARNING_STEPS.length
                    ? LEARNING_STEPS[reps]
                    : interval * easeFactor; // maintenance mode past the last fixed step
            reps++;
        }

        return {
            interval,
            reps,
            easeFactor,
            nextReview: Date.now() + interval * 24 * 60 * 60 * 1000,
            lastReview: Date.now(),
        };
    },

    /** Preview what the next review time label will be for a given grade */
    previewLabel(sr, grade) {
        const nextSr = SRS.update(sr, grade);
        const days = nextSr.interval;
        const mins = Math.round(days * 24 * 60);
        if (mins < 60) return SRS.formatIntervalMinutes(mins);
        return SRS.formatIntervalDays(days);
    },

    formatIntervalDays(days) {
        if (days < 1) {
            const h = Math.round(days * 24);
            return `${h}h`;
        }
        if (days <= 1) return "1 dzień";
        if (days < 7) return `${days} dni`;
        if (days === 7) return "1 tydz.";
        if (days < 30) {
            const w = Math.round(days / 7);
            return w === 1 ? "1 tydz." : `${w} tyg.`;
        }
        if (days === 30) return "1 mies.";
        const m = Math.round(days / 30);
        return m === 1 ? "1 mies." : `${m} mies.`;
    },

    formatIntervalMinutes(mins) {
        if (mins < 60) return `${mins} min`;
        const h = Math.round(mins / 60);
        return h === 1 ? "1 godz." : `${h} godz.`;
    },

    /** Ensure a word has SR metadata, migrating the old step-based format if present */
    ensure(word) {
        if (!word.sr) {
            word.sr = SRS.defaultState();
        }
        if (word.sr.step !== undefined) {
            const oldIntervalDays = word.sr.interval || 0;
            word.sr = {
                interval: oldIntervalDays,
                reps: oldIntervalDays > 0 ? 1 : 0, // Roughly guess reps
                easeFactor: 2.5,
                nextReview: word.sr.nextReview || 0,
                lastReview: word.sr.lastReview || null,
            };
        }
        return word;
    },
};
