const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { load, loadFunction } = require("./helpers");

function node() {
    const listeners = new Map();
    const children = new Map();
    const classes = new Set();
    return {
        style: { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }, parentElement: null, isConnected: true, disabled: false,
        classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        setAttribute() {},
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(callback);
        },
        removeEventListener(name, callback) {
            listeners.set(name, (listeners.get(name) || []).filter(fn => fn !== callback));
        },
        dispatch(name, extra = {}) {
            for (const callback of listeners.get(name) || []) callback({ stopPropagation() {}, preventDefault() {}, ...extra });
        },
        querySelector(selector) {
            if (!children.has(selector)) children.set(selector, node());
            return children.get(selector);
        },
        appendChild(child) { child.parentElement = this; child.isConnected = true; },
        insertBefore(child, before) { child.parentElement = this; child.isConnected = true; },
        contains(child) { return child === this || [...children.values()].includes(child); },
        remove() { this.isConnected = false; this.parentElement = null; },
    };
}

function toastHarness() {
    let now = 0, sequence = 0;
    const frames = new Map(), timers = new Map(), created = [];
    const document = { ...node(), body: node(), hidden: false, createElement() { const el = node(); created.push(el); return el; } };
    const video = { isConnected: true, getBoundingClientRect: () => ({ top: 100, right: 1000, width: 900 }) };
    const context = vm.createContext({
        document, window: { ...node(), innerWidth: 1200 }, HTMLElement: function () {},
        performance: { now: () => now },
        chrome: { runtime: { getURL: file => `chrome-extension://test/${file}` } },
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        setTimeout: (callback, delay) => { timers.set(++sequence, { callback, due: now + delay }); return sequence; },
    });
    load(context, "video/dual-subtitle-toast.js");
    const toast = context.LectoroDualSubtitleToast.create({ getVideo: () => video, getPlayerContainer: () => video });
    function advance(ms) {
        now += ms;
        const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
        for (const [id, timer] of timers) if (timer.due <= now) { timers.delete(id); timer.callback(); }
    }
    return { toast, document, created, advance };
}

test("toast pauses hover countdown, resumes remaining time and cleans up after exit", () => {
    const h = toastHarness();
    h.toast.show({ retry() {}, duration: 5000 }); h.advance(0);
    const el = h.created[0];
    assert.equal(el.style.top, "120px");
    assert.equal(el.style.right, "220px");
    assert.equal(el.querySelector("img").src, "chrome-extension://test/icons/icon48.png");
    h.advance(2000);
    el.dispatch("pointerenter");
    const progress = el.querySelector(".__qt_dual-toast-progress").style.transform;
    h.advance(10000);
    assert.equal(el.isConnected, true);
    assert.equal(el.querySelector(".__qt_dual-toast-progress").style.transform, progress);
    el.dispatch("pointerleave"); h.advance(2999);
    assert.equal(el.isConnected, true);
    h.advance(1); h.advance(300);
    assert.equal(el.isConnected, false);
});

test("focus and hover pauses overlap; Retry only executes once", () => {
    const h = toastHarness(); let retries = 0;
    h.toast.show({ retry() { retries++; } }); h.advance(0);
    const el = h.created[0], retry = el.querySelector(".__qt_dual-toast-retry");
    el.dispatch("focusin"); el.dispatch("pointerenter"); el.dispatch("pointerleave");
    h.advance(6000); assert.equal(el.isConnected, true);
    retry.dispatch("click"); retry.dispatch("click");
    assert.equal(retries, 1);
    h.advance(300); assert.equal(el.isConnected, false);
});

test("dismissed or replaced toast cannot invoke a stale Retry callback", () => {
    const h = toastHarness(); let retries = 0;
    h.toast.show({ retry() { retries++; } }); h.advance(0);
    const old = h.created[0];
    h.toast.show({ retry() {} }); h.advance(0);
    old.querySelector(".__qt_dual-toast-retry").dispatch("click");
    assert.equal(retries, 0); assert.equal(old.isConnected, false);
    h.created[1].querySelector(".__qt_dual-toast-close").dispatch("click");
    h.advance(300); assert.equal(h.created[1].isConnected, false);
});

test("notification stays paused while document is hidden", () => {
    const h = toastHarness();
    h.toast.show({ retry() {}, duration: 5000 }); h.advance(0); h.advance(1000);
    h.document.hidden = true; h.document.dispatch("visibilitychange"); h.advance(60000);
    assert.equal(h.created[0].isConnected, true);
    h.document.hidden = false; h.document.dispatch("visibilitychange"); h.advance(4000); h.advance(300);
    assert.equal(h.created[0].isConnected, false);
});

test("renderer takes Slave exclusively from current cue and clears it on repeated Master text", () => {
    const box = node(); box.children = [];
    box.style.setProperty = () => {};
    box.classList.toggle = () => {};
    box.querySelector = selector => box.children.find(el => el.className === selector.slice(1)) || null;
    box.appendChild = child => box.children.push(child);
    Object.defineProperty(box, "innerHTML", { set() { box.children = []; } });
    const context = vm.createContext({
        PREFIX: "__qt_", SUB_WORD_CLASS: "word", activeUnifiedCue: null,
        activeLines: [], activeSubtitleInput: { lines: [], options: {} }, activeText: "", activeWordSpans: [], recentSubtitlesHistory: [],
        aiTooltipActive: false, isSubHovering: false, subClickLocked: false,
        ensureCustomSubtitlesLayer: () => ({ layer: node(), box }),
        getPlayerRegistry: () => ({ getVideo: () => null }), cleanCardText: text => text.trim(),
        getPlatformName: () => "netflix",
        isDoubleSubtitlesActive: () => true, isSentenceOverlayOpen: () => false,
        syncCustomSubtitlePosition() {},
        SharedPhraseDetector: { tokenizeSubtitleLine: text => [{ type: "text", text }] },
        document: { createElement: () => { const el = node(); el.appendChild = child => { el.textContent = child.textContent; }; return el; }, createTextNode: text => ({ textContent: text }) },
    });
    loadFunction(context, "video/subtitle-overlay.js", "renderCustomSubtitles");
    const render = context.renderCustomSubtitles;
    render(["Hello\nworld"], { cue: { startTime: 1, endTime: 2, translation: "Witaj\nświecie" } });
    assert.equal(box.children.length, 2);
    assert.equal(box.children[0].textContent, "Hello world");
    assert.equal(box.children[1].textContent, "Witaj świecie");
    assert.equal(box.children[0].className, "__qt_sub-line");
    assert.equal(box.children[1].className, "__qt_sub-secondary");
    const oldMasterElement = box.children[0];
    render(["Hello world"], { cue: { startTime: 3, endTime: 4, translation: "" }, secondaryText: "STALE" });
    assert.equal(box.children[1].textContent, "");
    assert.notEqual(box.children[0], oldMasterElement);
    const overlapping = ["First speaker", "Second speaker"];
    overlapping.cue = { translation: "Pierwszy" };
    overlapping.allCues = [overlapping.cue, { translation: "Drugi" }];
    overlapping.translation = "Pierwszy\nDrugi";
    render(overlapping, { cue: overlapping.cue, secondaryText: overlapping.translation });
    assert.equal(box.children.length, 2);
    assert.equal(box.children[0].textContent, "First speaker Second speaker");
    assert.equal(box.children.at(-1).textContent, "Pierwszy Drugi");
    for (const platform of ["netflix", "youtube"]) {
        context.getPlatformName = () => platform;
        context.isDoubleSubtitlesActive = () => true;
        render(["First line", "Second line"], { cue: { translation: "Tłumaczenie" } });
        assert.equal(box.children[0].textContent, "First line Second line");
        context.isDoubleSubtitlesActive = () => false;
        // Settings changes must restore original breaks even while playback is paused.
        render(context.activeSubtitleInput.lines, context.activeSubtitleInput.options);
        assert.deepEqual(box.children.map(el => el.textContent), ["First line", "Second line"]);
        context.isDoubleSubtitlesActive = () => true;
        render(context.activeSubtitleInput.lines, context.activeSubtitleInput.options);
        assert.equal(box.children[0].textContent, "First line Second line");
        assert.equal(box.children[1].textContent, "Tłumaczenie");
    }
    context.isDoubleSubtitlesActive = () => false;
    for (const platform of ["ted", "videojs", "generic"]) {
        context.getPlatformName = () => platform;
        render(["First line", "Second line"]);
        assert.deepEqual(box.children.map(el => el.textContent), ["First line", "Second line"]);
    }
    context.getPlatformName = () => "netflix";
    context.isDoubleSubtitlesActive = () => true;
    render(["Second speaker"], { cue: overlapping.allCues[1] });
    assert.equal(box.children.at(-1).textContent, "Drugi");
    render([]);
    assert.equal(box.children.length, 0);
});

test("vertical drag handle moves subtitles on Y axis only and saves position", () => {
    let stored = {};
    const box = node();
    box.children = [];
    box.style.marginBottom = "68px";
    const layer = node();

    const listeners = new Map();
    const windowMock = {
        innerHeight: 1000,
        addEventListener(name, fn) {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(fn);
        },
        removeEventListener(name, fn) {
            listeners.set(name, (listeners.get(name) || []).filter(cb => cb !== fn));
        },
        dispatch(name, event) {
            for (const fn of listeners.get(name) || []) fn(event);
        },
    };

    const context = vm.createContext({
        C: {
            UI_CLASSES: {
                SUB_HANDLE: "__qt_subtitles-drag-handle",
                SUB_DRAGGING: "__qt_is-dragging",
            },
            STORAGE_KEYS: { SUBTITLE_POSITION: "subtitlePosition" },
        },
        SUB_WORD_CLASS: "word",
        subDragHandleEl: null,
        subDragBadgeEl: null,
        isSubDragging: false,
        currentSubPosition: 14,
        currentSubBottomPx: 68,
        customSubLayerEl: layer,
        window: windowMock,
        getPlayerRegistry: () => ({ getVideo: () => ({ getBoundingClientRect: () => ({ height: 1000 }) }) }),
        findPlayerContainer: () => ({ getBoundingClientRect: () => ({ height: 1000 }) }),
        document: {
            createElement: (tag) => {
                const el = node();
                el.tagName = tag;
                return el;
            }
        },
        chrome: {
            storage: {
                local: {
                    set(obj) { Object.assign(stored, obj); }
                }
            }
        },
    });

    loadFunction(context, "video/subtitle-overlay.js", "setupVerticalDrag");
    loadFunction(context, "video/subtitle-overlay.js", "ensureDragHandle");

    context.ensureDragHandle(box);
    assert.ok(context.subDragHandleEl);
    assert.equal(context.subDragHandleEl.className, "__qt_subtitles-drag-handle");

    // Simulate drag start on handle (pointerdown at clientY = 800)
    context.subDragHandleEl.dispatch("pointerdown", { button: 0, clientY: 800, pointerId: 1, target: context.subDragHandleEl });
    assert.equal(context.isSubDragging, true);

    // Simulate dragging upwards by 100px (clientY goes from 800 down to 700)
    windowMock.dispatch("pointermove", { clientY: 700, preventDefault() {}, stopPropagation() {} });
    assert.equal(context.currentSubPosition, 17);
    assert.equal(box.style.marginBottom, "168px");

    // Simulate drag end (pointerup)
    windowMock.dispatch("pointerup", { clientY: 700, preventDefault() {}, stopPropagation() {} });
    assert.equal(context.isSubDragging, false);
    assert.equal(stored.subtitlePosition, 17);
});

