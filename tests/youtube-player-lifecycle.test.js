const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFunction } = require('./helpers');

function harness() {
    const frames = new Map(), synced = [], cleared = [];
    let id = 0;
    const context = vm.createContext({
        boundVideo: null, boundVideoCleanup: null, playbackRafId: null,
        cueIndex: [], currentDisplayedText: '', currentDisplayedCue: null,
        isPreviewVideo: () => false, checkIsCcActive: () => true,
        syncActiveCue: video => synced.push(video), requestTracklistFromBridge() {},
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; },
        cancelAnimationFrame: id => frames.delete(id),
        LectoroSubtitleOverlay: { updateFocusTiming() {}, renderCustomSubtitles: lines => cleared.push(lines) },
    });
    for (const name of ['startPlaybackLoop', 'stopPlaybackLoop', 'bindVideoEvents', 'unbindVideoEvents']) {
        loadFunction(context, 'adapters/youtube-adapter.js', name);
    }
    const video = () => {
        const listeners = new Map();
        return {
            isConnected: true, paused: false, ended: false, currentTime: 1, listeners,
            addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
            removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
            emit(name) { for (const fn of listeners.get(name) || []) fn(); },
        };
    };
    return { context, frames, synced, cleared, video, flush() {
        const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
    } };
}

test('already playing video starts caption updates without waiting for another play event', () => {
    const h = harness(), video = h.video();
    h.context.bindVideoEvents(video);
    assert.deepEqual(h.synced, [video]);
    assert.equal(h.frames.size, 1);
    h.flush();
    assert.deepEqual(h.synced, [video, video]);
    video.isConnected = false;
    h.flush();
    assert.equal(h.frames.size, 0, 'removed player cannot leave an animation loop running');
});

test('replaced YouTube players cannot clear or overwrite captions from the new player', () => {
    const h = harness(), oldVideo = h.video(), newVideo = h.video();
    h.context.bindVideoEvents(oldVideo);
    const lateLoadEvent = [...oldVideo.listeners.get('emptied')][0];
    h.context.bindVideoEvents(newVideo);
    assert.equal([...oldVideo.listeners.values()].reduce((count, listeners) => count + listeners.size, 0), 0);
    oldVideo.emit('pause'); oldVideo.emit('timeupdate'); oldVideo.emit('emptied');
    lateLoadEvent(); // An event already queued before listener cleanup is harmless too.
    assert.equal(h.cleared.length, 0);
    assert.deepEqual(h.synced, [oldVideo, newVideo]);
    assert.equal(h.frames.size, 1);
    h.flush();
    assert.equal(h.synced.at(-1), newVideo);
    h.context.bindVideoEvents(newVideo);
    assert.equal(newVideo.listeners.get('timeupdate').size, 1, 'rebinding is idempotent');
    h.context.unbindVideoEvents();
    assert.equal(h.frames.size, 0);
    newVideo.emit('timeupdate'); newVideo.emit('emptied');
    assert.equal(h.cleared.length, 0);
});
