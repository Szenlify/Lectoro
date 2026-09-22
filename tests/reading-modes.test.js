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
        wordCloudSelectedSpan: null,
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
        "positionAllWordClouds",
        "positionWordCloud",
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
    test(`S uses native ${language}: words=true, even with simple AI language`, async () => {
        const state = app({
            targetLang: language,
            wordCloudMode: true,
            aiExplanationLanguage: "simple_target",
        });
        await state.start();
        assert.deepEqual(state.drawn, []);
        assert.deepEqual(
            Array.from(
                state.context.wordCloudEls,
                ({ cloud }) => cloud.textContent,
            ),
            [`${language}:important`, `${language}:example`],
        );
        assert.equal(state.speech.length, 1);
        assert.equal(state.speech[0].text, `${language}:important example`);
        assert.equal(state.speech[0].lang, language);
        assert.equal(state.loading.length, 0);
        assert.equal(state.charged(), 0);
        assert.equal(state.urls.length, 1);
        assert.equal(state.video.paused, true);
        assert.equal(state.errors.length, 0);
    });
}

test("S mode avoids cloud overlap with vertical tiering and speaks full sentence via Google Translate without drawing it", async () => {
    const state = app({ wordCloudMode: true, targetLang: "pl", learningLang: "en" });
    const words = ["unfortunately", "circumstances"];
    const spans = words.map(element);
    spans[0].getBoundingClientRect = () => ({ left: 100, right: 180, top: 200, bottom: 220, width: 80, height: 20 });
    spans[1].getBoundingClientRect = () => ({ left: 190, right: 280, top: 200, bottom: 220, width: 90, height: 20 });
    state.context.activeWordSpans = spans;
    state.context.activeText = "unfortunately circumstances";
    state.context.SharedTranslatorService.lookupWords = async () => [
        { translated: "niestety", length: 1 },
        { translated: "okoliczności", length: 1 },
    ];
    await state.start();
    assert.equal(state.context.wordCloudEls.length, 2);
    const [cloud1, cloud2] = state.context.wordCloudEls;
    const left1 = parseInt(cloud1.cloud.style.left, 10);
    const top1 = parseInt(cloud1.cloud.style.top, 10);
    const left2 = parseInt(cloud2.cloud.style.left, 10);
    const top2 = parseInt(cloud2.cloud.style.top, 10);
    const horizCollision = !(left1 + 60 + 6 <= left2 || left2 + 60 + 6 <= left1);
    const vertCollision = !(top1 + 20 <= top2 || top2 + 20 <= top1);
    assert.ok(!(horizCollision && vertCollision), "adjacent clouds must not overlap each other");
    assert.equal(state.speech.length, 1);
    assert.equal(state.speech[0].lang, "pl");
    assert.deepEqual(state.drawn, []);
});

test("HTTP 429 produces one visible error, no original-as-translation and no quota charge", async () => {
    const state = app({ wordCloudMode: true });
    state.context.SharedTranslatorService.lookupWords = async () => {
        const err = new Error("Rate limited");
        err.code = "RATE_LIMITED";
        throw err;
    };
    await state.start();
    assert.equal(state.errors.length, 1);
    assert.equal(state.errors[0].code, "RATE_LIMITED");
    assert.equal(state.drawn.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.context.wordCloudEls.length, 0);
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
    const state = app();
    state.context.SubscriptionService.getSubtitleQuotaStatus = async () => ({
        allowed: false,
        resetInMs: 1000,
    });
    const result = await state.context.LectoroReadingModes.translate("important example", state.ui.subtitleModeRevision);
    assert.equal(state.limits.length, 1);
    assert.equal(state.urls.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.errors.length, 0);
    assert.equal(result.limitReached, true);
});

for (const setting of ["targetLang", "learningLang"]) {
test(`changing ${setting} while a translation is in flight discards its result`, async () => {
    const state = app();
    state.context.wordCloudActive = true;
    const revision = state.ui.subtitleModeRevision;
    const pending = deferred();
    state.context.fetch = () => pending.promise;
    const action = state.context.LectoroReadingModes.translate("important example", revision);
    await tick();
    await state.store.local.set({ [setting]: "de" });
    pending.resolve({
        ok: true,
        json: async () => [[["stare tłumaczenie"]], null, "en"],
    });
    const result = await action;
    assert.equal(result, null);
    assert.equal(state.drawn.length, 0);
    assert.equal(state.speech.length, 0);
    assert.equal(state.errors.length, 0);
});

}

test("disabled modes or a missing cue restore playback without requests", async () => {
    for (const empty of [false, true]) {
        const state = app(
            empty ? {} : { wordCloudMode: false },
        );
        if (empty) state.context.activeText = "";
        await state.start();
        assert.equal(state.video.paused, false);
        assert.equal(state.urls.length, 0);
        assert.equal(state.ui.isSubtitleUiOpen(), false);
    }
});

test("speech failure does not replace a valid sentence translation with an error", async () => {
    const state = app();
    state.context.QT.speak = async () => {
        throw new Error("Voice unavailable");
    };
    await state.ui.doSentenceTranslation(state.video, "important example", {
        speakTranslated: true,
        translationTask: Promise.resolve({
            status: "success",
            translated: "pl:important example",
            translatedText: "pl:important example",
            targetLang: "pl",
        }),
    });
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

test("simple words do not receive word-cloud-loading blue pulse animation", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false });
    const pending = deferred(); let started = false;
    const words = ["the", "apples", "is", "house", "you"];
    const spans = words.map(element);
    state.context.activeWordSpans = spans;
    state.context.SharedTranslatorService.lookupWords = async (w, target, source, options) => {
        started = true; return pending.promise;
    };
    const running = state.start();
    while (!started) await tick();
    const loading = `${C.PREFIX}word-cloud-loading`;
    assert.equal(spans[0].classList.contains(loading), false, "'the' should not pulse");
    assert.equal(spans[1].classList.contains(loading), true, "'apples' should pulse");
    assert.equal(spans[2].classList.contains(loading), false, "'is' should not pulse");
    assert.equal(spans[3].classList.contains(loading), true, "'house' should pulse");
    assert.equal(spans[4].classList.contains(loading), false, "'you' should not pulse");
    pending.resolve(words.map(() => null));
    await running;
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
    const words = ["Get", "up", "early"];
    const spans = words.map(element);
    const line = element();
    spans.forEach(span => { line.appendChild(span); line.appendChild(element(" ")); });
    state.context.activeWordSpans = spans;
    state.context.activeText = "Get up early";
    let calls = 0;
    state.context.SharedTranslatorService.lookupWords = async (tokens, target, source, options) => {
        calls++;
        assert.equal(options.contextual, true);
        assert.equal(options.context, "Get up early");
        assert.deepEqual(Array.from(tokens), words);
        return [{ translated: "wstań", length: 2 }, null, { translated: "wcześnie", length: 1 }];
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
    const state = app({ wordCloudMode: true });
    let keydown;
    state.context.document.addEventListener = (type, handler) => {
        if (type === "keydown") keydown = handler;
    };
    load(state.context, "video/universal-video-controller.js");
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

test("words that do not highlight (simple words, non-dictionary terms) are never translated or given clouds after clicking S", async () => {
    const state = app({ wordCloudMode: true, subtitleTTS: false, learningLang: "en", targetLang: "pl" });
    const words = ["I", "am", "reading", "the", "book", "in", "peace"];
    const spans = words.map(element);
    const line = element();
    spans.forEach((span) => {
        line.appendChild(span);
        line.appendChild(element(" "));
    });
    state.context.activeWordSpans = spans;
    state.context.activeText = words.join(" ");
    // Even if lookupWords returns translations for ALL words (including simple ones):
    state.context.SharedTranslatorService.lookupWords = async (tokens) => {
        return tokens.map((t) => ({ translated: `pl:${t}`, length: 1 }));
    };
    await state.start();
    // Only "reading", "book", "peace" must have word clouds!
    // "I", "am", "the", "in" must NOT have word clouds and must NOT be highlighted!
    const clouds = state.context.wordCloudEls;
    assert.deepEqual(
        clouds.map((c) => c.cloud.textContent),
        ["pl:reading", "pl:book", "pl:peace"],
    );
    assert.equal(spans[0].classList.contains("highlight"), false, "'I' must not highlight");
    assert.equal(spans[1].classList.contains("highlight"), false, "'am' must not highlight");
    assert.equal(spans[2].classList.contains("highlight"), true, "'reading' must highlight");
    assert.equal(spans[3].classList.contains("highlight"), false, "'the' must not highlight");
    assert.equal(spans[4].classList.contains("highlight"), true, "'book' must highlight");
    assert.equal(spans[5].classList.contains("highlight"), false, "'in' must not highlight");
    assert.equal(spans[6].classList.contains("highlight"), true, "'peace' must highlight");
});


test("S arrows select clouds in subtitle order, keep phrases intact and clamp at boundaries", async () => {
    const state = app({ subtitleTTS: false });
    await state.start();
    const selected = [];
    state.context.getSpanWord = span => span.textContent;
    state.context.handleSubWordClick = (span, text) => selected.push(text);
    loadFunction(state.context, overlayFile, "navigateWordCloud");
    const first = state.context.wordCloudEls[0];
    const second = state.context.wordCloudEls[1];
    first.members = [element("get"), element("up")];
    state.context.wordCloudEls = [second, first];
    assert.equal(state.context.wordCloudSelectedSpan, null);
    state.context.navigateWordCloud(1);
    state.context.navigateWordCloud(1);
    state.context.navigateWordCloud(1);
    state.context.navigateWordCloud(-1);
    assert.deepEqual(selected, ["get up", "example", "example", "get up"]);
    assert.equal(state.video.paused, true);
    state.context.wordCloudSelectedSpan = null;
    state.context.navigateWordCloud(-1);
    assert.equal(selected.at(-1), "example");
    let closed = false;
    state.context.closeSubTooltip = options => { closed = options.resumeVideo === false; };
    state.context.document.querySelectorAll = () => [];
    loadFunction(state.context, overlayFile, "removeWordClouds");
    state.context.removeWordClouds();
    assert.equal(closed, true);
    assert.equal(state.context.wordCloudSelectedSpan, null);
});

test("S arrows and A/D preserve the reading session and Z/X keep defaults until selection", async () => {
    const state = app({ subtitleTTS: false });
    let keydown;
    state.context.document.addEventListener = (type, handler) => { if (type === "keydown") keydown = handler; };
    state.context.document.querySelector = () => null;
    let sentenceSaves = 0;
    const directions = [];
    state.ui.isWordCloudActive = () => state.context.wordCloudActive;
    state.ui.hasWordCloudSelection = () => directions.length > 0;
    state.ui.navigateWordCloud = direction => directions.push(direction);
    state.ui.saveCurrentSentenceToReview = () => sentenceSaves++;
    load(state.context, "video/universal-video-controller.js");
    await state.start();
    const revision = state.ui.subtitleModeRevision;
    const press = key => {
        const event = { key, target: { tagName: "BODY" }, prevented: false,
            preventDefault() { this.prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
        keydown(event);
        return event;
    };
    press("z");
    assert.equal(sentenceSaves, 1);
    assert.equal(press("x").prevented, false);
    press("ArrowRight");
    press("ArrowLeft");
    press("d");
    press("a");
    press("D");
    press("A");
    assert.deepEqual(directions, [1, -1, 1, -1, 1, -1]);
    assert.equal(state.ui.subtitleModeRevision, revision);
    assert.equal(state.video.paused, true);
    press("z");
    assert.equal(sentenceSaves, 1, "loading a selected word must not save the whole sentence");
    assert.equal(press("x").prevented, true);
});
