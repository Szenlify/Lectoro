const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction, deferred, tick } = require("./helpers");
const file = "video/subtitle-overlay.js";

function harness() {
    const events = [];
    const retries = [];
    const video = { isConnected: true, paused: true, ended: false };
    const context = vm.createContext({
        subtitleModeRevision: 1, subtitleModeStarting: true, subtitleResumeRevision: 0,
        subTooltipRequestId: 1, aiExplainRequestId: 1, aiExplainSpeechToken: 1,
        aiExplainSpeechPromise: Promise.resolve(), aiAutoAdvanceTimer: 1,
        quotaCountdownTimer: null, isSubHovering: false, subClickLocked: false,
        aiTooltipActive: false, aiPaywallActive: false, eTranslateActive: false, wordCloudActive: false,
        customSubBoxEl: null,
        clearTimeout() {}, setTimeout: fn => retries.push(fn),
        requestAnimationFrame: fn => retries.push(fn),
        SharedTtsService: { cancel: () => events.push("cancel") },
        cleanupReading: () => events.push("stop-reading"),
        QT: { hideTooltip: () => events.push("hide-tooltip") },
        document: { body: { removeAttribute() {} } },
        removeOverlay() {}, removeWordClouds() {}, removeSubtitleTranslationUnderOriginal() {},
        isSentenceOverlayOpen: () => false,
        getPlayerRegistry: () => ({
            getVideo: () => video,
            playVideo: () => { events.push("play"); video.paused = false; },
            pauseVideo: () => { video.paused = true; },
        }),
    });
    for (const name of ["stopVideoSpeech", "restoreOriginal", "handleVideoPlaybackStarted",
        "resumeVideoAfterSubtitleClose", "pauseIfPlaying"]) loadFunction(context, file, name);
    return { context, events, video, retries };
}

test("closing S cancels speech and pending work before DOM cleanup can fail", () => {
    const { context, events } = harness();
    context.removeOverlay = () => { throw Error("detached DOM"); };
    assert.throws(() => context.restoreOriginal(), /detached DOM/);
    assert.equal(events[0], "cancel");
    assert.equal(context.subtitleModeRevision, 2);
    assert.equal(context.subtitleModeStarting, false);
    assert.equal(context.aiExplainSpeechToken, 2);
    assert.equal(context.aiExplainRequestId, 1);
    assert.equal(context.subTooltipRequestId, 2);
    assert.equal(context.aiExplainSpeechPromise, null);
    assert.equal(context.aiAutoAdvanceTimer, null);
});

test("closing old S UI preserves a new Enter request until its session is active", () => {
    const { context } = harness();
    context.restoreOriginal();
    assert.equal(context.aiExplainRequestId, 1);
    context.aiTooltipActive = true;
    context.stopVideoSpeech();
    assert.equal(context.aiExplainRequestId, 2);
});

for (const type of ["play", "playing", "seeking", "seeked", "ended", "pagehide"]) {
    test(`${type} stops speech even when no subtitle overlay remains`, () => {
        const { context, events } = harness();
        context.handleVideoPlaybackStarted({ type, target: { tagName: type === "pagehide" ? undefined : "VIDEO" } });
        assert.deepEqual(events, ["cancel", "stop-reading", "hide-tooltip"]);
        assert.equal(context.subtitleModeRevision, 2);
    });
}

test("TTS audio events do not cancel their own playback", () => {
    const { context, events } = harness();
    context.handleVideoPlaybackStarted({ type: "play", target: { tagName: "AUDIO" } });
    assert.deepEqual(events, []);
});

test("video resumes only after speech stops, including delayed resume attempts", () => {
    const { context, events, video, retries } = harness();
    context.resumeVideoAfterSubtitleClose(video);
    assert.equal(events.at(-1), "play");
    assert.ok(events.indexOf("cancel") < events.indexOf("play"));
    video.paused = true;
    events.length = 0;
    retries[0]();
    assert.deepEqual(events, ["cancel", "stop-reading", "hide-tooltip", "play"]);
});

test("starting a new paused reading session invalidates old resume retries", () => {
    const { context, events, video, retries } = harness();
    context.resumeVideoAfterSubtitleClose(video);
    context.pauseIfPlaying(video);
    events.length = 0;
    retries.forEach(fn => fn());
    assert.equal(video.paused, true);
    assert.deepEqual(events, []);
});

test("a closed word lookup cannot start TTS after the same word is reopened", async () => {
    const pending = deferred();
    const span = { isConnected: true, textContent: "hello" };
    const spoken = [];
    let lookups = 0;
    const context = vm.createContext({
        subTooltipRequestId: 0, isSubHovering: true, lastHoveredSubWord: span,
        activeWordSpans: [span], activeText: "hello", ensureSubtitleUiTracking() {},
        QT: { showLoading() {}, showTooltip() {}, buildTooltipHtml: data => data,
            attachTooltipHandlers() {}, speak: async text => spoken.push(text) },
        SharedTranslatorService: {
            getReadingSettings: async () => ({ targetLang: "pl", learningLang: "en" }),
            lookupWords: async () => ++lookups === 1 ? pending.promise : [{ translated: "cześć" }],
        },
    });
    loadFunction(context, file, "showWordTooltip");
    const old = context.showWordTooltip(span, "hello", {}, { speak: true });
    await tick();
    context.subTooltipRequestId++;
    await context.showWordTooltip(span, "hello", {}, { speak: true });
    pending.resolve([{ translated: "cześć", senses: [{ definition: "An old definition" }] }]);
    await old;
    assert.deepEqual(spoken, ["hello"]);
});

test("hiding a missing tooltip still invalidates pending audio", () => {
    const events = [];
    const context = vm.createContext({
        tooltipEl: null, stopTooltipSpeech: () => events.push("stop"),
    });
    loadFunction(context, "core.js", "hideTooltip");
    context.hideTooltip();
    assert.deepEqual(events, ["stop"]);
});

test("closing text reading cancels every TTS backend before UI cleanup", () => {
    let cancelled = false;
    const context = vm.createContext({
        readingSession: 1, readingSafetyTimer: null, readingStartTimer: null,
        readingMonitorTimer: null, activeReadingUtterance: {}, isReading: true,
        clearTimeout() {}, clearInterval() {}, lastSpeechCancelAt: 0,
        SharedTtsService: { cancel: () => { cancelled = true; } },
        clearSentenceHighlight: () => { throw Error("detached DOM"); },
    });
    loadFunction(context, "content.js", "cleanupReading");
    assert.throws(() => context.cleanupReading(), /detached DOM/);
    assert.equal(cancelled, true);
    assert.equal(context.isReading, false);
    assert.equal(context.readingSession, 2);
});
