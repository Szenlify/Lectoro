const assert = require("assert");
const fs = require("fs");

// Mock environment
globalThis.DOMParser = class MockDOMParser {
    parseFromString(str, type) {
        return {
            documentElement: {
                getAttribute: () => null,
                attributes: [],
            },
            getElementsByTagNameNS: () => [],
            querySelector: () => null,
        };
    }
};

// Load SubtitleService
require("../shared/subtitle-service.js");
const SubtitleService = globalThis.SharedSubtitleService;

console.log("Testing parseYouTubeJson3 & SubtitleService...");

// 1. Test standard YouTube JSON3 with clean sentence segments
const sampleJson3 = JSON.stringify({
    wireMagic: "pb3",
    events: [
        {
            tStartMs: 1000,
            dDurationMs: 2500,
            segs: [{ utf8: "Hello world, welcome to Lectoro." }],
        },
        {
            tStartMs: 3800,
            dDurationMs: 3000,
            segs: [{ utf8: "This is a full sentence with proper timing." }],
        },
    ],
});

const cues1 = SubtitleService.parseYouTubeJson3(sampleJson3);
console.log("Cues 1:", cues1);
assert.strictEqual(cues1.length, 2);
assert.strictEqual(cues1[0].startTime, 1);
assert.strictEqual(cues1[0].text, "Hello world, welcome to Lectoro.");
assert.strictEqual(cues1[1].startTime, 3.8);

// 2. Test Dynamic ASR (Automatic Speech Recognition) with fragmented word streaming
const sampleAsrJson3 = JSON.stringify({
    wireMagic: "pb3",
    events: [
        { tStartMs: 500, dDurationMs: 400, segs: [{ utf8: "Today" }] },
        { tStartMs: 900, dDurationMs: 300, segs: [{ utf8: " we" }] },
        { tStartMs: 1200, dDurationMs: 400, segs: [{ utf8: " are" }] },
        { tStartMs: 1600, dDurationMs: 500, segs: [{ utf8: " testing" }] },
        { tStartMs: 2100, dDurationMs: 600, segs: [{ utf8: " dynamic" }] },
        { tStartMs: 2700, dDurationMs: 500, segs: [{ utf8: " subtitles." }] },
        // Pause of 1.5s
        { tStartMs: 4700, dDurationMs: 300, segs: [{ utf8: "And" }] },
        { tStartMs: 5000, dDurationMs: 400, segs: [{ utf8: " here" }] },
        { tStartMs: 5400, dDurationMs: 400, segs: [{ utf8: " is" }] },
        { tStartMs: 5800, dDurationMs: 500, segs: [{ utf8: " the" }] },
        { tStartMs: 6300, dDurationMs: 600, segs: [{ utf8: " second" }] },
        { tStartMs: 6900, dDurationMs: 400, segs: [{ utf8: " sentence\n" }] },
    ],
});

const cues2 = SubtitleService.parseYouTubeJson3(sampleAsrJson3);
console.log("Cues 2 (Dynamic ASR reconstructed):", cues2);
assert.strictEqual(cues2.length, 2);
assert.strictEqual(cues2[0].text, "Today we are testing dynamic subtitles.");
assert.strictEqual(cues2[0].startTime, 0.5);
assert.strictEqual(cues2[0].endTime, 4.66);

assert.strictEqual(cues2[1].text, "And here is the second sentence");
assert.strictEqual(cues2[1].startTime, 4.7);
assert.strictEqual(cues2[1].endTime, 8.4);

// 3. Test timeline navigation (A and D keys)
const timeNext = SubtitleService.findAdjacentCueTime(cues2, 1.0, 1);
assert.strictEqual(timeNext, 4.7, "Next subtitle should seek to 4.7s");

// At 2.5s (> 0.5s + 1.2s), rewind to sentence start
const timeRepeat = SubtitleService.findAdjacentCueTime(cues2, 2.5, -1);
assert.strictEqual(timeRepeat, 0.5, "Rewind should jump to start of current sentence");

// At 5.0s (<= 4.7s + 1.2s), jump to previous sentence
const timePrev = SubtitleService.findAdjacentCueTime(cues2, 5.0, -1);
assert.strictEqual(timePrev, 0.5, "Previous subtitle should jump to previous sentence start");

console.log("✅ All YouTube subtitle parser & timeline tests PASSED!");
