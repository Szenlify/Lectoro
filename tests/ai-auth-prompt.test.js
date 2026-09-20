const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { load, loadFunction } = require('./helpers');

for (const language of ['en', 'pl', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'cs', 'pt']) {
    test(`AI auth prompt panel renders all keys properly for language: ${language}`, () => {
        let rendered;
        const context = vm.createContext({
            clearTimeout, aiAutoAdvanceTimer: null, aiAutoAdvanceDisabled: false,
            aiExplainSpeechToken: 0, SharedTtsService: { cancel() {} },
            aiTooltipActive: false, aiPaywallActive: false,
            ensureAiExplainKeydownListener() {}, subtitleTranslationLang: 'en',
            PREFIX: '__qt_', aiExplainLayout: {}, translationAnchorLayout: null,
            captureSubtitleLayout: () => ({}),
            applyAiExplanation(html) {
                rendered = html;
                return { querySelector: () => null };
            },
        });
        load(context, 'shared/i18n.js');
        loadFunction(context, 'video/subtitle-overlay.js', 'showAiAuthOverlay');
        context.SharedI18n.setLang(language);
        context.showAiAuthOverlay();

        for (const key of [
            'ai_auth_title',
            'ai_auth_banner_title',
            'ai_auth_banner_sub',
            'ai_auth_offer_title',
            'ai_auth_perk1',
            'ai_auth_perk2',
            'ai_auth_perk3',
            'video_paywall_resume',
            'sign_in_google'
        ]) {
            const expectedText = context.SharedI18n.t(key, language);
            assert.ok(
                rendered.includes(expectedText),
                `Prompt in ${language} should include '${expectedText}' for key '${key}'`
            );
        }
    });
}

test('handleAIExplain shows auth overlay when user is not signed in', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../video/subtitle-overlay.js'), 'utf8');
    const start = source.indexOf('    async function handleAIExplain(video)');
    const end = source.indexOf('    function getSpeedOverlayParent', start);
    let authOverlayShown = false;
    let geminiCalled = false;
    const noop = () => {};

    const context = vm.createContext({
        activeText: 'The quick brown fox jumps over the lazy dog',
        aiExplainRequestId: 0,
        trackedVideo: null,
        eTranslateActive: false,
        wordCloudActive: false,
        aiSavedIndices: new Set(),
        aiAiSavedIndices: new Set(),
        document: { body: { setAttribute: noop } },
        getPlayerRegistry: () => ({}),
        cleanupReading: noop,
        closeSubTooltip: noop,
        removeSubtitleTranslationUnderOriginal: noop,
        pauseIfPlaying: noop,
        captureSubtitleLayout: () => ({ rect: {} }),
        showAiShimmer: noop,
        getActiveSubtitleContext: () => null,
        normalizeLanguageCode: () => 'en',
        SharedTranslatorService: { getLearningLang: async () => 'en' },
        showAiAuthOverlay: () => { authOverlayShown = true; },
        showAiPaywallOverlay: noop,
        FirebaseSync: {
            getUser: async () => null, // NOT logged in
        },
        QT: {
            hideTooltip: noop,
            getTargetLang: async () => 'pl',
            geminiExplainSentence: async () => {
                geminiCalled = true;
                return { translation: 'Szybki lis', explanation: 'Test', items: [] };
            },
        },
    });

    vm.runInContext(source.slice(start, end), context);
    await context.handleAIExplain(null);

    assert.equal(authOverlayShown, true, 'showAiAuthOverlay must be called when user is not signed in');
    assert.equal(geminiCalled, false, 'Gemini must not be called when user is not signed in');
});
