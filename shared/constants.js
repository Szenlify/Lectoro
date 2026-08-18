/**
 * Lectoro – Central Constants, UI Identifiers & Shared Assets (SSOT)
 * Single Source of Truth for extension-wide prefixes, IDs, SVG icons, and event names.
 */
(function initConstants(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) {
        root.LectoroConstants = api;
        // Keep compatibility shortcuts
        if (!root.SharedConstants) root.SharedConstants = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function createConstants() {
    "use strict";

    const PREFIX = "__qt_";

    const UI_IDS = Object.freeze({
        ICON: `${PREFIX}icon`,
        TOOLTIP: `${PREFIX}tooltip`,
        REVIEW_TOAST: `${PREFIX}review_toast`,
        SAVE_TOAST: `${PREFIX}save_toast`,
        AI_RESULT: `${PREFIX}ai-result`,
        SPEED_OVERLAY: `${PREFIX}speed-overlay`,
        NETFLIX_HIT_LAYER: `${PREFIX}netflix-subtitle-hit-layer`,
    });

    const UI_CLASSES = Object.freeze({
        WORD_CLOUD: `${PREFIX}word-cloud`,
        SUB_WORD: `${PREFIX}sub-word`,
        SAVE_TOAST: `${PREFIX}save_toast`,
        TOAST_VISIBLE: `${PREFIX}toast_visible`,
        HIDE_CONTROLS: `${PREFIX}hide-controls`,
        NETFLIX_HIDDEN: `${PREFIX}netflix-subtitles-hidden`,
        NETFLIX_CAPTURING: `${PREFIX}netflix-capturing`,
        READING_SENTENCE_HIGHLIGHT: "qt-reading-sentence",
    });

    const EVENT_NAMES = Object.freeze({
        NETFLIX_SEEK: "__lectoro_netflix_seek",
        NETFLIX_ARTWORK_REQUEST: "__lectoro_netflix_artwork_request",
        NETFLIX_ARTWORK_RESPONSE: "__lectoro_netflix_artwork_response",
        NETFLIX_TRACK_REQUEST: "__lectoro_netflix_track_request",
        NETFLIX_TRACK_RESPONSE: "__lectoro_netflix_track_response",
        NETFLIX_MANIFEST: "__lectoro_netflix_timed_text_manifest",
        NETFLIX_MANIFEST_REQUEST: "__lectoro_netflix_timed_text_manifest_request",
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
        FIREBASE_SYNC: "QT_FIREBASE_SYNC",
        FIRESTORE_DELETE: "QT_FIRESTORE_DELETE",
        FIRESTORE_DELETE_BATCH: "QT_FIRESTORE_DELETE_BATCH",
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
        EDIT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>`,
    });

    const LANG_TAGS = Object.freeze({
        pl: "PL",
        en: "EN",
        de: "DE",
        es: "ES",
        fr: "FR",
        it: "IT",
        pt: "PT",
        uk: "UK",
    });

    function langTag(code) {
        return LANG_TAGS[code] || String(code || "?").toUpperCase();
    }

    /** Check if a target element is part of Lectoro's own overlay / tooltip / cloud UI */
    function isOwnUI(target) {
        if (!target) return false;
        const selector = `#${UI_IDS.ICON}, #${UI_IDS.TOOLTIP}, #${UI_IDS.REVIEW_TOAST}, #${UI_IDS.SAVE_TOAST}, #${UI_IDS.SPEED_OVERLAY}, .${UI_CLASSES.WORD_CLOUD}, .${PREFIX}word-cloud, .${UI_CLASSES.SUB_WORD}`;
        return !!target.closest?.(selector);
    }

    return Object.freeze({
        PREFIX,
        UI_IDS,
        UI_CLASSES,
        EVENT_NAMES,
        MESSAGE_TYPES,
        SVG_ICONS,
        LANG_TAGS,
        langTag,
        isOwnUI,
    });
});
