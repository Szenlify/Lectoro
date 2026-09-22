const test = require("node:test");
const assert = require("node:assert/strict");
const Controller = require("../video/universal-video-controller");
const SubtitleService = require("../shared/subtitle-service");

test("UniversalVideoController calculates adjacent cue times with 50% replay threshold", () => {
    const cues = [
        { startTime: 1.0, endTime: 5.0, text: "Sentence 1 (duration: 4.0s)" },
        { startTime: 7.0, endTime: 10.0, text: "Sentence 2 (duration: 3.0s)" },
    ];

    // Cue 1 duration = 4.0s. Half is 2.0s (i.e. at playback time 3.0s).

    // 1. Next subtitle ('D' / 'ArrowRight') from inside Cue 1 -> jumps to Cue 2 (7.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 2.0, 1), 7.0);

    // 2. Backward navigation ('A' / 'ArrowLeft') at 4.0s (> 50% of Cue 1):
    //    Since 4.0s is 3.0s into the 4.0s cue (> 2.0s threshold), it REPLAYS Cue 1 (1.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 4.0, -1), 1.0);

    // 3. Backward navigation ('A' / 'ArrowLeft') at 2.0s (< 50% of Cue 1):
    //    Since 2.0s is only 1.0s into the 4.0s cue (< 2.0s threshold), it jumps back to previous (or start of first cue 1.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 2.0, -1), 1.0);

    // 4. In Cue 2 (7.0 to 10.0, duration 3.0s, half is 1.5s -> threshold time 8.5s):
    //    At 9.0s (> 50% into Cue 2): replays Cue 2 from 7.0s
    assert.equal(Controller.calculateAdjacentCueTime(cues, 9.0, -1), 7.0);

    //    At 7.5s (< 50% into Cue 2): jumps back to Cue 1 (1.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 7.5, -1), 1.0);

    // 5. In silence between cues (e.g. at 6.0s):
    //    Pressing 'A' / 'ArrowLeft' jumps back to Cue 1 that just finished (1.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 6.0, -1), 1.0);
    //    Pressing 'D' / 'ArrowRight' jumps forward to upcoming Cue 2 (7.0s)
    assert.equal(Controller.calculateAdjacentCueTime(cues, 6.0, 1), 7.0);
});

test("UniversalVideoController supports Netflix 125ms advance audio pre-roll buffer", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "Cue 1" },
        { startTime: 3.0, endTime: 4.0, text: "Cue 2" },
    ];
    const options = { advanceOffset: 0.125 };

    // Next from Cue 1 with offset -> 3.0 - 0.125 = 2.875
    assert.equal(Controller.calculateAdjacentCueTime(cues, 0.875, 1, options), 2.875);

    // Replay Cue 2 (> 50% into Cue 2, e.g. at 3.9s) -> 3.0 - 0.125 = 2.875
    assert.equal(Controller.calculateAdjacentCueTime(cues, 3.9, -1, options), 2.875);

    // Prev from Cue 2 near start (2.875s) -> 1.0 - 0.125 = 0.875
    assert.equal(Controller.calculateAdjacentCueTime(cues, 2.875, -1, options), 0.875);
});

test("UniversalVideoController exports user-adjustable config values", () => {
    const config = Controller.getConfig();
    assert.equal(config.REPLAY_THRESHOLD_RATIO, 0.5);
    assert.equal(config.FALLBACK_SEEK_SECONDS, 5);
    assert.equal(config.NETFLIX_ADVANCE_OFFSET, 0.125);
});

test("UniversalVideoController routes Z and X to word save and AI sentence save when tooltip is open", () => {
    let wordSavedClicked = false;
    let aiSavedClicked = false;
    let sentenceSaved = false;

    const mockWordBtn = {
        disabled: false,
        classList: { contains: () => false },
        click: () => { wordSavedClicked = true; },
    };
    const mockAiBtn = {
        disabled: false,
        classList: { contains: () => false },
        click: () => { aiSavedClicked = true; },
    };

    const prevDoc = global.document;
    global.document = {
        querySelector: (sel) => {
            if (sel.includes(".visible")) return true;
            if (sel.includes("save-word-btn")) return mockWordBtn;
            if (sel.includes("save-ai-btn")) return mockAiBtn;
            return null;
        },
    };

    const prevOverlay = global.LectoroSubtitleOverlay;
    global.LectoroSubtitleOverlay = {
        isSubtitleUiOpen: () => false,
        isAiTooltipActive: () => false,
        saveCurrentSentenceToReview: () => { sentenceSaved = true; },
    };

    const prevRegistry = global.LectoroPlayerRegistry;
    global.LectoroPlayerRegistry = {
        getVideo: () => ({ paused: false, playbackRate: 1.0 }),
    };

    try {
        const preventDefault = () => {};
        const stopPropagation = () => {};
        const stopImmediatePropagation = () => {};

        // Press 'Z' with tooltip open -> clicks word save button, does NOT call sentence save
        Controller.handleKeyDown({ key: "z", preventDefault, stopPropagation, stopImmediatePropagation });
        assert.equal(wordSavedClicked, true, "Z key must trigger word save button");
        assert.equal(sentenceSaved, false, "Z key must not trigger full sentence save when tooltip is open");

        // Press 'X' with tooltip open -> clicks AI sentence button
        Controller.handleKeyDown({ key: "x", preventDefault, stopPropagation, stopImmediatePropagation });
        assert.equal(aiSavedClicked, true, "X key must trigger AI sentence save button");
    } finally {
        global.document = prevDoc;
        global.LectoroSubtitleOverlay = prevOverlay;
        global.LectoroPlayerRegistry = prevRegistry;
    }
});

test("core.js buildSaveFooterHtml renders Z and X kbd hints and type='button'", () => {
    const vm = require("node:vm");
    const { loadFunction } = require("./helpers");
    const C = require("../shared/constants");
    const U = require("../shared/utils");

    const context = vm.createContext({ SharedI18n: require("../shared/i18n"),
        LectoroConstants: C,
        C,
        SharedUtils: U,
        PREFIX: "__qt_",
        SVG: C.SVG_ICONS,
        escapeHtml: U.escapeHtml,
        escapeAttr: U.escapeAttr,
    });
    loadFunction(context, "core.js", "buildSaveFooterHtml");

    const html = context.buildSaveFooterHtml('data-src="test" data-translated="test2"', {
        saveLabel: "Zapisz",
        saveTitle: "Zapisz słowo (Z)",
        saveKeyHint: "Z",
        aiLabel: "Zdanie AI",
        aiTitle: "Generuj zdanie AI (X)",
        aiKeyHint: "X",
    });

    assert.ok(html.includes('type="button"'), "Buttons must have type='button'");
    assert.ok(html.includes('<kbd class="__qt_key-hint">Z</kbd>'), "Must render kbd hint for Z");
    assert.ok(html.includes('<kbd class="__qt_key-hint">X</kbd>'), "Must render kbd hint for X");
    assert.ok(html.includes("Zapisz"), "Must include save label");
    assert.ok(html.includes("Zdanie AI"), "Must include AI label");
});

test("UniversalVideoController rewinding during active subtitle jumps directly to active subtitle start", async () => {
    const mockVideo = {
        currentTime: 14.8,
        duration: 120,
        paused: false,
    };

    const prevOverlay = global.LectoroSubtitleOverlay;
    const prevRegistry = global.LectoroPlayerRegistry;

    try {
        // Mock active subtitle started at 12.0s
        global.LectoroSubtitleOverlay = {
            getActiveSubtitleStartTime: () => 12.0,
            isSubtitleUiOpen: () => false,
            isAiTooltipActive: () => false,
        };
        global.LectoroPlayerRegistry = {
            getVideo: () => mockVideo,
            // no custom navigateSubtitle, fallback to controller logic
        };

        // Current time is 14.8s (2.8s into subtitle). Rewinding should jump to 12.0s, NOT (14.8 - 5s = 9.8s)!
        await Controller.navigateSubtitle(mockVideo, -1);
        assert.equal(mockVideo.currentTime, 12.0, "Must jump directly to subtitle start time 12.0s");

        // Forward seeking when no future cues should jump by fallback delta (+5s)
        await Controller.navigateSubtitle(mockVideo, 1);
        assert.equal(mockVideo.currentTime, 17.0, "Forward seek should advance by fallback delta");
    } finally {
        global.LectoroSubtitleOverlay = prevOverlay;
        global.LectoroPlayerRegistry = prevRegistry;
    }
});



