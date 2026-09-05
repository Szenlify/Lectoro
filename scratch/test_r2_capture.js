const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.resolve(__dirname, '..');

console.log("=== Testing R2 Capture, DRY / SSOT & Dead Code Cleanup ===");

// 1. Verify core.js
const corePath = path.join(rootDir, 'core.js');
const coreContent = fs.readFileSync(corePath, 'utf8');

assert(
    coreContent.includes('async function captureVideoScreenshot(videoOverride = null) {'),
    'core.js: captureVideoScreenshot must be an async function'
);
assert(
    coreContent.includes('return captureMediaScreenshot(video);'),
    'core.js: captureVideoScreenshot must delegate to captureMediaScreenshot (DRY / SSOT)'
);
console.log("✓ core.js: captureVideoScreenshot is async and delegates to captureMediaScreenshot");

// 2. Verify adapters/player-registry.js
const registryPath = path.join(rootDir, 'adapters/player-registry.js');
const registryContent = fs.readFileSync(registryPath, 'utf8');

assert(
    registryContent.includes('return (await QT.captureVideoScreenshot(video)) || "";'),
    'player-registry.js: captureVideoReviewScreenshot must await QT.captureVideoScreenshot'
);
console.log("✓ player-registry.js: captureVideoReviewScreenshot properly awaits QT.captureVideoScreenshot");

// 3. Verify video/subtitle-overlay.js
const overlayPath = path.join(rootDir, 'video/subtitle-overlay.js');
const overlayContent = fs.readFileSync(overlayPath, 'utf8');

assert(
    overlayContent.includes('let activeAiVideo = null;'),
    'subtitle-overlay.js: activeAiVideo variable must be declared'
);
assert(
    overlayContent.includes('activeAiVideo = video || trackedVideo || registry?.getVideo?.() || null;'),
    'subtitle-overlay.js: handleAIExplain must capture activeAiVideo'
);
assert(
    overlayContent.includes('function saveCurrentAiExplainItem() {'),
    'subtitle-overlay.js: saveCurrentAiExplainItem function must be defined'
);
assert(
    overlayContent.includes('saveCurrentAiExplainItem,'),
    'subtitle-overlay.js: saveCurrentAiExplainItem must be exported in SubtitleOverlay'
);
assert(
    !overlayContent.includes('function languageTag('),
    'subtitle-overlay.js: dead function languageTag must be removed'
);
assert(
    overlayContent.includes('function wireAiExplainSaveButton(item) {'),
    'subtitle-overlay.js: wireAiExplainSaveButton must accept item cleanly'
);
console.log("✓ subtitle-overlay.js: activeAiVideo tracking, saveCurrentAiExplainItem exported, dead languageTag removed");

// 4. Verify video/video-hotkeys.js
const hotkeysPath = path.join(rootDir, 'video/video-hotkeys.js');
const hotkeysContent = fs.readFileSync(hotkeysPath, 'utf8');

assert(
    hotkeysContent.includes('if (key === "z" || key === "Z") {\n                    if (overlay?.saveCurrentAiExplainItem?.()) {\n                        return;\n                    }\n                }'),
    'video-hotkeys.js: key Z in aiTooltipOpen block must call saveCurrentAiExplainItem and return'
);
console.log("✓ video-hotkeys.js: key Z properly routes to saveCurrentAiExplainItem when AI explanation is active");

// 5. Verify shared/image-service.js
const imgServicePath = path.join(rootDir, 'shared/image-service.js');
const imgServiceContent = fs.readFileSync(imgServicePath, 'utf8');

assert(
    !imgServiceContent.includes('PIXABAY_SUPPORTED_LANGS'),
    'image-service.js: dead PIXABAY_SUPPORTED_LANGS must be removed'
);
assert(
    !imgServiceContent.includes('resolvePixabayLang'),
    'image-service.js: dead resolvePixabayLang must be removed'
);
console.log("✓ image-service.js: dead Pixabay language code removed");

// 6. Verify shared/gemini-proxy.js
const proxyPath = path.join(rootDir, 'shared/gemini-proxy.js');
const proxyContent = fs.readFileSync(proxyPath, 'utf8');

assert(
    proxyContent.includes('[GeminiProxy] R2 uploadCardImage message error:'),
    'gemini-proxy.js: uploadCardImage in content script must log error warnings'
);
console.log("✓ gemini-proxy.js: content script communication error logging verified");

console.log("\nALL R2 CAPTURE, DRY/SSOT & CLEANUP TESTS PASSED! 🚀\n");
