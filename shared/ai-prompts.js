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
        return `Jesteś doświadczonym egzaminatorem językowym tworzącym PRAWDZIWY sprawdzian szkolny (na poziomie solidnego testu z języka ${srcLangAdj}), a nie luźny quiz zabawowy. Uczeń uczy się słówek w języku ${srcLangAdj} (kolumna "słowo źródłowe" poniżej), a ich polskie tłumaczenie podano tylko jako pomoc. Stwórz OBSZERNY, rozbudowany, zróżnicowany i wymagający sprawdzian, który RZETELNIE sprawdza rozumienie i poprawne użycie słówek w języku ${srcLangAdj} – każda oczekiwana odpowiedź (luka do uzupełnienia, poprawna opcja, odpowiedź w translation/correct_form/word_from_definition) MUSI być w języku ${srcLangAdj}, NIGDY po polsku. Treści poleceń/instrukcji i ewentualne opisy znaczeń pisz po polsku, żeby uczeń rozumiał zadanie, ale sama odpowiedź zawsze ma być słowem/zdaniem w języku ${srcLangAdj}.

NAJWAŻNIEJSZA ZASADA JAKOŚCI — zero bezsensownych/sztucznych pytań: każde pytanie musi realnie sprawdzać konkretną, jednoznacznie definiowalną umiejętność językową (słownictwo, gramatykę, użycie w kontekście). Zabronione jest tworzenie pytań, w których "poprawna odpowiedź" różni się od materiału wyjściowego w sposób DOWOLNY/PRZYPADKOWY i niezwiązany z żadną testowalną zasadą – uczeń nie może być karany za coś, czego nie miał prawa się domyślić lub wywnioskować. W szczególności:
- dla "correct_form": wszystkie "options" MUSZĄ być różnymi formami GRAMATYCZNYMI dokładnie tego samego słowa bazowego podanego w nawiasie w "sentence" (np. różne czasy/formy czasownika, liczba pojedyncza/mnoga rzeczownika, stopniowanie przymiotnika) – żadna opcja nie może być zupełnie innym słowem ani zawierać dodatkowej treści spoza tej jednej odmiany;
- dla "word_from_definition": "answer" MUSI być dokładnie jednym ze słówek z listy poniżej (dokładnie taką formą, jaka występuje w kolumnie "słowo źródłowe"), a "definition" musi jednoznacznie i WYŁĄCZNIE opisywać znaczenie tego jednego słowa (bez podawania samego słowa ani jego tłumaczenia wprost);
- dystraktory w multiple_choice/odd_one_out muszą być prawdopodobne i tej samej kategorii gramatycznej/części mowy (nie oczywiste absurdy ułatwiające zgadywanie);
- "hint" w fill_blank nie może zdradzać całej odpowiedzi ani być z nią identyczny.
Przykład ŹLE dla "correct_form" (zabronione — opcje to różne słowa, nie formy tego samego słowa): { "sentence": "Yesterday I ___ (go) to the cinema.", "options": ["go", "walk", "run", "drive"], "answer": "went" }
Przykład DOBRZE (opcje to wyłącznie formy czasownika "go"): { "sentence": "Yesterday I ___ (go) to the cinema.", "options": ["go", "goes", "went", "gone"], "answer": "went" }

WAŻNE — zróżnicowanie między generacjami: token unikalności ${nonce}. Za KAŻDYM razem, nawet dla identycznej listy słówek, wybierz inny zestaw typów sekcji, inną ich kolejność, inne konkretne pytania, przykłady i zdania – quiz nigdy nie powinien wyglądać tak samo dwa razy z rzędu. W tej generacji użyj DOKŁADNIE tych typów sekcji, w tej kolejności: ${chosenTypes.join(", ")}. Mieszaj też poziom trudności pytań w ramach sekcji (część łatwiejszych, część trudniejszych/podchwytliwych, na poziomie realnego sprawdzianu szkolnego, nie infantylnego quizu).

ROZMIAR SPRAWDZIANU — ma być OBSZERNY: każda sekcja MUSI zawierać co najmniej 5-6 w pełni wypełnionych, sensownych pytań (dla "matching": co najmniej 5-6 par) — nigdy nie zwracaj pustej ani ubogiej (1-2 pozycje) tablicy "questions"/"pairs". Rozłóż słówka pomiędzy sekcje tak, aby W CAŁYM SPRAWDZIANIE (łącznie, we wszystkich sekcjach) każde słówko z listy pojawiło się przynajmniej raz — najlepiej kilka razy, w różnych sekcjach i różnych formach/kontekstach gramatycznych, żeby dokładnie sprawdzić całą listę, a nie tylko jej wybrany fragment.

KRYTYCZNE — dokładna struktura JSON: dla KAŻDEGO typu sekcji użyj DOKŁADNIE takich samych nazw pól jak w przykładzie na końcu (np. "prompt", "pairs", "hint" itd.) — inne/brakujące nazwy pól sprawiają, że pytanie wyświetla się jako PUSTE w aplikacji.

Opis dostępnych typów sekcji:
- multiple_choice: pole "questions", każde pytanie ma "question" (po polsku, np. opisujące znaczenie, synonim lub kontekst użycia — konkretne i jednoznaczne, tak by istniała dokładnie JEDNA poprawna odpowiedź), "options" (4 opcje w języku ${srcLangAdj}, jedna poprawna + 3 sensowne, prawdopodobne dystraktory tej samej kategorii/części mowy — bez oczywistych, śmiesznych odpowiedzi ułatwiających zgadywanie), "answer" (poprawna opcja w języku ${srcLangAdj}, dokładnie zgodna z jedną z "options").
- fill_blank: pole "questions", każde pytanie ma "sentence" (naturalne, sensowne zdanie W JĘZYKU ${srcLangAdj} z DOKŁADNIE JEDNĄ luką "___" w miejscu słówka, jednoznacznie wskazujące jaki wyraz pasuje z kontekstu), "hint" (krótkie polskie tłumaczenie DOKŁADNIE brakującego słowa – tylko podpowiedź, NIGDY całe zdanie ani synonim zdradzający więcej niż samo słowo), "answer" (brakujące słowo w języku ${srcLangAdj}, dokładnie pasujące gramatycznie i logicznie do luki).
- matching: pole "pairs" (NIE "questions"!) – tablica co najmniej 5-6 obiektów, każdy ma "a" (słowo źródłowe w języku ${srcLangAdj}) i "b" (jego polskie tłumaczenie, zgodne z listą słówek). To jedyna sekcja, gdzie polski pojawia się jako część pytania, bo to dopasowywanie, a nie pisanie odpowiedzi.
- translation: pole "questions", każde pytanie ma "prompt" (polecenie PO POLSKU w stylu "Jak powiedzieć po ${srcLangAdj}u: 'słowo lub krótkie zdanie'?" – MUSI zawierać konkretną polską frazę do przetłumaczenia, nigdy nie zostawiaj pustego polecenia) i "answer" (dokładne tłumaczenie tej frazy w języku ${srcLangAdj}).
- true_false: pole "questions", każde pytanie ma "statement" (konkretne, jednoznaczne stwierdzenie po polsku o znaczeniu lub użyciu słówka w języku ${srcLangAdj} — na tyle precyzyjne, by dało się je jednoznacznie ocenić jako prawdziwe lub fałszywe, unikaj stwierdzeń niejasnych/dyskusyjnych) i "answer" jako SUROWĄ wartość logiczną JSON true/false (bez cudzysłowów!).
- correct_form: pole "questions", każde pytanie ma "sentence" (naturalne zdanie w języku ${srcLangAdj} z DOKŁADNIE JEDNĄ luką "___", a zaraz po niej – w nawiasie – bazowa/słownikowa forma uczonego słówka, np. "Yesterday I ___ (go) to the cinema."), "options" (3-4 różne formy GRAMATYCZNE TEGO SAMEGO słowa z nawiasu – np. różne czasy/osoby czasownika, liczba pojedyncza/mnoga, stopień przymiotnika – dokładnie jedna z nich poprawnie uzupełnia zdanie) i "answer" (poprawna forma, dokładnie zgodna z jedną z "options"). To zadanie sprawdza znajomość gramatyki/odmiany słówka w realnym kontekście zdania, tak jak w prawdziwym sprawdzianie szkolnym.
- word_from_definition: pole "questions", każde pytanie ma "definition" (zwięzły, jednoznaczny opis/definicja PO POLSKU znaczenia lub zastosowania jednego konkretnego uczonego słówka – bez podawania samego słowa ani jego tłumaczenia wprost, np. "Uczucie silnej niechęci lub wstrętu do czegoś.") i "answer" (dokładnie to słowo w języku ${srcLangAdj}, TAKIE SAMO jak w kolumnie "słowo źródłowe" listy słówek). To zadanie sprawdza aktywne przypominanie sobie słówka na podstawie jego znaczenia, a nie tylko rozpoznawanie.
- odd_one_out: pole "questions", każde pytanie ma "options" (4 słowa w języku ${srcLangAdj} tej samej części mowy/kategorii gramatycznej, w tym uczone słówka, z jednej wyraźnej kategorii znaczeniowej + 1 pasujące do innej, jednoznacznie odmiennej kategorii — bez dwuznaczności co do tego, które słowo nie pasuje) i "answer" (wyraz, który nie pasuje).

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
      "type": "correct_form",
      "instructions": "Uzupełnij zdanie poprawną formą słowa podanego w nawiasie.",
      "questions": [
        { "sentence": "Yesterday I ___ (go) to the cinema.", "options": ["go", "goes", "went", "gone"], "answer": "went" }
      ]
    },
    {
      "type": "word_from_definition",
      "instructions": "Odgadnij słowo na podstawie definicji i zapisz je w języku źródłowym.",
      "questions": [
        { "definition": "Uczucie silnej niechęci lub wstrętu do czegoś.", "answer": "hate" }
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
