const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleService = require("../shared/subtitle-service");
const C = require("../shared/constants");

test("reconstructFullSentenceCues merges fragmented cues until punctuation", () => {
    const rawCues = [
        { startTime: 1.0, endTime: 2.0, text: "I have always" },
        { startTime: 2.05, endTime: 3.2, text: "wanted to learn" },
        { startTime: 3.25, endTime: 4.5, text: "a new language." },
        { startTime: 4.6, endTime: 6.0, text: "It is really fascinating!" },
    ];

    const result = SubtitleService.reconstructFullSentenceCues(rawCues);

    assert.equal(result.length, 2);
    // First sentence
    assert.equal(result[0].text, "I have always wanted to learn a new language.");
    assert.equal(result[0].startTime, 1.0);
    // finalizeCues bridges gap to next.startTime - 0.04 (4.6 - 0.04 = 4.56)
    assert.equal(result[0].endTime, 4.56);
    assert.deepEqual(result[0].lines, ["I have always wanted to learn a new language."]);

    // Second sentence
    assert.equal(result[1].text, "It is really fascinating!");
    assert.equal(result[1].startTime, 4.6);
    assert.equal(result[1].endTime, 6.0);
    assert.deepEqual(result[1].lines, ["It is really fascinating!"]);
});

test("reconstructFullSentenceCues breaks on long pauses (> 1.4s) even without punctuation", () => {
    const rawCues = [
        { startTime: 0.5, endTime: 1.5, text: "Wait" },
        { startTime: 3.5, endTime: 4.5, text: "who is that" }, // 2.0s gap
        { startTime: 4.6, endTime: 5.5, text: "over there?" },
    ];

    const result = SubtitleService.reconstructFullSentenceCues(rawCues);

    assert.equal(result.length, 2);
    assert.equal(result[0].text, "Wait");
    assert.equal(result[0].startTime, 0.5);
    // finalizeCues bridges to 3.5 - 0.04 = 3.46
    assert.equal(result[0].endTime, 3.46);

    assert.equal(result[1].text, "who is that over there?");
    assert.equal(result[1].startTime, 3.5);
    assert.equal(result[1].endTime, 5.5);
});

test("reconstructFullSentenceCues breaks on speaker changes (>> or - )", () => {
    const rawCues = [
        { startTime: 1.0, endTime: 2.5, text: "Are you ready" },
        { startTime: 2.6, endTime: 3.8, text: ">> Yes, absolutely." },
    ];

    const result = SubtitleService.reconstructFullSentenceCues(rawCues);

    assert.equal(result.length, 2);
    assert.equal(result[0].text, "Are you ready");
    // cleanCueText strips speaker marker >> for clean display
    assert.equal(result[1].text, "Yes, absolutely.");
});

test("reconstructFullSentenceCues handles empty or invalid input safely", () => {
    assert.deepEqual(SubtitleService.reconstructFullSentenceCues([]), []);
    assert.deepEqual(SubtitleService.reconstructFullSentenceCues(null), []);
});

test("reconstructFullSentenceCues splits unpunctuated song lyrics into readable single-line cues", () => {
    const rawCues = [
        { startTime: 0.0, endTime: 1.2, text: "So rewind," },
        { startTime: 1.3, endTime: 2.2, text: "repeat it" },
        { startTime: 2.4, endTime: 3.5, text: "If the world ends tonight" },
        { startTime: 3.8, endTime: 4.9, text: "You’ll be in my arms" },
        { startTime: 5.2, endTime: 6.4, text: "We’ll be frozen in time" },
        { startTime: 6.6, endTime: 7.7, text: "Underneath the stars" },
        { startTime: 8.0, endTime: 9.1, text: "My lungs are screaming" },
        { startTime: 9.3, endTime: 10.4, text: "This heart is bleeding" },
        { startTime: 10.6, endTime: 11.7, text: "I love this feeling" },
        { startTime: 12.0, endTime: 13.5, text: "So rewind, repeat it" },
    ];

    const result = SubtitleService.reconstructFullSentenceCues(rawCues);
    // Must NOT merge into 1 huge 35-word wall of text!
    assert.ok(result.length >= 4, `Expected at least 4 cues, got ${result.length}`);
    for (const cue of result) {
        const words = cue.text.trim().split(/\s+/).length;
        assert.ok(words <= 12, `Cue "${cue.text}" has ${words} words, exceeds single-line limit`);
        assert.ok(cue.text.length <= 70, `Cue length ${cue.text.length} exceeds 70 chars`);
    }
});

test("alignSlaveTrackToMaster aligns multiple slave fragments via interval overlap and glues text", () => {
    // Master track: one full sentence [1.0, 5.0]
    const masterCues = [
        { startTime: 1.0, endTime: 5.0, text: "I have always wanted to learn a new language." },
        { startTime: 6.0, endTime: 9.0, text: "It opens up so many doors." },
    ];

    // Slave track (e.g. Polish translation from platform or translator):
    // Two fragments overlapping the first master cue, one overlapping the second
    const slaveCues = [
        { startTime: 0.9, endTime: 2.8, text: "Zawsze chciałem" },
        { startTime: 2.9, endTime: 4.9, text: "nauczyć się nowego języka." },
        { startTime: 6.1, endTime: 8.8, text: "To otwiera tak wiele drzwi." },
    ];

    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 2);
    // First master cue got glued Polish translation and kept master [1.0, 5.0] interval
    assert.equal(aligned[0].startTime, 1.0);
    assert.equal(aligned[0].endTime, 5.0);
    assert.equal(aligned[0].translation, "Zawsze chciałem nauczyć się nowego języka.");

    // Second master cue got its translation
    assert.equal(aligned[1].startTime, 6.0);
    assert.equal(aligned[1].endTime, 9.0);
    assert.equal(aligned[1].translation, "To otwiera tak wiele drzwi.");
});

test("alignSlaveTrackToMaster ignores non-overlapping slave cues and deduplicates repeated text", () => {
    const masterCues = [
        { startTime: 10.0, endTime: 14.0, text: "Hello world" },
    ];

    const slaveCues = [
        { startTime: 1.0, endTime: 4.0, text: "Cześć stary" }, // no overlap
        { startTime: 10.2, endTime: 12.0, text: "Witaj świecie" },
        { startTime: 12.1, endTime: 13.9, text: "Witaj świecie" }, // duplicate text
    ];

    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 1);
    assert.equal(aligned[0].translation, "Witaj świecie");
});

test("alignSlaveTrackToMaster synchronizes forward and fuses master cues spanned by a single slave cue into one line", () => {
    // Two master fragments: "He walked into" and "the room quietly."
    const masterCues = [
        { startTime: 1.0, endTime: 2.8, text: "He walked into" },
        { startTime: 2.9, endTime: 4.8, text: "the room quietly." },
        { startTime: 6.0, endTime: 8.0, text: "Nobody noticed him." },
    ];

    // One slave sentence spanning across both master fragments: [1.1, 4.6]
    const slaveCues = [
        { startTime: 1.1, endTime: 4.6, text: "Wszedł cicho do pokoju." },
        { startTime: 6.1, endTime: 7.9, text: "Nikt go nie zauważył." },
    ];

    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    // Master cues 0 and 1 are fused forward into a single unified line!
    assert.equal(aligned.length, 2);

    assert.equal(aligned[0].text, "He walked into the room quietly.");
    assert.deepEqual(aligned[0].lines, ["He walked into the room quietly."]);
    assert.equal(aligned[0].startTime, 1.0);
    assert.equal(aligned[0].endTime, 4.8);
    assert.equal(aligned[0].translation, "Wszedł cicho do pokoju.");

    assert.equal(aligned[1].text, "Nobody noticed him.");
    assert.equal(aligned[1].startTime, 6.0);
    assert.equal(aligned[1].endTime, 8.0);
    assert.equal(aligned[1].translation, "Nikt go nie zauważył.");
});

test("alignSlaveTrackToMaster handles slight timestamp drift forward gracefully", () => {
    // Master cue with slight timing drift compared to platform translation (e.g. 0.2s drift)
    const masterCues = [
        { startTime: 2.0, endTime: 4.0, text: "Look at the sky." },
    ];
    // Slave starts 0.1s after master ends due to drift
    const slaveCues = [
        { startTime: 4.1, endTime: 5.5, text: "Spójrz na niebo." },
    ];

    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 1);
    assert.equal(aligned[0].translation, "Spójrz na niebo.");
});

test("DEFAULT_READING_SETTINGS contains doubleSubtitles default to true", () => {
    assert.equal(C.DEFAULT_READING_SETTINGS.doubleSubtitles, true);
    assert.equal(C.STORAGE_KEYS.DOUBLE_SUBTITLES, "doubleSubtitles");
    assert.equal(C.UI_CLASSES.CUSTOM_SUB_SECONDARY, "__qt_custom-sub-secondary");
});

