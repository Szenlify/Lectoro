const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { read, storage, tick } = require("./helpers");
const SubtitleService = require("../shared/subtitle-service");
const Constants = require("../shared/constants");
const E = Constants.EVENT_NAMES;

class Events {
    constructor() { this.listeners = new Map(); }
    addEventListener(name, listener) {
        if (!this.listeners.has(name)) this.listeners.set(name, new Set());
        this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    dispatchEvent(event) {
        for (const listener of [...(this.listeners.get(event.type) || [])]) listener(event);
    }
}
class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}
const captionText = (text, start = 1, duration = 1) => JSON.stringify({
    events: [{ tStartMs: start * 1000, dDurationMs: duration * 1000, segs: [{ utf8: text }] }],
});
const MASTER = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "Same\nwords" }] },
    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "Same words" }] },
] });
const SLAVE = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "Pierwsza\nlinia" }] },
    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "Druga linia" }] },
] });
const track = { baseUrl: "https://www.youtube.com/api/timedtext?v=video1&lang=en&signature=test", languageCode: "en", vssId: ".en", kind: "" };

function setup(initial = {}) {
    const window = new Events();
    window.location = { hostname: "www.youtube.com", pathname: "/watch", search: "?v=video1", href: "https://www.youtube.com/watch?v=video1" };
    const document = new Events();
    let ccEnabled = true;
    const button = { getAttribute: () => String(ccEnabled), classList: { contains: () => false } };
    const player = { querySelector: (selector) => selector === ".ytp-subtitles-button" ? button : null };
    const video = Object.assign(new Events(), {
        currentTime: 1.5, isConnected: true, paused: true,
        closest: (selector) => selector.includes("#movie_player") ? player : null,
    });
    document.querySelector = (selector) => selector === "video" ? video : selector === ".ytp-subtitles-button" ? button : null;
    document.getElementById = (id) => id === "movie_player" ? player : null;
    const settings = storage({ doubleSubtitles: true, targetLang: "pl", ...initial });
    const timers = new Map();
    let timerId = 0;
    let displayed = [];
    const renders = [];
    const statuses = [];
    const requests = [];
    const context = vm.createContext({
        window, document, URL, URLSearchParams, CustomEvent, console,
        LectoroConstants: Constants, SharedSubtitleService: SubtitleService,
        chrome: { storage: settings },
        HTMLVideoElement: class {},
        MutationObserver: class { observe() {} disconnect() {} },
        setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout: (id) => timers.delete(id),
        requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        LectoroSubtitleOverlay: {
            renderCustomSubtitles(lines, options = {}) { displayed = [...lines]; renders.push({ lines: [...lines], options }); },
            getActiveText: () => displayed.join(" "), getActiveLines: () => displayed,
            setDualSubtitleStatus: (status) => statuses.push(status),
        },
    });
    vm.runInContext(read("adapters/youtube-adapter.js"), context);
    const adapter = context.LectoroYouTubeAdapter;
    adapter.getContainer(video);
    window.addEventListener(E.YOUTUBE_FETCH_REQUEST, (event) => requests.push(event.detail));
    const emit = (type, detail) => window.dispatchEvent(new CustomEvent(type, { detail }));
    return {
        adapter, window, video, settings, renders, statuses, requests, emit,
        reply(request, values) { emit(E.YOUTUBE_FETCH_RESPONSE, { requestId: request.requestId, ok: true, ...values }); },
        async runTimer(delay) {
            for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); await timer.callback(); }
            await tick();
        },
        async begin() {
            const result = adapter.loadCaptionTrack(track, "video1");
            await tick();
            this.reply(requests[0], { text: MASTER });
            await tick();
            return { result };
        },
        setCc(enabled) { ccEnabled = enabled; emit(E.YOUTUBE_TRACKS_AVAILABLE, { videoId: "video1", tracks: [track], activeTrack: track, isCcActive: enabled }); },
        seek(time) { video.currentTime = time; video.dispatchEvent({ type: "seeked" }); },
    };
}

test("YouTube uses tlang and renders paired clusters in both languages, including repeated text", async () => {
    const h = setup();
    const { result } = await h.begin();
    assert.equal(h.renders.at(-1).options.secondaryText, "");
    const slaveUrl = new URL(h.requests[1].url);
    assert.equal(slaveUrl.searchParams.get("tlang"), "pl");
    assert.equal(slaveUrl.searchParams.get("signature"), "test");
    h.reply(h.requests[1], { text: SLAVE });
    await result;
    assert.equal(h.adapter.getAllCues().length, 1);
    assert.deepEqual(h.adapter.getAllCues().map((cue) => [cue.startTime, cue.endTime]), [[1, 3]]);
    assert.equal(h.renders.at(-1).lines[0], "Same words");
    assert.equal(h.renders.at(-1).options.secondaryText, "Pierwsza linia\nDruga linia");
    h.seek(2);
    assert.equal(h.renders.at(-1).options.secondaryText, "Pierwsza linia\nDruga linia");
    assert.equal(h.renders.at(-1).options.cue.startTime, 1);
    h.seek(3);
    assert.deepEqual(h.renders.at(-1).lines, []);
    assert.equal(h.renders.at(-1).options.secondaryText, "");
    h.seek(1.5);
    assert.equal(h.renders.at(-1).options.secondaryText, "Pierwsza linia\nDruga linia");
    assert.equal(h.statuses.at(-1).status, "ready");
});

for (const failure of [{ status: 429 }, { error: "network_error" }, { error: "timeout" }]) {
    test(`YouTube reports ${JSON.stringify(failure)} once and Retry reloads only Slave`, async () => {
        const h = setup();
        const { result } = await h.begin();
        h.reply(h.requests[1], { ok: false, text: "", ...failure });
        await result;
        assert.equal(h.requests.length, 2);
        assert.equal(h.statuses.at(-1).status, "error");
        assert.equal(h.adapter.getAllCues()[0].translation, "");
        assert.equal(h.renders.at(-1).lines[0], "Same words");
        const retry = h.statuses.at(-1).retry();
        await tick();
        assert.equal(new URL(h.requests[2].url).searchParams.get("tlang"), "pl");
        h.reply(h.requests[2], { text: SLAVE });
        await retry;
        assert.equal(h.requests.length, 3);
        assert.equal(h.statuses.at(-1).status, "ready");
    });
}

test("YouTube bounds a silent bridge timeout and reports missing tracks with working Retry", async () => {
    const h = setup();
    const { result } = await h.begin();
    await h.runTimer(6000);
    await result;
    assert.equal(h.statuses.at(-1).status, "error");
    const empty = setup();
    empty.emit(E.YOUTUBE_TRACKS_AVAILABLE, { tracks: [], videoId: "video1", isCcActive: false });
    await tick();
    assert.equal(empty.statuses.at(-1).status, "error");
    let trackRequest;
    empty.window.addEventListener(E.YOUTUBE_TRACK_REQUEST, (event) => { trackRequest = event.detail; });
    await empty.statuses.at(-1).retry();
    assert.ok(trackRequest.requestId);
});

test("YouTube target language changes replace the pending request and reject stale Slave responses", async () => {
    const h = setup();
    const { result } = await h.begin();
    const oldRequest = h.requests[1];
    await h.settings.local.set({ targetLang: "de" });
    await tick();
    assert.equal(new URL(h.requests[2].url).searchParams.get("tlang"), "de");
    h.reply(h.requests[2], { text: captionText("Guten Tag") });
    await tick();
    h.reply(oldRequest, { text: SLAVE });
    await result;
    assert.equal(h.renders.at(-1).options.secondaryText, "Guten Tag");
    h.emit(E.YOUTUBE_SLAVE_TIMED_TEXT, { text: SLAVE, videoId: "video1" });
    assert.equal(h.renders.at(-1).options.secondaryText, "Guten Tag");
});

test("YouTube disabling double subtitles cancels pending work and immediately clears Slave", async () => {
    const h = setup();
    const { result } = await h.begin();
    const pending = h.requests[1];
    await h.settings.local.set({ doubleSubtitles: false });
    await tick();
    h.reply(pending, { text: SLAVE });
    await result;
    assert.equal(h.requests.length, 2);
    assert.equal(h.statuses.at(-1).status, "idle");
    assert.equal(h.renders.at(-1).options.secondaryText, "");
});

test("YouTube navigation and CC-off discard in-flight results without resurrecting subtitles", async () => {
    for (const action of ["navigate", "cc"]) {
        const h = setup();
        const { result } = await h.begin();
        const pending = h.requests[1];
        if (action === "navigate") {
            Object.assign(h.window.location, { search: "?v=video2", href: "https://www.youtube.com/watch?v=video2" });
            h.emit(E.YOUTUBE_NAVIGATION, { videoId: "video2" });
        } else h.setCc(false);
        h.reply(pending, { text: SLAVE });
        await result;
        assert.deepEqual(h.renders.at(-1).lines, []);
        assert.equal(h.statuses.at(-1).status, "idle");
    }
});

test("YouTube resolves the native active track metadata to its signed URL and tries official formats only", async () => {
    const h = setup({ doubleSubtitles: false });
    h.emit(E.YOUTUBE_TRACKS_AVAILABLE, { tracks: [track], activeTrack: { languageCode: "en", vssId: ".en" }, videoId: "video1", isCcActive: true });
    await tick();
    assert.equal(h.requests.length, 1);
    h.reply(h.requests[0], { text: "" });
    await tick();
    assert.equal(new URL(h.requests[1].url).searchParams.get("fmt"), "vtt");
    h.reply(h.requests[1], { text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\nworld\n" });
    await tick();
    assert.equal(h.adapter.getAllCues()[0].text, "Hello world");
    assert.equal(h.requests.length, 2);
    assert.equal(h.statuses.at(-1).status, "idle");
});

function setupBridge(fetchImpl) {
    const window = new Events();
    window.location = { search: "?v=video1", pathname: "/watch", href: "https://www.youtube.com/watch?v=video1" };
    window.fetch = fetchImpl;
    const document = new Events();
    document.readyState = "loading";
    document.getElementById = () => null;
    document.querySelector = () => null;
    const timers = new Map();
    let nextTimer = 0;
    const context = vm.createContext({
        window, document, URL, URLSearchParams, CustomEvent, AbortController,
        XMLHttpRequest: class extends Events { open() {} send() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
        clearTimeout: (id) => timers.delete(id),
    });
    vm.runInContext(read("youtube-player-bridge.js"), context);
    const responses = [];
    const nativeEvents = [];
    window.addEventListener(E.YOUTUBE_FETCH_RESPONSE, (event) => responses.push(event.detail));
    for (const name of [E.YOUTUBE_TIMED_TEXT, E.YOUTUBE_SLAVE_TIMED_TEXT]) {
        window.addEventListener(name, (event) => nativeEvents.push(event.detail));
    }
    return {
        window, timers, responses, nativeEvents,
        request(url = track.baseUrl) { window.dispatchEvent(new CustomEvent(E.YOUTUBE_FETCH_REQUEST, { detail: { requestId: "test", url } })); },
    };
}

test("YouTube bridge preserves HTTP429 and never loops its own request into native caption events", async () => {
    let calls = 0;
    const h = setupBridge(async () => {
        calls++;
        return { ok: false, status: 429, text: async () => "rate limited" };
    });
    h.request();
    await tick();
    assert.equal(calls, 1);
    assert.equal(h.responses[0].status, 429);
    assert.equal(h.responses[0].text, "");
    assert.equal(h.nativeEvents.length, 0);
    h.request("https://unrelated.example/api/timedtext");
    await tick();
    assert.equal(calls, 1);
    assert.equal(h.responses[1].error, "invalid_timedtext_url");
});

test("YouTube bridge aborts the actual network request after five seconds", async () => {
    let signal;
    const h = setupBridge((_url, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    h.request();
    assert.equal(signal.aborted, false);
    [...h.timers.values()].find((timer) => timer.delay === 5000).fn();
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal(h.responses[0].error, "timeout");
});

test("YouTube bridge stamps native caption responses with the video at request start", async () => {
    let resolve;
    const h = setupBridge(() => new Promise((done) => { resolve = done; }));
    const nativeRequest = h.window.fetch(track.baseUrl);
    h.window.location.search = "?v=video2";
    resolve({ ok: true, clone: () => ({ text: async () => MASTER }) });
    await nativeRequest;
    await tick();
    assert.equal(h.nativeEvents[0].videoId, "video1");
});

test("YouTube retains Master loading when double subtitles are disabled before Master finishes", async () => {
    const h = setup();
    const first = h.adapter.loadCaptionTrack(track, "video1");
    await tick();
    const oldRequest = h.requests[0];
    await h.settings.local.set({ doubleSubtitles: false });
    await tick();
    assert.equal(h.requests.length, 2);
    assert.equal(new URL(h.requests[1].url).searchParams.has("tlang"), false);
    h.reply(h.requests[1], { text: MASTER });
    await tick();
    h.reply(oldRequest, { text: captionText("Stale master") });
    await first;
    assert.equal(h.adapter.getAllCues()[0].text, "Same words Same words");
    assert.equal(h.statuses.at(-1).status, "idle");
});

test("YouTube suppresses subtitles while video is still loading (readyState < 2) and displays them once loaded", async () => {
    const h = setup();
    h.video.readyState = 0;
    const { result } = await h.begin();
    h.reply(h.requests[1], { text: SLAVE });
    await result;
    assert.equal(h.renders.length, 0);

    h.video.readyState = 2;
    h.video.dispatchEvent({ type: "loadeddata" });
    assert.equal(h.renders.length, 1);
    assert.deepEqual(h.renders.at(-1).lines, ["Same words", "Same words"]);
});


test("YouTube language changes never merge existing pairs into four clusters", async () => {
    const h = setup();
    const captions = (words) => JSON.stringify({ events: words.map((text, i) => ({
        tStartMs: (i + 1) * 1000, dDurationMs: 1000, segs: [{ utf8: text }],
    })) });
    const loading = h.adapter.loadCaptionTrack(track, "video1");
    await tick();
    h.reply(h.requests[0], { text: captions(["A", "B", "C", "D"]) });
    await tick();
    h.reply(h.requests[1], { text: captions(["a", "b", "c", "d"]) });
    await loading;
    for (const language of ["de", "fr"]) {
        await h.settings.local.set({ targetLang: language });
        await tick();
        h.reply(h.requests.at(-1), { text: captions(["w", "x", "y", "z"]) });
        await tick();
        const cues = h.adapter.getAllCues();
        assert.deepEqual(Array.from(cues, (cue) => cue.text), ["A B", "C D"]);
        assert.deepEqual(Array.from(cues, (cue) => cue.translation), ["w\nx", "y\nz"]);
        h.seek(3.5);
        assert.deepEqual(h.renders.at(-1).lines, ["C", "D"]);
        assert.equal(h.renders.at(-1).options.secondaryText, "y\nz");
    }
});

test("YouTube keeps Apple translation with its source through parsing, alignment and pairing", async () => {
    const h = setup();
    const captions = (texts) => JSON.stringify({ events: texts.map((text, i) => ({
        tStartMs: (1 + i * 2) * 1000, dDurationMs: 2000, segs: [{ utf8: text }],
    })) });
    const result = h.adapter.loadCaptionTrack(track, "video1");
    await tick();
    h.reply(h.requests[0], { text: captions([
        "So now Apples will do that soon", "See, it was a a tactical decision", "Well done. Oh, hi there",
    ]) });
    await tick();
    h.reply(h.requests[1], { text: captions([
        "Więc Apple wkrótce to zrobi.", "widzisz, to była decyzja taktyczna.", "Dobrze zrobiony. O, cześć.",
    ]) });
    await result;
    assert.deepEqual(h.renders.at(-1).lines, ["So now Apples will do that soon", "See, it was a a tactical decision"]);
    assert.equal(h.renders.at(-1).options.secondaryText, "Więc Apple wkrótce to zrobi.\nwidzisz, to była decyzja taktyczna.");
    h.seek(3.5);
    assert.ok(h.renders.at(-1).options.secondaryText.includes("widzisz, to była decyzja taktyczna."));
    h.seek(5.5);
    assert.deepEqual(h.renders.at(-1).lines, ["Well done. Oh, hi there"]);
    assert.equal(h.renders.at(-1).options.secondaryText, "Dobrze zrobiony. O, cześć.");
});

test("YouTube aligns the supplied Apple ASR sentences before pairing and preserves them on language reload", async () => {
    const h = setup();
    const english = read("tests/fixtures/apple-asr-en.json");
    const polish = read("tests/fixtures/apple-asr-pl.json");
    const result = h.adapter.loadCaptionTrack(track, "video1");
    await tick();
    h.reply(h.requests[0], { text: english });
    await tick();
    h.reply(h.requests[1], { text: polish });
    await result;
    const verify = () => {
        h.seek(8.72);
        assert.deepEqual(h.renders.at(-1).lines, [
            "So now Apples will do that soon.", "See, it was a a tactical decision.",
        ]);
        assert.equal(h.renders.at(-1).options.secondaryText,
            "Więc Apple wkrótce to zrobi.\nWidzisz, to była decyzja taktyczna.");
        h.seek(13.2);
        assert.deepEqual(h.renders.at(-1).lines, ["Well done.", "Oh, hi there."]);
        assert.equal(h.renders.at(-1).options.secondaryText, "Dobrze zrobiony.\nO, cześć.");
        h.seek(15.44);
        assert.deepEqual(h.renders.at(-1).lines, ["I'm Sam Tucker"]);
        assert.equal(h.renders.at(-1).options.secondaryText, "Nazywam się Sam Tucker i jestem");
        h.seek(6);
        assert.equal(h.renders.at(-1).options.secondaryText,
            "I dlatego kilka lat temu spowodowaliśmy eksplozję naszych baterii.");
    };
    verify();
    await h.settings.local.set({ targetLang: "de" });
    await tick();
    await h.settings.local.set({ targetLang: "pl" });
    await tick();
    h.reply(h.requests.at(-1), { text: polish });
    await tick();
    verify();
});

test("unmatched captions elsewhere in a video do not disable Apple sentence alignment", async () => {
    for (const extraIn of ["en", "pl"]) {
        const h = setup();
        const english = JSON.parse(read("tests/fixtures/apple-asr-en.json"));
        const polish = JSON.parse(read("tests/fixtures/apple-asr-pl.json"));
        (extraIn === "en" ? english : polish).events.push({
            tStartMs: 22000, dDurationMs: 1500,
            segs: [{ utf8: "Extra" }, { utf8: " caption.", tOffsetMs: 500 }],
        });
        const result = h.adapter.loadCaptionTrack(track, "video1");
        await tick();
        h.reply(h.requests[0], { text: JSON.stringify(english) });
        await tick();
        h.reply(h.requests[1], { text: JSON.stringify(polish) });
        await result;
        h.seek(8.72);
        assert.deepEqual(h.renders.at(-1).lines, [
            "So now Apples will do that soon.", "See, it was a a tactical decision.",
        ]);
        assert.equal(h.renders.at(-1).options.secondaryText,
            "Więc Apple wkrótce to zrobi.\nWidzisz, to była decyzja taktyczna.");
    }
});
