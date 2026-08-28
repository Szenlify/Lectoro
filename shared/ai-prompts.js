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
    if (typeof require !== "undefined") {
      try {
        const constants = require("./constants");
        if (constants && typeof constants.getLanguageName === "function") {
          return constants.getLanguageName(code);
        }
      } catch (_) { }
    }
    return code ? String(code).toUpperCase() : "Polish";
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

  /** Helper to format surrounding movie dialogue context (before / after) */
  formatSubtitleContext(context) {
    if (!context || typeof context !== "object") return "";

    const normalizeLines = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) {
        return val.map((s) => String(s || "").trim()).filter(Boolean);
      }
      if (typeof val === "string") {
        const trimmed = val.trim();
        return trimmed ? [trimmed] : [];
      }
      return [];
    };

    const before = normalizeLines(context.before);
    const after = normalizeLines(context.after);

    if (before.length === 0 && after.length === 0) return "";

    const sections = ["\nSURROUNDING MOVIE DIALOGUE CONTEXT (Reference only - do NOT translate these):"];
    if (before.length > 0) {
      sections.push("Previous dialogue:");
      for (const line of before) {
        sections.push(`- "${line}"`);
      }
    }
    if (after.length > 0) {
      sections.push("Following dialogue:");
      for (const line of after) {
        sections.push(`- "${line}"`);
      }
    }

    return sections.join("\n");
  },

  /**
   * Used by core.js (geminiExplainSentence) when the user asks the
   * extension to explain/translate a subtitle sentence they didn't understand.
   */
  explainSentence(sentence, targetLang, context = null) {
    const tgtName = AIPrompts.getLangName(targetLang);
    const contextBlock = AIPrompts.formatSubtitleContext(context);
    const hasContext = !!contextBlock;

    return `Explain this video subtitle sentence in ${targetLang}:
"${sentence}"
${hasContext ? `${contextBlock}\n` : ""}
Instructions for language learner assistance:
1. "source_language": Detect the sentence language and return only its lowercase ISO 639-1 code (for example "en", "es", "de").
2. "translation": Accurate, natural, context-aware translation in ${tgtName} (${targetLang}), preserving spoken conversational nuances.${
      hasContext
        ? `\n   CRITICAL: Translate ONLY the target sentence ("${sentence}"). DO NOT translate the previous or following dialogue. Use the dialogue context strictly to resolve speaker gender, pronouns, tone, slang, and situational meaning.`
        : ""
    }
3. "explanation": Concise, high-value learning breakdown in ${tgtName} (1-2 short sentences). Explain idioms, phrasal verbs, key vocabulary, or grammatical nuances accurately and to the point.${
      hasContext ? " If the dialogue context clarifies an ambiguous phrase or tone, briefly mention it." : ""
    }

Respond ONLY with JSON:
{"source_language": "en", "translation": "...", "explanation": "..."}`;
  },

  /**
   * Used by core.js (geminiMovieTranslate) for the "movie-style" subtitle
   * translation + short explanation shown in the tooltip.
   */
  movieTranslate(text, targetLang, context = null) {
    const tgtName = AIPrompts.getLangName(targetLang);
    const contextBlock = AIPrompts.formatSubtitleContext(context);
    const hasContext = !!contextBlock;

    return `You are an expert language teacher analyzing a short, possibly incomplete fragment of dialogue from a movie or TV show.
${hasContext ? `${contextBlock}\n` : ""}
The text may be:
- cut off mid-sentence,
- ${hasContext ? "clarified by the surrounding previous/following context," : "missing previous or following context,"}
- informal, colloquial, idiomatic, slang-heavy, or grammatically incomplete,
- difficult to understand literally.

Your job is to infer the most likely meaning from the available context and explain it naturally to a language learner.

IMPORTANT RULES:
1. Preserve the intended meaning of the original fragment, not its literal word-for-word meaning.
2. ${hasContext ? `CRITICAL: Translate ONLY the target text ("${text}"). NEVER translate the surrounding dialogue context. Use surrounding dialogue purely as background reference to understand who is speaking, tone, and situation.` : "If the fragment is incomplete, use the most likely surrounding context to interpret it, but NEVER invent words that are not present in the original text."}
3. Keep the explanation very short and highly informative.
4. Focus only on the most important language point: idiom, phrasal verb, slang, unusual expression, grammar, tone, or meaning.
5. Whenever you mention an original English word or phrase in the explanation, ALWAYS put it in double quotation marks, exactly as it appears in the original text.
6. Do not quote words that are not present in the original text.
7. Do not explain obvious words unless they are important for understanding the sentence.
8. The translation should sound natural in ${tgtName}, like something a native speaker would actually say.
9. Keep the original spoken tone: casual, emotional, sarcastic, rude, humorous, etc., when relevant.
10. Do not over-explain. The explanation must be exactly ONE short sentence.
11. If the text is ambiguous, choose the most probable interpretation and explain it simply.
12. Never mention that you are an AI or that the text is incomplete unless this is essential to understanding the meaning.

Text: "${text}"

Return ONLY valid JSON:
{
  "translation": "...",
  "explanation": "..."
}

Language: ${tgtName} (${targetLang})`;
  },

  /**
   * Used by popup.js (aiTranslateReviewCard) for the flashcard "Enter"
   * shortcut in the Review tab.
   */
standardTranslate(word, sentence, srcLang = "en", tgtLang = "pl") {
    const srcName = AIPrompts.getLangName(srcLang);
    const tgtName = AIPrompts.getLangName(tgtLang);
    const context = sentence ? `\nContext sentence: "${sentence}"` : "";

    return `You are an expert language teacher helping a learner understand the word "${word}" in ${srcName}.

Your task is to explain the word clearly and naturally for a language learner.

IMPORTANT RULES:
1. "word_translation" must be the most accurate and natural ${tgtName} translation of "${word}".
2. ALWAYS use the context sentence to determine the correct meaning when context is provided.
3. If "${word}" has multiple meanings, choose only the meaning that best fits the context.
4. "sentence_translation" must be a natural, fluent ${tgtName} translation of the context sentence, not a literal translation.
5. "explanation" MUST be written entirely in ${tgtName}.
6. "explanation" must be exactly ONE short, useful sentence.
7. Whenever you mention the original ${srcName} word or phrase in "explanation", ALWAYS put it in double quotation marks.
8. Keep the original word or phrase itself in ${srcName}; everything else in "explanation" must be in ${tgtName}.
9. Explain only the most useful point for a learner: meaning in context, usage, part of speech, collocation, phrasal verb, tone, or important nuance.
10. Do not give long dictionary definitions or unnecessary alternative meanings.
11. Do not invent context or information that is not supported by the input.
12. Be concise and practical, like a teacher giving a quick explanation.

Word: "${word}"${context}

Respond ONLY with valid JSON:
{
  "word_translation": "...",
  "sentence_translation": "...",
  "explanation": "..."
}`;
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
  "title": "Lectoro AI Quiz ${tgtName}",
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
