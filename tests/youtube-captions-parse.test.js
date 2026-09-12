const test = require("node:test");
const assert = require("node:assert/strict");

// Mock environment for XML/DOM parsing in Node
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

require("../shared/subtitle-service.js");
const SubtitleService = globalThis.SharedSubtitleService;

test("SubtitleService parses standard YouTube JSON3 format", () => {
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

    const cues = SubtitleService.parseYouTubeJson3(sampleJson3);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].startTime, 1);
    assert.strictEqual(cues[0].text, "Hello world, welcome to Lectoro.");
    assert.strictEqual(cues[1].startTime, 3.8);
});

test("SubtitleService reconstructs dynamic ASR word streaming into natural cues", () => {
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

    const cues = SubtitleService.parseYouTubeJson3(sampleAsrJson3);
    assert.strictEqual(cues.length, 2);
    assert.strictEqual(cues[0].text, "Today we are testing dynamic subtitles.");
    assert.strictEqual(cues[0].startTime, 0.5);

    assert.strictEqual(cues[1].text, "And here is the second sentence");
    assert.strictEqual(cues[1].startTime, 4.7);
});

test("SubtitleService handles timeline navigation (adjacent cue times)", () => {
    const cues = [
        { startTime: 0.5, endTime: 3.5, text: "First" },
        { startTime: 4.7, endTime: 7.2, text: "Second" },
    ];
    const timeNext = SubtitleService.findAdjacentCueTime(cues, 1.0, 1);
    assert.strictEqual(timeNext, 4.7);

    const timeRepeat = SubtitleService.findAdjacentCueTime(cues, 2.5, -1);
    assert.strictEqual(timeRepeat, 0.5);
});

test("SubtitleService strips speaker markers like >> and &gt;&gt;", () => {
    assert.strictEqual(SubtitleService.cleanCueText(">> Hello world"), "Hello world");
    assert.strictEqual(SubtitleService.cleanCueText(">>> Welcome back to the show"), "Welcome back to the show");
    assert.strictEqual(SubtitleService.cleanCueText("Speaker 1: Hello. >> Speaker 2: Hi there."), "Speaker 1: Hello. Speaker 2: Hi there.");
    assert.strictEqual(SubtitleService.cleanCueText("&gt;&gt; Good morning &gt;&gt; everyone"), "Good morning everyone");
    assert.strictEqual(SubtitleService.cleanCueText("›› Testing ›› markers"), "Testing markers");
    assert.strictEqual(SubtitleService.cleanCueText(">> "), "");
});
