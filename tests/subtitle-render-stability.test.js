const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load, read, cssRule } = require('./helpers');
const C = require('../shared/constants');

// This DOM tracks real removal/reparenting semantics and queued animation frames.
// It intentionally does not pretend to measure browser typography.
function harness(hostname = "www.youtube.com") {
    class Element {
        constructor(tag = 'div') {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.parentElement = null;
            this.className = '';
            this.dataset = {};
            this.attributes = {};
            this.style = {
                setProperty(name, value) { this[name] = value; },
                getPropertyValue(name) { return this[name] || ''; },
                removeProperty(name) { delete this[name]; },
            };
            this.classList = {
                contains: name => this.className.split(' ').includes(name),
                add: (...names) => { this.className = [...new Set([...this.className.split(' '), ...names])].join(' '); },
                remove: (...names) => { this.className = this.className.split(' ').filter(name => !names.includes(name)).join(' '); },
            };
        }
        get isConnected() { return this === root || Boolean(this.parentElement?.isConnected); }
        get parentNode() { return this.parentElement; }
        get firstChild() { return this.children[0] || null; }
        get childNodes() { return this.children; }
        get offsetHeight() { return 60; }
        get offsetWidth() { return 200; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentElement = this; return child; }
        insertBefore(child, reference) {
            child.remove();
            const index = this.children.indexOf(reference);
            this.children.splice(index < 0 ? this.children.length : index, 0, child);
            child.parentElement = this;
        }
        remove() {
            if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
            this.parentElement = null;
        }
        set innerHTML(value) { assert.equal(value, ''); for (const child of [...this.children]) child.remove(); }
        setAttribute(name, value) { this.attributes[name] = value; }
        getAttribute(name) { return this.attributes[name] ?? null; }
        addEventListener() {}
        removeEventListener() {}
        querySelector() { return null; }
        querySelectorAll() { return []; }
        getBoundingClientRect() { return { width: 1000, height: 600, top: 0, left: 0 }; }
    }
    const root = new Element('html');
    const body = root.appendChild(new Element('body'));
    const player = body.appendChild(new Element());
    const video = player.appendChild(new Element('video'));
    Object.assign(video, { readyState: 4, currentTime: 1, paused: false, closest: () => player });
    let cc = true, preferences;
    const frames = new Map();
    let frameId = 0;
    const events = new Map();
    const observers = [];
    const document = {
        body, documentElement: root, fullscreenElement: null,
        createElement: tag => new Element(tag),
        createTextNode: text => Object.assign(new Element('#text'), { textContent: text }),
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        addEventListener: (name, callback) => events.set(name, callback),
    };
    const context = vm.createContext({
        LectoroConstants: C, SharedI18n: { t: value => value },
        SharedUtils: { cleanCardText: value => value },
        DictionaryTokenizer: require("../shared/dictionary-tokenizer"),
        SharedPhraseDetector: { tokenizeSubtitleLine: value => [{ type: 'word', text: value }] },
        QT: { getOverlayParent: () => body, addDismissHandler() {}, addCleanup() {} },
        LectoroPlayerRegistry: { getVideo: () => video, isCcActive: () => cc, onSubtitleChange() {} },
        document, window: { location: { hostname }, addEventListener() {}, getComputedStyle: () => ({ position: 'relative' }) },
        chrome: { storage: { local: { get: (defaults, callback) => { preferences = data => callback({ ...defaults, ...data }); } }, onChanged: { addListener() {} } } },
        requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame: id => frames.delete(id),
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} },
    });
    load(context, 'video/subtitle-overlay.js');
    const overlay = context.LectoroSubtitleOverlay;
    const layer = () => player.children.find(child => child.id === C.UI_IDS.CUSTOM_SUBTITLES_LAYER) || document.fullscreenElement?.children.find(child => child.id === C.UI_IDS.CUSTOM_SUBTITLES_LAYER);
    return {
        overlay, video, player, document, body, events, frames, context,
        preferences: data => preferences(data), layer,
        box: () => layer()?.children[0], cc: value => { cc = value; }, observers,
        flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    };
}

test('refresh waits for stored preferences and displays only the latest pending cue', () => {
    const h = harness();
    h.overlay.renderCustomSubtitles(['Previous']);
    h.overlay.renderCustomSubtitles(['Latest']);
    assert.equal(h.box(), undefined, 'no default-style subtitle is painted before storage resolves');
    h.preferences({ [C.STORAGE_KEYS.SUBTITLE_POSITION]: 30, [C.STORAGE_KEYS.SUBTITLE_FONT_SIZE]: 'large' });
    assert.equal(h.overlay.getActiveText(), 'Latest');
    assert.equal(h.layer().style['--lectoro-sub-font-size'], '31px');
    assert.equal(h.layer().style['--lectoro-sub-bottom'], '180px');
    assert.equal(h.box().style.opacity, '1');
    assert.equal(h.frames.size, 0, 'first paint already has final geometry');
});

test('every cue has its drag controls and final layout before the next animation frame', () => {
    const h = harness(); h.preferences({});
    let handle;
    for (const lines of [['First'], ['Next'], ['Two', 'lines'], ['Back to one']]) {
        h.overlay.renderCustomSubtitles(lines);
        const box = h.box();
        const controls = box.children.filter(child => child.classList.contains(C.UI_CLASSES.SUB_HANDLE));
        assert.equal(controls.length, 1, 'handle must already be in flex layout');
        if (handle) assert.equal(controls[0], handle, 'reuse the handle and its pointer listeners');
        handle = controls[0];
        const children = [...box.children];
        const bottom = h.overlay.getCurrentSubBottomPx();
        h.overlay.syncCustomSubtitlePosition(); h.flush();
        assert.deepEqual(box.children, children, 'no delayed addition or reordering of controls');
        assert.equal(h.overlay.getCurrentSubBottomPx(), bottom);
    }
});

test('player DOM replacement and fullscreen reuse the current cue without an empty layer', () => {
    const h = harness(); h.preferences({}); h.overlay.renderCustomSubtitles(['Same cue']);
    const layer = h.layer(), box = h.box(), words = h.overlay.getCustomSubtitleElements();
    layer.remove();
    h.overlay.renderCustomSubtitles(['Same cue']);
    assert.equal(h.layer(), layer);
    assert.equal(h.box(), box);
    assert.equal(h.overlay.getCustomSubtitleElements(), words);
    h.document.fullscreenElement = h.body;
    h.events.get('fullscreenchange')(); h.flush();
    assert.equal(layer.parentElement, h.body);
    assert.equal(box.style.opacity, '1');
});

test('CC off, unloaded media and real gaps clear captions without resurrecting old text', () => {
    const h = harness(); h.preferences({});
    for (const reason of ['cc', 'loading', 'gap']) {
        h.cc(true); h.video.readyState = 4; h.overlay.renderCustomSubtitles(['Visible']);
        if (reason === 'cc') h.cc(false);
        if (reason === 'loading') h.video.readyState = 0;
        h.overlay.renderCustomSubtitles(reason === 'gap' ? [] : ['Should be hidden']);
        h.overlay.syncCustomSubtitlePosition(); h.flush();
        assert.equal(h.overlay.getActiveText(), '');
        assert.equal(h.box().style.opacity, '0');
        assert.equal(h.box().children.some(child => child.classList.contains('__qt_sub-line')), false);
    }
});

test('same text with changed line breaks updates the visible lines', () => {
    const h = harness(); h.preferences({});
    h.overlay.renderCustomSubtitles(['One two', 'three']);
    h.overlay.renderCustomSubtitles(['One', 'two three']);
    assert.deepEqual(Array.from(h.overlay.getActiveLines()), ['One', 'two three']);
});

test('caption CSS arrives at document_start and cue containers never animate', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const styles = manifest.content_scripts.filter(script => script.css?.includes('styles.css'));
    assert.equal(styles.length, 1);
    assert.equal(styles[0].run_at, 'document_start');
    for (const selector of ['#__qt_custom_subtitles_layer', '#__qt_custom_subtitles_layer .__qt_subtitles-box', '.__qt_sub-line']) {
        const rule = cssRule('styles.css', selector);
        assert.equal(rule.transition, 'none !important');
        assert.equal(rule.animation, 'none !important');
    }
});


test('a player with no layout stays hidden until resize provides real dimensions', () => {
    const h = harness(); h.preferences({});
    const emptyRect = () => ({ width: 0, height: 0, top: 0, left: 0 });
    h.player.getBoundingClientRect = emptyRect;
    h.video.getBoundingClientRect = emptyRect;
    Object.defineProperty(h.video, 'offsetWidth', { get: () => 0 });
    Object.defineProperty(h.video, 'offsetHeight', { get: () => 0 });
    h.overlay.renderCustomSubtitles(['Loaded before the player layout']);
    assert.equal(h.layer().style.display, 'none');
    h.player.getBoundingClientRect = () => ({ width: 800, height: 450, top: 0, left: 0 });
    h.observers[0].callback(); h.flush();
    assert.equal(h.layer().style.display, 'flex');
    assert.equal(h.layer().style['--lectoro-sub-font-size'], '20px');
    assert.equal(h.layer().style['--lectoro-sub-bottom'], '62px');
    assert.equal(h.overlay.getActiveText(), 'Loaded before the player layout');
});

test('clearing a pending cue before settings load never revives it on refresh', () => {
    const h = harness();
    h.overlay.renderCustomSubtitles(['Stale']);
    h.overlay.renderCustomSubtitles([]);
    h.preferences({});
    assert.equal(h.overlay.getActiveText(), '');
    assert.equal(h.box().style.opacity, '0');
});


test('YouTube ASR reflows fragments while manual and Netflix retain authored line breaks', () => {
    for (const hostname of ['www.youtube.com', 'www.netflix.com']) {
        const h = harness(hostname); h.preferences({});
        h.overlay.renderCustomSubtitles(['First phrase', 'continues here'], { isAsr: true });
        assert.deepEqual(Array.from(h.overlay.getActiveLines()), hostname === 'www.youtube.com'
            ? ['First phrase continues here'] : ['First phrase', 'continues here']);
        h.overlay.renderCustomSubtitles(['First speaker', 'Second speaker'], { isAsr: false });
        assert.deepEqual(Array.from(h.overlay.getActiveLines()), ['First speaker', 'Second speaker']);
    }
});

test('malformed ASR keeps all visible words and falls back with a notice; valid clocks recover focus', () => {
    const h = harness();
    const notices = [];
    h.context.LectoroYouTubeAdapter = {
        reportFocusUnavailable: () => notices.push('unavailable'),
        reportFocusAvailable: () => notices.push('available'),
    };
    h.preferences({ [C.STORAGE_KEYS.YOUTUBE_FOCUS_MODE]: true });
    const cue = { startTime: 0, endTime: 2, segs: [
        { utf8: 'One', tOffsetMs: 0 }, { utf8: 'three', tOffsetMs: 1000 },
    ] };
    h.overlay.renderCustomSubtitles(['One two three'], { cue, isAsr: true });
    assert.equal(h.overlay.getActiveText(), 'One two three');
    assert.equal(h.box().classList.contains('is-focus-mode'), false);
    assert.deepEqual(notices, ['unavailable']);
    const valid = { ...cue, segs: [
        { utf8: 'One', tOffsetMs: 0 }, { utf8: 'two', tOffsetMs: 500 }, { utf8: 'three', tOffsetMs: 1000 },
    ] };
    h.overlay.renderCustomSubtitles(['One two', 'three'], { cue: valid, isAsr: true });
    assert.equal(h.box().classList.contains('is-focus-mode'), true);
    assert.deepEqual(notices, ['unavailable', 'available']);
    assert.equal(h.overlay.getFocusSliderElement().style.opacity, '1');
});

test('Focus follows JSON3 milliseconds after merging and seeking, including silence between source cues', () => {
    const h = harness();
    const S = require('../shared/subtitle-service');
    h.context.SharedSubtitleService = S;
    h.preferences({ [C.STORAGE_KEYS.YOUTUBE_FOCUS_MODE]: true });
    const cues = S.mergeShortCues(S.normalizeCueSentenceCase(S.parseYouTubeJson3({ events: [
        { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'look' }, { utf8: ' here', tOffsetMs: 325 }] },
        { tStartMs: 2400, dDurationMs: 700, segs: [{ utf8: 'now' }] },
    ] }, { preserveTiming: true, preserveCueBoundaries: true }), 'en'));
    assert.equal(cues.length, 1);
    h.overlay.renderCustomSubtitles(cues[0].lines, { cue: cues[0], isAsr: true });
    for (const [ms, expected] of [
        [999, null], [1000, 'Look'], [1324, 'Look'], [1325, 'here'],
        [1999, 'here'], [2000, null], [2200, null], [2399, null],
        [2400, 'now'], [3099, 'now'], [3100, null], [1325, 'here'],
    ]) {
        h.overlay.updateFocusTiming(ms);
        const focused = h.overlay.getCustomSubtitleElements().find(span => span.classList.contains('__qt_word-focused'));
        assert.equal(focused?.textContent ?? null, expected, `source clock at ${ms} ms`);
        assert.equal(h.overlay.getFocusSliderElement().style.opacity, expected ? '1' : '0');
    }
});
