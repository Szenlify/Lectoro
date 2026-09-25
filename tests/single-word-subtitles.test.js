const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const S = require("../shared/subtitle-service");
const cue = (text, startTime, endTime) => ({ text, startTime, endTime, lines: [text] });

test("a trailing word joins the previous subtitle, including long and punctuated sentences", () => {
    for (const text of ["I think you are the biggest guys around", "Are you ready?"]) {
        const input = [cue(text, 1, 3), cue("here.", 3.1, 4), cue("Next full sentence", 4, 6)];
        const snapshot = structuredClone(input);
        const result = S.mergeSingleWordCues(input);
        assert.equal(result.length, 2);
        assert.equal(result[0].text, `${text} here.`);
        assert.deepEqual(result[0].lines, [`${text} here.`]);
        assert.equal(result[0].startTime, 1);
        assert.equal(result[0].endTime, 4);
        assert.deepEqual(input, snapshot);
    }
});

test("joins consecutive one-word cues but respects pauses, speakers, overlap and sound labels", () => {
    assert.equal(S.mergeSingleWordCues([cue("Look at", 0, 1), cue("those", 1, 2), cue("muscles!", 2, 3)])[0].text, "Look at those muscles!");
    for (const next of [cue("Later", 4, 5), cue("— Yes!", 1, 2), cue("[Music]", 1, 2), cue("simultaneous", 0, 1), cue("two words", 1, 2)]) {
        assert.equal(S.mergeSingleWordCues([cue("First phrase", 0, 1), next]).length, 2, next.text);
    }
    assert.equal(S.mergeSingleWordCues([cue("It's", 1, 2)]).length, 1);
    assert.equal(S.mergeSingleWordCues([cue("First phrase", 0, 1), cue("don't", 1, 2)]).length, 1);
    assert.equal(S.mergeSingleWordCues([cue("こんにちは", 0, 1), cue("これは長い文章です。", 1, 2)]).length, 2);
});

test("merged YouTube ASR keeps absolute word timing and shifts relative offsets", () => {
    const first = cue("Look here", 1, 2);
    const next = cue("now!", 2, 3);
    Object.defineProperty(first, "segs", { value: [{ utf8: "Look", tOffsetMs: 0 }, { utf8: " here", tOffsetMs: 500 }] });
    Object.defineProperty(first, "tStartMs", { value: 1000 });
    Object.defineProperty(first, "dDurationMs", { value: 1000 });
    Object.defineProperty(next, "segs", { value: [{ utf8: "now!", tOffsetMs: 100 }] });
    const [result] = S.mergeSingleWordCues([first, next]);
    assert.deepEqual(result.segs.map(s => s.tAbsMs), [1000, 1500, 2100]);
    assert.deepEqual(result.segs.map(s => s.tOffsetMs), [0, 500, 1100]);
    assert.equal(result.dDurationMs, 2000);
    assert.equal(first.segs.length, 2);
});

test("YouTube display index joins fragments before building its timing index", () => {
    const context = vm.createContext({ getSubtitleService: () => S, cueIndex: [], cueMaxEnd: [],
        boundVideo: null, document: { querySelector: () => null }, currentVideoId: "", currentDisplayedText: "", currentDisplayedCue: null });
    loadFunction(context, "adapters/youtube-adapter.js", "setCueIndex");
    context.setCueIndex([cue("See you", 0, 1), cue("soon", 1, 2)], "video");
    assert.equal(context.cueIndex.length, 1);
    assert.equal(context.cueMaxEnd[0], 2);
});

test("native subtitles show the joined phrase during both cues and disappear at its end", () => {
    const first = cue("See you", 0, 1), second = cue("soon!", 1.1, 2);
    const track = { kind: "subtitles", mode: "showing", cues: [first, second], activeCues: [first] };
    const video = { textTracks: [track], currentTime: 0.5 };
    const context = vm.createContext({ SharedSubtitleService: S, cueText: c => c.text, compareCues: (a, b) => a.startTime - b.startTime });
    loadFunction(context, "adapters/player-registry.js", "getNativeCueLines");
    for (const time of [0.5, 1.05, 1.5]) {
        video.currentTime = time;
        track.activeCues = time < 1 ? [first] : time < 1.1 ? [] : [second];
        const lines = context.getNativeCueLines(video);
        assert.equal(lines.join(" "), "See you soon!");
        assert.equal(lines.cue.endTime, 2);
    }
    video.currentTime = 2;
    track.activeCues = [];
    assert.equal(context.getNativeCueLines(video).length, 0);
});

test("native display cache updates when cues change and keeps tracks separate", () => {
    const track = { cues: [cue("Come back", 0, 1)], activeCues: [] };
    assert.equal(S.getNativeDisplayCues(track), S.getNativeDisplayCues(track));
    track.cues.push(cue("soon", 1, 2));
    assert.equal(S.getNativeDisplayCues(track)[0].text, "Come back soon");
    const other = { cues: [cue("Wróć", 0, 1)], activeCues: [] };
    assert.equal(S.getNativeDisplayCues(other)[0].text, "Wróć");
});
