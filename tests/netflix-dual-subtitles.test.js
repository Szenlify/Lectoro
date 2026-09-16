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

test("Netflix aligns both official tracks cue-by-cue matching Language Reactor (no artificial cluster fusing)", async (t) => {
    const h = harness(); t.after(h.dispose);
    const cues = await h.adapter.ensureSubtitleIndex();
    assert.equal(cues.length, 2);
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 2);
    assert.equal(cues[0].translation, "Polski tekst");
    assert.equal(cues[1].startTime, 3);
    assert.equal(cues[1].endTime, 4);
    assert.equal(cues[1].translation, "Polski tekst");

    // Cue 1 active at 1.5s
    h.video.currentTime = 1.5;
    const first = h.adapter.getCurrentCueLines(h.video);
    assert.equal(first.cue, cues[0]);
    assert.equal(first.translation, "Polski tekst");

    // During silence gap between 2.0s and 2.875s, no cue is displayed (no ghosting/hanging subtitles)
    h.video.currentTime = 2.5;
    assert.equal(h.adapter.getCurrentCueLines(h.video).length, 0);

    // Cue 2 active at 3.5s
    h.video.currentTime = 3.5;
    const second = h.adapter.getCurrentCueLines(h.video);
    assert.equal(second.cue, cues[1]);
    assert.equal(second.translation, "Polski tekst");

    // After cue 2 (at 4.5s), empty
    h.video.currentTime = 4.5;
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

test("Netflix adapter rankDownloads prefers webvtt-lssdh-ios8 profile over other profiles (LR parity)", () => {
    const context = vm.createContext({ normalizedValue: (v) => String(v || "").toLowerCase().trim() });
    loadFunction(context, "adapters/netflix-adapter.js", "rankDownloads");
    const downloads = [
        { profile: "dfxp-ls-sdh", urls: ["https://cdn.nflxvideo.net/dfxp.xml"] },
        { profile: "webvtt-lssdh-ios8", urls: ["https://cdn.nflxvideo.net/webvtt-lssdh.vtt"] },
        { profile: "simplesdh", urls: ["https://cdn.nflxvideo.net/simple.xml"] },
        { profile: "webvtt-lssdh", urls: ["https://cdn.nflxvideo.net/webvtt.vtt"] },
    ];
    const ranked = context.rankDownloads({ downloads });
    assert.equal(ranked[0].profile, "webvtt-lssdh-ios8");
    assert.equal(ranked[1].profile, "webvtt-lssdh");
});

test("Netflix bridge JSON.stringify unlocks all tracks and adds webvtt-lssdh-ios8 profile (LR parity)", () => {
    const source = read("netflix-player-bridge.js");
    const context = vm.createContext({
        JSON,
        Function,
        console,
        window: { addEventListener: () => {}, dispatchEvent: () => {}, location: { pathname: "/watch/123" } },
        document: { querySelector: () => null, addEventListener: () => {} },
        history: { pushState: () => {}, replaceState: () => {} },
        setInterval: () => {},
        CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
    });
    vm.runInContext(source, context);

    const manifestRequest = {
        params: {
            supportsPartialHydration: false,
            profiles: ["dfxp-ls-sdh"],
        },
    };
    const stringified = context.JSON.stringify(manifestRequest);
    const parsed = JSON.parse(stringified);

    assert.equal(parsed.params.supportsPartialHydration, true);
    assert.equal(parsed.params.showAllSubDubTracks, true);
    assert.ok(parsed.params.profiles.includes("webvtt-lssdh-ios8"));
});

test("Netflix bridge Function.prototype.apply configures Cadmium DRM buffering (LR parity)", () => {
    const source = read("netflix-player-bridge.js");
    const context = vm.createContext({
        console,
        window: { addEventListener: () => {}, dispatchEvent: () => {}, location: { pathname: "/watch/123" } },
        document: { querySelector: () => null, addEventListener: () => {} },
        history: { pushState: () => {}, replaceState: () => {} },
        setInterval: () => {},
        CustomEvent: class { constructor(type, detail) { this.type = type; this.detail = detail; } },
    });
    vm.runInContext(source, context);

    const check = (key) => vm.runInContext(`(function probe(k) { return k; }).apply(null, ["${key}"])`, context);
    assert.equal(check("preciseSeeking"), true);
    assert.equal(check("minBufferingTimeInMilliseconds"), 1000);
    assert.equal(check("fatalOnUnexpectedSeeking"), false);
});

test("Language Reactor Module 151 multiOverlap attaches spanning translation to both master cues", () => {
    const masterCues = [
        { startTime: 1.0, endTime: 2.5, text: "Wait for me," },
        { startTime: 2.6, endTime: 4.0, text: "we have to go." },
    ];
    const slaveCues = [
        { startTime: 0.9, endTime: 4.1, text: "Czekaj na mnie, musimy iść." },
    ];
    const aligned = subtitleService.alignSlaveTrackToMaster(masterCues, slaveCues, { multiOverlap: true });
    assert.equal(aligned.length, 2);
    assert.equal(aligned[0].translation, "Czekaj na mnie, musimy iść.");
    assert.equal(aligned[1].translation, "Czekaj na mnie, musimy iść.");
});

test("Netflix getAdjacentSubtitleTime navigates dialogue cues accurately with 125ms offset (A and D keys)", async (t) => {
    const h = harness(); t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();

    // Cue 0 is 1.000s --> 2.000s
    // Cue 1 is 3.000s --> 4.000s

    // At 0.875s (start of Cue 0 with 125ms offset), pressing D (next) jumps to Cue 1 (2.875s)
    const nextFromStart = await h.adapter.getAdjacentSubtitleTime(0.875, 1);
    assert.equal(nextFromStart, 2.875);

    // At 1.5s (inside Cue 0), pressing D (next) jumps to Cue 1 (2.875s)
    const nextFromInside = await h.adapter.getAdjacentSubtitleTime(1.5, 1);
    assert.equal(nextFromInside, 2.875);

    // At 2.5s (in silence between Cue 0 and Cue 1), pressing D (next) jumps to Cue 1 (2.875s)
    const nextFromGap = await h.adapter.getAdjacentSubtitleTime(2.5, 1);
    assert.equal(nextFromGap, 2.875);

    // At 2.5s (in silence between Cue 0 and Cue 1), pressing A (prev) rewinds to Cue 0 (0.875s)
    const prevFromGap = await h.adapter.getAdjacentSubtitleTime(2.5, -1);
    assert.equal(prevFromGap, 0.875);

    // At 3.9s (> 750ms into Cue 1), pressing A (prev) replays Cue 1 from beginning (2.875s)
    const replayCue1 = await h.adapter.getAdjacentSubtitleTime(3.9, -1);
    assert.equal(replayCue1, 2.875);

    // At 2.875s (beginning of Cue 1), pressing A (prev) jumps back to Cue 0 (0.875s)
    const prevFromCue1 = await h.adapter.getAdjacentSubtitleTime(2.875, -1);
    assert.equal(prevFromCue1, 0.875);

    // At end of video (after Cue 1), pressing D (next) returns null
    const nextPastEnd = await h.adapter.getAdjacentSubtitleTime(5.0, 1);
    assert.equal(nextPastEnd, null);
});



test("Netflix keeps authored lines before and after translation loads", async (t) => {
    const pending = deferred();
    const h = harness({ send: async (message) => message.url.includes("master")
        ? { text: vtt("First line\nSecond line") } : pending.promise });
    t.after(h.dispose);
    const building = h.adapter.ensureSubtitleIndex();
    await tick();
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["First line", "Second line"]);
    pending.resolve({ text: vtt("Tłumaczenie") });
    await building;
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["First line", "Second line"]);
});

test("Netflix retains short replies contained in another simultaneous line", async (t) => {
    const text = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nYes, of course.\n\n00:00:01.000 --> 00:00:03.000\nYes\n";
    const h = harness({ settings: { doubleSubtitles: false }, send: async () => ({ text }) });
    t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["Yes, of course.", "Yes"]);
});

test("Netflix overlapping lines disappear at their own authored ends", async (t) => {
    const text = "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nLong reply\n\n00:00:01.020 --> 00:00:02.400\nShort reply\n";
    const h = harness({ settings: { doubleSubtitles: false }, send: async () => ({ text }) });
    t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["Long reply", "Short reply"]);
    h.video.currentTime = 2.5;
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["Long reply"]);
});

test("Netflix spanning translation survives an exact start match into the next cue", () => {
    const cues = subtitleService.alignSlaveTrackToMaster([
        { startTime: 1, endTime: 2, text: "First" },
        { startTime: 2, endTime: 4, text: "Second" },
    ], [{ startTime: 1, endTime: 4, text: "Cała wypowiedź" }], { multiOverlap: true });
    assert.deepEqual(cues.map(cue => cue.translation), ["Cała wypowiedź", "Cała wypowiedź"]);
});

test("Netflix finds long active cues behind ended cues older than thirty seconds", async (t) => {
    const text = "WEBVTT\n\n00:00:01.000 --> 00:01:00.000\nLong cue\n\n00:00:02.000 --> 00:00:03.000\nShort cue\n";
    const h = harness({ settings: { doubleSubtitles: false }, send: async () => ({ text }) });
    t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    h.video.currentTime = 40;
    assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), ["Long cue"]);
});

test("Netflix buffering preserves active subtitles without refetching on recovery", async (t) => {
    const h = harness(); t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    const requests = h.requests.length;
    h.setActive({ playerReady: false, isCcActive: false, track: null });
    await h.poll();
    assert.equal(h.adapter.getCurrentCueLines(h.video)[0], "Same words");
    h.setActive({ playerReady: true, isCcActive: true, track: { id: "master", language: "en" } });
    await h.poll();
    assert.equal(h.requests.length, requests);
});

test("Netflix confirmed subtitle-off polling hides indexed subtitles", async (t) => {
    const h = harness(); t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    h.setActive({ playerReady: true, isCcActive: false, track: null });
    await h.poll();
    assert.equal(h.adapter.getCurrentCueLines(h.video), null);
    assert.equal(h.renders.at(-1).lines.length, 0);
});

test("Netflix normal playback follows exact cue boundaries without seek pre-roll", async (t) => {
    const text = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst\n\n00:00:02.000 --> 00:00:03.000\nSecond\n";
    const h = harness({ settings: { doubleSubtitles: false }, send: async () => ({ text }) });
    t.after(h.dispose);
    await h.adapter.ensureSubtitleIndex();
    for (const [time, expected] of [[0.875, []], [0.999, []], [1, ["First"]],
        [1.9, ["First"]], [1.999, ["First"]], [2, ["Second"]], [3, []]]) {
        h.video.currentTime = time;
        assert.deepEqual(Array.from(h.adapter.getCurrentCueLines(h.video)), expected, `at ${time}s`);
    }
});
