const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleService = require("../shared/subtitle-service");

const exact = { preserveTiming: true };

test("platform WebVTT parsing retains gaps, near-simultaneous cues and explicit ends", () => {
    const input = `WEBVTT

00:00:01.000 --> 00:00:01.100
First
line

00:00:01.020 --> 00:00:01.080
Second speaker

00:00:03.000 --> 00:00:03.200
After silence
`;
    const cues = SubtitleService.parseTimedText(input, "vtt", "text/vtt", exact);
    assert.deepEqual(cues, [
        { startTime: 1, endTime: 1.1, text: "First line", lines: ["First line"] },
        { startTime: 1.02, endTime: 1.08, text: "Second speaker", lines: ["Second speaker"] },
        { startTime: 3, endTime: 3.2, text: "After silence", lines: ["After silence"] },
    ]);
    assert.equal(SubtitleService.parseTimedText(input).length, 2, "legacy parsing remains opt-out");
});

test("platform JSON3 parsing uses event timings and joins segments without changing punctuation", () => {
    const input = JSON.stringify({ events: [
        { tStartMs: 1234, dDurationMs: 700, segs: [{ utf8: "Hel" }, { utf8: "lo," }, { utf8: "\nworld!", tOffsetMs: 200 }] },
        { tStartMs: 5000, dDurationMs: 150, segs: [{ utf8: "After silence." }] },
        { tStartMs: 6000, segs: [{ utf8: "No end." }] },
        { tStartMs: 7000, dDurationMs: 0, segs: [{ utf8: "Empty interval." }] },
        { tStartMs: 8000, dDurationMs: 500 },
    ] });
    const cues = SubtitleService.parseTimedText(input, "json3", "application/json", exact);
    assert.equal(cues.length, 2);
    assert.deepEqual(cues[0], { startTime: 1.234, endTime: 1.934, text: "Hello, world!", lines: ["Hello, world!"] });
    assert.equal(cues[1].endTime, 5.15);
});

test("exact normalization never rounds platform boundaries or invents missing duration", () => {
    const cues = SubtitleService.finalizeCues([
        { startTime: 1.1234567, endTime: 1.2345678, text: "Exact\n time" },
        { startTime: 2, endTime: null, text: "Missing duration" },
        { startTime: 3, endTime: 2, text: "Negative duration" },
    ], exact);
    assert.deepEqual(cues, [{ startTime: 1.1234567, endTime: 1.2345678, text: "Exact time", lines: ["Exact time"] }]);
});

test("platform SubRip fallback keeps authored timing", () => {
    const cues = SubtitleService.parseTimedText("1\n00:00:01,000 --> 00:00:01,200\nOne\nline\n\n2\n00:00:02,000 --> 00:00:02,400\nSecond", "", "", exact);
    assert.deepEqual(cues.map(({ startTime, endTime, text }) => ({ startTime, endTime, text })), [
        { startTime: 1, endTime: 1.2, text: "One line" },
        { startTime: 2, endTime: 2.4, text: "Second" },
    ]);
});
