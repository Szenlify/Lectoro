/**
 * Lectoro – AI Prompts
 * Centralized collection of every prompt template sent to the Gemini API
 * across the extension (content scripts + popup). Keeping them in one file
 * makes it easy to review, tweak wording/behavior, or translate the prompts
 * without hunting through the feature code that calls the AI.
 *
 * Each entry is a small function that returns the final prompt string.
 */
const AIPrompts = {
    /**
     * Used by core.js (geminiGenerateSentence) to create one example
     * sentence (+ translation) that shows a learned word in context.
     */
    sentenceExample(word, translated, srcLang, tgtLang) {
        return `You are a language learning assistant. The user is learning the word "${word}" (${srcLang}) which translates to "${translated}" (${tgtLang}).

Generate ONE short, practical, everyday sentence using the word "${word}" in ${srcLang}. The sentence should:
- Be useful in daily conversation
- Be natural and commonly used
- Be 5-15 words long
- Show the word in a clear, memorable context

Then translate that sentence to ${tgtLang}.

Respond ONLY in this exact JSON format, nothing else:
{"sentence": "...", "translation": "..."}`;
    },

    /**
     * Used by core.js (geminiExplainSentence) when the user asks the
     * extension to explain/translate a subtitle sentence they didn't understand.
     */
    explainSentence(sentence, targetLang) {
        return `You are a language learning assistant. The user is watching a video and didn't understand the following sentence:
"${sentence}"

Please explain what this sentence means briefly and concisely. Provide a direct translation to ${targetLang} and a short explanation of any idioms or difficult words if present.

The explanation must be written in Polish.
Respond ONLY in this exact JSON format, nothing else:
{"translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by core.js (geminiMovieTranslate) for the "movie-style" subtitle
     * translation + short explanation shown in the tooltip.
     */
    movieTranslate(text, targetLang) {
        return `You are a movie-style translator. Translate the following text to ${targetLang} as naturally and colloquially as if it were in a film or subtitle. Then provide a short explanation of the sentence in the same target language. Respond ONLY in this exact JSON format, nothing else:\n{"translation":"...", "explanation":"..."}\nText:\n${text}`;
    },

    /**
     * Used by popup.js (generateQuizWithGemini) to build the full,
     * multi-section vocabulary quiz from the user's saved word list.
     * @param {Object} opts
     * @param {string} opts.srcLangAdj - Polish adjective form of the source language (e.g. "angielskim")
     * @param {string} opts.wordList   - formatted "1. "word" = "translation"" list, one per line
     * @param {string} opts.nonce      - random token nudging the model toward varied output
     * @param {string[]} opts.chosenTypes - ordered list of section types to include this generation
     */
    quiz({ srcLangAdj, wordList, nonce, chosenTypes }) {
        return `Jesteś asystentem do nauki języków. Uczeń uczy się słówek w języku ${srcLangAdj} (kolumna "słowo źródłowe" poniżej), a ich polskie tłumaczenie podano tylko jako pomoc. Stwórz bardziej rozbudowany, zróżnicowany i wymagający test/quiz sprawdzający WYŁĄCZNIE znajomość słówek w języku ${srcLangAdj} – każda oczekiwana odpowiedź (luka do uzupełnienia, poprawna opcja, odpowiedź w translation/word_order/error_correction) MUSI być w języku ${srcLangAdj}, NIGDY po polsku. Treści poleceń/instrukcji i ewentualne opisy znaczeń pisz po polsku, żeby uczeń rozumiał zadanie, ale sama odpowiedź zawsze ma być słowem/zdaniem w języku ${srcLangAdj}.

WAŻNE — zróżnicowanie między generacjami: token unikalności ${nonce}. Za KAŻDYM razem, nawet dla identycznej listy słówek, wybierz inny zestaw typów sekcji, inną ich kolejność, inne konkretne pytania, przykłady i zdania – quiz nigdy nie powinien wyglądać tak samo dwa razy z rzędu. W tej generacji użyj DOKŁADNIE tych typów sekcji, w tej kolejności: ${chosenTypes.join(", ")}. Mieszaj też poziom trudności pytań w ramach sekcji (część łatwiejszych, część trudniejszych/podchwytliwych).

Opis dostępnych typów sekcji:
- multiple_choice: pytanie po polsku (np. opisujące znaczenie, synonim lub kontekst użycia), 4 opcje odpowiedzi w języku ${srcLangAdj} (jedna poprawna, pozostałe sensowne dystraktory).
- fill_blank: zdanie W JĘZYKU ${srcLangAdj} z luką "___" w miejscu słówka; odpowiedź to brakujące słowo w języku ${srcLangAdj}.
- matching: pary słowo źródłowe (${srcLangAdj}) <-> polskie tłumaczenie, do połączenia (jedyna sekcja, gdzie polski się pojawia, bo to dopasowywanie a nie pisanie odpowiedzi).
- translation: polecenie po polsku w stylu "Jak powiedzieć po ${srcLangAdj}u: '<polskie słowo>'?"; odpowiedź to słowo w języku ${srcLangAdj}.
- true_false: stwierdzenie po polsku o znaczeniu słówka w języku ${srcLangAdj} (prawda/fałsz), odpowiedź to tylko true/false.
- word_order: podaj potasowaną listę pojedynczych wyrazów tworzących poprawne zdanie w języku ${srcLangAdj} zawierające jedno z uczonych słówek (pole "words"); odpowiedź ("answer") to całe poprawnie ułożone zdanie w języku ${srcLangAdj}.
- error_correction: podaj zdanie w języku ${srcLangAdj} zawierające jeden celowy błąd GRAMATYCZNY dotyczący uczonego słówka (np. zła forma czasownika/czas gramatyczny, zły przyimek, brak/zła forma liczby mnogiej, zły szyk zdania, zły article/rodzajnik, niepoprawna zgoda podmiotu z orzeczeniem) — słowo docelowe MUSI być zapisane poprawnie ortograficznie, błąd nie może polegać na literówce ani zmienionej pojedynczej literze w pisowni. Odpowiedź ("answer") to CAŁE poprawione zdanie w języku ${srcLangAdj}.
- odd_one_out: podaj 4 słowa w języku ${srcLangAdj} (w tym uczone słówka) z jednej kategorii znaczeniowej + 1 pasujące do innej kategorii (pole "options"); odpowiedź ("answer") to wyraz, który nie pasuje.

Nie używaj wszystkich słówek w każdej sekcji – rozłóż je sensownie pomiędzy sekcje.

Lista słówek:
${wordList}

Odpowiedz WYŁĄCZNIE w tym dokładnym formacie JSON (uwzględnij TYLKO sekcje typów wskazanych powyżej, w podanej kolejności), bez żadnego dodatkowego tekstu:
{
  "title": "krótki tytuł quizu",
  "sections": [
    {"type": "multiple_choice", "instructions": "...", "questions": [{"question": "...", "options": ["...","...","...","..."], "answer": "..."}]},
    {"type": "fill_blank", "instructions": "...", "questions": [{"sentence": "... ___ ...", "answer": "..."}]},
    {"type": "matching", "instructions": "...", "pairs": [{"a": "...", "b": "..."}]},
    {"type": "translation", "instructions": "...", "questions": [{"prompt": "...", "answer": "..."}]},
    {"type": "true_false", "instructions": "...", "questions": [{"statement": "...", "answer": true}]},
    {"type": "word_order", "instructions": "...", "questions": [{"words": ["...","...","..."], "answer": "..."}]},
    {"type": "error_correction", "instructions": "...", "questions": [{"sentence": "...", "answer": "..."}]},
    {"type": "odd_one_out", "instructions": "...", "questions": [{"options": ["...","...","...","..."], "answer": "..."}]}
  ]
}`;
    },
};

// Content scripts share a plain global scope, popup.html/background.js run in
// their own page-like contexts — expose on window when available so all
// consumers (core.js, popup.js) can use the same `AIPrompts` reference.
if (typeof window !== "undefined") {
    window.AIPrompts = AIPrompts;
}
