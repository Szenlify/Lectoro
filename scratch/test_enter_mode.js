/**
 * Verification test for Enter mode improvements:
 * 1. CSS color inversion in styles.css for data-type="sentence"
 * 2. 1/1 condition explains, >1 omits sentence explanation
 * 3. Manual navigation disables auto-advance
 * 4. Saving word/idiom sets sentenceTranslated from full sentence translation
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// 1. Verify styles.css
const cssPath = path.join(__dirname, "../styles.css");
const cssContent = fs.readFileSync(cssPath, "utf-8");

const termMatch = cssContent.match(
    /#__qt_sentence_translation\s+\.__qt_ai-term-card\[data-type="sentence"\]\s+\.__qt_ai-term\s*\{([^}]+)\}/,
);
assert(termMatch, "Sentence .__qt_ai-term rule must exist in styles.css");
assert(
    termMatch[1].includes("color: #00ffea !important;"),
    `Original sentence text must be cyan/blue (#00ffea). Got: ${termMatch[1]}`,
);

const meaningMatch = cssContent.match(
    /#__qt_sentence_translation\s+\.__qt_ai-term-card\[data-type="sentence"\]\s+\.__qt_ai-term-meaning\s*\{([^}]+)\}/,
);
assert(meaningMatch, "Sentence .__qt_ai-term-meaning rule must exist in styles.css");
assert(
    meaningMatch[1].includes("color: rgba(255, 255, 255, 0.95) !important;"),
    `Translated sentence text must be white. Got: ${meaningMatch[1]}`,
);
console.log("✓ Test 1 Passed: styles.css color swapping verified successfully.");

// 2. Verify subtitle-overlay.js logic
const jsPath = path.join(__dirname, "../video/subtitle-overlay.js");
const jsContent = fs.readFileSync(jsPath, "utf-8").replace(/\r\n/g, "\n");

// Verify speakUntilFinished is defined
assert(
    jsContent.includes("function speakUntilFinished(text, lang, opts = {})"),
    "speakUntilFinished helper must be defined in subtitle-overlay.js",
);

// Verify 1/1 condition for explanation:
assert(
    jsContent.includes("const isSentenceWithBreakdown = totalItems > 1 && item.type === \"sentence\";"),
    "isSentenceWithBreakdown must check totalItems > 1",
);
assert(
    jsContent.includes("const isSingleSentence = aiExplainQueue.length <= 1;"),
    "isSingleSentence must check queue length <= 1",
);

// Verify auto-advance disabling on manual navigation:
assert(
    jsContent.includes("let aiAutoAdvanceDisabled = false;"),
    "aiAutoAdvanceDisabled flag must be declared",
);
assert(
    jsContent.includes("if (manual) {\n            aiAutoAdvanceDisabled = true;\n        }"),
    "showAiExplainItem must set aiAutoAdvanceDisabled when manual is true",
);
assert(
    jsContent.includes("!aiAutoAdvanceDisabled && aiExplainIndex + 1 < aiExplainQueue.length"),
    "speakAiExplainItem must check !aiAutoAdvanceDisabled before scheduling auto advance",
);

// Verify flashcard sentenceTranslated saving:
assert(
    jsContent.includes("sentenceTranslated: contextSentenceTranslated,"),
    "wireAiExplainSaveButton must pass contextSentenceTranslated to QT.saveWord",
);
assert(
    jsContent.includes("aiSentenceTranslated: contextSentenceTranslated,"),
    "wireAiExplainSaveButton must pass contextSentenceTranslated to aiSentenceTranslated",
);
assert(
    jsContent.includes("sentenceTranslated: translation,"),
    "handleAIExplain must propagate translation to breakdownItems",
);

console.log("✓ Test 2 Passed: 1/1 explanation, manual advance suppression, and flashcard sentenceTranslated verified successfully.");

// 3. Verify video-hotkeys.js passes manual: true
const hotkeysPath = path.join(__dirname, "../video/video-hotkeys.js");
const hotkeysContent = fs.readFileSync(hotkeysPath, "utf-8");
assert(
    hotkeysContent.includes("nextAiExplainItem?.({ manual: true })"),
    "video-hotkeys must pass manual: true on next item navigation",
);
assert(
    hotkeysContent.includes("prevAiExplainItem?.({ manual: true })"),
    "video-hotkeys must pass manual: true on prev item navigation",
);
console.log("✓ Test 3 Passed: video-hotkeys.js manual flag verified successfully.");

// 4. Verify Task 12.1: No word expansion in styles.css
const aiWrapMatch = cssContent.match(/\.__qt_ai-sub-wrap\s*\{([^}]+)\}/);
assert(aiWrapMatch, ".__qt_ai-sub-wrap rule must exist in styles.css");
assert(
    aiWrapMatch[1].includes("padding: 0 !important;"),
    `.__qt_ai-sub-wrap must have padding: 0 !important to prevent word expansion. Got: ${aiWrapMatch[1]}`,
);
assert(
    aiWrapMatch[1].includes("margin: 0 !important;"),
    `.__qt_ai-sub-wrap must have margin: 0 !important. Got: ${aiWrapMatch[1]}`,
);

const aiActiveMatch = cssContent.match(/\.__qt_ai-sub-wrap\.__qt_ai-sub-active[^{]*\{([^}]+)\}/);
assert(aiActiveMatch, ".__qt_ai-sub-active rule must exist in styles.css");
assert(
    aiActiveMatch[1].includes("padding: 0 !important;"),
    `.__qt_ai-sub-active must have padding: 0 !important. Got: ${aiActiveMatch[1]}`,
);
assert(
    aiActiveMatch[1].includes("box-shadow: inset 0 0 0 1px #4ecdc4"),
    `.__qt_ai-sub-active must use inset box-shadow to prevent outer layout expansion. Got: ${aiActiveMatch[1]}`,
);
console.log("✓ Test 4 Passed: Task 12.1 subtitle word non-expansion verified successfully.");

// 5. Verify Task 12.2 Part 1: popup UI and settings persistence
const popupHtmlPath = path.join(__dirname, "../popup.html");
const popupHtmlContent = fs.readFileSync(popupHtmlPath, "utf-8");
assert(
    popupHtmlContent.includes('id="aiExplanationLanguage"'),
    "popup.html must contain select with id='aiExplanationLanguage'",
);
assert(
    popupHtmlContent.includes('value="native"') && popupHtmlContent.includes('value="simple_target"'),
    "popup.html must provide 'native' and 'simple_target' options",
);

const popupInitPath = path.join(__dirname, "../popup/init.js");
const popupInitContent = fs.readFileSync(popupInitPath, "utf-8");
assert(
    popupInitContent.includes('aiExplanationLanguage: "native"'),
    "popup/init.js must include aiExplanationLanguage default in POPUP_INIT_KEYS",
);

const popupSettingsPath = path.join(__dirname, "../popup/settings.js");
const popupSettingsContent = fs.readFileSync(popupSettingsPath, "utf-8");
assert(
    popupSettingsContent.includes('aiExplanationLanguage'),
    "popup/settings.js must bind aiExplanationLanguage",
);
console.log("✓ Test 5 Passed: popup UI and settings persistence verified successfully.");

// 6. Verify Task 12.2 Part 2: AIPrompts.explainSentence simple_target mode
global.LectoroConstants = require("../shared/constants.js");
global.SharedUtils = require("../shared/utils.js");
const AIPrompts = require("../shared/ai-prompts.js");

const defaultPrompt = AIPrompts.explainSentence("The cat sat on the mat.", "pl");
assert(
    defaultPrompt.includes("Explain this video subtitle sentence in pl:"),
    "Default prompt must target native language pl",
);
assert(
    defaultPrompt.includes('Concise, high-value learning breakdown in Polish (1-2 short sentences)'),
    "Default prompt must request explanation in Polish",
);

const simpleTargetPrompt = AIPrompts.explainSentence(
    "The cat sat on the mat.",
    "pl",
    null,
    { aiExplanationLanguage: "simple_target" },
);
assert(
    simpleTargetPrompt.includes("Explain this video subtitle sentence in simple language (CEFR A2-B1"),
    "Simple target prompt must include CEFR A2-B1 instructions in prompt header",
);
assert(
    simpleTargetPrompt.includes("written in SIMPLE, clear words in the sentence's original language (CEFR A2-B1 level"),
    "Simple target prompt must request explanation in simple target language",
);
assert(
    simpleTargetPrompt.includes('translation": Accurate, natural, context-aware translation in Polish (pl)'),
    "Simple target prompt must keep translation in native language (Polish)",
);
console.log("✓ Test 6 Passed: AIPrompts.explainSentence simple_target mode verified successfully.");

// 7. Verify Task 12.2 Part 3: SharedTranslatorService & core.js delegation
const translatorPath = path.join(__dirname, "../shared/translator-service.js");
const translatorContent = fs.readFileSync(translatorPath, "utf-8");
assert(
    translatorContent.includes("getAiExplanationLanguage"),
    "translator-service.js must define and export getAiExplanationLanguage",
);
assert(
    translatorContent.includes("aiExplanationLanguage"),
    "translator-service.js explainSentence must forward aiExplanationLanguage",
);

const corePath = path.join(__dirname, "../core.js");
const coreContent = fs.readFileSync(corePath, "utf-8");
assert(
    coreContent.includes("getAiExplanationLanguage: () => SharedTranslatorService.getAiExplanationLanguage()"),
    "core.js must expose getAiExplanationLanguage",
);
assert(
    coreContent.includes("geminiExplainSentence: (s, tgt, ctx = null, opts = {}) => SharedTranslatorService.explainSentence(s, tgt, ctx, opts)"),
    "core.js geminiExplainSentence must forward opts",
);
console.log("✓ Test 7 Passed: translator-service and core.js delegation verified successfully.");

// 8. Verify Task 12.2 Part 4: subtitle-overlay.js TTS voice and settings integration
assert(
    jsContent.includes("let aiExplainMode = \"native\";"),
    "subtitle-overlay.js must declare aiExplainMode state",
);
assert(
    jsContent.includes("const aiExplanationLanguage ="),
    "subtitle-overlay.js must query getAiExplanationLanguage",
);
assert(
    jsContent.includes("aiExplainMode === \"simple_target\""),
    "subtitle-overlay.js must handle simple_target for TTS voice selection",
);
console.log("✓ Test 8 Passed: subtitle-overlay.js simple_target TTS voice verified successfully.");

console.log("\nALL ENTER MODE & SETTING IMPROVEMENTS VERIFIED! 🚀");
