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
        const srcName = AIPrompts.getLangName(srcLang);
        const tgtName = AIPrompts.getLangName(tgtLang);
        return `Create 1 natural everyday sentence (5-15 words) in ${srcName} using "${word}" (meaning: "${translated}").
The sentence must be practical, authentic, and clearly demonstrate the word's meaning in context for language learners. Translate the sentence to ${tgtName}.
Respond ONLY with JSON:
{"sentence": "...", "translation": "..."}`;
    },

    /**
     * Used by core.js (geminiExplainSentence) when the user asks the
     * extension to explain/translate a subtitle sentence they didn't understand.
     */
    explainSentence(sentence, targetLang) {
        const tgtName = AIPrompts.getLangName(targetLang);
        return `Explain this video subtitle sentence in ${targetLang}:
"${sentence}"

Instructions for language learner assistance:
1. "source_language": Detect the sentence language and return only its lowercase ISO 639-1 code (for example "en", "es", "de").
2. "translation": Accurate, natural, context-aware translation in ${tgtName} (${targetLang}), preserving spoken conversational nuances.
3. "explanation": Concise, high-value learning breakdown in ${tgtName} (1-2 short sentences). Explain idioms, phrasal verbs, key vocabulary, or grammatical nuances accurately and to the point.

Respond ONLY with JSON:
{"source_language": "en", "translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by core.js (geminiMovieTranslate) for the "movie-style" subtitle
     * translation + short explanation shown in the tooltip.
     */
    movieTranslate(text, targetLang) {
        const tgtName = AIPrompts.getLangName(targetLang);
        return `Translate this video/movie subtitle to natural ${tgtName} (${targetLang}) for a language learner, with a concise, spot-on explanation in ${tgtName}.
Text: "${text}"

Instructions:
1. "translation": Natural, contextually accurate translation in ${tgtName} capturing authentic spoken tone and idioms.
2. "explanation": Exactly 1 short, high-value sentence in ${tgtName} explaining the key nuance, idiom, phrasal verb, slang, or word usage for a learner.

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
        const context = sentence ? `\nContext sentence: "${sentence}"` : "";

        return `Translate "${word}" (${srcName}) to ${tgtName}.${context}
Instructions for language learner review:
1. "word_translation": Most accurate and natural ${tgtName} translation of "${word}" (matching the context if provided).
2. "sentence_translation": Natural, fluent ${tgtName} translation of the context sentence if provided, otherwise "".
3. "explanation": Concise, spot-on 1-sentence note in ${tgtName} explaining the nuance, part of speech, typical collocation, or usage tip.

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

        return `Create a high-quality pedagogical vocabulary test for language learners.
Language tested: ${srcName}
Instruction language: ${tgtName}
Sections to include: ${chosen}
Nonce: ${opts.nonce || "default"}

Rules for language learning effectiveness:
1. All instructions, hints, and explanations MUST be in ${tgtName}.
2. Target words, options, and test sentences MUST be in ${srcName}.
3. Sentences must be natural, practical, and authentic everyday situations (CEFR A2-B2).
4. multiple_choice: 4 plausible options of the same part of speech, exactly 1 correct answer.
5. fill_blank: Natural context sentence with "___", short and precise hint in ${tgtName}, answer in ${srcName}.
6. matching: 5-8 clear, direct pairs (a=${srcName}, b=${tgtName}).
7. translation: Practical everyday conversational phrase (2-6 words) in ${tgtName} with answer in ${srcName}.
8. true_false: Clear, educational statement in ${tgtName} about word meaning or usage, answer boolean.
9. correct_form: Natural sentence with "___ (lemma)", 3-4 inflected forms in options, answer is correct form.
10. odd_one_out: 4 options in ${srcName} (3 sharing a clear semantic/grammatical category, 1 outlier answer).

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
