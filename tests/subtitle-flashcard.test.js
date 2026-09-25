const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const C = require("../shared/constants");

function app(enabled, fail = false, translated = "Nie, to kosztuje 3,50 dolara.") {
    const saved = [], requests = [], toasts = [];
    let translations = 0;
    const video = { paused: false };
    const context = vm.createContext({
        C, activeText: "No, it costs $3.50.", subtitleTranslationLang: "pl", savingSentence: false,
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

        },
        QT: {
            geminiExplainSentence: async (...args) => {
                translations++;
                requests.push(args);
                if (fail) throw Error("Translation unavailable");
                return { translation: translated, detectedLang: "en" };
            },
            saveWord: async card => saved.push(card),
        },
    });
    loadFunction(context, "video/subtitle-overlay.js", "saveCurrentSentenceToReview");
    return { context, saved, requests, toasts, translations: () => translations };
}

for (const enabled of [false, true]) {
    test(`Z preserves the exact subtitle even with legacy AI setting ${enabled}`, async () => {
        assert.equal(C.DEFAULT_READING_SETTINGS.smartSubtitleFlashcard, undefined);
        const state = app(enabled);
        await state.context.saveCurrentSentenceToReview();
        assert.equal(state.translations(), 1);
        assert.deepEqual(JSON.parse(JSON.stringify(state.requests[0])), [
            "No, it costs $3.50.", "pl",
            { before: ["The train left"], current: "missed it", after: [] },
            { sourceLang: "en", translationOnly: true },
        ]);
        assert.equal(state.saved[0].original, "No, it costs $3.50.");
        assert.equal(state.saved[0].translated, "Nie, to kosztuje 3,50 dolara.");
        assert.equal(state.saved[0].screenshot, "screenshot");
        assert.match(state.saved[0].url, /youtube/);
        assert.equal(state.toasts.at(-1).status, "success");
        assert.equal(state.context.savingSentence, false);
    });
}

test("translation failure permits retry without saving a misleading card", async () => {
    const state = app(true, true);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.saved.length, 0);
    assert.equal(state.toasts.at(-1).status, "error");
    assert.equal(state.context.savingSentence, false);
    await state.context.saveCurrentSentenceToReview();
    assert.equal(state.translations(), 2);
});

for (const translated of [null, "", "   "]) {
    test(`empty translation ${JSON.stringify(translated)} cannot become the card back`, async () => {
        const state = app(false, false, translated);
        await state.context.saveCurrentSentenceToReview();
        assert.equal(state.saved.length, 0);
        assert.equal(state.toasts.at(-1).status, "error");
    });
}
