const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFunction } = require('./helpers');

function harness() {
    const video = { currentTime: 1, paused: false, ended: false, isConnected: true };
    const session = { video, subtitleFrame: null };
    const frames = new Map();
    const payloads = [];
    let sequence = 0;
    const context = vm.createContext({
        activeVideo: video, videoSessions: new Map([[video, session]]),
        document: { hidden: false }, isNetflixPage: () => true,
        isPreviewOrThumbnailVideo: () => false, isCcActive: () => true,
        getAdapterElements: () => [{ textContent: 'Stale DOM' }],
        getNativeCueLines: () => ['Stale native track'],
        LectoroBaseAdapter: { extractCueLines: () => ['Stale DOM'] },
        LectoroNetflixAdapter: { getCurrentCueLines: () =>
            video.currentTime >= 1.05 && video.currentTime < 1.15 ? ['Short reply'] : [] },
        subtitleChangeCallback: value => payloads.push(value),
        requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; },
    });
    loadFunction(context, 'adapters/player-registry.js', 'dispatchSubtitleChange');
    loadFunction(context, 'adapters/player-registry.js', 'startSubtitleClock');
    function frame(time) {
        video.currentTime = time;
        const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());
    }
    return { context, session, video, frames, payloads, frame };
}

test('Netflix displays and clears a short cue between timeupdate events', () => {
    const h = harness();
    h.context.startSubtitleClock(h.session);
    h.context.startSubtitleClock(h.session);
    assert.equal(h.frames.size, 1, 'only one clock per video');
    h.frame(1.06);
    assert.equal(h.payloads.at(-1).fullText, 'Short reply');
    h.frame(1.16);
    assert.equal(h.payloads.at(-1).fullText, '', 'empty timeline must not restore stale DOM');
    h.video.paused = true;
    h.frame(1.17);
    assert.equal(h.frames.size, 0);
});

test('Netflix subtitle clock stops for hidden, removed, or replaced videos', () => {
    for (const stop of [
        h => { h.context.document.hidden = true; },
        h => { h.video.isConnected = false; },
        h => { h.context.activeVideo = {}; },
    ]) {
        const h = harness();
        h.context.startSubtitleClock(h.session);
        stop(h);
        h.frame(1.06);
        assert.equal(h.frames.size, 0);
        assert.equal(h.payloads.length, 0);
    }
});
