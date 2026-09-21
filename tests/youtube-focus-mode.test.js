const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Load dependencies
require("../shared/constants.js");
const SharedI18n = require("../shared/i18n.js");
require("../shared/subtitle-service.js");
require("../shared/phrase-detector.js");

const C = globalThis.LectoroConstants;
const SubtitleService = globalThis.SharedSubtitleService;

test("YouTube Focus Mode: Constants and default settings are registered", () => {
    assert.strictEqual(C.STORAGE_KEYS.YOUTUBE_FOCUS_MODE, "youtubeFocusMode");
    assert.strictEqual(C.STORAGE_KEYS.YOUTUBE_FOCUS_COLOR, "youtubeFocusColor");
    assert.strictEqual(C.DEFAULT_READING_SETTINGS.youtubeFocusMode, false);
    assert.strictEqual(C.DEFAULT_READING_SETTINGS.youtubeFocusColor, "#6366f1");
});

test("YouTube Focus Mode: i18n translations exist for all 11 supported languages", () => {
    const supportedLangs = ["en", "pl", "de", "es", "fr", "it", "ja", "ko", "nl", "cs", "pt"];
    for (const lang of supportedLangs) {
        const title = SharedI18n.t("youtube_focus_mode", lang);
        const desc = SharedI18n.t("youtube_focus_mode_desc", lang);
        const color = SharedI18n.t("youtube_focus_color", lang);

        assert.ok(title && title !== "youtube_focus_mode", `Missing youtube_focus_mode for ${lang}`);
        assert.ok(desc && desc !== "youtube_focus_mode_desc", `Missing youtube_focus_mode_desc for ${lang}`);
        assert.ok(color && color !== "youtube_focus_color", `Missing youtube_focus_color for ${lang}`);
    }
});

test("YouTube Focus Mode: styles.css contains sliding highlighter and normal word opacity", () => {
    const cssPath = path.join(__dirname, "../styles.css");
    const css = fs.readFileSync(cssPath, "utf8");

    assert.ok(css.includes(".is-focus-mode .__qt_sub-word"), "Missing .is-focus-mode .__qt_sub-word rule");
    assert.ok(css.includes(".__qt_focus_slider"), "Missing .__qt_focus_slider rule");
    assert.ok(css.includes("--lectoro-focus-bg"), "Missing --lectoro-focus-bg variable in slider");
    assert.ok(css.includes("transform"), "Missing transform transition on slider");
});

test("YouTube Focus Mode: YouTube JSON3 ASR preserves word-level timings", () => {
    const fixturePath = path.join(__dirname, "fixtures/apple-asr-en.json");
    const fixtureJson = fs.readFileSync(fixturePath, "utf8");

    const cues = SubtitleService.parseYouTubeJson3(fixtureJson, { preserveTiming: true });
    assert.ok(cues.length > 0, "Parsed cues should not be empty");

    const firstCue = cues[0];
    assert.ok(Array.isArray(firstCue.segs), "Cues must preserve segs array");
    assert.ok(firstCue.segs.length > 1, "First cue must have multiple word segments");

    const segWithOffset = firstCue.segs.find((s) => s.tOffsetMs != null);
    assert.ok(segWithOffset, "At least one segment should have tOffsetMs");
    assert.ok(segWithOffset.tAbsMs != null, "Segment should have computed absolute timestamp tAbsMs");
});

test("YouTube Focus Mode: Subtitle overlay sliding highlighter and timestamp validation", async () => {
    const classListMock = (initialClasses = []) => {
        const classes = new Set(initialClasses);
        return {
            classes,
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (n) => classes.has(n),
        };
    };

    let elementCounter = 0;
    const createMockElement = (tag) => {
        const cl = classListMock();
        elementCounter++;
        const mockRect = {
            left: elementCounter * 40,
            top: 20,
            width: 50,
            height: 24,
            right: elementCounter * 40 + 50,
            bottom: 44,
        };
        const styleMap = new Map();
        return {
            tagName: tag.toUpperCase(),
            children: [],
            childNodes: [],
            classList: cl,
            dataset: {},
            style: {
                setProperty: (k, v) => styleMap.set(k, v),
                getPropertyValue: (k) => styleMap.get(k) || "",
                removeProperty: (k) => styleMap.delete(k),
                set transform(v) { styleMap.set("transform", v); },
                get transform() { return styleMap.get("transform") || ""; },
                set width(v) { styleMap.set("width", v); },
                get width() { return styleMap.get("width") || ""; },
                set height(v) { styleMap.set("height", v); },
                get height() { return styleMap.get("height") || ""; },
                set opacity(v) { styleMap.set("opacity", v); },
                get opacity() { return styleMap.get("opacity") || ""; },
            },
            appendChild(child) {
                this.children.push(child);
                this.childNodes.push(child);
                child.parentNode = this;
                return child;
            },
            removeChild(child) {
                const idx = this.children.indexOf(child);
                if (idx !== -1) this.children.splice(idx, 1);
                return child;
            },
            insertBefore(newNode, refNode) {
                const idx = refNode ? this.children.indexOf(refNode) : -1;
                if (idx !== -1) {
                    this.children.splice(idx, 0, newNode);
                    this.childNodes.splice(idx, 0, newNode);
                } else {
                    this.children.push(newNode);
                    this.childNodes.push(newNode);
                }
                newNode.parentNode = this;
                return newNode;
            },
            contains(other) {
                return this === other || this.children.some((c) => c === other || c?.contains?.(other));
            },
            getBoundingClientRect: () => ({ ...mockRect }),
            focus: () => {},
            setAttribute: () => {},
            getAttribute: () => null,
            addEventListener: () => {},
            removeEventListener: () => {},
            isConnected: true,
        };
    };

    const docElement = createMockElement("html");
    const docHead = createMockElement("head");
    const docBody = createMockElement("body");

    const mockDocument = {
        createElement: (tag) => createMockElement(tag),
        createTextNode: (text) => ({ textContent: text, nodeType: 3 }),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: docElement,
        head: docHead,
        body: docBody,
        fullscreenElement: null,
    };

    const storageData = {
        [C.STORAGE_KEYS.YOUTUBE_FOCUS_MODE]: true,
        [C.STORAGE_KEYS.YOUTUBE_FOCUS_COLOR]: "#10b981",
    };
    const storageListeners = [];

    const mockChrome = {
        storage: {
            local: {
                get: (keys, cb) => cb({ ...keys, ...storageData }),
                set: (obj, cb) => {
                    Object.assign(storageData, obj);
                    storageListeners.forEach((fn) => {
                        const changes = {};
                        for (const k of Object.keys(obj)) {
                            changes[k] = { newValue: obj[k] };
                        }
                        fn(changes, "local");
                    });
                    if (cb) cb();
                },
            },
            onChanged: {
                addListener: (fn) => storageListeners.push(fn),
            },
        },
    };

    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    const origChrome = globalThis.chrome;
    const origQT = globalThis.QT;
    const origSharedUtils = globalThis.SharedUtils;
    const origRegistry = globalThis.LectoroPlayerRegistry;
    const origRaf = globalThis.requestAnimationFrame;
    const origCaf = globalThis.cancelAnimationFrame;

    try {
        globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
        globalThis.window = {
            location: { hostname: "www.youtube.com" },
            addEventListener: () => {},
            removeEventListener: () => {},
            setTimeout: (fn) => setTimeout(fn, 0),
            clearTimeout: (id) => clearTimeout(id),
            requestAnimationFrame: (fn) => setTimeout(fn, 0),
            cancelAnimationFrame: (id) => clearTimeout(id),
        };
        globalThis.document = mockDocument;
        globalThis.chrome = mockChrome;
        globalThis.QT = {
            TOOLTIP_ID: "qt-tooltip",
            addDismissHandler: () => {},
            addCleanup: () => {},
            hideTooltip: () => {},
            getTooltipEl: () => null,
            getOverlayParent: () => null,
            getMousePos: () => ({ x: 0, y: 0 }),
            findWordAtPoint: () => null,
            escapeHtml: (s) => s,
            escapeAttr: (s) => s,
        };
        globalThis.SharedUtils = {
            cleanCardText: (t) => t,
            isRedundantSentence: () => false,
            escapeHtml: (s) => s,
            escapeAttr: (s) => s,
        };

        const mockVideo = { currentTime: 0.5, paused: false, readyState: 4 };
        globalThis.LectoroPlayerRegistry = {
            getVideo: () => mockVideo,
            isPreviewOrThumbnailVideo: () => false,
            isCcActive: () => true,
            onSubtitleChange: () => {},
        };

        delete require.cache[require.resolve("../video/subtitle-overlay.js")];
        require("../video/subtitle-overlay.js");

        const SubtitleOverlay = globalThis.LectoroSubtitleOverlay;
        assert.ok(SubtitleOverlay, "LectoroSubtitleOverlay should be exposed");

        // 1. Cue with per-word timestamps (timelabs)
        const sampleCueWithTimings = {
            startTime: 0.16,
            endTime: 2.8,
            tStartMs: 160,
            dDurationMs: 2640,
            segs: [
                { utf8: "Well", tOffsetMs: 0, tAbsMs: 160 },
                { utf8: " guys,", tOffsetMs: 320, tAbsMs: 480 },
                { utf8: " it's", tOffsetMs: 880, tAbsMs: 1040 },
                { utf8: " clear", tOffsetMs: 1279, tAbsMs: 1439 },
            ],
            lines: ["Well guys, it's clear"],
            text: "Well guys, it's clear",
        };

        mockVideo.currentTime = 0;
        SubtitleOverlay.renderCustomSubtitles(sampleCueWithTimings.lines, {
            cue: sampleCueWithTimings,
            isAsr: true,
        });

        const slider = SubtitleOverlay.getFocusSliderElement();
        assert.ok(slider, "Focus slider element should exist for ASR cue with timestamps");
        assert.strictEqual(slider.classList.contains("is-active"), false, "Slider should be inactive initially before cue start");
        assert.ok(slider.style.transform.startsWith("translate3d"), "Slider should be pre-positioned to the first word instead of (0,0)");

        // Test word 1 (200ms) - snaps cleanly without transition animation from (0,0)
        SubtitleOverlay.updateFocusTiming(200);
        assert.strictEqual(slider.style.opacity, "1", "Slider should be visible at 200ms");
        assert.strictEqual(slider.classList.contains("is-active"), true, "Slider should gain is-active class");
        const transformWord1 = slider.style.transform;
        assert.ok(transformWord1.startsWith("translate3d"), "Slider should have 3D transform for word 1");

        // Test word 2 (600ms) - slider smoothly glides to new transform without hiding
        SubtitleOverlay.updateFocusTiming(600);
        assert.strictEqual(slider.style.opacity, "1", "Slider should stay visible while sliding to word 2");
        const transformWord2 = slider.style.transform;
        assert.notStrictEqual(transformWord1, transformWord2, "Slider position should update when moving to word 2");

        // Test past cue (3500ms) - slider smoothly fades out
        SubtitleOverlay.updateFocusTiming(3500);
        assert.strictEqual(slider.style.opacity, "0", "Slider should fade out after cue ends");
        assert.strictEqual(slider.classList.contains("is-active"), false, "Slider should lose is-active class when faded out");

        // 2. Cue WITHOUT per-word timestamps (e.g. only 1 segment or no offsets)
        const sampleCueWithoutTimings = {
            startTime: 3.0,
            endTime: 5.0,
            tStartMs: 3000,
            dDurationMs: 2000,
            segs: [
                { utf8: "This is a full sentence without per-word offsets." },
            ],
            lines: ["This is a full sentence without per-word offsets."],
            text: "This is a full sentence without per-word offsets.",
        };

        SubtitleOverlay.renderCustomSubtitles(sampleCueWithoutTimings.lines, {
            cue: sampleCueWithoutTimings,
            isAsr: true,
        });

        // Focus mode must NOT activate for captions without timestamps
        SubtitleOverlay.updateFocusTiming(3200);
        assert.strictEqual(slider.style.opacity, "0", "Focus mode should not be active for captions without timestamps");

        // Manual tracks must not become ASR merely because JSON3 has timings.
        SubtitleOverlay.renderCustomSubtitles(sampleCueWithTimings.lines, {
            cue: sampleCueWithTimings, isAsr: false,
        });
        SubtitleOverlay.updateFocusTiming(600);
        assert.strictEqual(slider.style.opacity, "0");
        // Changing only the track type must invalidate the rendering cache.
        SubtitleOverlay.renderCustomSubtitles(sampleCueWithTimings.lines, {
            cue: sampleCueWithTimings, isAsr: true,
        });
        SubtitleOverlay.updateFocusTiming(600);
        assert.strictEqual(slider.style.opacity, "1");
        SubtitleOverlay.renderCustomSubtitles(sampleCueWithTimings.lines, {
            cue: sampleCueWithTimings, isAsr: false,
        });
        SubtitleOverlay.updateFocusTiming(600);
        assert.strictEqual(slider.style.opacity, "0");

        for (const segs of [[{ utf8: "Hello!", tOffsetMs: 0 }], [{ utf8: "Hello!" }], undefined]) {
            const singleWordCue = { startTime: 6, endTime: 7, segs };
            mockVideo.currentTime = 6.2;
            SubtitleOverlay.renderCustomSubtitles(["Hello!"], { cue: singleWordCue, isAsr: true });
            assert.strictEqual(slider.style.opacity, "1", "Single ASR word is highlighted immediately");
            SubtitleOverlay.updateFocusTiming(7100);
            assert.strictEqual(slider.style.opacity, "0", "Single-word highlight ends with the cue");
        }

        for (const hostname of ["www.netflix.com", "example.com", "youtube.com.example.com", "notyoutube.com"]) {
            globalThis.window.location.hostname = hostname;
            SubtitleOverlay.renderCustomSubtitles(sampleCueWithTimings.lines, {
                cue: sampleCueWithTimings, isAsr: true,
            });
            SubtitleOverlay.updateFocusTiming(600);
            assert.strictEqual(slider.style.opacity, "0", `Focus must stay off on ${hostname}`);
        }
        globalThis.window.location.hostname = "www.youtube.com";

        // 3. Color synchronization
        mockChrome.storage.local.set({ [C.STORAGE_KEYS.YOUTUBE_FOCUS_COLOR]: "#f59e0b" });
        assert.strictEqual(SubtitleOverlay.getFocusColor(), "#f59e0b", "Focus color should update in overlay");

        await new Promise((r) => setTimeout(r, 50));
    } finally {
        globalThis.window = origWindow;
        globalThis.document = origDocument;
        globalThis.chrome = origChrome;
        globalThis.QT = origQT;
        globalThis.SharedUtils = origSharedUtils;
        globalThis.LectoroPlayerRegistry = origRegistry;
        globalThis.requestAnimationFrame = origRaf;
        globalThis.cancelAnimationFrame = origCaf;
    }
});

test("YouTube caption selection supports explicit ASR preference", () => {
    assert.strictEqual(C.EVENT_NAMES.YOUTUBE_SET_TRACK, "__lectoro_youtube_set_track");

    const origWindow = globalThis.window;
    const origDocument = globalThis.document;
    try {
        globalThis.window = {
            location: { hostname: "www.youtube.com" },
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => {},
        };
        globalThis.document = {
            addEventListener: () => {},
            removeEventListener: () => {},
            querySelector: () => null,
            querySelectorAll: () => [],
        };
        delete require.cache[require.resolve("../adapters/youtube-adapter.js")];
        require("../adapters/youtube-adapter.js");
        const Adapter = globalThis.LectoroYouTubeAdapter;
        assert.ok(Adapter?.selectBestCaptionTrack, "selectBestCaptionTrack should be exposed");

        const sampleTracks = [
            { languageCode: "en", kind: "", name: "English", baseUrl: "https://.../en-manual", vssId: ".en" },
            { languageCode: "en", kind: "asr", name: "English (auto-generated)", baseUrl: "https://.../en-asr", vssId: "a.en" },
            { languageCode: "es", kind: "", name: "Spanish", baseUrl: "https://.../es-manual", vssId: ".es" },
        ];

        // 1. When Focus Mode is OFF (preferAsr = false): chooses manual track
        const chosenNormal = Adapter.selectBestCaptionTrack(sampleTracks, "en", false);
        assert.strictEqual(chosenNormal.kind, "", "Normal mode should prefer manual track");
        assert.strictEqual(chosenNormal.vssId, ".en");

        // 2. When Focus Mode is ON (preferAsr = true): ALWAYS chooses auto-generated (ASR) track
        const chosenFocus = Adapter.selectBestCaptionTrack(sampleTracks, "en", true);
        assert.strictEqual(chosenFocus.kind, "asr", "Focus mode must prefer auto-generated ASR track");
        assert.strictEqual(chosenFocus.vssId, "a.en");

        // 3. Fallback when video only has manual tracks: returns manual track without crashing
        const manualOnlyTracks = [
            { languageCode: "en", kind: "", name: "English", baseUrl: "https://.../en-manual", vssId: ".en" },
        ];
        const chosenFallback = Adapter.selectBestCaptionTrack(manualOnlyTracks, "en", true);
        assert.strictEqual(chosenFallback.kind, "", "Should fall back to manual track if no ASR tracks exist");
    } finally {
        globalThis.window = origWindow;
        globalThis.document = origDocument;
    }
});
