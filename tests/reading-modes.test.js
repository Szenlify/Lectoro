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
        childNodes: [],
        parentNode: null,
        get firstChild() { return this.childNodes[0] || null; },
        get nextSibling() {
            const siblings = this.parentNode?.childNodes || [];
            return siblings[siblings.indexOf(this) + 1] || null;
        },
        set className(value) {
            classes.clear();
            value.split(/\s+/).forEach((name) => classes.add(name));
        },
        closest(selector) {
            return this.classList.contains(selector.slice(1)) ? this : this.parentNode?.closest(selector) || null;
        },
        appendChild(node) {
            node.remove();
            node.parentNode = this;
            this.childNodes.push(node);
        },
        insertBefore(node, reference) {
            node.remove();
            node.parentNode = this;
            this.childNodes.splice(this.childNodes.indexOf(reference), 0, node);
        },
        remove() {
            if (this.parentNode) {
                const siblings = this.parentNode.childNodes;
                siblings.splice(siblings.indexOf(this), 1);
                this.parentNode = null;
            }
        },
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
        "wrapMatchedSpans",
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

test("missing dictionary words are generated after known words are rendered", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    state.context.SharedTranslatorService.lookupWords = async (words, target, source, options) => {
        if (!options.generateMissing) return [{ translated: "pl:important", length: 1 }, null];
        assert.deepEqual(Array.from(words), ["example"]);
        assert.equal(state.context.wordCloudEls.length, 1);
        return [{ translated: "pl:example", length: 1 }];
    };
    await state.start();
    assert.equal(state.errors.length, 0);
    assert.equal(state.urls.length, 0);
    assert.deepEqual(
        Array.from(
            state.context.wordCloudEls,
            ({ cloud }) => cloud.textContent,
        ),
        ["pl:important", "pl:example"],
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

test("late generated words do not repaint a closed subtitle session", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const pending = deferred();
    let generating = false;
    state.context.SharedTranslatorService.lookupWords = async (words, target, source, options) => {
        if (!options.generateMissing) return [{ translated: "known", length: 1 }, null];
        generating = true;
        return pending.promise;
    };
    const running = state.start();
    while (!generating) await tick();
    const before = state.context.wordCloudEls.length;
    state.context.subtitleModeRevision++;
    pending.resolve([{ translated: "late", length: 1 }]);
    await running;
    assert.equal(state.context.wordCloudEls.length, before);
});

test("word loading pulses stop on success and failure, including words still in the queue", async () => {
    for (const fail of [false, true]) {
        const state = app({ wordCloudMode: true, subtitleTTS: false });
        const pending = deferred(); let started = false;
        state.context.activeWordSpans = ["apple", "house", "book", "window"].map(element);
        state.context.SharedTranslatorService.lookupWords = async (words, target, source, options) => {
            if (!options.generateMissing) return words.map(() => null);
            started = true; return pending.promise;
        };
        const running = state.start();
        while (!started) await tick();
        const loading = `${C.PREFIX}word-cloud-loading`;
        assert.ok(state.context.activeWordSpans.every(span => span.classList.contains(loading)));
        if (fail) pending.reject(Error("Offline"));
        else pending.resolve([{ translated: "gotowe", length: 1 }]);
        await running;
        assert.ok(state.context.activeWordSpans.every(span => !span.classList.contains(loading)));
        assert.equal(state.errors.length, fail ? 1 : 0);
    }
});

test("closing S removes pulses immediately; an old result cannot clear a newer pulse", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const pending = deferred(); let started = false;
    state.context.SharedTranslatorService.lookupWords = async (words, target, source, options) => {
        if (!options.generateMissing) return words.map(() => null);
        started = true; return pending.promise;
    };
    const running = state.start();
    while (!started) await tick();
    const loading = `${C.PREFIX}word-cloud-loading`;
    state.context.document.querySelectorAll = () => state.context.activeWordSpans;
    loadFunction(state.context, overlayFile, "removeWordClouds");
    state.context.removeWordClouds();
    assert.ok(state.context.activeWordSpans.every(span => !span.classList.contains(loading)));
    state.context.subtitleModeRevision++;
    const span = state.context.activeWordSpans[0];
    span.dataset.wordCloudLoading = String(state.context.subtitleModeRevision);
    span.classList.add(loading);
    pending.resolve([{ translated: "old", length: 1 }]);
    await running;
    assert.ok(span.classList.contains(loading));
});

test("word clouds skip simple words and highlight every token of a dictionary phrase", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const dictionary = require("../shared/local-dictionary");
    state.context.LectoroPlayerRegistry.getSubtitleLanguage = () => "no";
    const words = ["You", "are", "we", "the", "apples", "unlisted", "look", "forward", "to", "123"];
    const spans = words.map(element);
    const line = element();
    spans.forEach((span) => {
        line.appendChild(span);
        line.appendChild(element(" "));
    });
    spans[2].classList.add("highlight");
    state.context.activeWordSpans = spans;
    state.context.activeText = words.join(" ");
    state.context.SharedTranslatorService.lookupWords = async (requested, targetLang, sourceLang, options) => {
        assert.equal(targetLang, "pl");
        assert.equal(sourceLang, "en");
        assert.equal(options.wordByWord, true);
        if (options.generateMissing) return requested.map(() => null);
        assert.deepEqual(Array.from(requested), words);
        assert.ok(spans.every((span) => !span.classList.contains("highlight")));
        return dictionary.lookupWordByWord(requested, { apple: "jabłko", "look forward to": "wyczekiwać z niecierpliwością" });
    };
    await state.start();
    assert.deepEqual(spans.map((span) => !!span.closest(".highlight")), [false, false, false, false, true, false, true, true, true, false]);
    assert.deepEqual(Array.from(state.context.wordCloudEls, ({ cloud }) => cloud.textContent), ["jabłko", "wyczekiwać z niecierpliwością"]);
    assert.equal(state.urls.length, 0);
    assert.equal(state.errors.length, 0);
});

test("S requests the complete context and renders get up as one expression", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const words = ["Get", "up", "now"];
    const spans = words.map(element);
    const line = element();
    spans.forEach(span => { line.appendChild(span); line.appendChild(element(" ")); });
    state.context.activeWordSpans = spans;
    state.context.activeText = "Get up now";
    let calls = 0;
    state.context.SharedTranslatorService.lookupWords = async (tokens, target, source, options) => {
        calls++;
        assert.equal(options.contextual, true);
        assert.equal(options.context, "Get up now");
        assert.deepEqual(Array.from(tokens), words);
        return [{ translated: "wstań", length: 2 }, null, { translated: "teraz", length: 1 }];
    };
    await state.start();
    assert.equal(calls, 1);
    assert.equal(state.errors.length, 0);
    const clouds = state.context.wordCloudEls;
    assert.equal(clouds.length, 2);
    assert.equal(clouds[0].cloud.textContent, "wstań");
    assert.deepEqual(Array.from(clouds[0].members), spans.slice(0, 2));
    assert.equal(clouds[0].wrappers.length, 1);
    assert.ok(spans.every(span => !span.classList.contains(`${C.PREFIX}word-cloud-loading`)));
});

test("closing S while expression analysis is pending prevents stale grouped clouds", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const pending = deferred();
    let started = false;
    state.context.SharedTranslatorService.lookupWords = async () => { started = true; return pending.promise; };
    const running = state.start();
    while (!started) await tick();
    state.context.subtitleModeRevision++;
    pending.resolve([{ translated: "zwrot", length: 2 }, null]);
    await running;
    assert.equal(state.context.wordCloudEls.length, 0);
    assert.ok(state.context.activeWordSpans.every(span => !span.classList.contains(`${C.PREFIX}word-cloud-loading`)));
});

test("blessing in disguise has a continuous background, centered cloud and reversible grouping", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const words = ["blessing", "in", "disguise"];
    const spans = words.map(element);
    const line = element();
    spans.forEach((span, index) => {
        if (index) line.appendChild(element(" "));
        line.appendChild(span);
        span.getBoundingClientRect = () => ({ left: 100 + index * 80, right: 160 + index * 80,
            top: 200, bottom: 220, width: 60, height: 20 });
    });
    const originalNodes = [...line.childNodes];
    state.context.activeWordSpans = spans;
    state.context.activeText = words.join(" ");
    state.context.window.innerWidth = 1000;
    state.context.SharedTranslatorService.lookupWords = async (requested) =>
        require("../shared/local-dictionary").lookupWordByWord(requested, { "blessing in disguise": "szczęście w nieszczęściu" });
    loadFunction(state.context, overlayFile, "positionWordCloud");
    loadFunction(state.context, overlayFile, "removeWordClouds");
    state.context.document.querySelectorAll = () => [];
    await state.start();
    assert.equal(state.context.wordCloudEls.length, 1);
    const { cloud, span, members, wrappers } = state.context.wordCloudEls[0];
    assert.equal(cloud.textContent, "szczęście w nieszczęściu");
    assert.equal(wrappers.length, 1);
    assert.deepEqual(wrappers[0].childNodes, originalNodes, "spaces share the same background");
    assert.ok(spans.every((member) => !member.classList.contains("highlight")));
    assert.ok(wrappers[0].classList.contains("highlight"));
    assert.equal(cloud.style.left, "180px", "cloud center equals the center of all three words");
    spans[2].getBoundingClientRect = () => ({ left: 260, right: 400, top: 200, bottom: 220, width: 140, height: 20 });
    state.context.positionWordCloud(cloud, span, members);
    assert.equal(cloud.style.left, "220px", "position follows the whole phrase after resizing");
    state.context.removeWordClouds();
    assert.deepEqual(line.childNodes, originalNodes, "closing preserves original word nodes and spaces");
    assert.equal(state.context.wordCloudEls.length, 0);
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
