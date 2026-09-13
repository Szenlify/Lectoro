const test = require("node:test");
const assert = require("node:assert/strict");

require("../shared/subtitle-service.js");
const SubtitleService = globalThis.SharedSubtitleService;

test("YouTube JSON3 clusters synchronize 1:1 by tStartMs and cap rolling windows cleanly", () => {
    // Exact sample from YouTube timedtext network responses provided by user
    const enJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 0,
                dDurationMs: 1258720,
                id: 1,
                wpWinPosId: 1,
                wsWinStyleId: 1,
            },
            {
                tStartMs: 719,
                dDurationMs: 3041,
                wWinId: 1,
                segs: [
                    { utf8: "If" },
                    { utf8: " he", tOffsetMs: 161 },
                    { utf8: " was", tOffsetMs: 321 },
                    { utf8: " prime", tOffsetMs: 480 },
                    { utf8: " minister", tOffsetMs: 720 },
                    { utf8: " for", tOffsetMs: 961 },
                    { utf8: " one", tOffsetMs: 1201 },
                    { utf8: " day,", tOffsetMs: 1361 },
                ],
            },
            {
                tStartMs: 2389,
                dDurationMs: 1371,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 2399,
                dDurationMs: 3121,
                wWinId: 1,
                segs: [
                    { utf8: "what" },
                    { utf8: " would", tOffsetMs: 161 },
                    { utf8: " you", tOffsetMs: 401 },
                    { utf8: " do?", tOffsetMs: 561 },
                ],
            },
            {
                tStartMs: 3750,
                dDurationMs: 1770,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 3760,
                dDurationMs: 4999,
                wWinId: 1,
                segs: [
                    { utf8: ">> I", isSpeakerChange: 1 },
                    { utf8: " would", tOffsetMs: 159 },
                    { utf8: " get", tOffsetMs: 400 },
                    { utf8: " rid", tOffsetMs: 480 },
                    { utf8: " of", tOffsetMs: 720 },
                    { utf8: " every", tOffsetMs: 880 },
                    { utf8: " single", tOffsetMs: 1120 },
                    { utf8: " [ __ ]", tOffsetMs: 1440 },
                ],
            },
            {
                tStartMs: 5510,
                dDurationMs: 3249,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 5520,
                dDurationMs: 3239,
                wWinId: 1,
                segs: [
                    { utf8: "legal" },
                    { utf8: " immigrant", tOffsetMs: 239 },
                ],
            },
        ],
    });

    const plJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 0,
                dDurationMs: 1258720,
                id: 1,
                wpWinPosId: 1,
                wsWinStyleId: 1,
            },
            {
                tStartMs: 719,
                dDurationMs: 3041,
                wWinId: 1,
                segs: [
                    { utf8: "Gdyby " },
                    { utf8: "był ", tOffsetMs: 272 },
                    { utf8: "premierem ", tOffsetMs: 544 },
                    { utf8: "przez ", tOffsetMs: 816 },
                    { utf8: "jeden ", tOffsetMs: 1088 },
                    { utf8: "dzień,", tOffsetMs: 1360 },
                ],
            },
            {
                tStartMs: 2389,
                dDurationMs: 1371,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 2399,
                dDurationMs: 3121,
                wWinId: 1,
                segs: [
                    { utf8: "co " },
                    { utf8: "byś ", tOffsetMs: 280 },
                    { utf8: "zrobił?", tOffsetMs: 560 },
                ],
            },
            {
                tStartMs: 3750,
                dDurationMs: 1770,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 3760,
                dDurationMs: 4999,
                wWinId: 1,
                segs: [
                    { utf8: "Pozbyłbym ", isSpeakerChange: 1 },
                    { utf8: "się ", tOffsetMs: 288 },
                    { utf8: "każdego, ", tOffsetMs: 576 },
                    { utf8: "[ ", tOffsetMs: 864 },
                    { utf8: "__ ", tOffsetMs: 1152 },
                    { utf8: "],", tOffsetMs: 1440 },
                ],
            },
            {
                tStartMs: 5510,
                dDurationMs: 3249,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 5520,
                dDurationMs: 3239,
                wWinId: 1,
                segs: [
                    { utf8: "legalnego " },
                    { utf8: "imigranta,", tOffsetMs: 239 },
                ],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });

    assert.equal(masterCues.length, 4, "4 text clusters parsed from EN");
    assert.equal(slaveCues.length, 4, "4 text clusters parsed from PL");

    // Check individual cluster boundaries: rolling windows must be capped to next cluster startTime
    assert.deepEqual(
        masterCues.map((c) => [c.startTime, c.endTime]),
        [
            [0.719, 2.399],
            [2.399, 3.76],
            [3.76, 5.52],
            [5.52, 8.759],
        ],
    );

    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 4);

    // Cluster 0: 0.719 - 2.399s
    assert.equal(aligned[0].startTime, 0.719);
    assert.equal(aligned[0].endTime, 2.399);
    assert.equal(aligned[0].text, "If he was prime minister for one day,");
    assert.equal(aligned[0].translation, "Gdyby był premierem przez jeden dzień,");

    // Cluster 1: 2.399 - 3.760s
    assert.equal(aligned[1].startTime, 2.399);
    assert.equal(aligned[1].endTime, 3.76);
    assert.equal(aligned[1].text, "what would you do?");
    assert.equal(aligned[1].translation, "co byś zrobił?");

    // Cluster 2: 3.760 - 5.520s
    assert.equal(aligned[2].startTime, 3.76);
    assert.equal(aligned[2].endTime, 5.52);
    assert.equal(aligned[2].text, "I would get rid of every single");
    assert.equal(aligned[2].translation, "Pozbyłbym się każdego,");

    // Cluster 3: 5.520 - 8.759s (CRITICAL: must NOT be empty!)
    assert.equal(aligned[3].startTime, 5.52);
    assert.equal(aligned[3].endTime, 8.759);
    assert.equal(aligned[3].text, "legal immigrant");
    assert.equal(aligned[3].translation, "legalnego imigranta,");
});

test("YouTube JSON3 clusters preserve pause / silence intervals when next cluster is after gap", () => {
    const json = JSON.stringify({
        events: [
            {
                tStartMs: 1000,
                dDurationMs: 2000, // ends at 3.0s
                segs: [{ utf8: "First phrase" }],
            },
            {
                tStartMs: 6000, // starts at 6.0s (3s pause)
                dDurationMs: 2500,
                segs: [{ utf8: "Second phrase after pause" }],
            },
        ],
    });

    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });
    assert.equal(cues.length, 2);
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3, "silence between 3s and 6s must not be bridged");
    assert.equal(cues[1].startTime, 6);
    assert.equal(cues[1].endTime, 8.5);
});

test("YouTube JSON3 re-attaches orphaned word tails (e.g. 'it.') to previous cluster when followed by capital letter", () => {
    const json = JSON.stringify({
        events: [
            {
                tStartMs: 11679,
                dDurationMs: 2880,
                segs: [
                    { utf8: "Today" },
                    { utf8: " I'll", tOffsetMs: 161 },
                    { utf8: " try", tOffsetMs: 401 },
                    { utf8: " to", tOffsetMs: 561 },
                    { utf8: " explain", tOffsetMs: 721 },
                    { utf8: " step", tOffsetMs: 960 },
                    { utf8: " by", tOffsetMs: 1201 },
                    { utf8: " step", tOffsetMs: 1361 },
                ],
            },
            {
                tStartMs: 13190,
                dDurationMs: 1369,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 13200,
                dDurationMs: 3520,
                segs: [
                    { utf8: "on" },
                    { utf8: " how", tOffsetMs: 80 },
                    { utf8: " to", tOffsetMs: 240 },
                    { utf8: " beat", tOffsetMs: 319 },
                    { utf8: " him.", tOffsetMs: 479 },
                    { utf8: " So", tOffsetMs: 720 },
                    { utf8: " let's", tOffsetMs: 880 },
                    { utf8: " get", tOffsetMs: 1040 },
                    { utf8: " into", tOffsetMs: 1120 },
                ],
            },
            {
                tStartMs: 14549,
                dDurationMs: 2171,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 14559,
                dDurationMs: 4001,
                segs: [
                    { utf8: "it.", acAsrConf: 0 },
                    { utf8: " Instantly", tOffsetMs: 881 },
                    { utf8: " going", tOffsetMs: 1361 },
                    { utf8: " to", tOffsetMs: 1441 },
                    { utf8: " go", tOffsetMs: 1521 },
                    { utf8: " here", tOffsetMs: 1681 },
                    { utf8: " for", tOffsetMs: 1841 },
                    { utf8: " a", tOffsetMs: 2001 },
                ],
            },
        ],
    });

    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });
    assert.equal(cues.length, 3);

    assert.equal(cues[0].text, "Today I'll try to explain step by step");
    assert.equal(cues[0].startTime, 11.679);
    assert.equal(cues[0].endTime, 13.2);

    // Cluster 1 must have 'it.' attached and end at 15.440s (14.559 + 0.881)
    assert.equal(cues[1].text, "on how to beat him. So let's get into it.");
    assert.equal(cues[1].startTime, 13.2);
    assert.equal(cues[1].endTime, 15.44);

    // Cluster 2 must start with 'Instantly' at 15.440s
    assert.equal(cues[2].text, "Instantly going to go here for a");
    assert.equal(cues[2].startTime, 15.44);
    assert.equal(cues[2].endTime, 18.56);
});

test("YouTube JSON3 pushes orphaned sentence heads forward to next cluster (period + capital letter)", () => {
    // Cluster 0 ends with "... beat him. So", where "So" is the orphan start of the next sentence
    // Cluster 1 continues "let's get into it."
    const json = JSON.stringify({
        events: [
            {
                tStartMs: 13200,
                dDurationMs: 2500,
                segs: [
                    { utf8: "on" },
                    { utf8: " how", tOffsetMs: 80 },
                    { utf8: " to", tOffsetMs: 240 },
                    { utf8: " beat", tOffsetMs: 319 },
                    { utf8: " him.", tOffsetMs: 479 },
                    { utf8: " So", tOffsetMs: 720 },
                ],
            },
            {
                tStartMs: 15700,
                dDurationMs: 2800,
                segs: [
                    { utf8: "let's" },
                    { utf8: " get", tOffsetMs: 160 },
                    { utf8: " into", tOffsetMs: 320 },
                    { utf8: " it.", tOffsetMs: 480 },
                ],
            },
        ],
    });

    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });
    assert.equal(cues.length, 2);

    // Cluster 0 must end at 13.920s (13200 + 720) with "on how to beat him."
    assert.equal(cues[0].text, "on how to beat him.");
    assert.equal(cues[0].startTime, 13.2);
    assert.equal(cues[0].endTime, 13.92);

    // Cluster 1 must start at 13.920s with "So let's get into it."
    assert.equal(cues[1].text, "So let's get into it.");
    assert.equal(cues[1].startTime, 13.92);
    assert.equal(cues[1].endTime, 18.5);
});

test("YouTube JSON3 re-attaches detached leading punctuation to previous cluster", () => {
    // Cluster 1 starts with a detached comma: ", but we couldn't wait."
    const json = JSON.stringify({
        events: [
            {
                tStartMs: 1000,
                dDurationMs: 2000,
                segs: [{ utf8: "We wanted to go" }],
            },
            {
                tStartMs: 3000,
                dDurationMs: 2500,
                segs: [{ utf8: ", but we couldn't wait." }],
            },
        ],
    });

    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });
    assert.equal(cues.length, 2);

    assert.equal(cues[0].text, "We wanted to go,");
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3);

    assert.equal(cues[1].text, "but we couldn't wait.");
    assert.equal(cues[1].startTime, 3);
    assert.equal(cues[1].endTime, 5.5);
});

test("YouTube JSON3 preserves abbreviations and decimal numbers without splitting", () => {
    const json = JSON.stringify({
        events: [
            {
                tStartMs: 1000,
                dDurationMs: 2000,
                segs: [{ utf8: "We visited Dr. Smith" }],
            },
            {
                tStartMs: 3000,
                dDurationMs: 2500,
                segs: [{ utf8: "yesterday afternoon." }],
            },
            {
                tStartMs: 6000,
                dDurationMs: 2000,
                segs: [{ utf8: "Version 1.5 is" }],
            },
            {
                tStartMs: 8000,
                dDurationMs: 2000,
                segs: [{ utf8: "now available." }],
            },
        ],
    });

    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });
    assert.equal(cues.length, 4);

    // Dr. Smith should not be split
    assert.equal(cues[0].text, "We visited Dr. Smith");
    assert.equal(cues[1].text, "yesterday afternoon.");

    // 1.5 should not be split
    assert.equal(cues[2].text, "Version 1.5 is");
    assert.equal(cues[3].text, "now available.");
});

test("cleanCueText normalizes spacing before punctuation and duplicate commas", () => {
    assert.equal(SubtitleService.cleanCueText("hello , world"), "hello, world");
    assert.equal(SubtitleService.cleanCueText("really ?"), "really?");
    assert.equal(SubtitleService.cleanCueText("yes !"), "yes!");
    assert.equal(SubtitleService.cleanCueText("done . Next"), "done. Next");
    assert.equal(SubtitleService.cleanCueText("item, , next"), "item, next");
    assert.equal(SubtitleService.cleanCueText("item,, next"), "item, next");
    assert.equal(SubtitleService.cleanCueText("end., next"), "end. next");
});

test("YouTube JSON3 preserves time cluster boundaries between Master and Slave without dragging multi-word clauses across clusters", () => {
    const enJson = JSON.stringify({
        events: [
            {
                tStartMs: 11679,
                dDurationMs: 2880,
                segs: [
                    { utf8: "Today" },
                    { utf8: " I'll", tOffsetMs: 161 },
                    { utf8: " try", tOffsetMs: 401 },
                    { utf8: " to", tOffsetMs: 561 },
                    { utf8: " explain", tOffsetMs: 721 },
                    { utf8: " step", tOffsetMs: 960 },
                    { utf8: " by", tOffsetMs: 1201 },
                    { utf8: " step", tOffsetMs: 1361 },
                ],
            },
            { tStartMs: 13190, dDurationMs: 1369, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 13200,
                dDurationMs: 3520,
                segs: [
                    { utf8: "on" },
                    { utf8: " how", tOffsetMs: 80 },
                    { utf8: " to", tOffsetMs: 240 },
                    { utf8: " beat", tOffsetMs: 319 },
                    { utf8: " him.", tOffsetMs: 479 },
                    { utf8: " So", tOffsetMs: 720 },
                    { utf8: " let's", tOffsetMs: 880 },
                    { utf8: " get", tOffsetMs: 1040 },
                    { utf8: " into", tOffsetMs: 1120 },
                ],
            },
            { tStartMs: 14549, dDurationMs: 2171, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 14559,
                dDurationMs: 4001,
                segs: [
                    { utf8: "it." },
                    { utf8: " Instantly", tOffsetMs: 881 },
                ],
            },
        ],
    });

    const plJson = JSON.stringify({
        events: [
            {
                tStartMs: 11679,
                dDurationMs: 2880,
                segs: [
                    { utf8: "Dzisiaj " },
                    { utf8: "postaram ", tOffsetMs: 226 },
                    { utf8: "się ", tOffsetMs: 452 },
                    { utf8: "krok ", tOffsetMs: 678 },
                    { utf8: "po ", tOffsetMs: 904 },
                    { utf8: "kroku ", tOffsetMs: 1130 },
                    { utf8: "wyjaśnić", tOffsetMs: 1356 },
                ],
            },
            { tStartMs: 13190, dDurationMs: 1369, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 13200,
                dDurationMs: 3520,
                segs: [
                    { utf8: "jak " },
                    { utf8: "go ", tOffsetMs: 186 },
                    { utf8: "pokonać.  ", tOffsetMs: 372 },
                    { utf8: "No ", tOffsetMs: 558 },
                    { utf8: "więc ", tOffsetMs: 744 },
                    { utf8: "do ", tOffsetMs: 930 },
                    { utf8: "rzeczy", tOffsetMs: 1116 },
                ],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    // Cluster 0 at 11679: MUST strictly stick to its own time cluster
    assert.equal(aligned[0].startTime, 11.679);
    assert.equal(aligned[0].endTime, 13.2);
    assert.equal(aligned[0].text, "Today I'll try to explain step by step");
    assert.equal(aligned[0].translation, "Dzisiaj postaram się krok po kroku wyjaśnić");

    // Cluster 1 at 13200: MUST have 'jak go pokonać. No więc do rzeczy'
    assert.equal(aligned[1].startTime, 13.2);
    assert.equal(aligned[1].endTime, 15.44);
    assert.equal(aligned[1].text, "on how to beat him. So let's get into it.");
    assert.equal(aligned[1].translation, "jak go pokonać. No więc do rzeczy");
});

test("YouTube JSON3 pushes sentence start ('50 take') forward when previous sentence completed with a period ('wait.')", () => {
    const enJson = JSON.stringify({
        events: [
            {
                tStartMs: 53680,
                dDurationMs: 5000,
                segs: [
                    { utf8: ">> 25", isSpeakerChange: 1 },
                    { utf8: " minus", tOffsetMs: 1080 },
                    { utf8: " 25", tOffsetMs: 1520 },
                    { utf8: " Wait,", tOffsetMs: 2000 },
                    { utf8: " wait,", tOffsetMs: 2160 },
                    { utf8: " oh", tOffsetMs: 2480 },
                    { utf8: " wait.", tOffsetMs: 2760 },
                    { utf8: " 50", tOffsetMs: 3560 },
                    { utf8: " take", tOffsetMs: 3880 },
                ],
            },
            { tStartMs: 57750, dDurationMs: 930, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 57760,
                dDurationMs: 2600,
                segs: [
                    { utf8: "away" },
                    { utf8: " 25.", tOffsetMs: 120 },
                ],
            },
            { tStartMs: 58670, dDurationMs: 1690, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 58680,
                dDurationMs: 2800,
                segs: [
                    { utf8: ">> 50", isSpeakerChange: 1 },
                    { utf8: " take", tOffsetMs: 360 },
                    { utf8: " away", tOffsetMs: 520 },
                    { utf8: " 25.", tOffsetMs: 640 },
                ],
            },
        ],
    });

    const plJson = JSON.stringify({
        events: [
            {
                tStartMs: 53680,
                dDurationMs: 5000,
                segs: [
                    { utf8: "25 ", isSpeakerChange: 1 },
                    { utf8: "minus ", tOffsetMs: 554 },
                    { utf8: "25 ", tOffsetMs: 1108 },
                    { utf8: "Poczekaj, ", tOffsetMs: 1662 },
                    { utf8: "poczekaj, ", tOffsetMs: 2216 },
                    { utf8: "ach, ", tOffsetMs: 2770 },
                    { utf8: "poczekaj.  ", tOffsetMs: 3324 },
                    { utf8: "50", tOffsetMs: 3878 },
                ],
            },
            { tStartMs: 57750, dDurationMs: 930, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 57760,
                dDurationMs: 2600,
                segs: [
                    { utf8: "odejmij " },
                    { utf8: "25.", tOffsetMs: 120 },
                ],
            },
            { tStartMs: 58670, dDurationMs: 1690, segs: [{ utf8: "\n" }] },
            {
                tStartMs: 58680,
                dDurationMs: 2800,
                segs: [
                    { utf8: "50 ", isSpeakerChange: 1 },
                    { utf8: "odejmij ", tOffsetMs: 320 },
                    { utf8: "25.", tOffsetMs: 640 },
                ],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    // Cluster 0: ends cleanly at 57.240s with completed sentence
    assert.equal(aligned[0].startTime, 53.68);
    assert.equal(aligned[0].endTime, 57.24);
    assert.equal(aligned[0].text, "25 minus 25 Wait, wait, oh wait.");
    assert.equal(aligned[0].translation, "25 minus 25 Poczekaj, poczekaj, ach, poczekaj.");

    // Cluster 1: starts at 57.240s with complete "50 take away 25."
    assert.equal(aligned[1].startTime, 57.24);
    assert.equal(aligned[1].endTime, 58.68);
    assert.equal(aligned[1].text, "50 take away 25.");
    assert.equal(aligned[1].translation, "50 odejmij 25.");

    // Cluster 2: speaker change at 58.680s
    assert.equal(aligned[2].startTime, 58.68);
    assert.equal(aligned[2].endTime, 61.48);
    assert.equal(aligned[2].text, "50 take away 25.");
    assert.equal(aligned[2].translation, "50 odejmij 25.");
});




