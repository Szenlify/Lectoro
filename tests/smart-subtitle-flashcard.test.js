const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const C = require("../shared/constants");

function app(enabled, fail = false) {
    const saved = [], requests = [], toasts = [];
    let translations = 0;
    const video = { paused: false };
    const context = vm.createContext({
        C, activeText: "missed it", subtitleTranslationLang: "pl", savingSentence: false,
        saveResumeTimer: null, pausedForSave: false, wasPlayingBeforeSave: false,
        SAVE_TOAST_SUCCESS_MS: 1, SAVE_TOAST_ERROR_MS: 1,
        window: { location: { href: "https://www.youtube.com/watch?v=example" } },
        console: { error() {} }, clearTimeout() {}, setTimeout() {}, resumeAfterSave() {},
        getPlayerRegistry: () => ({ getVideo: () => video, pauseVideo: () => { video.paused = true; },
            captureVideoReviewScreenshot: async () => "screenshot" }),
        getActiveSubtitleContext: () => ({ before: ["The train left"], current: "missed it", after: [] }),
        cleanCardText: text => text, flashCapture() {},
        showSaveToast: (status, payload) => toasts.push({ status, payload }),
        SharedTranslatorService: {
            getReadingSettings: async () => ({ smartSubtitleFlashcard: enabled, targetLang: "pl", learningLang: "en" }),
            generateSubtitleFlashcard: async (...args) => {
                requests.push(args);
                if (fail) throw Error("AI unavailable");
                return { sentence: "I missed the train", translation: "Spóźniłem się na pociąg" };
            },
        },
        QT: {
            translate: async () => { translations++; return { translated: "przegapiłem to", detectedLang: "en" }; },
            saveWord: async card => saved.push(card),
        },
    });
    loadFunction(context, "video/subtitle-overlay.js", "saveCurrentSentenceToReview");
    return { context, saved, requests, toasts, translations: () => translations };
}

test("smart subtitle setting is opt-in and disabled Z saves the original subtitle", async () => {
    assert.equal(C.DEFAULT_READING_SETTINGS.smartSubtitleFlashcard, false);
    const state = app(false);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.requests.length, 0);
    assert.equal(state.translations(), 1);
    assert.equal(state.saved[0].original, "missed it");
    assert.equal(state.saved[0].translated, "przegapiłem to");
});

test("enabled Z saves the contextual AI sentence and matching translation with source media", async () => {
    const state = app(true);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.translations(), 0);
    assert.equal(state.requests.length, 1);
    assert.equal(state.requests[0][0], "missed it");
    assert.equal(state.requests[0][1].before[0], "The train left");
    assert.equal(state.saved[0].original, "I missed the train");
    assert.equal(state.saved[0].translated, "Spóźniłem się na pociąg");
    assert.equal(state.saved[0].screenshot, "screenshot");
    assert.match(state.saved[0].url, /youtube/);
    assert.equal(state.context.savingSentence, false);
});

test("AI failure shows an error without saving a misleading card and permits retry", async () => {
    const state = app(true, true);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.saved.length, 0);
    assert.equal(state.toasts.at(-1).status, "error");
    assert.equal(state.context.savingSentence, false);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.requests.length, 2);
});
