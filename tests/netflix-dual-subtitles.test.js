const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { read, load, loadFunction, storage, deferred, tick } = require("./helpers");
const C = require("../shared/constants");
const subtitleService = require("../shared/subtitle-service");

const track = (id, language) => ({
    id, bcp47: language,
    downloads: [{ profile: "webvtt", urls: [`https://cdn.nflxvideo.net/${id}.vtt`] }],
});
const vtt = (first, second = first) => `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${first}\n\n00:00:03.000 --> 00:00:04.000\n${second}\n`;

function harness({ slave = true, send, settings = {} } = {}) {
    const listeners = new Map();
    const statuses = [];
    const renders = [];
    const requests = [];
    const intervals = [];
    const timers = new Set();
    const local = storage({ targetLang: "pl", doubleSubtitles: true, ...settings });
    const video = { currentTime: 1.5, closest: () => null, paused: true };
    const window = {
        location: { hostname: "www.netflix.com", pathname: "/watch/123" },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(fn);
        },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        dispatchEvent(event) {
            for (const fn of [...listeners.get(event.type) || []]) fn(event);
        },
    };
    const emit = (type, detail) => window.dispatchEvent({ type, detail });
    let active = { playerReady: true, isCcActive: true, track: { id: "master", language: "en" }, movieId: "123" };
    window.addEventListener(C.EVENT_NAMES.NETFLIX_TRACK_REQUEST, (event) => {
        emit(C.EVENT_NAMES.NETFLIX_TRACK_RESPONSE, { ...active, requestId: event.detail.requestId });
    });
    const context = vm.createContext({
        window,
        document: {
            querySelector: (selector) => selector === "video" ? video : null,
            documentElement: { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } },
        },
        chrome: { storage: local },
        LectoroConstants: C,
        SharedSubtitleService: subtitleService,
        SharedUtils: {
            async sendRuntimeMessage(message) {
                requests.push(message);
                if (send) return send(message);
                return { text: vtt(message.url.includes("master") ? "Same words" : "Polski tekst"), contentType: "text/vtt" };
            },
        },
        LectoroSubtitleOverlay: {
            setDualSubtitleStatus: (status) => statuses.push(status),
            renderCustomSubtitles: (lines, options) => renders.push({ lines, options }),
        },
        CustomEvent: class { constructor(type, { detail } = {}) { this.type = type; this.detail = detail; } },
        performance,
        console,
        setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
        clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
        setInterval(fn) { intervals.push(fn); return fn; },
        clearInterval() {},
    });
    load(context, "adapters/netflix-adapter.js");
    const manifest = { movieId: "123", tracks: [track("master", "en"), ...(slave ? [track("slave", "pl")] : [])] };
    emit(C.EVENT_NAMES.NETFLIX_MANIFEST, manifest);
    return {
        adapter: context.LectoroNetflixAdapter, emit, window, statuses, renders, requests, video, local, manifest,
        setActive(value) { active = { ...active, ...value }; },
        async poll() { await intervals.at(-1)(); },
        dispose() { for (const timer of timers) clearTimeout(timer); },
    };
}

test("Netflix pairs both official tracks and preserves the pair throughout its interval", async (t) => {
    const h = harness(); t.after(h.dispose);
    const cues = await h.adapter.ensureSubtitleIndex();
    assert.equal(cues.length, 1);
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 4);
    assert.equal(cues[0].translation, "Polski tekst\nPolski tekst");
    const first = h.adapter.getCurrentCueLines(h.video);
    assert.equal(first.cue, cues[0]);
    h.video.currentTime = 2;
    assert.equal(h.adapter.getCurrentCueLines(h.video).cue, cues[0]);
    h.video.currentTime = 3;
    const second = h.adapter.getCurrentCueLines(h.video);
    assert.equal(second.cue, cues[0]);
    assert.equal(first.cue, second.cue);
    h.video.currentTime = 4;
    assert.equal(h.adapter.getCurrentCueLines(h.video).length, 0);
    assert.equal(h.statuses.at(-1).status, "ready");
    assert.equal(h.requests.length, 2);
    assert.ok(h.requests.every((request) => request.type === "QT_FETCH_NETFLIX_TIMED_TEXT"));
});

test("Netflix missing Slave produces one error while Master remains usable", async (t) => {
    const h = harness({ slave: false }); t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    assert.equal(h.adapter.getCurrentCueLines(h.video)[0], "Same words");
    assert.equal(h.statuses.at(-1).status, "error");
    assert.match(h.statuses.at(-1).error, /no subtitle track/);
    for (let i = 0; i < 3; i++) await h.poll();
    assert.equal(h.statuses.filter((status) => status.status === "error").length, 1);
});

test("Netflix publishes Master during Slave load, surfaces HTTP 429 and retries without negative cache", async (t) => {
    const pending = deferred();
    let slaveCalls = 0;
    const h = harness({ send: async (message) => {
        if (message.url.includes("master")) return { text: vtt("Master") };
        if (++slaveCalls === 1) return pending.promise;
        assert.equal(message.forceRetry, true);
        return { text: vtt("Tłumaczenie") };
    } }); t.after(h.dispose);
    const building = h.adapter.ensureSubtitleIndex();
    await tick();
    assert.equal(h.adapter.getCurrentCueLines(h.video)[0], "Master");
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "");
    pending.reject(new Error("HTTP 429"));
    await building;
    assert.equal(h.statuses.at(-1).status, "error");
    await h.statuses.at(-1).retry();
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "Tłumaczenie\nTłumaczenie");
    assert.equal(h.statuses.at(-1).status, "ready");
});

test("Netflix target-language changes reject a stale Slave response", async (t) => {
    const pending = deferred();
    const h = harness({ send: async (message) => message.url.includes("master")
        ? { text: vtt("Master") } : pending.promise }); t.after(h.dispose);
    const firstBuild = h.adapter.ensureSubtitleIndex();
    await tick();
    await h.local.local.set({ targetLang: "de" });
    await h.adapter.ensureSubtitleIndex();
    pending.resolve({ text: vtt("Stare tłumaczenie") });
    await firstBuild;
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "");
    assert.equal(h.statuses.at(-1).status, "error");
    assert.match(h.statuses.at(-1).error, /no subtitle track/);
});

test("Netflix disabling dual subtitles clears translation and fetches only Master", async (t) => {
    const h = harness(); t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "Polski tekst\nPolski tekst");
    const previousRequests = h.requests.length;
    await h.local.local.set({ doubleSubtitles: false });
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "");
    await h.adapter.ensureSubtitleIndex();
    assert.equal(h.requests.length, previousRequests + 1);
    assert.ok(h.requests.at(-1).url.includes("master"));
    assert.equal(h.statuses.at(-1).status, "idle");
});

test("Netflix CC toggle off rejects pending Slave and hides both lines", async (t) => {
    const pending = deferred();
    const h = harness({ send: async (message) => message.url.includes("master")
        ? { text: vtt("Master") } : pending.promise }); t.after(h.dispose);
    const building = h.adapter.ensureSubtitleIndex();
    await tick();
    h.emit(C.EVENT_NAMES.NETFLIX_TRACK_RESPONSE, {
        requestId: "ui-click-sync", movieId: "123", playerReady: true, isCcActive: false, track: null,
    });
    pending.resolve({ text: vtt("Stare tłumaczenie") });
    await building;
    assert.equal(h.adapter.getCurrentCueLines(h.video), null);
    assert.equal(h.renders.at(-1).lines.length, 0);
    assert.equal(h.statuses.at(-1).status, "idle");
});

test("Netflix navigation rejects pending responses from the previous movie", async (t) => {
    const pending = deferred();
    const h = harness({ send: async (message) => message.url.includes("master")
        ? { text: vtt("Master") } : pending.promise }); t.after(h.dispose);
    const building = h.adapter.ensureSubtitleIndex();
    await tick();
    h.window.location.pathname = "/browse";
    h.emit(C.EVENT_NAMES.NETFLIX_PLAYER_STATE_RESET, { movieId: "" });
    pending.resolve({ text: vtt("Stare tłumaczenie") });
    await building;
    assert.equal(h.adapter.getAllCues().length, 0);
    assert.equal(h.statuses.at(-1).status, "idle");
});

function backgroundHarness(fetchImpl) {
    const source = read("background.js");
    const start = source.indexOf("function isAllowedNetflixMediaHost(");
    const end = source.indexOf("function captureVisibleTab(", start);
    const context = vm.createContext({
        fetch: fetchImpl, URL, AbortSignal, TextDecoder, Date,
        NETFLIX_MEDIA_HOSTS: ["nflxvideo.net"], MAX_NETFLIX_TIMED_TEXT_BYTES: 100_000,
    });
    vm.runInContext(source.slice(start, end), context);
    return context;
}

test("Netflix worker caches failures until an explicit retry and bounds requests with a timeout", async () => {
    let calls = 0;
    let signal;
    const url = "https://cdn.nflxvideo.net/slave.vtt";
    const h = backgroundHarness(async (_, options) => {
        calls++;
        signal = options.signal;
        if (calls === 1) return { ok: false, status: 429 };
        return {
            ok: true, url,
            headers: { get: () => "" },
            arrayBuffer: async () => new TextEncoder().encode(vtt("Polski")).buffer,
        };
    });
    await assert.rejects(h.fetchNetflixTimedText(url), /429/);
    await assert.rejects(h.fetchNetflixTimedText(url), /429/);
    assert.equal(calls, 1);
    const response = await h.fetchNetflixTimedText(url, { forceRetry: true });
    assert.match(response.text, /Polski/);
    assert.equal(calls, 2);
    assert.ok(signal instanceof AbortSignal);
});

test("Netflix bridge accepts official manifest.tracks downloads and rejects audio profiles", () => {
    const context = vm.createContext({});
    for (const name of ["collectDownloadUrls", "getTimedTextTracks", "normalizeDownloads", "normalizeTimedTextManifest"]) {
        loadFunction(context, "netflix-player-bridge.js", name);
    }
    const manifest = context.normalizeTimedTextManifest({
        movieId: "123",
        tracks: [track("master", "en"), track("slave", "pl"), {
            id: "audio", language: "pl", downloads: [{ profile: "aac", urls: ["https://cdn.nflxvideo.net/audio"] }],
        }],
    });
    assert.equal(manifest.tracks.length, 2);
    assert.equal(manifest.tracks[1].bcp47, "pl");
    assert.equal(manifest.tracks[1].downloads[0].urls[0], "https://cdn.nflxvideo.net/slave.vtt");
});
