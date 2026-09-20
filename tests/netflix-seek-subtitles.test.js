const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFunction } = require('./helpers');

function harness() {
    let now = 0;
    class Video {}
    const video = Object.assign(new Video(), { currentTime: 10.5, paused: false, seeking: false });
    const rendered = [];
    const context = vm.createContext({
        HTMLVideoElement: Video, optimisticSeek: null,
        cueIndex: [
            { startTime: 10, endTime: 20, text: 'Previous' },
            { startTime: 20, endTime: 21, text: 'Destination' },
            { startTime: 30, endTime: 31, text: 'Later' },
        ],
        performance: { now: () => now }, OPTIMISTIC_SEEK_MAX_MS: 3000,
        POST_SEEK_DOM_GRACE_MS: 450, SEEK_EVENT: 'seek', SEEK_DELTA_EVENT: 'delta',
        isCcActive: () => true,
        document: { querySelector: () => video },
        window: { dispatchEvent() {} }, CustomEvent: class {},
        LectoroSubtitleOverlay: { renderCustomSubtitles: lines => rendered.push(Array.from(lines)) },
    });
    for (const name of ['findActiveIndexedCuesAt', 'getCurrentCueLines', 'renderIndexedCue', 'requestSeek']) {
        loadFunction(context, 'adapters/netflix-adapter.js', name);
    }
    return { context, video, rendered, at(ms, time, seeking = false) {
        now = ms; video.currentTime = time; video.seeking = seeking;
        return Array.from(context.getCurrentCueLines(video));
    } };
}

test('subtitle navigation renders the destination immediately through pre-roll and stale clock rebounds', () => {
    const h = harness();
    h.context.requestSeek(19.875, h.video, { subtitleNavigation: true });
    assert.deepEqual(h.rendered.at(-1), ['Destination']);
    assert.deepEqual(h.at(600, 10.5, true), ['Destination']);
    assert.deepEqual(h.at(700, 19.875), ['Destination']);
    assert.deepEqual(h.at(750, 10.5), ['Destination']);
    assert.deepEqual(h.at(900, 20), ['Destination']);
    assert.deepEqual(h.at(1400, 20.5), ['Destination']);
    assert.deepEqual(h.at(2000, 21.1), []);
});

test('backward and superseded seeks keep only the latest selected subtitle', () => {
    const h = harness();
    h.context.requestSeek(29.875, h.video, { subtitleNavigation: true });
    assert.deepEqual(h.rendered.at(-1), ['Later']);
    h.context.requestSeek(19.875, h.video, { subtitleNavigation: true });
    assert.deepEqual(h.at(600, 30, true), ['Destination']);
    assert.deepEqual(h.at(700, 19.875), ['Destination']);
    assert.deepEqual(h.at(4000, 19.875), ['Destination']);
});

test('ordinary seeks preserve gaps and failed seeks release their preview', () => {
    const h = harness();
    h.context.requestSeek(25, h.video);
    assert.deepEqual(h.rendered.at(-1), []);
    assert.deepEqual(h.at(600, 10.5), []);
    assert.deepEqual(h.at(3001, 10.5), ['Previous']);
});

test('paused navigation keeps the destination visible before its audio starts', () => {
    const h = harness();
    h.video.paused = true;
    h.context.requestSeek(19.875, h.video, { subtitleNavigation: true });
    assert.deepEqual(h.at(100, 19.875), ['Destination']);
    assert.deepEqual(h.at(700, 19.875), ['Destination']);
    assert.deepEqual(h.at(4000, 19.875), ['Destination']);
});
