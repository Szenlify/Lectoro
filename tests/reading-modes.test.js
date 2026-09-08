const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { load, loadFunction, storage, deferred, tick } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const overlayFile = "video/subtitle-overlay.js";

function element(text = "") {
    const classes = new Set();
    return {
        textContent: text,
        dataset: { clean: text },
        isConnected: true,
        style: {},
        classList: {
            contains: (value) => classes.has(value),
            add: (...values) => values.forEach((value) => classes.add(value)),
            remove: (...values) =>
                values.forEach((value) => classes.delete(value)),
            toggle: (value, on) =>
                on ? classes.add(value) : classes.delete(value),
        },
        getBoundingClientRect: () => ({ width: 60, height: 20 }),
    };
}

function app(settings = {}) {
    const store = storage({ ...C.DEFAULT_READING_SETTINGS, ...settings });
    const drawn = [],
        loading = [],
        speech = [],
        errors = [],
        limits = [],
        urls = [];
    let charged = 0;
    const video = {
        paused: false,
        pause() {
            this.paused = true;
        },
    };
    const registry = { getVideo: () => video, pauseVideo: () => video.pause() };
    const context = vm.createContext({
        LectoroConstants: C,
        C,
        SharedUtils: U,
        chrome: { storage: store },
        LectoroPlayerRegistry: registry,
        getPlayerRegistry: () => registry,
        AbortController,
        setTimeout,
        clearTimeout,
        console: { warn() {} },
        window: { getComputedStyle: () => ({ fontSize: "20px" }) },
        document: {
            body: { setAttribute() {} },
            createElement: () => element(),
        },
        fetch: async (url) => {
            const query = new URL(url).searchParams;
            urls.push(query);
            return {
                ok: true,
                json: async () => [
                    [[`${query.get("tl")}:${query.get("q")}`]],
                    null,
                    "en",
                ],
            };
        },
        subtitleModeRevision: 0,
        subtitleModeStarting: false,
        eTranslateActive: false,
        wordCloudActive: false,
        wordCloudEls: [],
        activeText: "important example",
        activeWordSpans: [element("important"), element("example")],
        WORD_CLOUD_CLASS: "cloud",
        WORD_CLOUD_HIGHLIGHT_CLASS: "highlight",
        ANY_PUNCTUATION_RE: /[.,]/g,
        PREFIX: C.PREFIX,
        pauseIfPlaying: () => video.pause(),
        captureSubtitleLayout: () => ({}),
        showSubtitleTranslationUnderOriginal: (text, options) => {
            if (!options?.loading) drawn.push(text);
        },
        showAiShimmer: () => loading.push("Analyzing"),
        removeAiShimmer() {},
        applyAiExplanation: (html) => drawn.push(html.replace(/<[^>]*>/g, "")),
        translationOverlay: null,
        removeSubtitleTranslationUnderOriginal() {},
        aiSubTranslationEl: null,
        ensureSubtitleUiTracking() {},
        positionWordCloud() {},
    });
    load(context, "shared/translator-service.js");
    context.SharedTranslatorService = {
        ...context.SharedTranslatorService,
        lookupWords: async (words, language) => words.map((word) => ({ translated: `${language}:${word}`, length: 1 })),
    };
    context.SubscriptionService = {
        getSubtitleQuotaStatus: async () => ({ allowed: true }),
        consumeSubtitleQuota: async (n) => {
            charged += n;
            return { allowed: true };
        },
    };
    load(context, "shared/subtitle-translation-service.js");
    context.SharedUtils = {
        ...U,
        sendRuntimeMessage: async (message) => ({
            result: await context.SharedSubtitleTranslationService.translate(
                message.text,
                message.targetLang,
                message.sourceLang,
            ),
        }),
    };
    context.QT = {
        escapeHtml: U.escapeHtml,
        getOverlayParent: () => ({ appendChild() {} }),
        speak: async (text, lang) => {
            speech.push({ text, lang });
        },
    };
    for (const name of [
        "showWordClouds",
        "doSentenceTranslation",
        "createSubtitleTranslationTask",
    ]) {
        loadFunction(context, overlayFile, name);
    }
    const ui = {
        get subtitleModeRevision() {
            return context.subtitleModeRevision;
        },
        nextSubtitleModeRevision() {
            context.subtitleModeStarting = true;
            return ++context.subtitleModeRevision;
        },
        resetSubtitleModeStarting() {
            context.subtitleModeStarting = false;
        },
        captureSubtitleSnapshot: () => ({
            text: context.activeText,
            elements: context.activeWordSpans,
            layout: {},
        }),
        restoreOriginal() {
            context.subtitleModeRevision++;
            context.eTranslateActive = false;
            context.wordCloudActive = false;
            context.subtitleModeStarting = false;
        },
        resumeVideoAfterSubtitleClose() {
            video.paused = false;
        },
        isSubtitleUiOpen: () =>
            context.subtitleModeStarting ||
            context.eTranslateActive ||
            context.wordCloudActive,
        showReadingError: (error) => errors.push(error),
        showSubtitleLimitOverlay: (quota) => limits.push(quota),
        showWordClouds: context.showWordClouds,
        doSentenceTranslation: context.doSentenceTranslation,
    };
    context.LectoroSubtitleOverlay = ui;
    load(context, "video/reading-modes.js");
    return {
        context,
        ui,
        store,
        video,
        drawn,
        loading,
        speech,
        errors,
        limits,
        urls,
        charged: () => charged,
        start: () => context.LectoroReadingModes.start(video),
    };
}

for (const language of ["pl", "de"]) {
    for (const [sentence, words] of [
        [true, false],
        [false, true],
        [true, true],
    ]) {
        test(`S uses native ${language}: sentence=${sentence}, words=${words}, even with simple AI language`, async () => {
            const state = app({
                targetLang: language,
                subtitleTTS: sentence,
                wordCloudMode: words,
                aiExplanationLanguage: "simple_target",
            });
            await state.start();
            assert.deepEqual(
                state.drawn,
                sentence ? [`${language}:important example`] : [],
            );
            assert.deepEqual(
                Array.from(
                    state.context.wordCloudEls,
                    ({ cloud }) => cloud.textContent,
                ),
                words ? [`${language}:important`, `${language}:example`] : [],
            );
            assert.equal(state.speech.length, sentence ? 1 : 0);
            if (sentence) assert.equal(state.speech[0].lang, language);
            assert.equal(state.loading.length, sentence ? 1 : 0);
            assert.equal(state.charged(), sentence ? "important example".length : 0);
            assert.equal(state.urls.length, sentence ? 1 : 0);
            assert.equal(state.video.paused, true);
            assert.equal(state.errors.length, 0);
        });
    }
}

test("HTTP 429 produces one visible error, no original-as-translation and no quota charge", async () => {
    const state = app({ subtitleTTS: true, wordCloudMode: true });
    state.context.fetch = async () => ({ ok: false, status: 429 });
    await state.start();
    assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0].code, "RATE_LIMITED");
    assert.equal(state.drawn.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.context.wordCloudEls.length, 2);
    assert.equal(state.charged(), 0);
});

test("missing dictionary words are skipped without a network fallback", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    state.context.SharedTranslatorService.lookupWords = async () => [{ translated: "pl:important", length: 1 }, null];
    await state.start();
    assert.equal(state.errors.length, 0);
    assert.equal(state.urls.length, 0);
    assert.deepEqual(
        Array.from(
            state.context.wordCloudEls,
            ({ cloud }) => cloud.textContent,
        ),
        ["pl:important"],
    );
});

test("quota denial displays the limit and never fetches or speaks", async () => {
    const state = app({ subtitleTTS: true });
    state.context.SubscriptionService.getSubtitleQuotaStatus = async () => ({
        allowed: false,
        resetInMs: 1000,
    });
    await state.start();
    assert.equal(state.limits.length, 1);
    assert.equal(state.urls.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.errors.length, 0);
});

for (const setting of ["targetLang", "learningLang"]) {
test(`changing ${setting} while a translation is in flight discards its result`, async () => {
    const state = app({ subtitleTTS: true, wordCloudMode: false });
    const pending = deferred();
    state.context.fetch = () => pending.promise;
    const action = state.start();
    await tick();
    await state.store.local.set({ [setting]: "de" });
    pending.resolve({
        ok: true,
        json: async () => [[["stare tłumaczenie"]], null, "en"],
    });
    await action;
    assert.equal(state.drawn.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.errors.length, 0);
});

}

test("disabled modes or a missing cue restore playback without requests", async () => {
    for (const empty of [false, true]) {
        const state = app(
            empty ? {} : { subtitleTTS: false, wordCloudMode: false },
        );
        if (empty) state.context.activeText = "";
        await state.start();
        assert.equal(state.video.paused, false);
        assert.equal(state.urls.length, 0);
        assert.equal(state.ui.isSubtitleUiOpen(), false);
    }
});

test("speech failure does not replace a valid sentence translation with an error", async () => {
    const state = app({ subtitleTTS: true, wordCloudMode: false });
    state.context.QT.speak = async () => {
        throw new Error("Voice unavailable");
    };
    await state.start();
    assert.deepEqual(state.drawn, ["pl:important example"]);
    assert.equal(state.errors.length, 0);
});

test("word clouds skip simple words and highlight every token of a dictionary phrase", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const dictionary = require("../shared/local-dictionary");
    state.context.LectoroPlayerRegistry.getSubtitleLanguage = () => "no";
    const words = ["You", "are", "we", "the", "apples", "unlisted", "look", "forward", "to", "123"];
    const spans = words.map(element);
    spans[2].classList.add("highlight");
    state.context.activeWordSpans = spans;
    state.context.activeText = words.join(" ");
    state.context.SharedTranslatorService.lookupWords = async (requested, targetLang, sourceLang, options) => {
        assert.equal(targetLang, "pl");
        assert.equal(sourceLang, "en");
        assert.equal(options.wordByWord, true);
        assert.deepEqual(Array.from(requested), words);
        assert.ok(spans.every((span) => !span.classList.contains("highlight")));
        return dictionary.lookupWordByWord(requested, require("../dictionaries/pl.json"));
    };
    await state.start();
    assert.deepEqual(spans.map((span) => span.classList.contains("highlight")), [false, false, false, false, true, false, true, true, true, false]);
    assert.deepEqual(Array.from(state.context.wordCloudEls, ({ cloud }) => cloud.textContent), ["jabłko", "wyczekiwać z niecierpliwością"]);
    assert.equal(state.urls.length, 0);
    assert.equal(state.errors.length, 0);
});

test("holding S keeps the session open; a second press closes it and resumes playback", async () => {
    const state = app({ subtitleTTS: true });
    let keydown;
    state.context.document.addEventListener = (type, handler) => {
        if (type === "keydown") keydown = handler;
    };
    load(state.context, "video/video-hotkeys.js");
    const event = (repeat) => ({
        key: "s",
        repeat,
        target: { tagName: "BODY" },
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
    });
    await state.start();
    const revision = state.ui.subtitleModeRevision;
    keydown(event(true));
    assert.equal(state.ui.subtitleModeRevision, revision);
    assert.equal(state.video.paused, true);
    keydown(event(false));
    assert.equal(state.ui.isSubtitleUiOpen(), false);
    assert.equal(state.video.paused, false);
});
