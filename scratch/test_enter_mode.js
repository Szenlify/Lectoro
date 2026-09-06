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

// 9. Verify Phase 14 & New Requirements: No auto-close, W key TTS replay & simple_target TTS translation
assert(
    !updatedJsContent.includes("aiExplainIndex + 1 >= aiExplainQueue.length"),
    "subtitle-overlay.js must NOT auto-close tooltip or resume video at queue end (cloud stays open)",
);
const normalizedJs = updatedJsContent.replace(/\r\n/g, "\n");
assert(
    normalizedJs.includes("const sentenceLang =\n                    aiExplainMode === \"simple_target\"\n                        ? aiExplainSourceLang\n                        : aiExplainTargetLang;"),
    "subtitle-overlay.js must speak simplified sentence in sourceLang when in simple_target mode",
);
assert(
    normalizedJs.includes("const detailLang =\n                    aiExplainMode === \"simple_target\"\n                        ? aiExplainSourceLang\n                        : aiExplainTargetLang;"),
    "subtitle-overlay.js must speak breakdown items (meaning + explanation) in sourceLang when in simple_target mode",
);
assert(
    normalizedJs.includes("const explanationSpeech = [item.meaning, item.explanation]\n                    .filter(Boolean)\n                    .join(\". \");"),
    "subtitle-overlay.js must speak item.meaning and item.explanation together",
);
assert(
    updatedJsContent.includes("function replayCurrentAiExplainTts()"),
    "subtitle-overlay.js must define replayCurrentAiExplainTts function",
);
assert(
    updatedJsContent.includes("replayCurrentAiExplainTts,"),
    "subtitle-overlay.js must export replayCurrentAiExplainTts in SubtitleOverlay",
);
const hotkeysJs = fs.readFileSync(path.join(__dirname, "..", "video", "video-hotkeys.js"), "utf-8");
assert(
    hotkeysJs.includes("overlay?.replayCurrentAiExplainTts?.()"),
    "video-hotkeys.js must call replayCurrentAiExplainTts when W key is pressed in Enter mode",
);
console.log("✓ Test 9 Passed: No auto-close, W key TTS replay & simple_target translation verified successfully.");

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
    fontOverlayJs.includes("effectiveSource * 0.60") &&
    fontOverlayJs.includes("effectiveSource * 0.50") &&
    fontOverlayJs.includes("effectiveSource * 0.44"),
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

// 15. Verify Phase 19: No arrow/square pointer on bubbles & speechParts includes item.meaning in simple_target mode
const stylesCss = fs.readFileSync(cssPath, "utf-8");
assert(
    !stylesCss.includes("#__qt_sentence_translation.__qt_sub-overlay::after"),
    "styles.css must NOT contain pointer arrow square for #__qt_sentence_translation",
);
assert(
    !stylesCss.includes(".__qt_word-cloud::after"),
    "styles.css must NOT contain pointer arrow for .__qt_word-cloud",
);
assert(
    !fontOverlayJs.includes("--lectoro-bubble-arrow-x"),
    "subtitle-overlay.js must NOT calculate or set dead --lectoro-bubble-arrow-x CSS variable",
);
assert(
    !fontOverlayJs.includes("aiExplainMode === \"simple_target\" ? \"\" : item.meaning"),
    "subtitle-overlay.js must NOT omit item.meaning from speechParts in simple_target mode",
);
console.log("✓ Test 15 Passed: No bubble pointer arrows/squares, dead arrow calculations eliminated & TTS meaning included.");

// 16. Verify Phase 20: AI badge generation & assignment in the configured language
const aiPromptsJs = fs.readFileSync(path.join(__dirname, "..", "shared", "ai-prompts.js"), "utf-8");
assert(
    aiPromptsJs.includes('2. "badge": Short category label for the whole sentence in ${targetLangDesc} (e.g. "Sentence").') &&
    aiPromptsJs.includes('\"badge\": short category label in ${targetLangDesc} (e.g. "Idiom", "Phrasal Verb", "Slang", "Word").') &&
    aiPromptsJs.includes('2. "badge": Short category label for the whole sentence in ${tgtName} (e.g. for Polish: "Zdanie").') &&
    aiPromptsJs.includes('\"badge\": short category label in ${tgtName} (e.g. for Polish: "Idiom", "Czasownik złożony", "Slang", "Słówko").'),
    "ai-prompts.js must include badge instructions for both sentence and items in simple_target and native modes",
);

assert(
    fontOverlayJs.includes("resolveAiBadge") &&
    fontOverlayJs.includes("resolveAiBadge,\n        isSubtitleUiOpen:"),
    "subtitle-overlay.js must define and export resolveAiBadge",
);

// Unit test resolveAiBadge logic in Node sandbox
const vm = require("vm");
const sandbox = {
    window: {},
    document: { addEventListener: () => {} },
    navigator: { userAgent: "" },
    chrome: { runtime: { id: "test" }, storage: { local: { get: () => {} } } },
    LectoroConstants: {
        PREFIX: "__qt_",
        UI_CLASSES: {},
        DEFAULT_SUBTITLE_SETTINGS: {},
    },
    SharedUtils: {
        escapeHtml: (s) => s,
        cleanTextForTTS: (s) => s,
    },
    QT: {
        escapeHtml: (s) => s,
        escapeAttr: (s) => s,
        addDismissHandler: () => {},
        formatSpeechMarkup: (s) => s,
    },
    SharedTtsService: { cancel: () => {} },
    SharedSubtitleService: {},
};
// Extract and evaluate resolveAiBadge function directly from subtitle-overlay.js
const badgeFnMatch = fontOverlayJs.match(/function resolveAiBadge\([\s\S]*?\n    \}/);
assert(badgeFnMatch, "resolveAiBadge function regex must match in subtitle-overlay.js");
vm.runInNewContext(badgeFnMatch[0] + "; this.resolveAiBadge = resolveAiBadge;", sandbox);
const { resolveAiBadge } = sandbox;

assert.strictEqual(resolveAiBadge("Custom Badge", "idiom", true, "en"), "Custom Badge");
assert.strictEqual(resolveAiBadge("", "sentence", true, "en"), "Sentence");
assert.strictEqual(resolveAiBadge("", "sentence", false, "pl"), "Zdanie");
assert.strictEqual(resolveAiBadge("", "sentence", false, "es"), "Oración");
assert.strictEqual(resolveAiBadge("", "idiom", true, "en"), "Idiom");
assert.strictEqual(resolveAiBadge("", "phrasal_verb", true, "en"), "Phrasal Verb");
assert.strictEqual(resolveAiBadge("", "phrasal_verb", false, "pl"), "Czasownik złożony");
assert.strictEqual(resolveAiBadge("", "vocabulary", true, "en"), "Word");
assert.strictEqual(resolveAiBadge("", "vocabulary", false, "pl"), "Słówko");
assert.strictEqual(resolveAiBadge("", "idiom", false, "es"), "Modismo");
assert.strictEqual(resolveAiBadge("", "vocabulary", false, "es"), "Palabra");
console.log("✓ Test 16 Passed: AI badge generation in prompt & multilingual resolveAiBadge verified successfully.");

// 17. Verify Phase 21 Part 1: styles.css and constants for subtitle translation under original
const updatedCss = fs.readFileSync(cssPath, "utf-8");
const subTransMatch = updatedCss.match(/#__qt_custom_subtitles_layer\s+\.__qt_custom-sub-translation\s*\{([^}]+)\}/);
assert(subTransMatch, ".__qt_custom-sub-translation rule must exist in styles.css");
assert(
    subTransMatch[1].includes("font-size: calc(var(--lectoro-sub-font-size, 26px) * 0.5) !important;"),
    `Subtitle translation must have 50% font size. Got: ${subTransMatch[1]}`,
);
assert(
    subTransMatch[1].includes("color: #cbd5e1 !important;"),
    `Subtitle translation must have soft gray color (#cbd5e1). Got: ${subTransMatch[1]}`,
);
assert(
    subTransMatch[1].includes("position: absolute !important;") && subTransMatch[1].includes("top: calc(100% + 6px) !important;"),
    `Subtitle translation must be positioned directly under original text without disrupting flow. Got: ${subTransMatch[1]}`,
);
assert(
    subTransMatch[1].includes("animation: qtSubTranslationFadeIn 0.28s"),
    `Subtitle translation must animate with qtSubTranslationFadeIn. Got: ${subTransMatch[1]}`,
);
assert(
    updatedCss.includes("@keyframes qtSubTranslationFadeIn"),
    "@keyframes qtSubTranslationFadeIn must be defined in styles.css",
);
const subBoxMatch = updatedCss.match(/#__qt_custom_subtitles_layer\s+\.__qt_custom-subtitles-box\s*\{([^}]+)\}/);
assert(
    subBoxMatch && subBoxMatch[1].includes("position: relative !important;"),
    "custom-subtitles-box must have position: relative !important",
);

const constantsPath = path.join(__dirname, "../shared/constants.js");
const constantsContent = fs.readFileSync(constantsPath, "utf-8");
assert(
    constantsContent.includes("CUSTOM_SUB_TRANSLATION: `${PREFIX}custom-sub-translation`"),
    "shared/constants.js must define CUSTOM_SUB_TRANSLATION",
);
console.log("✓ Test 17 Passed: Subtitle translation styles (50% font size, soft gray, animation, relative box) & constants verified.");

// 18. Verify Phase 21 Part 2: subtitle-overlay.js translation logic, auto-lift, and native stage 1 omission
const latestOverlayJs = fs.readFileSync(jsPath, "utf-8").replace(/\r\n/g, "\n");
assert(
    latestOverlayJs.includes("function showSubtitleTranslationUnderOriginal(translationText)"),
    "subtitle-overlay.js must define showSubtitleTranslationUnderOriginal",
);
assert(
    latestOverlayJs.includes("function removeSubtitleTranslationUnderOriginal()"),
    "subtitle-overlay.js must define removeSubtitleTranslationUnderOriginal",
);
assert(
    latestOverlayJs.includes("function adjustSubtitlePositionForTranslation()"),
    "subtitle-overlay.js must define adjustSubtitlePositionForTranslation",
);
assert(
    latestOverlayJs.includes("showSubtitleTranslationUnderOriginal(translation);"),
    "handleAIExplain must call showSubtitleTranslationUnderOriginal(translation)",
);
assert(
    latestOverlayJs.includes("if (breakdownItems.length > 0) {\n                aiExplainQueue = [...breakdownItems, sentenceItem];\n            } else {\n                aiExplainQueue = [sentenceItem];\n            }"),
    "handleAIExplain must append full sentence translation as final stage when breakdown items exist",
);
assert(
    latestOverlayJs.includes("showSubtitleTranslationUnderOriginal,") &&
    latestOverlayJs.includes("removeSubtitleTranslationUnderOriginal,") &&
    latestOverlayJs.includes("adjustSubtitlePositionForTranslation,"),
    "SubtitleOverlay must export subtitle translation functions",
);

// Verify auto-lift logic mathematically in sandboxed unit test
let simulatedBoxTransform = "";
let simulatedBoxClassList = new Set();
const liftSandbox = {
    customSubBoxEl: {
        style: {
            get transform() { return simulatedBoxTransform; },
            set transform(v) { simulatedBoxTransform = v; }
        },
        classList: {
            add: (c) => simulatedBoxClassList.add(c),
            remove: (c) => simulatedBoxClassList.delete(c),
        }
    },
    aiSubTranslationEl: { offsetHeight: 28 },
    aiSubTranslationText: "Przetłumaczone zdanie testowe",
    PREFIX: "__qt_",
    currentSubBottomPx: 0,
};
const liftFnMatch = latestOverlayJs.match(/function adjustSubtitlePositionForTranslation\(\)[\s\S]*?\n    \}/);
assert(liftFnMatch, "adjustSubtitlePositionForTranslation regex must match in subtitle-overlay.js");
vm.runInNewContext(liftFnMatch[0] + "; this.adjustSubtitlePositionForTranslation = adjustSubtitlePositionForTranslation;", liftSandbox);

// Case 1: Subtitle is very low (currentSubBottomPx = 0) -> Must lift up!
liftSandbox.currentSubBottomPx = 0;
liftSandbox.adjustSubtitlePositionForTranslation();
assert.strictEqual(simulatedBoxTransform, "translateY(-46px)", "Subtitles at 0px bottom must be lifted by 46px (28 + 6 + 12)");
assert(simulatedBoxClassList.has("__qt_custom-sub-lifted"), "custom-sub-lifted class must be added");

// Case 2: Subtitle is at normal position (currentSubBottomPx = 80px) -> Structure must NOT be disturbed!
liftSandbox.currentSubBottomPx = 80;
liftSandbox.adjustSubtitlePositionForTranslation();
assert.strictEqual(simulatedBoxTransform, "", "Subtitles at 80px bottom must NOT be lifted (transform cleared)");
assert(!simulatedBoxClassList.has("__qt_custom-sub-lifted"), "custom-sub-lifted class must be removed");
console.log("✓ Test 18 Passed: Subtitle translation under original, vertical position auto-lift & final stage append verified successfully.");

// 19. Verify Phase 22: Stage 4/4 without bubble, visual highlight, step badge, TTS and hotkeys
assert(
    constantsContent.includes("CUSTOM_SUB_TRANSLATION_ACTIVE: `${PREFIX}custom-sub-translation-active`"),
    "shared/constants.js must define CUSTOM_SUB_TRANSLATION_ACTIVE",
);
const activeTransMatch = updatedCss.match(/#__qt_custom_subtitles_layer\s+\.__qt_custom-sub-translation\.__qt_custom-sub-translation-active\s*\{([^}]+)\}/);
assert(activeTransMatch, ".__qt_custom-sub-translation.__qt_custom-sub-translation-active rule must exist in styles.css");
assert(
    activeTransMatch[1].includes("color: #ffffff !important;"),
    "Active subtitle translation must have crisp white color (#ffffff)",
);
assert(
    activeTransMatch[1].includes("linear-gradient"),
    "Active subtitle translation must have AI gradient background",
);
assert(
    activeTransMatch[1].includes("box-shadow"),
    "Active subtitle translation must have glowing box-shadow",
);
assert(
    updatedCss.includes(".__qt_custom-sub-translation.__qt_custom-sub-translation-active[data-step]::before"),
    "Micro step indicator data-step::before must be styled in styles.css",
);
assert(
    updatedCss.includes("@keyframes qtSubTranslationActivePulse"),
    "@keyframes qtSubTranslationActivePulse must be defined in styles.css",
);

// Verify logic in subtitle-overlay.js:
assert(
    latestOverlayJs.includes("const isSentenceWithBreakdown =\n            aiExplainQueue.length > 1 && item.type === \"sentence\";"),
    "showAiExplainItem must detect isSentenceWithBreakdown (stage 4/4)",
);
assert(
    latestOverlayJs.includes("removeOverlay();") &&
    latestOverlayJs.includes("aiSubTranslationEl.classList.add(\n                    C.UI_CLASSES.CUSTOM_SUB_TRANSLATION_ACTIVE,\n                );"),
    "Stage 4/4 must call removeOverlay and add CUSTOM_SUB_TRANSLATION_ACTIVE class",
);
assert(
    latestOverlayJs.includes("data-step") &&
    latestOverlayJs.includes("`${clampedIndex + 1}/${aiExplainQueue.length}`"),
    "Stage 4/4 must set data-step badge attribute",
);
assert(
    latestOverlayJs.includes("function ensureAiExplainKeydownListener()"),
    "subtitle-overlay.js must define ensureAiExplainKeydownListener for seamless hotkeys",
);

// Sandbox simulation of showAiExplainItem for 4/4 stage
let overlayRemoved = false;
let subTransClasses = new Set();
let subTransAttributes = {};
let spokenItem = null;
const showSandbox = {
    aiTooltipActive: true,
    aiExplainQueue: [
        { type: "idiom", term: "break a leg", meaning: "powodzenia" },
        { type: "idiom", term: "piece of cake", meaning: "bułka z masłem" },
        { type: "word", term: "curious", meaning: "ciekawy" },
        { type: "sentence", term: "It is a piece of cake", meaning: "To bułka z masłem" },
    ],
    aiAutoAdvanceDisabled: false,
    aiExplainIndex: 0,
    aiAutoAdvanceTimer: null,
    aiExplainSpeechToken: 0,
    aiExplainLayout: { rect: { top: 0, left: 0 } },
    clearTimeout: () => {},
    SharedTtsService: { cancel: () => {} },
    ensureAiExplainKeydownListener: () => {},
    removeOverlay: () => { overlayRemoved = true; },
    showSubtitleTranslationUnderOriginal: () => {},
    aiSubTranslationText: "To bułka z masłem",
    aiSubTranslationEl: {
        classList: {
            add: (c) => subTransClasses.add(c),
            remove: (c) => subTransClasses.delete(c),
        },
        setAttribute: (k, v) => { subTransAttributes[k] = v; },
        removeAttribute: (k) => { delete subTransAttributes[k]; },
    },
    updateSubtitleVideoHighlights: () => {},
    speakAiExplainItem: (item) => { spokenItem = item; },
    C: { UI_CLASSES: { CUSTOM_SUB_TRANSLATION_ACTIVE: "__qt_custom-sub-translation-active" } },
    renderAiExplainContent: () => "<div>Card</div>",
    applyAiExplanation: () => ({ querySelectorAll: () => [], querySelector: () => null }),
    wireAiExplainSpeakButton: () => {},
    wireAiExplainSaveButton: () => {},
    PREFIX: "__qt_",
};

const showFnMatch = latestOverlayJs.match(/function showAiExplainItem\(index, \{ manual = false \} = \{\}\)[\s\S]*?\n    \}/);
assert(showFnMatch, "showAiExplainItem regex must match in subtitle-overlay.js");
vm.runInNewContext(showFnMatch[0] + "; this.showAiExplainItem = showAiExplainItem;", showSandbox);

// Run step 4/4 (index 3)
showSandbox.showAiExplainItem(3);
assert.strictEqual(overlayRemoved, true, "Overlay bubble must be removed on stage 4/4");
assert.strictEqual(subTransClasses.has("__qt_custom-sub-translation-active"), true, "CUSTOM_SUB_TRANSLATION_ACTIVE must be added to translation");
assert.strictEqual(subTransAttributes["data-step"], "4/4", "data-step attribute must be '4/4'");
assert.strictEqual(spokenItem.meaning, "To bułka z masłem", "TTS must read translation text");

// Run step 3/4 (index 2 - navigating back)
showSandbox.showAiExplainItem(2, { manual: true });
assert.strictEqual(subTransClasses.has("__qt_custom-sub-translation-active"), false, "CUSTOM_SUB_TRANSLATION_ACTIVE must be removed when returning to word card");
assert.strictEqual(subTransAttributes["data-step"], undefined, "data-step attribute must be removed when returning to word card");
assert.strictEqual(spokenItem.term, "curious", "TTS must read the word on stage 3/4");
console.log("✓ Test 19 Passed: Phase 22 Stage 4/4 without bubble, visual highlight, step badge, TTS and hotkeys verified successfully.");

// 20. Verify Phase 23: Translate Full Sentence Mode Unification with Enter Mode (No Spinner, 50% Grey Subtitles Under Original)
const latestOverlayJsP23 = fs.readFileSync(path.join(__dirname, "../video/subtitle-overlay.js"), "utf-8").replace(/\r\n/g, "\n");
const latestHotkeysJsP23 = fs.readFileSync(path.join(__dirname, "../video/video-hotkeys.js"), "utf-8").replace(/\r\n/g, "\n");
const latestCssP23 = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf-8").replace(/\r\n/g, "\n");

// 20.1 Check no showSubLoading in subtitle-overlay.js (brak spinera)
assert(!latestOverlayJsP23.includes("showSubLoading"), "showSubLoading must not exist in subtitle-overlay.js");

// 20.2 Check doSentenceTranslation calls showSubtitleTranslationUnderOriginal
const doSentMatch = latestOverlayJsP23.match(/async function doSentenceTranslation[\s\S]*?\n    \}/);
assert(doSentMatch, "doSentenceTranslation function must exist in subtitle-overlay.js");
assert(
    doSentMatch[0].includes("showSubtitleTranslationUnderOriginal(translation.translatedText)"),
    "doSentenceTranslation must call showSubtitleTranslationUnderOriginal(translation.translatedText)",
);
assert(
    doSentMatch[0].includes("data-lectoro-sub-translate-active"),
    "doSentenceTranslation must set data-lectoro-sub-translate-active on document.body",
);

// 20.3 Check renderCustomSubtitles supports eTranslateActive
assert(
    latestOverlayJsP23.includes("(aiTooltipActive || eTranslateActive) && aiSubTranslationText"),
    "renderCustomSubtitles must keep translation visible if eTranslateActive is true",
);

// 20.4 Check video-hotkeys does NOT hide original subtitles on Netflix for sentence translation
assert(
    !latestHotkeysJsP23.includes("globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(true)"),
    "video-hotkeys.js must not hide Netflix original subtitles for subtitleTTS",
);

// 20.5 Check styles.css has active pointer events for data-lectoro-sub-translate-active and dead styles removed
assert(
    latestCssP23.includes('body[data-lectoro-sub-translate-active="true"] #__qt_custom_subtitles_layer .__qt_custom-sub-translation'),
    "styles.css must allow pointer events for data-lectoro-sub-translate-active",
);
assert(
    !latestCssP23.includes(".__qt_sentence-clean-overlay"),
    "styles.css must have dead .__qt_sentence-clean-overlay styles removed",
);

// 20.6 Sandbox execution of doSentenceTranslation
let p23UnderOriginalText = null;
let p23TtsSpokenText = null;
let p23TtsLang = null;
let p23SpeakingClassAdded = false;
let p23SpeakingClassRemoved = false;
let p23Paused = false;
const p23SubEl = {
    classList: {
        add: (c) => { if (c === "__qt_speaking") p23SpeakingClassAdded = true; },
        remove: (c) => { if (c === "__qt_speaking") p23SpeakingClassRemoved = true; },
    },
};

const p23Sandbox = {
    subtitleModeRevision: 1,
    activeText: "We need to go deeper into the forest.",
    getPlayerRegistry: () => ({ getCurrentText: () => "We need to go deeper into the forest." }),
    eTranslateActive: false,
    document: {
        body: {
            setAttribute: () => {},
            removeAttribute: () => {},
        },
    },
    pauseIfPlaying: (v) => { p23Paused = true; },
    captureSubtitleLayout: () => ({ rect: { top: 100, left: 200 } }),
    createSubtitleTranslationTask: async () => ({
        translatedText: "Musimy wejść głębiej w las.",
        targetLang: "pl",
    }),
    showSubtitleTranslationUnderOriginal: (txt) => {
        p23UnderOriginalText = txt;
    },
    aiSubTranslationEl: p23SubEl,
    PREFIX: "__qt_",
    QT: {
        speak: async (text, lang) => {
            p23TtsSpokenText = text;
            p23TtsLang = lang;
        },
    },
};

vm.runInNewContext(doSentMatch[0] + "; this.doSentenceTranslation = doSentenceTranslation;", p23Sandbox);

(async () => {
    await p23Sandbox.doSentenceTranslation(null, null, { speakTranslated: true });
    assert.strictEqual(p23Paused, true, "Video must be paused during sentence translation");
    assert.strictEqual(p23UnderOriginalText, "Musimy wejść głębiej w las.", "Translation text must be passed to showSubtitleTranslationUnderOriginal");
    assert.strictEqual(p23TtsSpokenText, "Musimy wejść głębiej w las.", "TTS must read translation aloud");
    assert.strictEqual(p23TtsLang, "pl", "TTS language must match targetLang");
    assert.strictEqual(p23SpeakingClassAdded, true, "Speaking glow class must be added during speech");
    assert.strictEqual(p23SpeakingClassRemoved, true, "Speaking glow class must be removed after speech");
    console.log("✓ Test 20 Passed: Phase 23 Translate full sentence mode unified with Enter mode (no spinner, 50% grey text under original subtitles, TTS) verified successfully.");

    console.log("\nALL ENTER MODE, UI/UX & SETTING IMPROVEMENTS VERIFIED! 🚀");
})();


