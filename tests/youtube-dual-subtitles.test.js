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
        readyState: "complete",
    };
}

test("YouTube dual subtitles: selectTranslationTrack picks direct /api/timedtext?v=xxx&lang=pl if present", async () => {
    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        window: {
            location: { hostname: "www.youtube.com", pathname: "/watch", search: "?v=test12345" },
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        },
        document: createMockDocument(),
        setTimeout: () => {},
        clearTimeout: () => {},
        chrome: { storage: storage({ targetLang: "pl", learningLang: "en" }) },
        console,
    });

    vm.runInContext(read("adapters/youtube-adapter.js"), context);
    const adapter = context.LectoroYouTubeAdapter;

    const tracks = [
        {
            baseUrl: "https://www.youtube.com/api/timedtext?v=test12345&lang=en",
            languageCode: "en",
            name: "English",
            kind: "",
            vssId: ".en",
            isTranslatable: true,
        },
        {
            baseUrl: "https://www.youtube.com/api/timedtext?v=test12345&lang=pl",
            languageCode: "pl",
            name: "Polski",
            kind: "",
            vssId: ".pl",
            isTranslatable: true,
        }
    ];

    const origTrack = adapter.selectBestCaptionTrack(tracks, "en");
    assert.equal(origTrack.languageCode, "en");
    assert.ok(origTrack.baseUrl.includes("lang=en"));

    // When direct Polish track exists, it must pick that exact track as translation
    const transTrack = adapter.selectTranslationTrack(tracks, "pl", origTrack);
    assert.ok(transTrack, "Translation track should be found");
    assert.equal(transTrack.languageCode, "pl");
    assert.equal(transTrack.baseUrl, "https://www.youtube.com/api/timedtext?v=test12345&lang=pl");
    assert.equal(transTrack.isAutoTranslated, false);
});

test("YouTube dual subtitles: selectTranslationTrack generates /api/timedtext?v=xxx&lang=en&tlang=pl when no direct track exists", async () => {
    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        window: {
            location: { hostname: "www.youtube.com", pathname: "/watch", search: "?v=test12345" },
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        },
        document: createMockDocument(),
        setTimeout: () => {},
        clearTimeout: () => {},
        chrome: { storage: storage({ targetLang: "pl", learningLang: "en" }) },
        console,
    });

    vm.runInContext(read("adapters/youtube-adapter.js"), context);
    const adapter = context.LectoroYouTubeAdapter;

    const tracks = [
        {
            baseUrl: "https://www.youtube.com/api/timedtext?v=test12345&lang=en&vss_id=.en",
            languageCode: "en",
            name: "English",
            kind: "",
            vssId: ".en",
            isTranslatable: true,
        }
    ];

    const origTrack = adapter.selectBestCaptionTrack(tracks, "en");
    assert.equal(origTrack.languageCode, "en");

    // When no direct Polish track exists, it appends &tlang=pl to the original track's URL
    const transTrack = adapter.selectTranslationTrack(tracks, "pl", origTrack);
    assert.ok(transTrack, "Translation track should be generated");
    assert.equal(transTrack.languageCode, "pl");
    assert.ok(transTrack.baseUrl.includes("lang=en"));
    assert.ok(transTrack.baseUrl.includes("tlang=pl"), "URL must contain tlang=pl");
    assert.equal(transTrack.isAutoTranslated, true);
});

test("YouTube dual subtitles: dual cue indexing and synchronized binary search lookup", async () => {
    const doc = createMockDocument();
    const moviePlayer = createMockElement("div");
    moviePlayer.id = "movie_player";
    const ccBtn = createMockElement("button");
    ccBtn.className = "ytp-subtitles-button ytp-button-active";
    ccBtn.setAttribute("aria-pressed", "true");
    moviePlayer.appendChild(ccBtn);
    doc.body.appendChild(moviePlayer);

    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        window: {
            location: { hostname: "www.youtube.com", pathname: "/watch", search: "?v=test12345" },
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        },
        document: doc,
        setTimeout: () => {},
        clearTimeout: () => {},
        chrome: { storage: storage() },
        console,
    });

    vm.runInContext(read("adapters/youtube-adapter.js"), context);
    const adapter = context.LectoroYouTubeAdapter;

    const originalCues = [
        { startTime: 1.0, endTime: 3.5, text: "Good morning everyone" },
        { startTime: 4.0, endTime: 6.5, text: "Welcome to this episode" },
    ];

    const translationCues = [
        { startTime: 1.0, endTime: 3.5, text: "Dzień dobry wszystkim" },
        { startTime: 4.0, endTime: 6.5, text: "Witamy w tym odcinku" },
    ];

    adapter.setCueIndex(originalCues, "test12345");
    adapter.setTranslationCueIndex(translationCues, "test12345");

    const mockVideo = createMockElement("video");
    mockVideo.currentTime = 2.0;
    mockVideo.closest = (sel) => sel.includes("movie_player") ? moviePlayer : null;

    // At 2.0s, original and translation must both resolve
    assert.equal(adapter.getCurrentSubtitleText(mockVideo), "Good morning everyone");
    assert.equal(adapter.getCurrentTranslationText(mockVideo), "Dzień dobry wszystkim");

    // At 5.0s, next pair of cues must resolve
    mockVideo.currentTime = 5.0;
    assert.equal(adapter.getCurrentSubtitleText(mockVideo), "Welcome to this episode");
    assert.equal(adapter.getCurrentTranslationText(mockVideo), "Witamy w tym odcinku");

    // At gap 3.8s, both should return empty
    mockVideo.currentTime = 3.8;
    assert.equal(adapter.getCurrentSubtitleText(mockVideo), "");
    assert.equal(adapter.getCurrentTranslationText(mockVideo), "");
});

test("YouTube dual subtitles: SubtitleOverlay renders translation line under original text with required attributes", () => {
    const doc = createMockDocument();
    const playerEl = createMockElement("div");
    playerEl.id = "movie_player";
    doc.body.appendChild(playerEl);

    const playerRegistryMock = {
        getVideo: () => ({
            isConnected: true,
            offsetWidth: 1280,
            offsetHeight: 720,
            paused: false,
            getBoundingClientRect: () => ({ width: 1280, height: 720, top: 0, bottom: 720, left: 0, right: 1280 }),
        }),
        isPreviewOrThumbnailVideo: () => false,
        isCcActive: () => true,
        onSubtitleChange: () => {},
        isNetflixPage: () => false,
    };

    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        SharedPhraseDetector: { tokenizeSubtitleLine: (text) => [{ type: "word", text, clean: text }] },
        SharedTranslatorService: { getReadingSettings: async () => C.DEFAULT_READING_SETTINGS },
        LectoroPlayerRegistry: playerRegistryMock,
        QT: {
            addDismissHandler: () => {},
            addCleanup: () => {},
            TOOLTIP_ID: C.UI_IDS.TOOLTIP,
            escapeHtml: (s) => s,
            escapeAttr: (s) => s,
            speak: async () => {},
            getTargetLang: async () => "pl",
            translate: async (s) => s,
        },
        window: {
            innerWidth: 1280,
            innerHeight: 720,
            addEventListener: () => {},
            removeEventListener: () => {},
            matchMedia: () => ({ matches: false }),
        },
        document: doc,
        chrome: { storage: storage() },
        setTimeout: (fn) => fn(),
        clearTimeout: () => {},
        requestAnimationFrame: (fn) => fn(),
        cancelAnimationFrame: () => {},
        console,
    });

    vm.runInContext(read("video/subtitle-overlay.js"), context);
    const overlay = context.LectoroSubtitleOverlay;

    // Render dual subtitles: original + translation
    overlay.renderCustomSubtitles(["Never gonna give you up"], {
        translationText: "Nigdy z ciebie nie zrezygnuję"
    });

    const box = doc.querySelector(`.${C.UI_CLASSES.CUSTOM_SUBTITLES_BOX}`);
    assert.ok(box, "Subtitle box container should exist");
    assert.equal(box.children.length, 2, "Box should have 2 lines: 1 original + 1 translation");

    const origLine = box.children[0];
    assert.ok(origLine.classList.contains(`${C.PREFIX}custom-sub-line`));
    assert.ok(!origLine.classList.contains(`${C.PREFIX}custom-sub-translation-line`));

    const transLine = box.children[1];
    assert.ok(transLine.classList.contains(`${C.PREFIX}custom-sub-line`), "Translation line must inherit base custom-sub-line class");
    assert.ok(transLine.classList.contains(`${C.PREFIX}custom-sub-translation-line`), "Translation line must have translation modifier class");
    assert.equal(transLine.dataset.subType, "translation");
    assert.equal(transLine.textContent, "Nigdy z ciebie nie zrezygnuję");

    assert.equal(overlay.getActiveText(), "Never gonna give you up");
    assert.equal(overlay.getActiveTranslationText(), "Nigdy z ciebie nie zrezygnuję");

    // Disable dual subtitles via toggle: translation line must NOT be rendered
    overlay.setDualSubtitlesEnabled(false);
    overlay.renderCustomSubtitles(["Never gonna give you up"], {
        translationText: "Nigdy z ciebie nie zrezygnuję"
    });

    assert.equal(box.children.length, 1, "Box should only have original line when dualSubtitles is disabled");
    assert.equal(overlay.getActiveTranslationText(), "");
});

test("YouTube dual subtitles: CSS rules enforce absolute positioning, font size 60% and light gray color #d1d5db", () => {
    const cssContent = read("styles.css");

    // Verify .__qt_custom-sub-translation-line exists in compiled CSS
    assert.ok(cssContent.includes(".__qt_custom-sub-translation-line"), "Compiled CSS must include translation line rule");

    // Verify position: absolute
    assert.ok(
        cssContent.includes("position:absolute") || cssContent.includes("position: absolute"),
        "Translation line must have position: absolute so it does not shift original subtitles"
    );

    // Verify top: calc(100% + 4px)
    assert.ok(
        cssContent.includes("top:calc(100% + 4px)") || cssContent.includes("top: calc(100% + 4px)"),
        "Translation line must be placed right below original text with 4px gap"
    );

    // Verify 60% font size
    assert.ok(
        cssContent.includes("font-size:calc(var(--lectoro-sub-font-size,26px) * 0.6)") ||
        cssContent.includes("font-size:calc(var(--lectoro-sub-font-size, 26px) * 0.6)"),
        "Font size must be 60% of original text size"
    );

    // Verify light gray color #d1d5db
    assert.ok(
        cssContent.includes("color:#d1d5db") || cssContent.includes("color: #d1d5db"),
        "Color must be light gray #d1d5db instead of white"
    );
});

test("YouTube dual subtitles: zero outgoing /api/timedtext fetches, ingests original cues from native player and translates via SharedTranslatorService", async () => {
    const doc = createMockDocument();
    const listeners = new Map();
    const mockWindow = {
        location: { hostname: "www.youtube.com", search: "?v=testVideo123", pathname: "/watch" },
        addEventListener: (event, handler) => {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        removeEventListener: (event, handler) => {
            const list = listeners.get(event) || [];
            listeners.set(event, list.filter(h => h !== handler));
        },
        dispatchEvent: (event) => {
            const list = listeners.get(event.type) || [];
            list.forEach(h => h(event));
            return true;
        },
        setTimeout: (fn) => setTimeout(fn, 1),
        clearTimeout: (id) => clearTimeout(id),
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
    };

    const mockSubtitleService = {
        parseTimedText: (text) => {
            return [{ startTime: 1.0, endTime: 3.5, text: "Original subtitle line" }];
        },
    };

    let translatorCalls = 0;
    const mockTranslatorService = {
        getTargetLang: async () => "pl",
        getLearningLang: async () => "en",
        translate: async (text, targetLang) => {
            translatorCalls++;
            return { translated: `Przetłumaczone: ${text}` };
        },
    };

    const ccBtn = createMockElement("button");
    ccBtn.className = "ytp-subtitles-button";
    ccBtn.setAttribute("aria-pressed", "true");
    doc.body.appendChild(ccBtn);

    const mockVideo = createMockElement("video");
    mockVideo.currentTime = 2.0;
    doc.body.appendChild(mockVideo);

    let fetchCalled = false;
    const context = vm.createContext({
        window: mockWindow,
        document: doc,
        CustomEvent: mockWindow.CustomEvent,
        LectoroConstants: C,
        SharedSubtitleService: mockSubtitleService,
        SharedTranslatorService: mockTranslatorService,
        SharedUtils: U,
        chrome: {
            storage: {
                local: {
                    get: async () => ({ [C.STORAGE_KEYS.TARGET_LANG]: "pl", [C.STORAGE_KEYS.DUAL_SUBTITLES]: true }),
                },
                onChanged: { addListener: () => {} },
            },
        },
        fetch: async (url) => {
            fetchCalled = true;
            assert.fail(`Must NOT fetch timedtext API: ${url}`);
        },
        MutationObserver: class {
            constructor() {}
            observe() {}
            disconnect() {}
        },
        console,
        setTimeout,
        clearTimeout,
    });

    vm.runInContext(read("adapters/youtube-adapter.js"), context);
    const adapter = context.LectoroYouTubeAdapter;

    // Simulate YouTube's player native XHR dispatching TIMED_TEXT_EVENT
    const originalTimedTextUrl = "https://www.youtube.com/api/timedtext?v=testVideo123&lang=en&fmt=json3";
    mockWindow.dispatchEvent(new mockWindow.CustomEvent("__lectoro_youtube_timed_text", {
        detail: {
            url: originalTimedTextUrl,
            text: "Original subtitle line",
            videoId: "testVideo123",
        }
    }));

    // Wait for event processing
    await new Promise(r => setTimeout(r, 50));

    // 1. Zero outgoing fetches made to timedtext
    assert.equal(fetchCalled, false, "Must make zero network fetches to /api/timedtext");

    // 2. Original cues ingested from native player XHR event
    const origCues = adapter.getCueIndex();
    assert.equal(origCues.length, 1, "Original cue index should be populated from intercepted event");
    assert.equal(origCues[0].text, "Original subtitle line");

    // 3. Translation is provided via SharedTranslatorService
    const translated = adapter.getCurrentTranslationText(mockVideo);
    assert.equal(translated, "Przetłumaczone: Original subtitle line");
    assert.ok(translatorCalls >= 1, "SharedTranslatorService must be called for cue translation");

    // 4. When dualSubtitles is disabled, translation text is empty
    adapter.setDualSubtitlesEnabled(false);
    assert.equal(adapter.getCurrentTranslationText(mockVideo), "");
});
