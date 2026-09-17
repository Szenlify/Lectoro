const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, loadFunction } = require('./helpers');

for (const language of ['en', 'pl', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'cs', 'pt']) {
    test(`AI limit panel follows current ${language} settings instead of stale Polish subtitles`, () => {
        let rendered;
        const context = vm.createContext({
            clearTimeout, aiAutoAdvanceTimer: null, aiAutoAdvanceDisabled: false,
            aiExplainSpeechToken: 0, SharedTtsService: { cancel() {} },
            aiTooltipActive: false, aiPaywallActive: false,
            ensureAiExplainKeydownListener() {}, subtitleTranslationLang: 'pl',
            PREFIX: '__qt_', aiExplainLayout: {}, translationAnchorLayout: null,
            captureSubtitleLayout: () => ({}),
            applyAiExplanation(html) {
                rendered = html;
                return { querySelector: () => null };
            },
        });
        load(context, 'shared/i18n.js');
        loadFunction(context, 'video/subtitle-overlay.js', 'showAiPaywallOverlay');
        context.SharedI18n.setLang(language);
        context.showAiPaywallOverlay();
        for (const key of ['paywall_ai_title', 'video_paywall_banner_title', 'video_paywall_banner_sub',
            'video_paywall_offer_title', 'video_paywall_perk1', 'video_paywall_perk2', 'video_paywall_perk3',
            'video_paywall_resume', 'video_paywall_cta']) {
            assert.ok(rendered.includes(context.SharedI18n.t(key, language)), key);
        }
        if (language !== 'pl') assert.ok(!rendered.includes(context.SharedI18n.t('paywall_ai_title', 'pl')));
        context.SharedI18n.setLang(language === 'de' ? 'fr' : 'de');
        context.showAiPaywallOverlay();
        assert.ok(rendered.includes(context.SharedI18n.t('paywall_ai_title')),
            'opening again uses updated language settings');
    });
}
