const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFunction, cssRule } = require('./helpers');
const i18n = require('../shared/i18n');

function timingHarness() {
    const context = vm.createContext({});
    loadFunction(context, 'video/subtitle-overlay.js', 'mapSpansToTimings');
    return (words, segments, cue = { startTime: 0, endTime: 2 }) =>
        Array.from(context.mapSpansToTimings(words.map(textContent => ({ textContent })), segments, cue));
}

test('focus matches complete words, joined segments and punctuation within authored times', () => {
    const map = timingHarness();
    const result = map(['I', 'can’t', 'go.'], [
        { text: 'I', startMs: 0, endMs: 200 },
        { text: 'can', startMs: 200, endMs: 500 },
        { text: "'t", startMs: 500, endMs: 700 },
        { text: 'go', startMs: 700, endMs: 2500 },
    ]);
    assert.deepEqual(result.map(({ startMs, endMs }) => [startMs, endMs]), [[0, 200], [200, 700], [700, 2000]]);
    assert.equal(map(['Café'], [{ text: 'Cafe\u0301', startMs: 0, endMs: 1000 }]).length, 1);
});

test('missing, phrase-only and invalid clocks never produce invented focus timings', () => {
    const map = timingHarness();
    assert.equal(map(['I', 'like'], [{ text: 'like', startMs: 0, endMs: 1000 }]).length, 0);
    assert.equal(map(['One', 'two'], [{ text: 'One two', startMs: 0, endMs: 1000 }]).length, 0);
    assert.equal(map(['One', 'two'], []).length, 0);
    assert.equal(map(['One'], [{ text: 'One', startMs: NaN, endMs: 1000 }]).length, 0);
    assert.equal(map(['One', 'two'], [
        { text: 'One', startMs: 0, endMs: 1000 }, { text: 'two', startMs: 500, endMs: 1200 },
    ]).length, 0);
    assert.equal(map(['One'], [], { startTime: 1, endTime: 1 }).length, 0);
    assert.deepEqual(map(['Hello'], [], { startTime: 1, endTime: 2 }).map(({ startMs, endMs }) => [startMs, endMs]), [[1000, 2000]]);
});

test('the ASR highlighter snaps between rows but slides within a row', () => {
    const classes = new Set(['is-active']), transitions = [];
    const span = (left, top) => ({
        isConnected: true, classList: { add() {}, remove() {} },
        getBoundingClientRect: () => ({ left, top, width: 40, height: 24 }),
    });
    const first = span(0, 0), second = span(50, 0), nextRow = span(0, 32);
    const context = vm.createContext({
        youtubeFocusModeActive: true, lastFocusedSpan: first,
        activeWordTimings: [
            { span: first, startMs: 0, endMs: 100 },
            { span: second, startMs: 100, endMs: 200 },
            { span: nextRow, startMs: 200, endMs: 300 },
        ],
        customSubBoxEl: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
        focusSliderEl: {
            offsetWidth: 40,
            classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
            style: { opacity: '1', setProperty: (...args) => transitions.push(args), removeProperty() {} },
        },
    });
    loadFunction(context, 'video/subtitle-overlay.js', 'updateFocusTiming');
    context.updateFocusTiming(150);
    assert.equal(transitions.length, 0);
    context.updateFocusTiming(250);
    assert.deepEqual(transitions, [['transition', 'none', 'important']]);
    context.updateFocusTiming(301);
    assert.equal(context.focusSliderEl.style.opacity, '0');
});

test('Focus keeps the selected caption language when only another language offers ASR', () => {
    const context = vm.createContext({});
    loadFunction(context, 'adapters/youtube-adapter.js', 'selectBestCaptionTrack');
    const spanish = { languageCode: 'es', kind: '', vssId: '.es' };
    const english = { languageCode: 'en', kind: 'asr', vssId: 'a.en' };
    assert.equal(context.selectBestCaptionTrack([spanish, english], 'es', true), spanish);
    assert.equal(context.selectBestCaptionTrack([spanish, english], 'en', true), english);
});

test('only YouTube gets the font-relative balanced reading column', () => {
    const box = cssRule('styles.css', '#__qt_custom_subtitles_layer[data-platform="youtube"] .__qt_subtitles-box');
    assert.equal(box['max-width'], 'min(86%, 36ch) !important');
    assert.equal(box['font-size'], 'var(--lectoro-sub-font-size, 26px) !important');
    const line = cssRule('styles.css', '#__qt_custom_subtitles_layer[data-platform="youtube"] .__qt_sub-line');
    assert.equal(line['text-wrap'], 'balance !important');
    assert.equal(line['overflow-wrap'], 'anywhere !important');
    assert.equal(cssRule('styles.css', '.__qt_subtitles-box')['max-width'], '90% !important');
});

for (const outcome of ['network', 'empty', 'stale']) {
    test(`caption loading handles ${outcome} without an unhandled rejection or misleading stale notice`, async () => {
        const notices = [];
        let current = true;
        const context = vm.createContext({
            pendingTrackKey: '', captionGeneration: 1, activeTrack: null, currentVideoId: 'video', cueIndex: [], boundVideo: {},
            invalidateCaptionRequest: () => 1, syncActiveCue() {}, getVideoIdFromUrl: () => 'video',
            isCurrentRequest: () => current, buildTimedTextUrl: () => 'url',
            fetchCueCandidates: async () => {
                if (outcome === 'stale') current = false;
                if (outcome !== 'empty') throw new Error('transport failed');
                return [];
            },
            showCaptionStatus: key => notices.push(key), processCaptionTrack() {},
        });
        loadFunction(context, 'adapters/youtube-adapter.js', 'loadCaptionTrack');
        await context.loadCaptionTrack({ baseUrl: 'url' }, 'video');
        assert.deepEqual(notices, outcome === 'stale' ? [] : ['youtube_captions_load_failed']);
        assert.equal(context.pendingTrackKey, '');
    });
}

test('caption recovery messages exist in every supported language', () => {
    for (const lang of i18n.SUPPORTED_LOCALES) {
        const dictionary = i18n.getDictionary(lang);
        for (const key of ['youtube_captions_load_failed', 'youtube_captions_unavailable', 'youtube_focus_unavailable']) {
            assert.ok(dictionary[key], `${lang}: ${key}`);
        }
    }
});

test('status messages are accessible, deduplicated, dismissible and follow fullscreen', () => {
    const element = () => ({
        children: [], attributes: {}, handlers: {}, parentElement: null,
        appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; },
        remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
    });
    const player = element(), fullscreen = element();
    const context = vm.createContext({
        captionStatusEl: null, captionStatusKey: '', captionStatusVideo: '',
        dismissedCaptionStatuses: new Set(),
        isPage: () => true, checkIsCcActive: () => true, getVideoIdFromUrl: () => 'video',
        boundVideo: { closest: () => player }, SharedI18n: { t: key => key },
        document: { fullscreenElement: null, createElement: element },
    });
    for (const name of ['clearCaptionStatus', 'showCaptionStatus', 'reportFocusUnavailable', 'reportFocusAvailable']) {
        loadFunction(context, 'adapters/youtube-adapter.js', name);
    }
    context.showCaptionStatus('youtube_captions_load_failed');
    const notice = player.children[0];
    assert.equal(notice.children[0].attributes.role, 'status');
    assert.equal(notice.children[1].attributes['aria-label'], 'video_toast_close');
    context.showCaptionStatus('youtube_captions_load_failed');
    assert.equal(player.children.length, 1);
    assert.equal(player.children[0], notice);
    context.reportFocusUnavailable();
    assert.equal(context.captionStatusKey, 'youtube_captions_load_failed', 'keep actionable loading error');
    context.document.fullscreenElement = fullscreen;
    context.showCaptionStatus('youtube_captions_load_failed');
    assert.equal(fullscreen.children[0], notice);
    notice.children[1].handlers.click({ stopPropagation() {} });
    context.showCaptionStatus('youtube_captions_load_failed');
    assert.equal(fullscreen.children.length, 0, 'dismissed warnings do not repeat every cue');
    context.reportFocusUnavailable();
    assert.equal(fullscreen.children.length, 1);
    context.reportFocusAvailable();
    assert.equal(fullscreen.children.length, 0, 'remove fallback notice when exact focus resumes');
    context.clearCaptionStatus(true);
    context.showCaptionStatus('youtube_captions_load_failed');
    assert.equal(fullscreen.children.length, 1, 'new video can report a new failure');
});
