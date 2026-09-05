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
    { aiExplanationLanguage: "simple_target", sourceLang: "en" },
);
assert(
    simpleTargetPrompt.includes("All outputs (simplified sentence, meanings, explanations) MUST be written 100% EXCLUSIVELY in English (en)"),
    "Simple target prompt must enforce 100% exclusive output in target language (English)",
);
assert(
    simpleTargetPrompt.includes("NEVER translate into Polish, Polish, Spanish, or any other language.") || simpleTargetPrompt.includes("NEVER translate into Polish"),
    "Simple target prompt must explicitly forbid translating into native language",
);
assert(
    simpleTargetPrompt.includes("DO NOT translate to Polish - write it in simple English (en)"),
    "Simple target prompt must instruct not to translate sentence to Polish",
);
assert(
    simpleTargetPrompt.includes("a simple synonym or short, basic definition (1-4 words) in simple English (en)"),
    "Simple target prompt must request item meanings in simple target language",
);
assert(
    simpleTargetPrompt.includes("DO NOT use Polish or any native language"),
    "Simple target prompt must explicitly ban native language from item meanings",
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
const updatedJsContent = fs.readFileSync(jsPath, "utf-8");
assert(
    updatedJsContent.includes("let aiExplainMode = \"native\";"),
    "subtitle-overlay.js must declare aiExplainMode state",
);
assert(
    updatedJsContent.includes("const aiExplanationLanguage ="),
    "subtitle-overlay.js must query getAiExplanationLanguage",
);
assert(
    updatedJsContent.includes("aiExplainMode === \"simple_target\""),
    "subtitle-overlay.js must handle simple_target for TTS voice selection",
);
console.log("✓ Test 8 Passed: subtitle-overlay.js simple_target TTS voice verified successfully.");

// 9. Verify Phase 14: Auto-close after queue completion & simple_target TTS refinement
assert(
    updatedJsContent.includes("closeAiTooltip({ resumeVideo: true });"),
    "subtitle-overlay.js must auto-close tooltip and resume video at queue end",
);
const normalizedJs = updatedJsContent.replace(/\r\n/g, "\n");
assert(
    normalizedJs.includes("const sentenceLang =\n                    aiExplainMode === \"simple_target\"\n                        ? aiExplainSourceLang\n                        : aiExplainTargetLang;"),
    "subtitle-overlay.js must speak simplified sentence in sourceLang when in simple_target mode",
);
assert(
    !normalizedJs.includes("if (aiExplainMode === \"simple_target\") {\n                    if (item.meaning) {"),
    "subtitle-overlay.js must not speak native language meaning in simple_target mode breakdown items",
);
assert(
    normalizedJs.includes("if (aiExplainMode === \"simple_target\" && breakdownItems.length > 0) {\n                aiExplainQueue = breakdownItems;"),
    "subtitle-overlay.js must skip sentence card in simple_target mode when breakdown items exist",
);
console.log("✓ Test 9 Passed: Auto-close & simple_target TTS enhancements verified successfully.");

// 10. Verify Phase 15: Subtitle word hover suppression & click-to-scroll navigation in Enter mode
const latestJs = fs.readFileSync(jsPath, "utf-8").replace(/\r\n/g, "\n");
assert(
    latestJs.includes("wordCloudActive ||\n                aiTooltipActive"),
    "subtitle-overlay.js mousemove must suppress word hover when aiTooltipActive is true",
);
assert(
    latestJs.includes("if (aiTooltipActive) {\n                // In Enter mode: clicking a highlighted subtitle word navigates to it in the AI queue"),
    "subtitle-overlay.js click must intercept clicks in Enter mode to navigate to highlighted term",
);
assert(
    latestJs.includes("showAiExplainItem(targetIdx, { manual: true });"),
    "subtitle-overlay.js must jump to clicked term via showAiExplainItem with manual: true",
);
assert(
    latestJs.includes("dataset.aiIndex = String(aiIndex);"),
    "subtitle-overlay.js must associate highlighted wrappers with queue indices",
);
const stylesContent = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf-8");
assert(
    stylesContent.includes(".__qt_ai-sub-wrap:hover") && stylesContent.includes("cursor: pointer !important;"),
    "styles.css must style highlighted subtitle terms with cursor: pointer",
);
console.log("✓ Test 10 Passed: Enter mode hover suppression & click-to-scroll navigation verified successfully.");

// 11. Verify Phase 16: Tailored hover styles, pill highlight synchronization, and pointerdown capture
assert(
    latestJs.includes("document.addEventListener(\n        \"pointerdown\",") &&
    latestJs.includes("e.stopImmediatePropagation?.();"),
    "subtitle-overlay.js must intercept pointerdown and click with stopImmediatePropagation in Enter mode",
);
assert(
    latestJs.includes("pill.classList.add(`${PREFIX}pill-highlight`);") &&
    latestJs.includes("pill.classList.remove(`${PREFIX}pill-highlight`);"),
    "subtitle-overlay.js mousemove must synchronize hover with ribbon pills",
);
assert(
    stylesContent.includes(".__qt_ai-queue-pill.__qt_pill-highlight") &&
    stylesContent.includes("body[data-lectoro-ai-active=\"true\"]") &&
    stylesContent.includes("rgba(168, 85, 247, 0.42)"),
    "styles.css must provide tailored violet hover styles, pill highlight, and disable unhighlighted word hover during AI active state",
);
console.log("✓ Test 11 Passed: Tailored hover, pill sync, and video player event interception verified successfully.");

// 12. Verify Task 17 Part 1: styles.css hidden ribbon pills, centered layout & CSS variables
assert(
    stylesContent.includes(".__qt_ai-queue-ribbon") &&
    stylesContent.includes("display: none !important;"),
    "styles.css must hide ribbon pills in top corner with display: none !important",
);
assert(
    stylesContent.includes(".__qt_ai-term-card") &&
    stylesContent.includes("align-items: center !important;") &&
    stylesContent.includes("text-align: center !important;"),
    "styles.css must center .__qt_ai-term-card horizontally",
);
assert(
    stylesContent.includes(".__qt_ai-term-header") &&
    stylesContent.includes("justify-content: center !important;") &&
    stylesContent.includes("text-align: center !important;"),
    "styles.css must center .__qt_ai-term-header content",
);
assert(
    stylesContent.includes("var(--lectoro-ai-term-font-size") &&
    stylesContent.includes("var(--lectoro-ai-meaning-font-size") &&
    stylesContent.includes("var(--lectoro-ai-explanation-font-size"),
    "styles.css must use proportional CSS variables for AI explanation typography",
);
assert(
    stylesContent.includes(".__qt_body") &&
    stylesContent.includes("text-align: center !important;") &&
    stylesContent.includes("align-items: center !important;") &&
    stylesContent.includes("padding: 14px 22px 18px !important;"),
    "styles.css must provide spacious centered .__qt_body layout and text",
);
assert(
    stylesContent.includes(".__qt_header") &&
    stylesContent.includes("justify-content: flex-end !important;"),
    "styles.css must align header navigation stepper to the upper right corner",
);
assert(
    stylesContent.includes("var(--lectoro-ai-badge-font-size") &&
    stylesContent.includes("--lectoro-ai-badge-font-size: 8px;"),
    "styles.css must define and use very small --lectoro-ai-badge-font-size for badges",
);
console.log("✓ Test 12 Passed: styles.css hidden ribbon pills, upper right stepper, centered layout, micro-badge & proportional CSS variables verified.");

// 13. Verify Task 17 Part 2: subtitle-overlay.js proportional font size calculations & badge above term
const fontOverlayJs = fs.readFileSync(jsPath, "utf-8").replace(/\r\n/g, "\n");
assert(
    fontOverlayJs.includes("--lectoro-ai-term-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-meaning-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-explanation-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-badge-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-meta-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-sentence-term-font-size") &&
    fontOverlayJs.includes("--lectoro-ai-sentence-meaning-font-size"),
    "subtitle-overlay.js applyTranslationFontSize must set all proportional font variables",
);
assert(
    fontOverlayJs.includes("effectiveSource * 0.62") &&
    fontOverlayJs.includes("effectiveSource * 0.54") &&
    fontOverlayJs.includes("effectiveSource * 0.46"),
    "subtitle-overlay.js must calculate compact typography proportionally from effective subtitle source size",
);
assert(
    fontOverlayJs.includes("${item.badge ? `<span class=\"${PREFIX}ai-badge\">${QT.escapeHtml(item.badge)}</span>` : \"\"}\n                        <div class=\"${PREFIX}ai-term-title-wrap\">"),
    "subtitle-overlay.js must place badge above the main term",
);
assert(
    fontOverlayJs.includes("applyTranslationFontSize(overlay, layout, {\n            fallbackPx: TRANSLATION_FONT_FALLBACK_PX,\n        });"),
    "subtitle-overlay.js applyAiExplanation must invoke applyTranslationFontSize on overlay",
);
console.log("✓ Test 13 Passed: subtitle-overlay.js badge above term & proportional font size calculations verified.");

// 14. Verify Task 17 Part 3: Flashcard native language translation on save in AI mode
assert(
    fontOverlayJs.includes("if (aiExplainMode === \"simple_target\")") &&
    fontOverlayJs.includes("await QT.translate(\n                            cleanedTerm,\n                            targetNativeLang,\n                        );"),
    "wireAiExplainSaveButton must translate cleanedTerm to targetNativeLang in simple_target mode",
);
assert(
    fontOverlayJs.includes("await QT.translate(\n                                contextSentence,\n                                targetNativeLang,\n                            );"),
    "wireAiExplainSaveButton must translate contextSentence to targetNativeLang in simple_target mode",
);
assert(
    fontOverlayJs.includes("const resolvedAiSentence = [aiDefinition, cleanedExplanation]\n                    .filter(Boolean)\n                    .join(\" — \");"),
    "wireAiExplainSaveButton must preserve simple target definition and explanation in aiSentence",
);
assert(
    fontOverlayJs.includes("tgtLang: targetNativeLang,"),
    "wireAiExplainSaveButton must save card with targetNativeLang",
);
console.log("✓ Test 14 Passed: Flashcard native language translation on save in AI mode verified.");

console.log("\nALL ENTER MODE, UI/UX & SETTING IMPROVEMENTS VERIFIED! 🚀");

