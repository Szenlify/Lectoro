const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const SharedI18n = require('../shared/i18n');

test('SharedI18n supports all 11 core languages', () => {
    const expected = ['en', 'pl', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'cs', 'pt'];
    for (const code of expected) {
        assert.ok(SharedI18n.SUPPORTED_LOCALES.includes(code), `Missing locale: ${code}`);
    }
});

test('SharedI18n.t translates keys for English and Polish', () => {
    assert.equal(SharedI18n.t('tab_settings', 'en'), 'Settings');
    assert.equal(SharedI18n.t('tab_settings', 'pl'), 'Ustawienia');
    assert.equal(SharedI18n.t('cloud_sync', 'pl'), '☁️ Synchronizacja w chmurze');
    assert.equal(SharedI18n.t('saved_msg', 'pl'), '✓ Zapisano');
});

test('SharedI18n.t interpolates parameters accurately', () => {
    const en = SharedI18n.t('credits_remaining', 'en', { left: 8 });
    assert.equal(en, '8 credits remaining this month');

    const pl = SharedI18n.t('credits_remaining', 'pl', { left: 8 });
    assert.equal(pl, 'Pozostało 8 kredytów w tym miesiącu');

    const used = SharedI18n.t('credits_used', 'en', { used: 3, limit: 15 });
    assert.equal(used, '3 of 15 AI credits used');
});

test('SharedI18n.t falls back to English for unknown locales and missing keys', () => {
    // Unsupported locale falls back to en
    assert.equal(SharedI18n.t('tab_words', 'xyz'), 'Words');
    // Normalization handles uppercase and sub-tags
    assert.equal(SharedI18n.t('tab_words', 'PL_pl'), 'Słowa');
    assert.equal(SharedI18n.t('tab_words', 'en-US'), 'Words');
});

test('SharedI18n setLang and getLang manage default target language', () => {
    SharedI18n.setLang('pl');
    assert.equal(SharedI18n.getLang(), 'pl');
    assert.equal(SharedI18n.t('tab_guide'), 'Poradnik');

    SharedI18n.setLang('en');
    assert.equal(SharedI18n.getLang(), 'en');
    assert.equal(SharedI18n.t('tab_guide'), 'Guide');
});

test('SharedI18n.applyToDOM translates text, titles, placeholders, and aria-labels', () => {
    // Mock minimal DOM structure
    function createElement(tagName, attrs = {}) {
        const attributes = new Map(Object.entries(attrs));
        return {
            tagName,
            textContent: '',
            getAttribute(k) { return attributes.get(k); },
            setAttribute(k, v) { attributes.set(k, v); },
            hasAttribute(k) { return attributes.has(k); }
        };
    }

    const heading = createElement('h1', { 'data-i18n': 'tab_review' });
    const button = createElement('button', { 'data-i18n-title': 'swap_languages', 'data-i18n-aria': 'swap_languages' });
    const input = createElement('input', { 'data-i18n-placeholder': 'search_placeholder' });

    const root = {
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') return [heading];
            if (selector === '[data-i18n-title]') return [button];
            if (selector === '[data-i18n-placeholder]') return [input];
            if (selector === '[data-i18n-aria]') return [button];
            return [];
        }
    };

    SharedI18n.applyToDOM(root, 'pl');
    assert.equal(heading.textContent, 'Powtórki');
    assert.equal(button.getAttribute('title'), 'Zamień języki miejscami');
    assert.equal(button.getAttribute('aria-label'), 'Zamień języki miejscami');
    assert.equal(input.getAttribute('placeholder'), 'Szukaj słowa, tłumaczenia lub zdania...');

    SharedI18n.applyToDOM(root, 'en');
    assert.equal(heading.textContent, 'Review');
    assert.equal(button.getAttribute('title'), 'Swap learning and native languages');
    assert.equal(button.getAttribute('aria-label'), 'Swap learning and native languages');
    assert.equal(input.getAttribute('placeholder'), 'Search word, translation, or sentence...');
});

test('SharedI18n.getLocalizedPrice returns localized prices and currencies', () => {
    // Polish
    const plFree = SharedI18n.getLocalizedPrice('free', 'pl');
    assert.equal(plFree.amount, 0);
    assert.equal(plFree.formatted, '0 zł');

    const plBasic = SharedI18n.getLocalizedPrice('basic', 'pl');
    assert.equal(plBasic.amount, 29.99);
    assert.equal(plBasic.currency, 'PLN');
    assert.equal(plBasic.formatted, '29,99 zł');

    const plPro = SharedI18n.getLocalizedPrice('pro', 'pl');
    assert.equal(plPro.amount, 79.99);
    assert.equal(plPro.currency, 'PLN');
    assert.equal(plPro.formatted, '79,99 zł');

    // English
    const enBasic = SharedI18n.getLocalizedPrice('basic', 'en');
    assert.equal(enBasic.formatted, '$7.99');
    assert.equal(enBasic.currency, 'USD');

    const enPro = SharedI18n.getLocalizedPrice('pro', 'en');
    assert.equal(enPro.formatted, '$19.99');

    // German (Euro)
    const deBasic = SharedI18n.getLocalizedPrice('basic', 'de');
    assert.equal(deBasic.currency, 'EUR');
    assert.equal(deBasic.formatted, '6,99 €');

    // Japanese (Yen)
    const jaPro = SharedI18n.getLocalizedPrice('pro', 'ja');
    assert.equal(jaPro.currency, 'JPY');
    assert.equal(jaPro.formatted, '¥3,000');

    // Korean (Won)
    const koBasic = SharedI18n.getLocalizedPrice('basic', 'ko');
    assert.equal(koBasic.currency, 'KRW');
    assert.equal(koBasic.formatted, '₩11,000');

    // Czech (CZK)
    const csBasic = SharedI18n.getLocalizedPrice('basic', 'cs');
    assert.equal(csBasic.currency, 'CZK');
    assert.equal(csBasic.formatted, '199 Kč');

    // Portuguese / Brazil (BRL)
    const ptBasic = SharedI18n.getLocalizedPrice('basic', 'pt');
    assert.equal(ptBasic.currency, 'BRL');
    assert.equal(ptBasic.formatted, 'R$ 39,90');

    // Fallback for unknown locale defaults to USD
    const fallback = SharedI18n.getLocalizedPrice('basic', 'unknown');
    assert.equal(fallback.formatted, '$7.99');
});

test('SharedI18n translates newly added keys across all 11 locales', () => {
    const criticalKeys = [
        'words_empty',
        'words_edit',
        'words_delete',
        'review_empty_title',
        'review_done_title',
        'review_show_question',
        'review_show_answer',
        'export_packing_zip',
        'video_toast_fail',
        'video_toast_retry',
        'video_reading_error_busy',
        'video_reading_error_generic',
        'video_sub_limit_title',
        'paywall_ai_title',
        'save_label',
        'save_word_title',
        'saved_status',
        'saved_to_review',
        'generating_ai',
        'error_label',
        'plan_limit',
        'breakdown_items',
        'play_pronunciation',
        'analyzing_sentence',
        'toast_saving_sentence',
        'toast_saved_sentence',
        'toast_could_not_save',
        'no_subtitles_to_save',
        'sentence_saved_to_review',
        'translate_btn',
        'read_aloud_btn',
        'stop_reading_btn',
        'quiz_out_of_credits',
        'could_not_refresh_ai_usage',
        'export_preparing',
        'export_downloading',
        'close_label',
        'scroll_plans',
        'signing_out',
        'deleting_account',
        'signed_in_feedback',
        'sign_in_error',
        'sync_done_summary',
        'sync_all_synced',
        'sync_failed',
        'delete_account_confirm',
        'account_deleted_feedback',
        'account_delete_failed',
        'failed_sign_out',
        'video_paywall_close_title',
        'close_and_resume_aria',
        'ai_limit_title',
        'status_portal_redirect',
        'status_stripe_trial',
        'status_stripe_opened',
        'status_stripe_error',
        'status_plan_updated'
    ];

    for (const locale of SharedI18n.SUPPORTED_LOCALES) {
        for (const key of criticalKeys) {
            const translation = SharedI18n.t(key, locale);
            assert.ok(translation, `Missing translation for key '${key}' in locale '${locale}'`);
            assert.notEqual(translation, key, `Untranslated key '${key}' in locale '${locale}'`);
        }
    }
});

test('SharedI18n translates all Guide keys across all 11 locales', () => {
    const guideKeys = [
        'guide_watching_videos',
        'guide_video_desc',
        'guide_playback',
        'guide_play_pause',
        'guide_prev_sub',
        'guide_next_sub',
        'guide_speed',
        'guide_learning',
        'guide_translate_tts',
        'guide_save_sentence',
        'guide_ai_explain',
        'guide_text_translation',
        'guide_step_1',
        'guide_step_2',
        'guide_step_3',
        'guide_learning_review',
        'guide_learning_review_desc',
        'guide_tip'
    ];

    for (const locale of SharedI18n.SUPPORTED_LOCALES) {
        for (const key of guideKeys) {
            const translation = SharedI18n.t(key, locale);
            assert.ok(translation, `Missing translation for key '${key}' in locale '${locale}'`);
            assert.notEqual(translation, key, `Untranslated key '${key}' in locale '${locale}'`);
            if (locale !== 'en') {
                const enTranslation = SharedI18n.t(key, 'en');
                assert.notEqual(translation, enTranslation, `Key '${key}' in locale '${locale}' unexpectedly equals English fallback`);
            }
        }
    }
});

test('SharedI18n.applyToDOM pre-translates elements inside template tags', () => {
    function createElement(tagName, attrs = {}) {
        const attributes = new Map(Object.entries(attrs));
        return {
            tagName,
            textContent: '',
            content: null,
            getAttribute(k) { return attributes.get(k); },
            setAttribute(k, v) { attributes.set(k, v); },
            hasAttribute(k) { return attributes.has(k); }
        };
    }

    const templateHeading = createElement('span', { 'data-i18n': 'guide_watching_videos' });
    const templateFragment = {
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') return [templateHeading];
            if (selector === 'template') return [];
            return [];
        }
    };
    const templateEl = createElement('template');
    templateEl.content = templateFragment;

    const root = {
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') return [];
            if (selector === 'template') return [templateEl];
            return [];
        }
    };

    SharedI18n.applyToDOM(root, 'pl');
    assert.equal(templateHeading.textContent, 'Oglądanie filmów');

    SharedI18n.applyToDOM(root, 'de');
    assert.equal(templateHeading.textContent, 'Videos ansehen');

    SharedI18n.applyToDOM(root, 'ja');
    assert.equal(templateHeading.textContent, '動画の視聴');
});

test('SharedI18n.getPrivacyUrl returns locale-specific URLs with root en fallback', () => {
    assert.equal(SharedI18n.getPrivacyUrl('pl'), 'https://lectoroai.vercel.app/pl/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('en'), 'https://lectoroai.vercel.app/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('ja'), 'https://lectoroai.vercel.app/ja/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('de'), 'https://lectoroai.vercel.app/de/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('es'), 'https://lectoroai.vercel.app/es/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('fr'), 'https://lectoroai.vercel.app/fr/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('it'), 'https://lectoroai.vercel.app/it/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('ko'), 'https://lectoroai.vercel.app/ko/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('nl'), 'https://lectoroai.vercel.app/nl/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('cs'), 'https://lectoroai.vercel.app/cs/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('pt'), 'https://lectoroai.vercel.app/pt/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('pl_PL'), 'https://lectoroai.vercel.app/pl/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('en-US'), 'https://lectoroai.vercel.app/privacy');
    assert.equal(SharedI18n.getPrivacyUrl('unknown'), 'https://lectoroai.vercel.app/privacy');

    assert.equal(SharedI18n.getTermsUrl('pl'), 'https://lectoroai.vercel.app/pl/terms');
    assert.equal(SharedI18n.getTermsUrl('en'), 'https://lectoroai.vercel.app/terms');
    assert.equal(SharedI18n.getTermsUrl('ja'), 'https://lectoroai.vercel.app/ja/terms');
});

test('SharedI18n.applyToDOM updates privacy and terms links to match current language', () => {
    function createElement(tagName, attrs = {}) {
        const attributes = new Map(Object.entries(attrs));
        return {
            tagName,
            textContent: '',
            getAttribute(k) { return attributes.get(k); },
            setAttribute(k, v) { attributes.set(k, v); },
            hasAttribute(k) { return attributes.has(k); }
        };
    }

    const privacyLink = createElement('a', {
        href: 'https://lectoroai.vercel.app/privacy',
        'data-i18n': 'footer_privacy',
        'data-i18n-href': 'privacy'
    });
    const termsLink = createElement('a', {
        href: 'https://lectoroai.vercel.app/terms',
        'data-i18n': 'footer_terms',
        'data-i18n-href': 'terms'
    });

    const root = {
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') return [privacyLink, termsLink];
            if (selector === '[data-i18n-href]') return [privacyLink, termsLink];
            if (selector === 'a[data-i18n="footer_privacy"], #footerPrivacyLink, #privacyLink') return [privacyLink];
            if (selector === 'a[data-i18n="footer_terms"], #footerTermsLink, #termsLink') return [termsLink];
            return [];
        }
    };

    // When language is Polish:
    SharedI18n.applyToDOM(root, 'pl');
    assert.equal(privacyLink.textContent, 'Polityka Prywatności');
    assert.equal(privacyLink.getAttribute('href'), 'https://lectoroai.vercel.app/pl/privacy');
    assert.equal(termsLink.getAttribute('href'), 'https://lectoroai.vercel.app/pl/terms');

    // When language is English:
    SharedI18n.applyToDOM(root, 'en');
    assert.equal(privacyLink.textContent, 'Privacy Policy');
    assert.equal(privacyLink.getAttribute('href'), 'https://lectoroai.vercel.app/privacy');
    assert.equal(termsLink.getAttribute('href'), 'https://lectoroai.vercel.app/terms');

    // When language is Japanese:
    SharedI18n.applyToDOM(root, 'ja');
    assert.equal(privacyLink.textContent, 'プライバシーポリシー');
    assert.equal(privacyLink.getAttribute('href'), 'https://lectoroai.vercel.app/ja/privacy');
    assert.equal(termsLink.getAttribute('href'), 'https://lectoroai.vercel.app/ja/terms');
});

test('LectoroConstants detects browser UI language and normalizes regional dialects like pt-BR', () => {
    const C = require('../shared/constants');

    // 1. Regional dialect normalization
    assert.equal(C.normalizeSupportedLanguage('pt-BR'), 'pt', 'pt-BR must normalize to pt');
    assert.equal(C.normalizeSupportedLanguage('pt_BR'), 'pt', 'pt_BR must normalize to pt');
    assert.equal(C.normalizeSupportedLanguage('pt-PT'), 'pt', 'pt-PT must normalize to pt');
    assert.equal(C.normalizeSupportedLanguage('es-419'), 'es', 'es-419 must normalize to es');
    assert.equal(C.normalizeSupportedLanguage('es-MX'), 'es', 'es-MX must normalize to es');
    assert.equal(C.normalizeSupportedLanguage('en-US'), 'en', 'en-US must normalize to en');
    assert.equal(C.normalizeSupportedLanguage('de-AT'), 'de', 'de-AT must normalize to de');
    assert.equal(C.normalizeSupportedLanguage('fr-CA'), 'fr', 'fr-CA must normalize to fr');
    assert.equal(C.normalizeSupportedLanguage('pl-PL'), 'pl', 'pl-PL must normalize to pl');
    assert.equal(C.normalizeSupportedLanguage('sv-SE', 'en'), 'en', 'Unsupported locale sv-SE must fallback to en');

    // 2. Detection from chrome.i18n.getUILanguage
    const origChrome = global.chrome;
    try {
        global.chrome = { i18n: { getUILanguage: () => 'pt-BR' } };
        assert.equal(C.detectBrowserLanguage(), 'pt', 'Brazilian Chrome must detect pt');

        global.chrome = { i18n: { getUILanguage: () => 'es-419' } };
        assert.equal(C.detectBrowserLanguage(), 'es', 'Latin American Spanish must detect es');

        global.chrome = { i18n: { getUILanguage: () => 'tr-TR' } };
        assert.equal(C.detectBrowserLanguage('en'), 'en', 'Turkish must fallback to en, never pl');

        // 3. Pairing: non-English native learns English, English native learns Spanish
        global.chrome = { i18n: { getUILanguage: () => 'pt-BR' } };
        const ptSettings = C.getDefaultLanguageSettings();
        assert.equal(ptSettings.targetLang, 'pt');
        assert.equal(ptSettings.learningLang, 'en');

        global.chrome = { i18n: { getUILanguage: () => 'en-US' } };
        const enSettings = C.getDefaultLanguageSettings();
        assert.equal(enSettings.targetLang, 'en');
        assert.equal(enSettings.learningLang, 'es');
    } finally {
        global.chrome = origChrome;
    }
});


