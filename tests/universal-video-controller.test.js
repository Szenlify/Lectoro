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
