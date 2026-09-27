const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, loadFunction } = require('./helpers');
const C = require('../shared/constants');
const S = require('../shared/subtitle-service');
const E = C.EVENT_NAMES;

function harness() {
    class Events {
        constructor() { this.handlers = new Map(); }
        addEventListener(name, fn) {
            if (!this.handlers.has(name)) this.handlers.set(name, new Set());
            this.handlers.get(name).add(fn);
        }
        removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
        dispatchEvent(event) { for (const fn of [...this.handlers.get(event.type) || []]) fn(event); }
        emit(type, detail) { this.dispatchEvent({ type, detail }); }
    }
    let serial = 0, time = 0, cc = true, tracksReady = true, metadataVideo = 'A';
    const timers = new Map(), frames = new Map(), requests = [], pending = [];
    const window = new Events();
    window.location = { hostname: 'www.youtube.com', pathname: '/watch', search: '?v=A', href: 'https://www.youtube.com/watch?v=A' };
    const button = { getAttribute: () => cc ? 'true' : 'false', classList: { contains: () => false } };
    const player = { querySelector: () => button, appendChild() {} };
    const makeVideo = () => Object.assign(new Events(), {
        tagName: 'VIDEO', isConnected: true, paused: false, ended: false, readyState: 4, currentTime: 1.2,
        closest: selector => selector.includes('#movie_player') ? player : null,
    });
    let video = makeVideo(), displayed = '';
    const document = Object.assign(new Events(), {
        querySelector: selector => selector === 'video' || selector === '#movie_player video, .html5-video-player video' ? video : null,
        getElementById: id => id === 'movie_player' ? player : null,
        createElement: () => ({ classList: {}, setAttribute() {}, addEventListener() {}, appendChild() {}, remove() {} }),
    });
    const context = vm.createContext({
        window, document, URL, URLSearchParams, LectoroConstants: C, SharedSubtitleService: S,
        SharedI18n: { t: key => key },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
        MutationObserver: class { observe() {} disconnect() {} },
        setTimeout: (fn, ms) => { timers.set(++serial, { fn, at: time + ms }); return serial; },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame: fn => { frames.set(++serial, fn); return serial; },
        cancelAnimationFrame: id => frames.delete(id),
        LectoroSubtitleOverlay: { renderCustomSubtitles: lines => { displayed = lines.join(' '); }, getActiveText: () => displayed, updateFocusTiming() {} },
    });
    window.addEventListener(E.YOUTUBE_TRACK_REQUEST, event => {
        const id = metadataVideo;
        window.emit(E.YOUTUBE_TRACK_RESPONSE, {
            requestId: event.detail.requestId, videoId: id, tracksReady,
            tracks: tracksReady ? [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${id}&lang=en&kind=asr`, languageCode: 'en', kind: 'asr' }] : [],
            isCcActive: cc,
        });
    });
    window.addEventListener(E.YOUTUBE_FETCH_REQUEST, event => {
        requests.push(new URL(event.detail.url).searchParams.get('v'));
        pending.push(event.detail);
    });
    load(context, 'adapters/youtube-adapter.js');
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    return {
        context, window, document, frames, requests, pending,
        get video() { return video; }, get displayed() { return displayed; },
        setReady(value) { tracksReady = value; }, setCc(value) { cc = value; },
        replaceVideo() { video.isConnected = false; video = makeVideo(); return video; },
        begin(id) {
            window.emit('yt-navigate-start');
            Object.assign(window.location, { search: `?v=${id}`, href: `https://www.youtube.com/watch?v=${id}` });
            metadataVideo = id;
            video.currentTime = 1.2;
        },
        finish() { window.emit('yt-navigate-finish'); },
        async tick(ms) {
            const until = time + ms;
            while (true) {
                const entry = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!entry) break;
                timers.delete(entry[0]); time = entry[1].at; entry[1].fn(); await settle();
            }
            time = until;
        },
        frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
        async respond(request = pending.shift()) {
            const id = new URL(request.url).searchParams.get('v');
            window.emit(E.YOUTUBE_FETCH_RESPONSE, { requestId: request.requestId, ok: true, text: JSON.stringify({ events: [
                { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: `${id} first.` }] },
                { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: `${id} second.` }] },
            ] }) });
            await settle();
        },
    };
}

test('switching films on the same playing video loads and advances captions without a seek or play event', async () => {
    const h = harness(); await h.tick(400); await h.respond();
    assert.equal(h.displayed, 'A first.');
    const reused = h.video;
    h.begin('B');
    assert.equal(h.displayed, '');
    h.finish(); await h.respond();
    assert.equal(h.video, reused);
    assert.deepEqual(h.requests, ['A', 'B']);
    assert.equal(h.displayed, 'B first.');
    h.video.currentTime = 3.2; h.frame();
    assert.equal(h.displayed, 'B second.');
    assert.equal(h.frames.size, 1);
    await h.tick(6000);
    assert.deepEqual(h.requests, ['A', 'B'], 'bootstrap does not refetch a loaded track');
});

test('slow metadata and a replaced player recover automatically; late old-film responses are ignored', async () => {
    const h = harness(); await h.tick(400);
    const oldRequest = h.pending.shift();
    h.begin('B'); h.setReady(false); h.replaceVideo(); h.finish();
    await h.respond(oldRequest);
    assert.equal(h.displayed, '');
    await h.tick(1300);
    assert.deepEqual(h.requests, ['A']);
    h.setReady(true); await h.tick(1200);
    assert.deepEqual(h.requests, ['A', 'B']);
    await h.respond();
    assert.equal(h.displayed, 'B first.');
    h.video.currentTime = 3.2; h.frame();
    assert.equal(h.displayed, 'B second.');
});

test('rapid A to B to C navigation cancels stale work and keeps only C captions', async () => {
    const h = harness(); await h.tick(400);
    const a = h.pending.shift();
    h.begin('B'); h.finish(); const b = h.pending.shift();
    h.begin('C'); h.finish(); const c = h.pending.shift();
    await h.respond(c); await h.respond(a); await h.respond(b);
    assert.equal(h.displayed, 'C first.');
    h.video.currentTime = 3.2; h.frame();
    assert.equal(h.displayed, 'C second.');
    assert.equal(h.frames.size, 1);
});

test('playing/readiness restarts an interrupted clock and CC off stays off', async () => {
    const h = harness(); await h.tick(400); await h.respond();
    h.video.paused = true; h.frame();
    assert.equal(h.frames.size, 0);
    h.video.paused = false; h.video.emit('playing');
    h.video.currentTime = 3.2; h.frame();
    assert.equal(h.displayed, 'A second.');
    h.setCc(false); h.begin('B'); h.finish(); await h.tick(6000);
    assert.deepEqual(h.requests, ['A']);
    assert.equal(h.displayed, '');
});

test('bridge reads only metadata belonging to the URL, even while the player still reports the old film', () => {
    let id = 'A';
    const track = videoId => ({ baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`, languageCode: 'en' });
    const response = videoId => ({ videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [track(videoId)] } } });
    const player = { getVideoData: () => ({ video_id: id }), getPlayerResponse: () => response(id), getOption: () => [track(id)] };
    const context = vm.createContext({ URL, URLSearchParams,
        window: { location: { search: '?v=B', pathname: '/watch', href: 'https://www.youtube.com/watch?v=B' }, ytInitialPlayerResponse: response('A') },
        getYouTubePlayer: () => player,
    });
    for (const name of ['getCurrentVideoId', 'extractCaptionTracks', 'areCaptionTracksReady']) loadFunction(context, 'youtube-player-bridge.js', name);
    assert.equal(context.getCurrentVideoId(), 'B');
    assert.equal(context.extractCaptionTracks().length, 0);
    assert.equal(context.areCaptionTracksReady('B', []), false);
    id = 'B';
    assert.equal(context.extractCaptionTracks()[0].baseUrl, track('B').baseUrl);
    assert.equal(context.areCaptionTracksReady('B', []), true);
});

test('a player becoming ready after bootstrap retries still loads captions via media readiness', async () => {
    const h = harness(); await h.tick(400); await h.respond();
    h.begin('B'); h.setReady(false); h.finish(); await h.tick(6000);
    h.setReady(true); h.replaceVideo();
    h.document.dispatchEvent({ type: 'loadedmetadata', target: h.video });
    assert.deepEqual(h.requests, ['A', 'B']);
    await h.respond();
    h.video.currentTime = 3.2; h.frame();
    assert.equal(h.displayed, 'B second.');
});

test('temporary empty metadata cannot cancel a new film caption download', async () => {
    const h = harness(); await h.tick(400); await h.respond();
    h.begin('B'); h.finish();
    h.window.emit(E.YOUTUBE_TRACKS_AVAILABLE, { videoId: 'B', tracks: [], isCcActive: true });
    await h.respond();
    assert.equal(h.displayed, 'B first.');
    assert.deepEqual(h.requests, ['A', 'B']);
});
