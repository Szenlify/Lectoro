const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../shared/constants");
const U = require("../shared/utils");
const { storage, read } = require("./helpers");

function createMockElement(tagName = "div", text = "") {
    const classes = new Set();
    const attributes = new Map();
    const styles = {};
    const children = [];

    const el = {
        tagName: tagName.toUpperCase(),
        childNodes: children,
        parentNode: null,
        dataset: {},
        get children() { return children; },
        get firstChild() { return children[0] || null; },
        get lastChild() { return children[children.length - 1] || null; },
        get textContent() { return text; },
        set textContent(val) { text = String(val); },
        get innerHTML() { return ""; },
        set innerHTML(val) {
            if (val === "") {
                while (children.length > 0) el.removeChild(children[0]);
            }
        },
        get className() { return Array.from(classes).join(" "); },
        set className(val) {
            classes.clear();
            String(val).split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
        },
        classList: {
            add: (...names) => names.forEach(n => classes.add(n)),
            remove: (...names) => names.forEach(n => classes.delete(n)),
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                if (force === undefined) {
                    classes.has(name) ? classes.delete(name) : classes.add(name);
                } else {
                    force ? classes.add(name) : classes.delete(name);
                }
            },
        },
        style: {
            setProperty: (prop, value) => { styles[prop] = value; },
            getPropertyValue: (prop) => styles[prop] || "",
            removeProperty: (prop) => { delete styles[prop]; },
            ...styles,
        },
        setAttribute: (name, val) => attributes.set(name, String(val)),
        getAttribute: (name) => attributes.get(name) || null,
        hasAttribute: (name) => attributes.has(name),
        removeAttribute: (name) => attributes.delete(name),
        appendChild: (child) => {
            if (child.parentNode) child.parentNode.removeChild(child);
            child.parentNode = el;
            children.push(child);
            return child;
        },
        removeChild: (child) => {
            const idx = children.indexOf(child);
            if (idx >= 0) {
                children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        },
        replaceChildren: (...newChildren) => {
            while (children.length > 0) el.removeChild(children[0]);
            newChildren.forEach(c => el.appendChild(c));
        },
        querySelector: (selector) => {
            for (const child of children) {
                if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) return child;
                if (selector.startsWith("#") && child.id === selector.slice(1)) return child;
                if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) return child;
                const found = child.querySelector?.(selector);
                if (found) return found;
            }
            return null;
        },
        querySelectorAll: (selector) => {
            const results = [];
            for (const child of children) {
                if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) results.push(child);
                if (selector.startsWith("#") && child.id === selector.slice(1)) results.push(child);
                if (child.tagName && child.tagName.toLowerCase() === selector.toLowerCase()) results.push(child);
                if (child.querySelectorAll) results.push(...child.querySelectorAll(selector));
            }
            return results;
        },
        closest: (selector) => {
            if (selector.startsWith(".") && el.classList.contains(selector.slice(1))) return el;
            return el.parentNode?.closest?.(selector) || null;
        },
        getBoundingClientRect: () => ({ width: 800, height: 60, top: 100, bottom: 160, left: 200, right: 1000 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        isConnected: true,
    };
    return el;
}

function createMockDocument() {
    const documentElement = createMockElement("html");
    const body = createMockElement("body");
    documentElement.appendChild(body);
    return {
        documentElement,
        body,
        createElement: (tag) => createMockElement(tag),
        createTextNode: (text) => ({ textContent: text, nodeType: 3, parentNode: null, remove: () => {} }),
        getElementById: (id) => body.querySelector("#" + id) || documentElement.querySelector("#" + id),
        querySelector: (sel) => body.querySelector(sel) || documentElement.querySelector(sel),
        querySelectorAll: (sel) => body.querySelectorAll(sel),
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}

function setupNetflixAdapterEnv() {
    const doc = createMockDocument();
    const eventListeners = new Map();

    const windowObj = {
        location: {
            hostname: "www.netflix.com",
            pathname: "/watch/81234567",
            search: "",
            hash: "",
        },
        addEventListener: (event, handler) => {
            if (!eventListeners.has(event)) eventListeners.set(event, new Set());
            eventListeners.get(event).add(handler);
        },
        removeEventListener: (event, handler) => {
            eventListeners.get(event)?.delete(handler);
        },
        dispatchEvent: (event) => {
            const handlers = eventListeners.get(event.type);
            if (handlers) {
                for (const h of handlers) h(event);
            }
            return true;
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail || {};
            }
        },
        performance: { now: () => Date.now() },
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
    };

    const storageData = {
        dualSubtitles: true,
        targetLang: "pl",
        learningLang: "en",
    };

    const storageListeners = new Set();

    const chromeObj = {
        storage: {
            local: {
                get: async (defaults) => ({ ...defaults, ...storageData }),
                set: async (items) => {
                    Object.assign(storageData, items);
                },
            },
            onChanged: {
                addListener: (listener) => storageListeners.add(listener),
                removeListener: (listener) => storageListeners.delete(listener),
            },
        },
        runtime: {
            sendMessage: async (msg) => {
                if (msg.type === "QT_FETCH_NETFLIX_TIMED_TEXT") {
                    return {
                        text: "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDzień dobry wszystkim\n\n2\n00:00:05.000 --> 00:00:08.000\nWitamy w serialu",
                        contentType: "text/vtt",
                    };
                }
                return {};
            },
        },
    };

    const context = {
        globalThis: null,
        window: windowObj,
        document: doc,
        chrome: chromeObj,
        LectoroConstants: C,
        SharedUtils: {
            ...U,
            sendRuntimeMessage: (msg) => chromeObj.runtime.sendMessage(msg),
            clamp: (v, min, max) => Math.min(Math.max(v, min), max),
            formatTime: () => "00:00",
        },
        SharedSubtitleService: {
            parseTimedText: (text, profile, contentType) => [
                { startTime: 1.0, endTime: 4.0, text: "Dzień dobry wszystkim", lines: ["Dzień dobry wszystkim"] },
                { startTime: 5.0, endTime: 8.0, text: "Witamy w serialu", lines: ["Witamy w serialu"] },
            ],
        },
        SharedTranslatorService: {
            translate: async (text, targetLang, learningLang) => ({
                translated: "Przetłumaczony tekst: " + text,
                sourceLang: learningLang || "en",
                targetLang: targetLang || "pl",
            }),
        },
        DictionaryTokenizer: {
            tokenize: (line) => [{ type: "word", text: line, clean: line.toLowerCase() }],
        },
        SharedPhraseDetector: {
            tokenizeSubtitleLine: (line) => [{ type: "word", text: line, clean: line.toLowerCase() }],
        },
        QT: {
            addDismissHandler: () => {},
            addCleanup: () => {},
            TOOLTIP_ID: C.UI_IDS.TOOLTIP,
            escapeHtml: (s) => s,
            escapeAttr: (s) => s,
            speak: async () => {},
            getTargetLang: async () => "pl",
            translate: async (s) => s,
            getOverlayParent: () => doc.body,
        },
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout: () => {},
        requestAnimationFrame: (fn) => fn(),
        cancelAnimationFrame: () => {},
        console,
    };
    context.globalThis = context;
    vm.createContext(context);

    // Load netflix-adapter.js
    const netflixCode = fs.readFileSync(path.join(__dirname, "../adapters/netflix-adapter.js"), "utf8");
    vm.runInContext(netflixCode, context);

    const adapter = context.LectoroNetflixAdapter;
    adapter.setActiveTextTrackState({
        playerReady: true,
        isCcActive: true,
        track: { bcp47: "en", displayName: "English" },
        movieId: "81234567",
    });

    return {
        context,
        adapter,
        storageData,
        storageListeners,
    };
}

test("NetflixAdapter: selectTranslationTrackFromManifest selects matching target language track", () => {
    const { adapter } = setupNetflixAdapterEnv();

    const mockManifest = {
        movieId: "81234567",
        tracks: [
            { id: "track_en", bcp47: "en", displayName: "English [Original]", isForcedNarrative: false },
            { id: "track_es", bcp47: "es", displayName: "Spanish", isForcedNarrative: false },
            { id: "track_pl", bcp47: "pl", displayName: "Polish", isForcedNarrative: false },
            { id: "track_pl_fn", bcp47: "pl", displayName: "Polish [Forced]", isForcedNarrative: true },
        ],
    };

    const activeTrack = { id: "track_en", bcp47: "en", displayName: "English" };

    const selectedPl = adapter.selectTranslationTrackFromManifest(mockManifest, "pl", activeTrack);
    assert.ok(selectedPl, "Expected Polish track to be selected");
    assert.equal(selectedPl.id, "track_pl");
    assert.equal(selectedPl.isForcedNarrative, false);

    // If active track is Polish, should not select itself
    const selectedWhenActiveIsPl = adapter.selectTranslationTrackFromManifest(mockManifest, "pl", { id: "track_pl" });
    if (selectedWhenActiveIsPl) {
        assert.notEqual(selectedWhenActiveIsPl.id, "track_pl");
    }

    // Select Spanish
    const selectedEs = adapter.selectTranslationTrackFromManifest(mockManifest, "es", activeTrack);
    assert.ok(selectedEs);
    assert.equal(selectedEs.id, "track_es");

    // Non-existent language returns null
    const selectedJa = adapter.selectTranslationTrackFromManifest(mockManifest, "ja", activeTrack);
    assert.equal(selectedJa, null);
});

test("NetflixAdapter: findIndexedTranslationCueAt performs binary search on indexed cues", () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setTranslationCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Cześć", lines: ["Cześć"] },
        { startTime: 6.0, endTime: 9.5, text: "Jak się masz?", lines: ["Jak się masz?"] },
        { startTime: 12.0, endTime: 15.0, text: "Do widzenia", lines: ["Do widzenia"] },
    ]);

    assert.equal(adapter.findIndexedTranslationCueAt(1.0), null);
    assert.equal(adapter.findIndexedTranslationCueAt(3.0)?.text, "Cześć");
    assert.equal(adapter.findIndexedTranslationCueAt(7.5)?.text, "Jak się masz?");
    assert.equal(adapter.findIndexedTranslationCueAt(10.5), null);
    assert.equal(adapter.findIndexedTranslationCueAt(13.0)?.text, "Do widzenia");
});

test("NetflixAdapter: getCurrentTranslationText returns indexed translation when available", () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Good morning everyone", lines: ["Good morning everyone"] },
        { startTime: 6.0, endTime: 9.0, text: "Welcome to the show", lines: ["Welcome to the show"] },
    ]);

    adapter.setTranslationCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Dzień dobry wszystkim", lines: ["Dzień dobry wszystkim"] },
        { startTime: 6.0, endTime: 9.0, text: "Witamy w serialu", lines: ["Witamy w serialu"] },
    ]);

    const mockVideo = { currentTime: 3.5 };

    const originalIsCcActive = adapter.isCcActive;
    adapter.isCcActive = () => true;

    const trans1 = adapter.getCurrentTranslationText(mockVideo);
    assert.equal(trans1, "Dzień dobry wszystkim");

    mockVideo.currentTime = 7.0;
    const trans2 = adapter.getCurrentTranslationText(mockVideo);
    assert.equal(trans2, "Witamy w serialu");

    mockVideo.currentTime = 12.0;
    const trans3 = adapter.getCurrentTranslationText(mockVideo);
    assert.equal(trans3, "");

    adapter.isCcActive = originalIsCcActive;
});

test("NetflixAdapter: getCurrentTranslationText falls back to live translation via SharedTranslatorService", async () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setTranslationCueIndex([]);
    adapter.isCcActive = () => true;

    await adapter.translateLiveCue("Hello world", "pl", "en");
    assert.ok(adapter.getLiveTranslationCache().has("Hello world"));
    assert.equal(adapter.getLiveTranslationCache().get("Hello world"), "Przetłumaczony tekst: Hello world");

    adapter.getCurrentCueLines = () => ["Hello world"];
    const trans = adapter.getCurrentTranslationText({ currentTime: 1.0 });
    assert.equal(trans, "Przetłumaczony tekst: Hello world");
});

test("NetflixAdapter: dualSubtitles: false suppresses translation text", () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Good morning", lines: ["Good morning"] },
    ]);
    adapter.setTranslationCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Dzień dobry", lines: ["Dzień dobry"] },
    ]);
    adapter.isCcActive = () => true;

    adapter.setDualSubtitlesEnabled(false);
    assert.equal(adapter.isDualSubtitlesEnabled(), false);

    const trans = adapter.getCurrentTranslationText({ currentTime: 3.0 });
    assert.equal(trans, "", "Translation should be empty when dual subtitles is disabled");

    adapter.setDualSubtitlesEnabled(true);
    assert.equal(adapter.isDualSubtitlesEnabled(), true);
    assert.equal(adapter.getCurrentTranslationText({ currentTime: 3.0 }), "Dzień dobry");
});

test("NetflixAdapter: translation is strictly suppressed when original cue is absent/ended", () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setTranslationCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "Dzień dobry", lines: ["Dzień dobry"] },
    ]);
    adapter.setCueIndex([]); // No original subtitle on screen!
    adapter.isCcActive = () => true;

    const trans = adapter.getCurrentTranslationText({ currentTime: 3.0 });
    assert.equal(trans, "", "Translation must never show alone when original subtitles are absent");
});

test("NetflixAdapter: multi-line translation cues are joined with newline for pre-line rendering", () => {
    const { adapter } = setupNetflixAdapterEnv();

    adapter.setCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "- Hello.\n- How are you?", lines: ["- Hello.", "- How are you?"] },
    ]);
    adapter.setTranslationCueIndex([
        { startTime: 2.0, endTime: 5.0, text: "- Cześć.\n- Jak się masz?", lines: ["- Cześć.", "- Jak się masz?"] },
    ]);
    adapter.isCcActive = () => true;

    const trans = adapter.getCurrentTranslationText({ currentTime: 3.0 });
    assert.equal(trans, "- Cześć.\n- Jak się masz?");
});

test("SubtitleOverlay renders translation line under original subtitles on Netflix", () => {
    const { context } = setupNetflixAdapterEnv();

    const overlayCode = fs.readFileSync(path.join(__dirname, "../video/subtitle-overlay.js"), "utf8");
    vm.runInContext(overlayCode, context);

    const overlay = context.LectoroSubtitleOverlay;
    assert.ok(overlay, "LectoroSubtitleOverlay should be defined");

    overlay.setDualSubtitlesEnabled(true);
    overlay.renderCustomSubtitles(["Good morning everyone"], {
        translationText: "Dzień dobry wszystkim",
    });

    const box = context.document.querySelector("#" + C.UI_IDS.CUSTOM_SUBTITLES_LAYER);
    assert.ok(box, "Subtitle overlay layer should exist in DOM");

    const transLine = box.querySelector(".__qt_custom-sub-translation-line");
    assert.ok(transLine, "Translation line element should exist");
    assert.equal(transLine.textContent, "Dzień dobry wszystkim");
    assert.equal(transLine.dataset.subType, "translation");
    assert.equal(overlay.getActiveTranslationText(), "Dzień dobry wszystkim");

    overlay.setDualSubtitlesEnabled(false);
    overlay.renderCustomSubtitles(["Good morning everyone"], {
        translationText: "Dzień dobry wszystkim",
    });
    const transLineOff = box.querySelector(".__qt_custom-sub-translation-line");
    assert.equal(transLineOff, null, "Translation line should be absent when dualSubtitles is disabled");
    assert.equal(overlay.getActiveTranslationText(), "");
});

test("SubtitleOverlay: translation line is removed immediately when original subtitles clear", () => {
    const { context } = setupNetflixAdapterEnv();

    const overlayCode = fs.readFileSync(path.join(__dirname, "../video/subtitle-overlay.js"), "utf8");
    vm.runInContext(overlayCode, context);

    const overlay = context.LectoroSubtitleOverlay;
    overlay.setDualSubtitlesEnabled(true);

    // 1. Show subtitles with translation
    overlay.renderCustomSubtitles(["Hello"], { translationText: "Cześć" });
    assert.equal(overlay.getActiveText(), "Hello");
    assert.equal(overlay.getActiveTranslationText(), "Cześć");

    // 2. Original subtitles clear (silence or cue ends)
    overlay.renderCustomSubtitles([], { translationText: "Cześć" });
    assert.equal(overlay.getActiveText(), "");
    assert.equal(overlay.getActiveTranslationText(), "");

    const box = context.document.querySelector("#" + C.UI_IDS.CUSTOM_SUBTITLES_LAYER);
    const transLine = box?.querySelector(".__qt_custom-sub-translation-line");
    assert.equal(transLine, null, "Translation line must be cleared immediately when original cue clears");
});

test("SubtitleOverlay: hover words is blocked on translation elements", () => {
    const { context } = setupNetflixAdapterEnv();

    const overlayCode = fs.readFileSync(path.join(__dirname, "../video/subtitle-overlay.js"), "utf8");
    vm.runInContext(overlayCode, context);

    const overlay = context.LectoroSubtitleOverlay;
    overlay.setDualSubtitlesEnabled(true);

    overlay.renderCustomSubtitles(["Hello world"], { translationText: "Witaj świecie" });

    const box = context.document.querySelector("#" + C.UI_IDS.CUSTOM_SUBTITLES_LAYER);
    const transLine = box.querySelector(".__qt_custom-sub-translation-line");
    assert.ok(transLine, "Translation line element must exist");

    // Translation line must NOT contain sub-word spans
    const subWords = transLine.querySelectorAll("." + C.UI_CLASSES.SUB_WORD);
    assert.equal(subWords.length, 0, "Translation line must not have interactive sub-word spans");

    // Translation line must have translation dataset attribute
    assert.equal(transLine.dataset.subType, "translation");
});

