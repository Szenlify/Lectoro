/**
 * Integration Test: Reusable Buttons in Enter Mode & Complete Removal of Video Subtitle Toggle
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

console.log("🧪 Testing Reusable Buttons & Verification of Video Subtitle Toggle Removal...");

const rootDir = path.resolve(__dirname, "..");
const constantsJs = fs.readFileSync(path.join(rootDir, "shared/constants.js"), "utf8");
const coreJs = fs.readFileSync(path.join(rootDir, "core.js"), "utf8");
const overlayJs = fs.readFileSync(path.join(rootDir, "video/subtitle-overlay.js"), "utf8");
const registryJs = fs.readFileSync(path.join(rootDir, "adapters/player-registry.js"), "utf8");
const hotkeysJs = fs.readFileSync(path.join(rootDir, "video/video-hotkeys.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");

// 1. Reusable Buttons in core.js
console.log("Test 1: Verify QT.buildSaveFooterHtml reusability & options");
assert(coreJs.includes("function buildSaveFooterHtml("), "core.js must declare buildSaveFooterHtml");
assert(coreJs.includes("saveKeyHtml"), "buildSaveFooterHtml must support key hints");
assert(coreJs.includes("save-word-btn"), "buildSaveFooterHtml must render save-word-btn");
assert(coreJs.includes("save-ai-btn"), "buildSaveFooterHtml must render save-ai-btn");
console.log("✓ Test 1 Passed: buildSaveFooterHtml flexible parameters verified.");

// 2. subtitle-overlay.js Enter mode card reuse
console.log("Test 2: Verify Enter mode card uses QT.buildSaveFooterHtml and wires buttons");
assert(overlayJs.includes("const footerHtml = QT.buildSaveFooterHtml(dataAttrs,"), "renderAiExplainContent must invoke QT.buildSaveFooterHtml");
assert(overlayJs.includes('saveKeyHint: "Z"'), "Enter mode card must provide Z key hint for Save button");
assert(overlayJs.includes("wireAiSentenceSaveButton("), "subtitle-overlay.js must have dedicated wireAiSentenceSaveButton");
assert(overlayJs.includes('<span class="ai-loader-label">✨ Generating…</span>'), "wireAiSentenceSaveButton must set ai-loader-label shimmer state");
assert(overlayJs.includes("QT.geminiGenerateSentence("), "wireAiSentenceSaveButton must invoke QT.geminiGenerateSentence");
assert(overlayJs.includes("aiAiSavedIndices.add(aiExplainIndex)"), "AI saved state must be tracked");
console.log("✓ Test 2 Passed: Enter mode card button reuse & shimmer animation verified.");

// 3. CSS Alignment & Glassmorphism styles
console.log("Test 3: Verify CSS alignment and button styling");
assert(stylesCss.includes("#__qt_sentence_translation .__qt_save-footer {\n    display: flex !important;\n    gap: 8px !important;\n    padding: 10px 16px 12px !important;\n    border-top: 1px solid rgba(255, 255, 255, 0.08) !important;\n    justify-content: flex-end !important;"), "#__qt_sentence_translation .__qt_save-footer must be justify-content: flex-end !important;");
assert(stylesCss.includes("#__qt_sentence_translation .__qt_save-ai-btn"), "styles.css must have #__qt_sentence_translation .__qt_save-ai-btn purple styling");
assert(stylesCss.includes(".ai-loader-label"), "styles.css must have .ai-loader-label styling");
assert(stylesCss.includes("@keyframes __qt_ai_shimmer"), "styles.css must define @keyframes __qt_ai_shimmer");
console.log("✓ Test 3 Passed: CSS styling and bottom-right alignment verified.");

// 4. Complete Removal of Video Subtitle Toggle from Constants
console.log("Test 4: Verify complete removal of toggle from shared/constants.js");
assert(!constantsJs.includes("SUBTITLE_ENABLED"), "STORAGE_KEYS must NOT define SUBTITLE_ENABLED");
assert(!constantsJs.includes("VIDEO_SUB_TOGGLE"), "UI_IDS must NOT include VIDEO_SUB_TOGGLE");
assert(!constantsJs.includes("FLOATING_SUB_TOGGLE"), "UI_IDS must NOT include FLOATING_SUB_TOGGLE");
assert(!constantsJs.includes("SUBTITLES: `<svg"), "SVG_ICONS must NOT define SUBTITLES");
console.log("✓ Test 4 Passed: Constants are clean of toggle references.");

// 5. Complete Removal of Toggle from subtitle-overlay.js
console.log("Test 5: Verify complete removal of toggle from subtitle-overlay.js");
assert(!overlayJs.includes("lectoroSubtitlesEnabled"), "subtitle-overlay.js must NOT contain lectoroSubtitlesEnabled");
assert(!overlayJs.includes("autoCcTriggeredForVideo"), "subtitle-overlay.js must NOT contain autoCcTriggeredForVideo");
assert(!overlayJs.includes("function isSubtitlesEnabled"), "subtitle-overlay.js must NOT define isSubtitlesEnabled");
assert(!overlayJs.includes("function setSubtitlesEnabled"), "subtitle-overlay.js must NOT define setSubtitlesEnabled");
assert(!overlayJs.includes("function toggleSubtitles"), "subtitle-overlay.js must NOT define toggleSubtitles");
assert(!overlayJs.includes("function autoEnablePlayerCc"), "subtitle-overlay.js must NOT define autoEnablePlayerCc");
assert(!overlayJs.includes("function ensureVideoSubToggle"), "subtitle-overlay.js must NOT define ensureVideoSubToggle");
assert(!overlayJs.includes("function updateVideoSubToggleUi"), "subtitle-overlay.js must NOT define updateVideoSubToggleUi");
assert(!overlayJs.includes("onVideoActivated"), "subtitle-overlay.js must NOT contain onVideoActivated");
console.log("✓ Test 5 Passed: subtitle-overlay.js is clean of toggle code.");

// 6. Complete Removal of Toggle from player-registry.js and video-hotkeys.js
console.log("Test 6: Verify removal from player-registry.js and video-hotkeys.js");
assert(!registryJs.includes("isSubtitlesEnabled"), "player-registry.js must NOT check isSubtitlesEnabled");
assert(!registryJs.includes("onVideoActivated"), "player-registry.js must NOT call onVideoActivated");
assert(!hotkeysJs.includes("toggleSubtitles"), "video-hotkeys.js must NOT call toggleSubtitles");
assert(!hotkeysJs.includes("isSubtitlesEnabled"), "video-hotkeys.js must NOT check isSubtitlesEnabled");
console.log("✓ Test 6 Passed: player-registry.js and video-hotkeys.js are clean.");

// 7. Complete Removal of Toggle CSS from styles.css
console.log("Test 7: Verify removal of toggle CSS from styles.css");
assert(!stylesCss.includes("__qt_video-sub-toggle"), "styles.css must NOT contain __qt_video-sub-toggle");
assert(!stylesCss.includes("__qt_floating-video-toggle"), "styles.css must NOT contain __qt_floating-video-toggle");
console.log("✓ Test 7 Passed: styles.css is clean of toggle classes.");

console.log("\n🎉 ALL TESTS PASSED: Toggle completely removed & reusable buttons verified! 🚀");
