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

function harness({ slave = true, send, settings = {}, translator = null } = {}) {
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
        ...(translator ? { SharedTranslatorService: translator } : {}),
        SharedUtils: {
            normalizeLanguageCode: require("../shared/utils").normalizeLanguageCode,
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

test("Netflix uses official tracks, preserves exact Master gaps and passes cue identity", async (t) => {
    const h = harness(); t.after(h.dispose);
    const cues = await h.adapter.ensureSubtitleIndex();
    assert.equal(cues.length, 2);
    assert.equal(cues[0].endTime, 2);
    assert.equal(cues[1].startTime, 3);
    assert.equal(cues[0].translation, "Polski tekst");
    const first = h.adapter.getCurrentCueLines(h.video);
    assert.equal(first.cue, cues[0]);
    h.video.currentTime = 2;
    assert.equal(h.adapter.getCurrentCueLines(h.video).length, 0);
    h.video.currentTime = 3;
    const second = h.adapter.getCurrentCueLines(h.video);
    assert.equal(second.cue, cues[1]);
    assert.notEqual(first.cue, second.cue);
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
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "Tłumaczenie");
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
    assert.equal(h.adapter.getCurrentCueLines(h.video).translation, "Polski tekst");
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

test("Netflix bridge extracts languageCode, locale, lang, and name into manifest tracks", () => {
    const context = vm.createContext({});
    for (const name of ["collectDownloadUrls", "getTimedTextTracks", "normalizeDownloads", "normalizeTimedTextManifest"]) {
        loadFunction(context, "netflix-player-bridge.js", name);
    }
    const manifest = context.normalizeTimedTextManifest({
        movieId: "456",
        timedtexttracks: [
            {
                id: "ja_track",
                languageCode: "ja",
                displayName: "Japoński [oryginalny]",
                downloadables: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/ja.vtt"] }],
            },
            {
                id: "de_track",
                locale: "de-DE",
                displayName: "Deutsch [Original]",
                downloadables: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/de.vtt"] }],
            },
        ],
    });
    assert.equal(manifest.tracks.length, 2);
    assert.equal(manifest.tracks[0].bcp47, "ja");
    assert.equal(manifest.tracks[0].displayName, "Japoński [oryginalny]");
    assert.equal(manifest.tracks[1].bcp47, "de-DE");
    assert.equal(manifest.tracks[1].displayName, "Deutsch [Original]");
});

test("Netflix resolves Japanese and German tracks by localized names and language codes", async (t) => {
    const jaVtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n日本語の字幕\n";
    const deVtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nDeutsche Untertitel\n";
    const requestedUrls = [];

    const h = harness({
        settings: { targetLang: "ja" },
        send: async (msg) => {
            requestedUrls.push(msg.url);
            if (msg.url.includes("master")) return { text: vtt("Master text") };
            if (msg.url.includes("ja")) return { text: jaVtt };
            if (msg.url.includes("de")) return { text: deVtt };
            return { text: vtt("Polski") };
        },
    });
    t.after(h.dispose);

    // Manifest with Japanese in Polish Netflix UI format ("Japoński [oryginalny]", languageCode: "ja")
    // and German in ("Deutsch [Original]", locale: "de-DE")
    h.manifest.tracks.push({
        id: "ja_track",
        languageCode: "ja",
        displayName: "Japoński [oryginalny]",
        downloads: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/ja.vtt"] }],
    });
    h.manifest.tracks.push({
        id: "de_track",
        locale: "de-DE",
        displayName: "Deutsch [Original]",
        downloads: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/de.vtt"] }],
    });
    h.emit(C.EVENT_NAMES.NETFLIX_MANIFEST, h.manifest);

    // 1. Japanese resolution
    const jaCues = await h.adapter.ensureSubtitleIndex();
    assert.equal(jaCues[0].translation, "日本語の字幕");
    assert.ok(requestedUrls.some((u) => u.includes("ja.vtt")));

    // 2. Switch to German
    await h.local.local.set({ targetLang: "de" });
    const deCues = await h.adapter.ensureSubtitleIndex();
    assert.equal(deCues[0].translation, "Deutsche Untertitel");
    assert.ok(requestedUrls.some((u) => u.includes("de.vtt")));
});

test("Netflix prefers standard dialogue tracks over Audio Description and CC", async (t) => {
    const h = harness({
        settings: { targetLang: "de" },
        send: async (msg) => {
            if (msg.url.includes("standard")) return { text: vtt("Standard dialogue") };
            if (msg.url.includes("ad")) return { text: vtt("Audio description") };
            return { text: vtt("Master") };
        },
    });
    t.after(h.dispose);

    h.manifest.tracks.push({
        id: "de_ad",
        language: "de",
        displayName: "Deutsch [Audiodeskription]",
        downloads: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/de_ad.vtt"] }],
    });
    h.manifest.tracks.push({
        id: "de_standard",
        language: "de",
        displayName: "Deutsch",
        downloads: [{ profile: "webvtt", urls: ["https://cdn.nflxvideo.net/de_standard.vtt"] }],
    });
    h.emit(C.EVENT_NAMES.NETFLIX_MANIFEST, h.manifest);

    const cues = await h.adapter.ensureSubtitleIndex();
    assert.equal(cues[0].translation, "Standard dialogue");
});

test("Netflix falls back to auto-translating master cues when no official slave track exists", async (t) => {
    const translations = new Map();
    const h = harness({
        slave: false,
        settings: { targetLang: "ja" },
        translator: {
            async translate(text, targetLang) {
                const result = `[${targetLang}] ${text}`;
                translations.set(`${targetLang}|${text}`, result);
                return { translated: result, detectedLang: "en" };
            },
        },
    });
    t.after(h.dispose);

    // Initial build succeeds and marks status as ready via auto-translation fallback
    const cues = await h.adapter.ensureSubtitleIndex();
    assert.equal(cues.length, 2);
    assert.equal(h.statuses.at(-1).status, "ready");

    // Before translation arrives, master lines are immediately usable
    h.video.currentTime = 1.5;
    const lines = h.adapter.getCurrentCueLines(h.video);
    assert.equal(lines[0], "Same words");

    // Wait for microtask tick for async translation resolution
    await tick();
    await tick();

    // Secondary translation is now populated
    const linesAfter = h.adapter.getCurrentCueLines(h.video);
    assert.equal(linesAfter.translation, "[ja] Same words");
    assert.equal(cues[0].translation, "[ja] Same words");

    // Check that prefetching also translated cue 1
    assert.equal(cues[1].translation, "[ja] Same words");

    // Switching setting to German auto-translates to German
    await h.local.local.set({ targetLang: "de" });
    await h.adapter.ensureSubtitleIndex();
    await tick();
    await tick();

    const deLines = h.adapter.getCurrentCueLines(h.video);
    assert.equal(deLines.translation, "[de] Same words");
    assert.equal(h.statuses.at(-1).status, "ready");
});


