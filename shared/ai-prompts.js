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
     * Used by popup.js (aiTranslateReviewCard) for the flashcard "Enter"
     * shortcut in the Review tab — a plain, accurate, dictionary-style AI
     * translation of the currently shown word/sentence (as opposed to the
     * colloquial "movie style" translation used elsewhere), so the user can
     * double-check the meaning on demand without flipping/rating the card.
     */
    standardTranslate(word, sentence, srcLang, tgtLang) {
        const sentencePart = sentence
            ? `\nZdanie z kontekstem: "${sentence}"`
            : "";
        return `Jesteś precyzyjnym tłumaczem słownikowym. Przetłumacz DOKŁADNIE i standardowo (bez stylizacji potocznej/filmowej) poniższe słowo z języka ${srcLang} na język ${tgtLang}.
Słowo: "${word}"${sentencePart}

Podaj najbardziej trafne, standardowe tłumaczenie słowa (uwzględniając kontekst zdania, jeśli podane), a jeśli zdanie zostało podane, przetłumacz też całe zdanie na ${tgtLang}. Odpowiedz WYŁĄCZNIE w tym dokładnym formacie JSON, bez żadnego dodatkowego tekstu:
{"word_translation": "...", "sentence_translation": "..."}`;
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

KRYTYCZNE — dokładna struktura JSON: dla KAŻDEGO typu sekcji użyj DOKŁADNIE takich samych nazw pól jak w przykładzie na końcu (np. "prompt", "pairs", "hint" itd.) — inne/brakujące nazwy pól sprawiają, że pytanie wyświetla się jako PUSTE w aplikacji. Każda sekcja MUSI zawierać przynajmniej 3-4 wypełnione pytania (lub pary dla "matching") — nigdy nie zwracaj pustej tablicy "questions"/"pairs".

Opis dostępnych typów sekcji:
- multiple_choice: pole "questions", każde pytanie ma "question" (po polsku, np. opisujące znaczenie, synonim lub kontekst użycia), "options" (4 opcje w języku ${srcLangAdj}, jedna poprawna + sensowne dystraktory), "answer" (poprawna opcja w języku ${srcLangAdj}).
- fill_blank: pole "questions", każde pytanie ma "sentence" (zdanie W JĘZYKU ${srcLangAdj} z luką "___" w miejscu słówka), "hint" (polskie tłumaczenie DOKŁADNIE brakującego słowa – krótka podpowiedź, NIGDY całe zdanie), "answer" (brakujące słowo w języku ${srcLangAdj}, dokładnie pasujące do luki).
- matching: pole "pairs" (NIE "questions"!) – tablica 4-6 obiektów, każdy ma "a" (słowo źródłowe w języku ${srcLangAdj}) i "b" (jego polskie tłumaczenie). To jedyna sekcja, gdzie polski pojawia się jako część pytania, bo to dopasowywanie, a nie pisanie odpowiedzi.
- translation: pole "questions", każde pytanie ma "prompt" (polecenie PO POLSKU w stylu "Jak powiedzieć po ${srcLangAdj}u: 'słowo'?" – MUSI zawierać konkretne polskie słowo do przetłumaczenia, nigdy nie zostawiaj pustego polecenia) i "answer" (tłumaczenie tego słowa w języku ${srcLangAdj}).
- true_false: pole "questions", każde pytanie ma "statement" (stwierdzenie po polsku o znaczeniu słówka w języku ${srcLangAdj}) i "answer" jako SUROWĄ wartość logiczną JSON true/false (bez cudzysłowów!).
- word_order: pole "questions", każde pytanie ma "words" (potasowana lista pojedynczych wyrazów tworzących poprawne zdanie w języku ${srcLangAdj} zawierające jedno z uczonych słówek) i "answer" (całe poprawnie ułożone zdanie w języku ${srcLangAdj}).
- error_correction: pole "questions", każde pytanie ma "sentence" (zdanie w języku ${srcLangAdj} z jednym celowym błędem GRAMATYCZNYM dotyczącym uczonego słówka – np. zła forma czasownika/czas gramatyczny, zły przyimek, brak/zła forma liczby mnogiej, zły szyk zdania, zły article/rodzajnik, niepoprawna zgoda podmiotu z orzeczeniem; słowo docelowe MUSI być zapisane poprawnie ortograficznie, błąd nie może polegać na literówce) i "answer" (CAŁE poprawione zdanie w języku ${srcLangAdj}).
- odd_one_out: pole "questions", każde pytanie ma "options" (4 słowa w języku ${srcLangAdj}, w tym uczone słówka, z jednej kategorii znaczeniowej + 1 pasujące do innej kategorii) i "answer" (wyraz, który nie pasuje).

Nie używaj wszystkich słówek w każdej sekcji – rozłóż je sensownie pomiędzy sekcje.

Lista słówek:
${wordList}

Odpowiedz WYŁĄCZNIE w tym dokładnym formacie JSON (uwzględnij TYLKO sekcje typów wskazanych powyżej, w podanej kolejności, zachowując dokładnie te same nazwy pól), bez żadnego dodatkowego tekstu:
{
  "title": "Szybka powtórka słownictwa",
  "sections": [
    {
      "type": "multiple_choice",
      "instructions": "Wybierz poprawne słowo pasujące do opisu.",
      "questions": [
        { "question": "Które słowo oznacza 'szybko'?", "options": ["fast", "slow", "car", "dog"], "answer": "fast" }
      ]
    },
    {
      "type": "fill_blank",
      "instructions": "Uzupełnij lukę brakującym słowem. Podpowiedź w nawiasie to polskie tłumaczenie szukanego słowa.",
      "questions": [
        { "sentence": "The list of chores seemed ___, never-ending.", "hint": "niekończąca się / żmudna", "answer": "endless" }
      ]
    },
    {
      "type": "matching",
      "instructions": "Połącz słowo źródłowe z jego polskim tłumaczeniem.",
      "pairs": [
        { "a": "fast", "b": "szybko" },
        { "a": "slow", "b": "wolno" },
        { "a": "car", "b": "samochód" },
        { "a": "dog", "b": "pies" }
      ]
    },
    {
      "type": "translation",
      "instructions": "Podaj tłumaczenie podanego polskiego słowa.",
      "questions": [
        { "prompt": "Jak powiedzieć po angielsku: 'szybko'?", "answer": "fast" }
      ]
    },
    {
      "type": "true_false",
      "instructions": "Zaznacz, czy stwierdzenie jest prawdziwe.",
      "questions": [
        { "statement": "Słowo 'fast' oznacza 'wolno'.", "answer": false }
      ]
    },
    {
      "type": "word_order",
      "instructions": "Ułóż wyrazy w poprawnej kolejności, tworząc zdanie.",
      "questions": [
        { "words": ["is", "This", "fast", "car", "a"], "answer": "This is a fast car" }
      ]
    },
    {
      "type": "error_correction",
      "instructions": "Znajdź i popraw błąd gramatyczny.",
      "questions": [
        { "sentence": "He go to school every day.", "answer": "He goes to school every day." }
      ]
    },
    {
      "type": "odd_one_out",
      "instructions": "Wskaż słowo, które nie pasuje do pozostałych.",
      "questions": [
        { "options": ["apple", "banana", "car", "orange"], "answer": "car" }
      ]
    }
    // ... uwzględnij TYLKO sekcje typów z chosenTypes, w podanej kolejności, z realną treścią dla uczonych słówek
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
