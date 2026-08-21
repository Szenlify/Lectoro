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
    /** Helper resolving full English language name via central LectoroConstants SSOT */
    getLangName(code) {
        if (typeof LectoroConstants !== "undefined" && typeof LectoroConstants.getLanguageName === "function") {
            return LectoroConstants.getLanguageName(code);
        }
        if (typeof SharedConstants !== "undefined" && typeof SharedConstants.getLanguageName === "function") {
            return SharedConstants.getLanguageName(code);
        }
        const c = String(code || "").toLowerCase();
        const fallback = {
            pl: "Polish", en: "English", de: "German", fr: "French",
            es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch",
            sv: "Swedish", cs: "Czech", sk: "Slovak", uk: "Ukrainian",
            ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean",
            ar: "Arabic", hi: "Hindi", tr: "Turkish"
        };
        return fallback[c] || (code ? String(code).toUpperCase() : "Polish");
    },

    /**
     * Used by core.js (geminiGenerateSentence) to create one example
     * sentence (+ translation) that shows a learned word in context.
     */
    sentenceExample(word, translated, srcLang, tgtLang) {
        return `Create 1 natural everyday sentence (5-15 words) in ${srcLang} using "${word}" (meaning: "${translated}"). Translate the sentence to ${tgtLang}.
Respond ONLY with JSON:
{"sentence": "...", "translation": "..."}`;
    },

    /**
     * Used by core.js (geminiExplainSentence) when the user asks the
     * extension to explain/translate a subtitle sentence they didn't understand.
     */
    explainSentence(sentence, targetLang) {
        return `Explain this video subtitle sentence in ${targetLang}:
"${sentence}"

Instructions:
1. "source_language": Detect the sentence language and return only its lowercase ISO 639-1 code (for example "en", "es", "de").
2. "translation": Most common, natural everyday equivalent in ${targetLang} (natural idiom/colloquial translation, avoid obscure slang).
3. "explanation": Brief breakdown of grammar, idioms or vocabulary (1-2 lines) in ${targetLang}.

Respond ONLY with JSON:
{"source_language": "en", "translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by core.js (geminiMovieTranslate) for the "movie-style" subtitle
     * translation + short explanation shown in the tooltip.
     */
    movieTranslate(text, targetLang) {
        return `Translate this movie subtitle to natural ${targetLang} with a brief 1-line explanation in ${targetLang}.
Text: "${text}"
Respond ONLY with JSON:
{"translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by popup.js (aiTranslateReviewCard) for the flashcard "Enter"
     * shortcut in the Review tab.
     */
    standardTranslate(word, sentence, srcLang = "en", tgtLang = "pl") {
        const srcName = AIPrompts.getLangName(srcLang);
        const tgtName = AIPrompts.getLangName(tgtLang);
        const context = sentence ? `\nContext: "${sentence}"` : "";

        return `Translate "${word}" (${srcName}) to ${tgtName}.${context}
Instructions:
1. "word_translation": Accurate standard ${tgtName} translation.
2. "sentence_translation": Translate the context sentence to ${tgtName} if provided, else "".
3. "explanation": Concise 1-sentence note on usage/meaning in ${tgtName}.

Respond ONLY with JSON:
{"word_translation": "...", "sentence_translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by popup (QuizExport) to build a multi-section vocabulary exam.
     */
    quiz(opts) {
        const srcName = opts.srcLangName || AIPrompts.getLangName(opts.srcLang || "en");
        const tgtName = opts.tgtLangName || AIPrompts.getLangName(opts.tgtLang || "pl");
        const chosen = (opts.chosenTypes && opts.chosenTypes.length)
            ? opts.chosenTypes.join(", ")
            : "multiple_choice, fill_blank, matching, translation, correct_form, odd_one_out";

        return `Create a high-quality vocabulary test.
Language tested: ${srcName}
Instruction language: ${tgtName}
Sections to include: ${chosen}
Nonce: ${opts.nonce || "default"}

Rules:
1. Instructions, hints, and explanations in ${tgtName}.
2. Target words, options, and test sentences in ${srcName}.
3. multiple_choice: 4 plausible options, same part of speech, 1 correct.
4. fill_blank: Natural sentence with "___", concise hint in ${tgtName}, answer in ${srcName}.
5. matching: 5-8 pairs (a=${srcName}, b=${tgtName}).
6. translation: Short practical phrase (2-6 words) in ${tgtName} with answer in ${srcName}.
7. true_false: Factual statement in ${tgtName}, answer boolean.
8. correct_form: Sentence with "___ (lemma)", 3-4 inflected forms in options, answer is correct form.
9. odd_one_out: 4 options in ${srcName}, 1 outlier answer.

Vocabulary List:
${opts.wordList}

Respond ONLY with JSON (no markdown outside JSON):
{
  "title": "LetFluent ${tgtName}",
  "sections": [
    {
      "type": "multiple_choice",
      "instructions": "...",
      "questions": [{ "question": "...", "options": ["A", "B", "C", "D"], "answer": "A" }]
    },
    {
      "type": "fill_blank",
      "instructions": "...",
      "questions": [{ "sentence": "... ___ ...", "hint": "...", "answer": "..." }]
    },
    {
      "type": "matching",
      "instructions": "...",
      "pairs": [{ "a": "...", "b": "..." }]
    },
    {
      "type": "translation",
      "instructions": "...",
      "questions": [{ "prompt": "...", "answer": "..." }]
    },
    {
      "type": "true_false",
      "instructions": "...",
      "questions": [{ "statement": "...", "answer": true }]
    },
    {
      "type": "correct_form",
      "instructions": "...",
      "questions": [{ "sentence": "... ___ (lemma) ...", "options": ["f1", "f2", "f3", "f4"], "answer": "f1" }]
    },
    {
      "type": "odd_one_out",
      "instructions": "...",
      "questions": [{ "options": ["w1", "w2", "w3", "outlier"], "answer": "outlier" }]
    }
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
if (typeof module !== "undefined" && module.exports) {
    module.exports = AIPrompts;
}
