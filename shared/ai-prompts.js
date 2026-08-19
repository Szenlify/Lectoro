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

Please explain what this sentence means briefly and concisely. Provide a translation to ${targetLang}. 
IMPORTANT: If the sentence is an idiom, slang, or contains figurative language, the "translation" field MUST contain its MOST COMMON, universally understood natural equivalent in ${targetLang}. Do NOT use literal word-for-word translations, and strictly AVOID obscure, regional, or overly creative slang expressions.
In the "explanation" field, provide a short breakdown of the grammar, idioms, or difficult words used, including the literal translation if it helps with understanding.

The explanation must be written in ${targetLang}.
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
    standardTranslate(word, sentence, srcLang = "en", tgtLang = "pl") {
        const srcName = AIPrompts.getLangName(srcLang);
        const tgtName = AIPrompts.getLangName(tgtLang);

        const contextPart = sentence ? `\nContext Sentence: "${sentence}"` : "";
        const sentenceRule = sentence
            ? `Translate the context sentence into ${tgtName}.`
            : `Set "sentence_translation" to "".`;

        return `You are a precise dictionary translator. Translate the word from ${srcName} into ${tgtName} accurately and neutrally.
Word: "${word}"${contextPart}

Instructions:
1. Provide the most accurate standard ${tgtName} translation for the word (considering context if provided).
2. ${sentenceRule}
3. Provide a concise explanation (1-2 sentences max) of meaning or usage in ${tgtName}.

Respond ONLY with valid JSON (no markdown):
{"word_translation": "...", "sentence_translation": "...", "explanation": "..."}`;
    },

    /**
     * Used by popup (QuizExport) to build a multi-section vocabulary exam
     * from the user's saved word list.
     * @param {Object} opts
     * @param {string} [opts.srcLang]     - ISO code of studied language (e.g. "en")
     * @param {string} [opts.tgtLang]     - ISO code of target/instruction language (e.g. "pl")
     * @param {string} [opts.srcLangName] - Full English name of studied language (e.g. "English")
     * @param {string} [opts.tgtLangName] - Full English name of instruction language (e.g. "Polish")
     * @param {string} [opts.srcLangAdj]  - Backward-compatibility fallback
     * @param {string} opts.wordList      - Formatted word list
     * @param {string} opts.nonce         - Random token for generation diversity
     * @param {string[]} opts.chosenTypes - Ordered section types to include
     */
    quiz(opts) {
        const srcName = opts.srcLangName || AIPrompts.getLangName(opts.srcLang || "en");
        const tgtName = opts.tgtLangName || AIPrompts.getLangName(opts.tgtLang || "pl");
        const chosen = (opts.chosenTypes && opts.chosenTypes.length)
            ? opts.chosenTypes.join(", ")
            : "multiple_choice, fill_blank, matching, translation, correct_form, odd_one_out";

        return `You are an expert language examiner and curriculum author creating a rigorous, high-value vocabulary exam.
Target language being tested/learned: ${srcName}
Student's native/instruction language: ${tgtName}

CORE PEDAGOGICAL & QUALITY RULES:
1. ALL instructions, question prompts/descriptions, fill-in-the-blank hints, and true/false statements MUST be written in ${tgtName} so the student clearly understands the exercise.
2. ALL tested vocabulary, answer keys, fill-in sentences, multiple-choice options, and word pairs MUST be in ${srcName}.
3. ZERO SILLY, TRIVIAL, OR ILLOGICAL QUESTIONS:
   - multiple_choice: Test contextual comprehension, nuance, or collocations. Provide 4 plausible options in ${srcName} of the EXACT same grammatical category (part of speech). Strictly NO absurd/silly distractors. Exactly one correct answer.
   - fill_blank: Natural, fluent sentence in ${srcName} with rich context and exactly one blank "___". "hint" in ${tgtName} must be a concise clue/translation of ONLY the missing word (never the whole sentence or the answer itself). "answer" in ${srcName} must fit the blank perfectly.
   - matching: 5-8 pairs where "a" is the term in ${srcName} and "b" is its accurate, natural translation in ${tgtName}.
   - translation: MUST be a concise, practical, everyday phrase or short sentence (2-6 words) testing the target vocabulary. NEVER copy long, rambling, slang-heavy subtitle quotes verbatim (e.g. avoid quotes like "If the first option fails, number two, what you gon' do?"). Instead, formulate a clear, concise phrase in ${tgtName} and standard, clean translation in ${srcName} (e.g. "Co zrobisz?" -> "What will you do?"). "answer" MUST be standard, clean spelling and grammar without conversational filler or slang contractions.
   - true_false: "statement" in ${tgtName} with an objective, factual claim about the meaning or usage of a word in ${srcName}. "answer" must be a raw JSON boolean (true or false).
   - correct_form: "sentence" in ${srcName} with "___ (lemma)" (e.g., "Yesterday she ___ (choose) a great book."). "options" MUST be 3-4 inflected grammatical forms of THAT EXACT SAME lemma (e.g. ["chose", "chooses", "choosing", "chosen"]). Strictly NO unrelated words. "answer" is the grammatically correct form.
   - odd_one_out: 4 options in ${srcName} of the same part of speech; 3 belong to a specific semantic category and 1 is a clear outlier. "answer" is the outlier word.
4. CLEAN & CONDENSE FLASHCARDS:
   - The provided vocabulary list may contain long movie quotes or conversational subtitle lines.
   - When constructing questions across all sections, distill and condense them into clean, high-value, standard language exercises.

STRUCTURE & DIVERSITY:
- Generation uniqueness nonce: ${opts.nonce || "default"}.
- Include EXACTLY these section types in this order: ${chosen}.
- Each section MUST contain at least 4-6 complete, meaningful questions (or pairs for matching).
- Distribute and test words from the vocabulary list across all sections.

VOCABULARY LIST:
${opts.wordList}

Respond ONLY with a valid JSON object matching this structure (no markdown formatting outside JSON, no comments):
{
  "title": "<LetFluent ${tgtName}>",
  "sections": [
    {
      "type": "multiple_choice",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "question": "<Question/context prompt in ${tgtName}>", "options": ["optA", "optB", "optC", "optD"], "answer": "optA" }
      ]
    },
    {
      "type": "fill_blank",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "sentence": "Context sentence with ___ for the word.", "hint": "<hint in ${tgtName}>", "answer": "word" }
      ]
    },
    {
      "type": "matching",
      "instructions": "<Task instructions in ${tgtName}>",
      "pairs": [
        { "a": "<src_word>", "b": "<tgt_translation>" }
      ]
    },
    {
      "type": "translation",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "prompt": "<Phrase in ${tgtName} to translate>", "answer": "<translation in ${srcName}>" }
      ]
    },
    {
      "type": "true_false",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "statement": "<Factual statement in ${tgtName}>", "answer": true }
      ]
    },
    {
      "type": "correct_form",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "sentence": "Sentence with ___ (lemma).", "options": ["form1", "form2", "form3", "form4"], "answer": "form1" }
      ]
    },
    {
      "type": "odd_one_out",
      "instructions": "<Task instructions in ${tgtName}>",
      "questions": [
        { "options": ["wordA", "wordB", "wordC", "outlierWord"], "answer": "outlierWord" }
      ]
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
