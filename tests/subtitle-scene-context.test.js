const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleService = require("../shared/subtitle-service");
const AIPrompts = require("../shared/ai-prompts");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");

const windowOptions = { secondsBefore: 30, secondsAfter: 15 };
const cue = (startTime, endTime, text) => ({ startTime, endTime, text });
const readContext = value => JSON.parse(AIPrompts.formatSubtitleContext(value).split(": ").slice(1).join(": "));

test("scene includes whole cues intersecting 30 seconds before and 15 seconds after", () => {
    const cues = [
        cue(10, 29.9, "outside before"),
        cue(29, 31, "whole boundary caption"),
        cue(35, 39, "earlier scene"),
        cue(45, 48, "nearer scene"),
        cue(55, 59, "immediate previous"),
        cue(60, 63, "current subtitle"),
        cue(63, 65, "immediate next"),
        cue(67, 70, "continuation"),
        cue(73, 76, "later scene"),
        cue(78, 81, "whole end caption"),
        cue(78.1, 82, "outside after"),
    ];
    const result = SubtitleService.getSurroundingContext(cues, 61, "current subtitle", windowOptions);
    assert.deepEqual(result.before, ["whole boundary caption", "earlier scene", "nearer scene", "immediate previous"]);
    assert.deepEqual(result.after, ["immediate next", "continuation", "later scene", "whole end caption"]);
    assert.equal(result.current, "current subtitle");
    assert.deepEqual(readContext(result), result, "prompt must retain more than two cues per side");
});

test("high/come down receives the continuous scene while Data.sentence stays the translation target", () => {
    const cues = [
        cue(30, 34, "I'm happy when I'm with you."),
        cue(40, 44, "Nothing else matters tonight."),
        cue(50, 54, "This feeling is incredible."),
        cue(55, 59, "So high I don’t wanna"),
        cue(60, 62, "come down"),
        cue(62, 65, "Stay here with me."),
        cue(67, 70, "I wish this moment would last."),
        cue(72, 75, "We can forget tomorrow."),
    ];
    const scene = SubtitleService.getSurroundingContext(cues, 61, "come down", windowOptions);
    const prompt = AIPrompts.explainSentence("come down", "pl", scene);
    for (const caption of cues) assert.ok(prompt.includes(caption.text), caption.text);
    assert.match(prompt, /continuous utterance across caption breaks/);
    assert.match(prompt, /never assume drugs or euphoria without support/);
    assert.match(prompt, /preserve ambiguity/);
    assert.ok(prompt.includes('Data: {"sentence":"come down","learning_language":"en"}'));
});

test("time window does not pull unrelated cues across long gaps", () => {
    const cues = [cue(0, 2, "old scene"), cue(100, 102, "current"), cue(150, 152, "future scene")];
    const result = SubtitleService.getSurroundingContext(cues, 101, "current", windowOptions);
    assert.deepEqual(result, { before: [], current: "current", after: [] });
    assert.deepEqual(SubtitleService.getSurroundingContext([], 101, "current", windowOptions), result);
});

test("repeated subtitles use the occurrence near playback and ignore empty cues", () => {
    const cues = [cue(1, 2, "Yes."), cue(95, 98, "recent scene"), cue(100, 103, ""), cue(101, 104, "Yes."), cue(105, 109, "next")];
    const result = SubtitleService.getSurroundingContext(cues, 102, "Yes.", windowOptions);
    assert.deepEqual(result, { before: ["recent scene"], current: "Yes.", after: ["next"] });
});

test("an active long cue wins over a repeated future cue with a closer start", () => {
    const cues = [cue(65, 69, "before active"), cue(70, 102, "same words"), cue(103, 105, "between"), cue(106, 109, "same words")];
    const result = SubtitleService.getSurroundingContext(cues, 100, "same words", windowOptions);
    assert.deepEqual(result.before, ["before active"]);
    assert.deepEqual(result.after, ["between", "same words"]);
});

test("a timed scene gap is not filled from stale playback history", () => {
    const video = { currentTime: 100 };
    const registry = {
        getVideo: () => video,
        getAllCues: () => [cue(100, 102, "current")],
        getSubtitleContext: () => ({ before: [], current: "current", after: [] }),
    };
    const context = vm.createContext({
        getPlayerRegistry: () => registry, activeText: "current",
        recentSubtitlesHistory: ["unrelated scene before a seek", "current"],
    });
    loadFunction(context, "video/subtitle-overlay.js", "getActiveSubtitleContext");
    assert.deepEqual(context.getActiveSubtitleContext(video, "current").before, []);
});

test("current cue supplies the full caption when the target is a smaller fragment", () => {
    const result = SubtitleService.getSurroundingContext([cue(60, 63, "So high I don’t wanna come down")], 61, "come down", windowOptions);
    assert.equal(readContext(result).current, "So high I don’t wanna come down");
});

test("prompt budgets prioritize nearby whole cues without truncating at 300 characters", () => {
    const long = "whole caption ".repeat(30);
    const result = readContext({
        before: ["farther ".repeat(600), long, "immediate previous"],
        current: "target",
        after: ["immediate next", long, "farther ".repeat(600)],
    });
    assert.deepEqual(result.before, [long.trim(), "immediate previous"]);
    assert.deepEqual(result.after, ["immediate next", long.trim()]);
    const escaped = AIPrompts.formatSubtitleContext({ before: Array(300).fill("\u0000".repeat(40)), after: Array(300).fill("\u0000".repeat(40)) });
    assert.ok(escaped.length < 8200, "budget must count JSON escaping, not just raw characters");
});

test("timed windows preserve count-based compatibility and allow zero-second sides", () => {
    const cues = [cue(1, 2, "one"), cue(3, 4, "two"), cue(5, 6, "three")];
    assert.deepEqual(SubtitleService.getSurroundingContext(cues, 3.5, "two", { secondsBefore: 0, secondsAfter: 0 }), { before: [], current: "two", after: [] });
    assert.deepEqual(SubtitleService.getSurroundingContext(cues, 3.5, "two", { maxBefore: 1, maxAfter: 1 }), { before: ["one"], current: "two", after: ["three"] });
});
