const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const S = require("../shared/subtitle-service");
const cue = (text, startTime, endTime) => ({ text, startTime, endTime, lines: [text] });
const timed = (texts) => texts.map((text, index) => cue(text, index, index + 1));

test("YouTube joins short multiword captions before or after a longer caption", () => {
    for (const texts of [
        ["We will see you", "over here!"],
        ["over here", "We will see you"],
        ["こんにちは", "これは長い文章です。"],
    ]) {
        const input = timed(texts);
        const snapshot = structuredClone(input);
        const result = S.mergeShortCues(input);
        assert.equal(result.length, 1);
        assert.equal(result[0].text, texts.join(" "));
        assert.deepEqual(result[0].lines, [texts.join(" ")]);
        assert.equal(result[0].startTime, 0);
        assert.equal(result[0].endTime, 2);
        assert.deepEqual(input, snapshot);
    }
});

test("YouTube uses strict 39/15 thresholds in both orders, counting spaces and punctuation", () => {
    for (const [left, right, count] of [
        [38, 14, 1], [39, 14, 2], [38, 15, 2], [15, 15, 2], [54, 1, 2],
    ]) {
        for (const lengths of [[left, right], [right, left]]) {
            const result = S.mergeShortCues(timed(lengths.map((length) => "a".repeat(length))));
            assert.equal(result.length, count, lengths.join(" + "));
        }
    }
    assert.equal(S.mergeShortCues(timed(["a".repeat(38), "one two three!"])).length, 1);
    assert.equal(S.mergeShortCues(timed(["a".repeat(38), "one two three!!"])).length, 2);
    assert.equal(S.mergeShortCues(timed(["😀".repeat(38), "one two"])).length, 1);
});

test("YouTube stops repeated merging at the character thresholds and preserves order", () => {
    for (const texts of [
        ["a".repeat(38), "b".repeat(14), "go"],
        ["go", "a".repeat(38), "b".repeat(14)],
        Array(12).fill("one two three"),
    ]) {
        const result = S.mergeShortCues(timed(texts));
        assert.equal(result.map((item) => item.text).join(" "), texts.join(" "));
        assert.ok(result.every((item) => Array.from(item.text).length <= 54));
        for (let index = 1; index < result.length; index += 1) {
            assert.ok(result[index - 1].endTime <= result[index].startTime);
        }
    }
});

test("YouTube respects pauses, speakers, sound labels, overlap and invalid timing in both directions", () => {
    for (const [first, next] of [
        [cue("Hello", 0, 1), cue("there", 4, 5)],
        [cue("Hello", 0, 2), cue("there", 1, 3)],
        [cue("Hello", 0, 1), cue("there", 0, 1)],
        [cue("Hello", 0, 1), cue("there", 1, NaN)],
        [cue("Hello", 0, 0), cue("there", 0, 1)],
        [cue("Hello", 0, 6), cue("there", 6, 13)],
        ...["— Yes!", ">> Yes!", "[Music]", "(laughing)", "♪ song"].flatMap((text) => [
            [cue(text, 0, 1), cue("Hello there", 1, 2)],
            [cue("Hello there", 0, 1), cue(text, 1, 2)],
        ]),
    ]) {
        assert.equal(S.mergeShortCues([first, next]).length, 2);
    }
});

test("YouTube merges translation and ASR clocks without mutating read-only parser metadata", () => {
    const input = timed(["Go", "over there", "right now"]);
    input.forEach((item, index) => {
        item.translation = ["Idź", "tam", "teraz"][index];
        Object.defineProperty(item, "tStartMs", { value: index * 1000 });
        Object.defineProperty(item, "dDurationMs", { value: 1000 });
        Object.defineProperty(item, "segs", { value: [{ utf8: item.text, tOffsetMs: 100 }] });
    });
    const [result] = S.mergeShortCues(input);
    assert.equal(result.text, "Go over there right now");
    assert.equal(result.translation, "Idź tam teraz");
    assert.deepEqual(result.segs.map((seg) => seg.tAbsMs), [100, 1100, 2100]);
    assert.deepEqual(result.segs.map((seg) => seg.tOffsetMs), [100, 1100, 2100]);
    assert.equal(result.dDurationMs, 3000);
    assert.equal(input[0].segs.length, 1);
});

test("YouTube builds its display timing index from character-based merges", () => {
    const context = vm.createContext({ getSubtitleService: () => S, cueIndex: [], cueMaxEnd: [],
        boundVideo: null, document: { querySelector: () => null }, currentVideoId: "", currentDisplayedText: "", currentDisplayedCue: null });
    loadFunction(context, "adapters/youtube-adapter.js", "setCueIndex");
    loadFunction(context, "adapters/youtube-adapter.js", "findActiveCue");
    context.setCueIndex(timed(["Over here", "we can see everything"]), "video");
    assert.equal(context.cueIndex.length, 1);
    assert.equal(context.cueMaxEnd[0], 2);
    for (const time of [0, 0.5, 1, 1.9]) {
        assert.equal(context.findActiveCue(time).text, "Over here we can see everything");
    }
    assert.equal(context.findActiveCue(2), null);
});
