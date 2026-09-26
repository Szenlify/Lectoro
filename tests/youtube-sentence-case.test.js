const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const S = require("../shared/subtitle-service");
const cue = (text, index = 0) => ({ text, lines: [text], startTime: index, endTime: index + 1 });
const normalize = (texts, language = "en") => S.normalizeCueSentenceCase(texts.map(cue), language).map((item) => item.text);

test("YouTube uses sentence case after periods, questions and exclamations", () => {
    assert.deepEqual(normalize(["HELLO WORLD. HOW ARE YOU? I'M HERE! LET'S GO."]),
        ["Hello world. How are you? I'm here! Let's go."]);
    assert.deepEqual(normalize(["hello. how are you? fine! thanks."]),
        ["Hello. How are you? Fine! Thanks."]);
    assert.deepEqual(normalize(["HELLO"]), ["Hello"]);
    assert.deepEqual(normalize(["hello. \"how are you?\" she asks."]),
        ["Hello. \"How are you?\" She asks."]);
});

test("YouTube preserves source names, brands, abbreviations and English I", () => {
    assert.deepEqual(normalize(["I THINK John IS HERE. he works at NASA with McDonald and YouTube. i know IBM."]),
        ["I think John is here. He works at NASA with McDonald and YouTube. I know IBM."]);
    assert.deepEqual(normalize(["i'm here and i've seen it. i'll ask and i'd wait."]),
        ["I'm here and I've seen it. I'll ask and I'd wait."]);
    assert.deepEqual(normalize(["THIS IS NASA AND THE FBI."]), ["This is NASA and the FBI."]);
    assert.deepEqual(normalize(["iPhone works. eBay sells it. I LOVE John. Will arrives in May."]),
        ["iPhone works. eBay sells it. I love John. Will arrives in May."]);
    assert.deepEqual(normalize(["we live in the US. TELL US MORE."]), ["We live in the US. Tell us more."]);
});

test("sentence state crosses cue boundaries without capitalizing every caption", () => {
    assert.deepEqual(normalize(["we can see", "The whole city. next", "We go home.", "then we rest."]),
        ["We can see", "the whole city. Next", "we go home.", "Then we rest."]);
    assert.deepEqual(normalize(["here am I.", "then we leave"]), ["Here am I.", "Then we leave"]);
});

test("periods in abbreviations, decimals, initials, URLs and emails do not start sentences", () => {
    assert.deepEqual(normalize(["i met Dr.", "Smith and J. Brown in the U.S. today. it cost 3.14 dollars. then we left."]),
        ["I met Dr.", "Smith and J. Brown in the U.S. today. It cost 3.14 dollars. Then we left."]);
    assert.deepEqual(normalize(["visit https://example.com/help and write to user@example.com. then wait."]),
        ["Visit https://example.com/help and write to user@example.com. Then wait."]);
});

test("Polish i stays lowercase inside a sentence and source German nouns keep capitals", () => {
    assert.deepEqual(normalize(["Ala I Jan SĄ TU. teraz idą np. do Warszawy."], "pl-PL"),
        ["Ala i Jan są tu. Teraz idą np. do Warszawy."]);
    assert.deepEqual(normalize(["ich lese ein Buch. danach besucht Anna die Schule."], "de"),
        ["Ich lese ein Buch. Danach besucht Anna die Schule."]);
});

test("casing preserves original cues, line breaks and non-enumerable ASR timing", () => {
    const input = cue("hello world. how are you?");
    input.lines = ["hello world.", "how are you?"];
    Object.defineProperty(input, "segs", { value: [{ utf8: "hello", tAbsMs: 100, tOffsetMs: 100 }] });
    Object.defineProperty(input, "tStartMs", { value: 0 });
    Object.defineProperty(input, "dDurationMs", { value: 1000 });
    const [result] = S.normalizeCueSentenceCase([input], "en");
    assert.equal(result.text, "Hello world. How are you?");
    assert.deepEqual(result.lines, ["Hello world.", "How are you?"]);
    assert.equal(result.startTime, input.startTime);
    assert.equal(result.endTime, input.endTime);
    assert.equal(result.segs, input.segs);
    assert.equal(result.tStartMs, 0);
    assert.equal(result.dDurationMs, 1000);
    assert.equal(Object.getOwnPropertyDescriptor(result, "segs").enumerable, false);
    assert.equal(input.text, "hello world. how are you?");
});

test("YouTube indexes and displays normalized text while keeping the merge length limit", () => {
    const context = vm.createContext({ getSubtitleService: () => S, cueIndex: [], cueMaxEnd: [],
        boundVideo: null, document: { querySelector: () => null }, currentVideoId: "", currentDisplayedText: "", currentDisplayedCue: null });
    loadFunction(context, "adapters/youtube-adapter.js", "setCueIndex");
    context.setCueIndex([cue("I THINK", 0), cue("John IS HERE.", 1), cue("how are you?", 2)], "video", "en");
    assert.equal(context.cueIndex.map((item) => item.text).join(" "), "I think John is here. How are you?");
    assert.ok(context.cueIndex.every((item) => item.text.length <= 54));
});

test("YouTube DOM fallback also uses sentence case", () => {
    const context = vm.createContext({ getSubtitleService: () => S, activeTrack: { languageCode: "en" },
        document: { querySelector: () => ({ querySelectorAll: () => [{ textContent: "HELLO WORLD. HOW ARE YOU?" }] }) } });
    loadFunction(context, "adapters/youtube-adapter.js", "getDomSubtitleLines");
    assert.equal(context.getDomSubtitleLines().join(" "), "Hello world. How are you?");
});
