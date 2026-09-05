/**
 * Lectoro – Central Constants, UI Identifiers & Shared Assets (SSOT)
 * Single Source of Truth for extension-wide prefixes, IDs, SVG icons, and event names.
 */
(function initConstants(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.LectoroConstants = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createConstants() {
        "use strict";

        const PREFIX = "__qt_";

        const UI_IDS = Object.freeze({
            ICON: `${PREFIX}icon`,
            TOOLTIP: `${PREFIX}tooltip`,
            REVIEW_TOAST: `${PREFIX}review_toast`,
            SAVE_TOAST: `${PREFIX}save_toast`,
            AI_RESULT: `${PREFIX}ai-result`,
            AI_LIMIT_TOAST: `${PREFIX}ai_limit_toast`,
            SPEED_OVERLAY: `${PREFIX}speed-overlay`,
            SENTENCE_TRANSLATION: `${PREFIX}sentence_translation`,
            CUSTOM_SUBTITLES_LAYER: `${PREFIX}custom_subtitles_layer`,
        });

        const UI_CLASSES = Object.freeze({
            WORD_CLOUD: `${PREFIX}word-cloud`,
            SUB_WORD: `${PREFIX}sub-word`,
            SUB_HINT: `${PREFIX}sub-hint`,
            SAVE_TOAST: `${PREFIX}save_toast`,
            TOAST_VISIBLE: `${PREFIX}toast_visible`,
            CUSTOM_SUBTITLES_LAYER: `${PREFIX}custom-subtitles-layer`,
            CUSTOM_SUBTITLES_BOX: `${PREFIX}custom-subtitles-box`,
            HIDE_CONTROLS: `${PREFIX}hide-controls`,
            NETFLIX_HIDE_CONTROLS: `${PREFIX}netflix-hide-controls`,
            NETFLIX_HIDDEN: `${PREFIX}netflix-subtitles-hidden`,
            NETFLIX_CAPTURING: `${PREFIX}netflix-capturing`,
            READING_SENTENCE_HIGHLIGHT: "qt-reading-sentence",
            IMAGE_SECTION: `${PREFIX}image-section`,
            IMAGE_STRIP: `${PREFIX}image-strip`,
            IMAGE_CARD: `${PREFIX}image-card`,
            IMAGE_SKELETON: `${PREFIX}image-skeleton`,
            IMAGE_THUMB: `${PREFIX}image-thumb`,
            IMAGE_SELECTED: `${PREFIX}image-selected`,
            IS_LOADING: `${PREFIX}is-loading`,
            AI_SUB_WRAP: `${PREFIX}ai-sub-wrap`,
            AI_SUB_ACTIVE: `${PREFIX}ai-sub-active`,
            AI_SUB_QUEUED: `${PREFIX}ai-sub-queued`,
            AI_SUB_UPCOMING: `${PREFIX}ai-sub-upcoming`,
            AI_PILL_UPCOMING: `${PREFIX}ai-pill-upcoming`,
        });

        const EVENT_NAMES = Object.freeze({
            NETFLIX_SEEK: "__lectoro_netflix_seek",
            NETFLIX_PAUSE: "__lectoro_netflix_pause",
            NETFLIX_PLAY: "__lectoro_netflix_play",
            NETFLIX_ARTWORK_REQUEST: "__lectoro_netflix_artwork_request",
            NETFLIX_ARTWORK_RESPONSE: "__lectoro_netflix_artwork_response",
            NETFLIX_TRACK_REQUEST: "__lectoro_netflix_track_request",
            NETFLIX_TRACK_RESPONSE: "__lectoro_netflix_track_response",
            NETFLIX_MANIFEST: "__lectoro_netflix_timed_text_manifest",
            NETFLIX_MANIFEST_REQUEST:
                "__lectoro_netflix_timed_text_manifest_request",
            NETFLIX_PLAYER_STATE_RESET: "__lectoro_netflix_player_state_reset",

            YOUTUBE_TIMED_TEXT: "__lectoro_youtube_timed_text",
            YOUTUBE_TRACKS_AVAILABLE: "__lectoro_youtube_tracks_available",
            YOUTUBE_TRACK_REQUEST: "__lectoro_youtube_track_request",
            YOUTUBE_TRACK_RESPONSE: "__lectoro_youtube_track_response",
            YOUTUBE_FETCH_REQUEST: "__lectoro_youtube_fetch_request",
            YOUTUBE_FETCH_RESPONSE: "__lectoro_youtube_fetch_response",
            YOUTUBE_SEEK: "__lectoro_youtube_seek",
            YOUTUBE_PAUSE: "__lectoro_youtube_pause",
            YOUTUBE_PLAY: "__lectoro_youtube_play",
            YOUTUBE_NAVIGATION: "__lectoro_youtube_navigation",
        });

        const MESSAGE_TYPES = Object.freeze({
            REVIEW_DUE: "QT_REVIEW_DUE",
            CAPTURE_VISIBLE_TAB: "QT_CAPTURE_VISIBLE_TAB",
            FETCH_NETFLIX_TIMED_TEXT: "QT_FETCH_NETFLIX_TIMED_TEXT",
            FETCH_CONTEXT_IMAGE: "QT_FETCH_CONTEXT_IMAGE",
            ENABLE_VIDEO_FRAME: "QT_ENABLE_VIDEO_FRAME",
            OPEN_PLANS: "QT_OPEN_PLANS",
            FIREBASE_SIGN_IN: "QT_FIREBASE_SIGN_IN",
            FIREBASE_SIGN_OUT: "QT_FIREBASE_SIGN_OUT",
            FIREBASE_DELETE_ACCOUNT: "QT_FIREBASE_DELETE_ACCOUNT",
            GET_FIREBASE_TOKEN: "QT_GET_FIREBASE_TOKEN",
            GET_FIREBASE_USER: "QT_GET_FIREBASE_USER",
            FIREBASE_SYNC: "QT_FIREBASE_SYNC",
            FIRESTORE_DELETE: "QT_FIRESTORE_DELETE",
            FIRESTORE_DELETE_BATCH: "QT_FIRESTORE_DELETE_BATCH",
            GEMINI_REQUEST: "QT_GEMINI_REQUEST",
            GEMINI_REFRESH_USAGE: "QT_GEMINI_REFRESH_USAGE",
            GEMINI_UPLOAD_CARD_IMAGE: "QT_GEMINI_UPLOAD_CARD_IMAGE",
            GEMINI_DELETE_CARD_IMAGES: "QT_GEMINI_DELETE_CARD_IMAGES",
            GEMINI_DELETE_ALL_USER_IMAGES: "QT_GEMINI_DELETE_ALL_USER_IMAGES",
            GOOGLE_TRANSLATE: "QT_GOOGLE_TRANSLATE",
            SUBSCRIPTION_REFRESH_PROFILE: "QT_SUBSCRIPTION_REFRESH_PROFILE",
            ELEVENLABS_SYNTHESIZE: "QT_ELEVENLABS_SYNTHESIZE",
            ELEVENLABS_VOICES: "QT_ELEVENLABS_VOICES",
            SEARCH_IMAGES: "QT_SEARCH_IMAGES",
        });

        const STORAGE_KEYS = Object.freeze({
            SAVED_WORDS: "savedWords",
            TARGET_LANG: "targetLang",
            SPEECH_VOICE: "speechVoice",
            SPEECH_RATE: "speechRate",
            TTS_VOLUME: "ttsVolume",
            TTS_MODE: "ttsMode",
            EL_VOICE_ID: "elVoiceId",
            SUBTITLE_TTS: "subtitleTTS",
            WORD_CLOUD_MODE: "wordCloudMode",
            SUBTITLE_POSITION: "subtitlePosition",
            SUBTITLE_BG_OPACITY: "subtitleBgOpacity",
            REVIEW_DIRECTION: "reviewDirection",
            FIREBASE_AUTH: "firebaseAuth",
            LAST_FIREBASE_SYNC: "lastFirebaseSync",
            LAST_FIREBASE_SYNC_ERROR: "lastFirebaseSyncError",
            PENDING_FIREBASE_CHANGES: "pendingFirebaseChanges",
            AI_USAGE_CACHE: "aiUsageCache",
            SUBSCRIPTION_PROFILE_CACHE: "subscriptionProfileCache",
            PERSISTENT_TRANSLATE_CACHE: "persistentTranslateCache",
            PERSISTENT_IMAGE_CACHE: "persistentImageCache",
            LATEST_QUIZ_HTML: "latestQuizHtml",
            LATEST_QUIZ_TITLE: "latestQuizTitle",
            LATEST_QUIZ_MODE: "latestQuizMode",
            QUIZ_GENERATIONS_FREE_COUNT: "quizGenerationsFreeCount",
            QUIZ_GENERATIONS_PAID_HISTORY: "quizGenerationsPaidHistory",
            EXPORT_USAGE: "exportUsage",
            SUBTITLE_HOURLY_USAGE: "lectoro_subtitle_hourly_usage",
        });

        const DEFAULT_SUBTITLE_SETTINGS = Object.freeze({
            POSITION: 14,
            BG_OPACITY: 0,
        });

        /** Default TTS settings shared by popup, content scripts and SharedTtsService */
        const DEFAULT_TTS_SETTINGS = Object.freeze({
            ttsMode: "browser",
            speechVoice: "",
            speechRate: 1.1,
            ttsVolume: 1,
            elVoiceId: "",
        });

        /** Remote endpoints (host_permissions in manifest.json must stay in sync) */
        const ENDPOINTS = Object.freeze({
            GEMINI_PROXY: "https://geminiproxy-gyagzflbra-ew.a.run.app",
            BILLING_FUNCTIONS:
                "https://europe-west1-extension-eng.cloudfunctions.net",
            GOOGLE_TRANSLATE:
                "https://translate.googleapis.com/translate_a/single",
            GOOGLE_TTS: "https://translate.google.com/translate_tts",
            PIXABAY: "https://pixabay.com/api/",
        });

        /**
         * Obfuscated external API credentials to protect against plain-text scraping.
         */
        const API_KEYS = Object.freeze({
            get PIXABAY() {
                // Obfuscated key: 57435186-f7a69b9d5541aea7ed5f2e318
                const _x = [
                    111, 109, 110, 105, 111, 107, 98, 108, 119, 60, 109, 59,
                    108, 99, 56, 99, 62, 111, 111, 110, 107, 59, 63, 59, 109,
                    63, 62, 111, 60, 104, 63, 105, 107, 98,
                ];
                return _x.map((c) => String.fromCharCode(c ^ 0x5a)).join("");
            },
        });

        const SVG_ICONS = Object.freeze({
            TRANSLATE: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>`,
            SPEAKER: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
            SAVE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
            SAVE_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#4ecdc4" stroke="#4ecdc4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
            SAVE_SENTENCE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
            SAVE_SENTENCE_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#4ecdc4" stroke="#4ecdc4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
            SAVE_AI: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
            SAVE_AI_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#a78bfa" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
            READ: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
            AI: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 6 1-4.5 4.25L17 20l-5-3.75L7 20l.5-6.75L3 9l6-1 3-6z"/><path d="M8 13h8"/><path d="M8 17h8"/></svg>`,
            IMAGE_SEARCH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
            EXTERNAL_LINK: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
            CHECK_SMALL: `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
            EDIT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`,
            SPEED: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
        });

        const R2_CDN_BASE_URL =
            "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev";

        /**
         * Central language registry – Single Source of Truth (SSOT)
         * Maps ISO 639-1 language codes to full English names, short uppercase tags, native labels, and flag emojis.
         * Fully synchronized with all target languages available in Lectoro.
         */
        const SUPPORTED_LANGUAGES = Object.freeze({
            ar: Object.freeze({
                code: "ar",
                name: "Arabic",
                tag: "AR",
                native: "العربية",
                flag: "🇸🇦",
            }),
            bg: Object.freeze({
                code: "bg",
                name: "Bulgarian",
                tag: "BG",
                native: "Български",
                flag: "🇧🇬",
            }),
            cs: Object.freeze({
                code: "cs",
                name: "Czech",
                tag: "CS",
                native: "Čeština",
                flag: "🇨🇿",
            }),
            da: Object.freeze({
                code: "da",
                name: "Danish",
                tag: "DA",
                native: "Dansk",
                flag: "🇩🇰",
            }),
            de: Object.freeze({
                code: "de",
                name: "German",
                tag: "DE",
                native: "Deutsch",
                flag: "🇩🇪",
            }),
            el: Object.freeze({
                code: "el",
                name: "Greek",
                tag: "EL",
                native: "Ελληνικά",
                flag: "🇬🇷",
            }),
            en: Object.freeze({
                code: "en",
                name: "English",
                tag: "EN",
                native: "English",
                flag: "🇬🇧",
            }),
            es: Object.freeze({
                code: "es",
                name: "Spanish",
                tag: "ES",
                native: "Español",
                flag: "🇪🇸",
            }),
            fr: Object.freeze({
                code: "fr",
                name: "French",
                tag: "FR",
                native: "Français",
                flag: "🇫🇷",
            }),
            he: Object.freeze({
                code: "he",
                name: "Hebrew",
                tag: "HE",
                native: "עברית",
                flag: "🇮🇱",
            }),
            hi: Object.freeze({
                code: "hi",
                name: "Hindi",
                tag: "HI",
                native: "हिन्दी",
                flag: "🇮🇳",
            }),
            hr: Object.freeze({
                code: "hr",
                name: "Croatian",
                tag: "HR",
                native: "Hrvatski",
                flag: "🇭🇷",
            }),
            hu: Object.freeze({
                code: "hu",
                name: "Hungarian",
                tag: "HU",
                native: "Magyar",
                flag: "🇭🇺",
            }),
            id: Object.freeze({
                code: "id",
                name: "Indonesian",
                tag: "ID",
                native: "Bahasa Indonesia",
                flag: "🇮🇩",
            }),
            it: Object.freeze({
                code: "it",
                name: "Italian",
                tag: "IT",
                native: "Italiano",
                flag: "🇮🇹",
            }),
            ja: Object.freeze({
                code: "ja",
                name: "Japanese",
                tag: "JA",
                native: "日本語",
                flag: "🇯🇵",
            }),
            ko: Object.freeze({
                code: "ko",
                name: "Korean",
                tag: "KO",
                native: "한국어",
                flag: "🇰🇷",
            }),
            nl: Object.freeze({
                code: "nl",
                name: "Dutch",
                tag: "NL",
                native: "Nederlands",
                flag: "🇳🇱",
            }),
            pl: Object.freeze({
                code: "pl",
                name: "Polish",
                tag: "PL",
                native: "Polski",
                flag: "🇵🇱",
            }),
            pt: Object.freeze({
                code: "pt",
                name: "Portuguese",
                tag: "PT",
                native: "Português",
                flag: "🇵🇹",
            }),
            "pt-br": Object.freeze({
                code: "pt-br",
                name: "Portuguese (Brazil)",
                tag: "PT-BR",
                native: "Português (Brasil)",
                flag: "🇧🇷",
            }),
            ro: Object.freeze({
                code: "ro",
                name: "Romanian",
                tag: "RO",
                native: "Română",
                flag: "🇷🇴",
            }),
            ru: Object.freeze({
                code: "ru",
                name: "Russian",
                tag: "RU",
                native: "Русский",
                flag: "🇷🇺",
            }),
            sk: Object.freeze({
                code: "sk",
                name: "Slovak",
                tag: "SK",
                native: "Slovenčina",
                flag: "🇸🇰",
            }),
            sv: Object.freeze({
                code: "sv",
                name: "Swedish",
                tag: "SV",
                native: "Svenska",
                flag: "🇸🇪",
            }),
            th: Object.freeze({
                code: "th",
                name: "Thai",
                tag: "TH",
                native: "ไทย",
                flag: "🇹🇭",
            }),
            tr: Object.freeze({
                code: "tr",
                name: "Turkish",
                tag: "TR",
                native: "Türkçe",
                flag: "🇹🇷",
            }),
            uk: Object.freeze({
                code: "uk",
                name: "Ukrainian",
                tag: "UK",
                native: "Українська",
                flag: "🇺🇦",
            }),
            vi: Object.freeze({
                code: "vi",
                name: "Vietnamese",
                tag: "VI",
                native: "Tiếng Việt",
                flag: "🇻🇳",
            }),
            zh: Object.freeze({
                code: "zh",
                name: "Chinese",
                tag: "ZH",
                native: "中文",
                flag: "🇨🇳",
            }),
        });

        const LANG_NAMES = Object.freeze(
            Object.fromEntries(
                Object.entries(SUPPORTED_LANGUAGES).map(([code, l]) => [
                    code,
                    l.name,
                ]),
            ),
        );

        const LANG_TAGS = Object.freeze(
            Object.fromEntries(
                Object.entries(SUPPORTED_LANGUAGES).map(([code, l]) => [
                    code,
                    l.tag,
                ]),
            ),
        );

        function getLanguageName(code) {
            if (!code) return "";
            const c = String(code).toLowerCase();
            return LANG_NAMES[c] || c.toUpperCase();
        }

        function langTag(code) {
            if (!code) return "?";
            const c = String(code).toLowerCase();
            return LANG_TAGS[c] || String(code).toUpperCase();
        }

        /**
         * Central ElevenLabs Voices registry – Single Source of Truth (SSOT)
         */
        const ELEVENLABS_VOICES = Object.freeze([
            Object.freeze({
                id: "TX3LPaxmHKxFdv7VOQHJ",
                name: "Liam",
                key: "liam",
            }),
            Object.freeze({
                id: "XrExE9yKIg1WjnnlVkGX",
                name: "Matilda",
                key: "matilda",
            }),
        ]);

        const ALLOWED_ELEVENLABS_VOICE_KEYS = Object.freeze(
            ELEVENLABS_VOICES.map((v) => v.key),
        );
        const ALLOWED_ELEVENLABS_VOICE_IDS = Object.freeze(
            ELEVENLABS_VOICES.map((v) => v.id),
        );

        /**
         * Stopwords / simple functional words (pronouns, auxiliary verbs, articles, prepositions)
         * Single Source of Truth shared across subtitle overlay, word cloud, and visual concept filters.
         */
        const SIMPLE_WORDS = Object.freeze(
            new Set([
                "an", "oh","um", "uh", "ah", "a", "and", "are", "as", "at", "be",
                "but", "by", "can", "can't", "could", "did", "do", "does",
                "for", "from", "had", "has", "have", "he", "her", "here",
                "his", "if", "in", "into", "is", "it", "its", "me", "my",
                "not", "of", "on", "or", "our", "she", "should", "so",
                "some", "that", "the", "their", "them", "there", "they",
                "this", "to", "too", "us", "was", "we", "were", "what",
                "when", "where", "which", "who", "why", "will", "with",
                "won't", "would", "you", "your", "yours",
            ]),
        );

        /** Check if a target element is part of Lectoro's own overlay / tooltip / cloud UI */
        function isOwnUI(target) {
            if (!target) return false;
            const selector = `#${UI_IDS.ICON}, #${UI_IDS.TOOLTIP}, #${UI_IDS.REVIEW_TOAST}, #${UI_IDS.SAVE_TOAST}, #${UI_IDS.SPEED_OVERLAY}, #${UI_IDS.SENTENCE_TRANSLATION}, .${UI_CLASSES.WORD_CLOUD}`;
            return !!target.closest?.(selector);
        }

        return Object.freeze({
            PREFIX,
            UI_IDS,
            UI_CLASSES,
            EVENT_NAMES,
            MESSAGE_TYPES,
            STORAGE_KEYS,
            DEFAULT_SUBTITLE_SETTINGS,
            DEFAULT_TTS_SETTINGS,
            ENDPOINTS,
            API_KEYS,
            SIMPLE_WORDS,
            SVG_ICONS,
            R2_CDN_BASE_URL,
            SUPPORTED_LANGUAGES,
            LANG_NAMES,
            LANG_TAGS,
            ELEVENLABS_VOICES,
            ALLOWED_ELEVENLABS_VOICE_KEYS,
            ALLOWED_ELEVENLABS_VOICE_IDS,
            getLanguageName,
            langTag,
            isOwnUI,
        });
    },
);
