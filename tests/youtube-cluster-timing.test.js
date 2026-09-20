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

test("YouTube ASR (youtube-genereted-json.md): recalculates word duration and clusters without desync (e.g. '8 months ago, I' and 'Osiem miesięcy temu')", () => {
    // Exact events from docs/youtube-genereted-json.md (events 4, 5, 6)
    const enJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 6319,
                dDurationMs: 4240,
                wWinId: 1,
                segs: [
                    { utf8: "across", acAsrConf: 0 },
                    { utf8: " different", tOffsetMs: 401, acAsrConf: 0 },
                    { utf8: " scenes", tOffsetMs: 641, acAsrConf: 0 },
                    { utf8: " with", tOffsetMs: 1040, acAsrConf: 0 },
                    { utf8: " animation", tOffsetMs: 1281, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 8150,
                dDurationMs: 2409,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 8160,
                dDurationMs: 4240,
                wWinId: 1,
                segs: [
                    { utf8: "and", acAsrConf: 0 },
                    { utf8: " spoken", tOffsetMs: 240, acAsrConf: 0 },
                    { utf8: " dialogue.", tOffsetMs: 640, acAsrConf: 0 },
                    { utf8: " 8", tOffsetMs: 1439, acAsrConf: 0 },
                    { utf8: " months", tOffsetMs: 1600, acAsrConf: 0 },
                    { utf8: " ago,", tOffsetMs: 1840, acAsrConf: 0 },
                    { utf8: " I", tOffsetMs: 2160, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 10549,
                dDurationMs: 1851,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 10559,
                dDurationMs: 4160,
                wWinId: 1,
                segs: [
                    { utf8: "posted", acAsrConf: 0 },
                    { utf8: " a", tOffsetMs: 241, acAsrConf: 0 },
                    { utf8: " tutorial", tOffsetMs: 481, acAsrConf: 0 },
                    { utf8: " on", tOffsetMs: 881, acAsrConf: 0 },
                    { utf8: " making", tOffsetMs: 1120, acAsrConf: 0 },
                    { utf8: " AI", tOffsetMs: 1441, acAsrConf: 0 },
                ],
            },
        ],
    });

    const plJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 6319,
                dDurationMs: 4240,
                wWinId: 1,
                segs: [
                    { utf8: "w ", acAsrConf: 0 },
                    { utf8: "różnych ", tOffsetMs: 320, acAsrConf: 0 },
                    { utf8: "scenach ", tOffsetMs: 640, acAsrConf: 0 },
                    { utf8: "z ", tOffsetMs: 960, acAsrConf: 0 },
                    { utf8: "animacją", tOffsetMs: 1280, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 8150,
                dDurationMs: 2409,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 8160,
                dDurationMs: 4240,
                wWinId: 1,
                segs: [
                    { utf8: "i ", acAsrConf: 0 },
                    { utf8: "dialogami ", tOffsetMs: 432, acAsrConf: 0 },
                    { utf8: "mówionymi.  ", tOffsetMs: 864, acAsrConf: 0 },
                    { utf8: "Osiem ", tOffsetMs: 1296, acAsrConf: 0 },
                    { utf8: "miesięcy ", tOffsetMs: 1728, acAsrConf: 0 },
                    { utf8: "temu", tOffsetMs: 2160, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 10549,
                dDurationMs: 1851,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 10559,
                dDurationMs: 4160,
                wWinId: 1,
                segs: [
                    { utf8: "opublikowałem ", acAsrConf: 0 },
                    { utf8: "poradnik ", tOffsetMs: 360, acAsrConf: 0 },
                    { utf8: "na ", tOffsetMs: 720, acAsrConf: 0 },
                    { utf8: "temat ", tOffsetMs: 1080, acAsrConf: 0 },
                    { utf8: "tworzenia", tOffsetMs: 1440, acAsrConf: 0 },
                ],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 3);

    // Cue 0 (6.319s - 8.160s)
    assert.equal(aligned[0].startTime, 6.319);
    assert.equal(aligned[0].endTime, 8.16);
    assert.equal(aligned[0].text, "across different scenes with animation");
    assert.equal(aligned[0].translation, "w różnych scenach z animacją");

    // Cue 1 (8.160s - 9.599s): sentence completes with "dialogue." and "mówionymi."
    // MUST NOT have "8 months ago" left hanging!
    assert.equal(aligned[1].startTime, 8.16);
    assert.equal(aligned[1].endTime, 9.599);
    assert.equal(aligned[1].text, "and spoken dialogue.");
    assert.equal(aligned[1].translation, "i dialogami mówionymi.");

    // Cue 2 (9.599s - 14.719s): starts exactly with word "8" / "Osiem" at 9.599s
    // and continues into "posted a tutorial on making AI"
    assert.equal(aligned[2].startTime, 9.599);
    assert.equal(aligned[2].text, "8 months ago, I posted a tutorial on making AI");
    assert.equal(aligned[2].translation, "Osiem miesięcy temu opublikowałem poradnik na temat tworzenia");
});

test("YouTube Manual Subtitles (youtube.md): retains timed translation fragments without guessing sentence boundaries", () => {
    // Exact events from docs/youtube.md lines 62-79 & 349-366
    const enJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 24280,
                dDurationMs: 2720,
                segs: [{ utf8: "To have you in my arms" }],
            },
            {
                tStartMs: 27880,
                dDurationMs: 2080,
                segs: [{ utf8: "Is this what you needed" }],
            },
            {
                tStartMs: 31560,
                dDurationMs: 3320,
                segs: [{ utf8: "‘Cause I’ll find the faith in anything" }],
            },
        ],
    });

    const plJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 24280,
                dDurationMs: 2720,
                segs: [{ utf8: "By mieć cię w ramionach Czy to jest to" }],
            },
            {
                tStartMs: 27880,
                dDurationMs: 2080,
                segs: [{ utf8: "czego potrzebowałaś Bo" }],
            },
            {
                tStartMs: 31560,
                dDurationMs: 3320,
                segs: [{ utf8: "znajdę wiarę w czymkolwiek" }],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 3);

    assert.equal(aligned[0].startTime, 24.28);
    assert.equal(aligned[0].endTime, 27);
    assert.equal(aligned[0].text, "To have you in my arms");
    assert.equal(aligned[0].translation, "By mieć cię w ramionach Czy to jest to");

    assert.equal(aligned[1].startTime, 27.88);
    assert.equal(aligned[1].endTime, 29.96);
    assert.equal(aligned[1].text, "Is this what you needed");
    assert.equal(aligned[1].translation, "czego potrzebowałaś Bo");

    assert.equal(aligned[2].startTime, 31.56);
    assert.equal(aligned[2].endTime, 34.88);
    assert.equal(aligned[2].text, "‘Cause I’ll find the faith in anything");
    assert.equal(aligned[2].translation, "znajdę wiarę w czymkolwiek");
});

test("YouTube Manual Subtitles (youtube.md): keeps translated words with their original timed cue", () => {
    // Lines 92-102 & 379-389 from docs/youtube.md
    const enJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 42840,
                dDurationMs: 2960,
                segs: [{ utf8: "If the world ends tonight" }],
            },
            {
                tStartMs: 47040,
                dDurationMs: 2280,
                segs: [{ utf8: "You’ll be in my arms" }],
            },
            {
                tStartMs: 50320,
                dDurationMs: 2800,
                segs: [{ utf8: "We’ll be frozen in time" }],
            },
        ],
    });

    const plJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 42840,
                dDurationMs: 2960,
                segs: [{ utf8: "Jeśli świat skończy się dziś w nocy Będziesz" }],
            },
            {
                tStartMs: 47040,
                dDurationMs: 2280,
                segs: [{ utf8: "w moich ramionach" }],
            },
            {
                tStartMs: 50320,
                dDurationMs: 2800,
                segs: [{ utf8: "Będziemy zamrożeni w czasie" }],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 3);
    assert.equal(aligned[0].text, "If the world ends tonight");
    assert.equal(aligned[0].translation, "Jeśli świat skończy się dziś w nocy Będziesz");

    assert.equal(aligned[1].text, "You’ll be in my arms");
    assert.equal(aligned[1].translation, "w moich ramionach");

    assert.equal(aligned[2].text, "We’ll be frozen in time");
    assert.equal(aligned[2].translation, "Będziemy zamrożeni w czasie");
});

test("YouTube ASR (youtube-genereted-json.md): Events 1-3 cascade into natural sentences ('Storms pass. What matters is what we find afterward.', 'That's what we're building today.')", () => {
    const enJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 0,
                dDurationMs: 4880,
                wWinId: 1,
                segs: [
                    { utf8: "Storms", acAsrConf: 0 },
                    { utf8: " pass.", tOffsetMs: 1120, acAsrConf: 0 },
                    { utf8: " What", tOffsetMs: 1920, acAsrConf: 0 },
                    { utf8: " matters", tOffsetMs: 2240, acAsrConf: 0 },
                    { utf8: " is", tOffsetMs: 2560, acAsrConf: 0 },
                    { utf8: " what", tOffsetMs: 2800, acAsrConf: 0 },
                    { utf8: " we", tOffsetMs: 2960, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 3110,
                dDurationMs: 1770,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 3120,
                dDurationMs: 3199,
                wWinId: 1,
                segs: [
                    { utf8: "find", acAsrConf: 0 },
                    { utf8: " afterward.", tOffsetMs: 240, acAsrConf: 0 },
                    { utf8: " That's", tOffsetMs: 1120, acAsrConf: 0 },
                    { utf8: " what", tOffsetMs: 1360, acAsrConf: 0 },
                    { utf8: " we're", tOffsetMs: 1520, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 4870,
                dDurationMs: 1449,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 4880,
                dDurationMs: 3280,
                wWinId: 1,
                segs: [
                    { utf8: "building", acAsrConf: 0 },
                    { utf8: " today.", tOffsetMs: 240, acAsrConf: 0 },
                    { utf8: " The", tOffsetMs: 640, acAsrConf: 0 },
                    { utf8: " same", tOffsetMs: 800, acAsrConf: 0 },
                    { utf8: " characters", tOffsetMs: 1040, acAsrConf: 0 },
                ],
            },
        ],
    });

    const plJson = JSON.stringify({
        wireMagic: "pb3",
        events: [
            {
                tStartMs: 0,
                dDurationMs: 4880,
                wWinId: 1,
                segs: [
                    { utf8: "Burze ", acAsrConf: 0 },
                    { utf8: "przemijają.  ", tOffsetMs: 592, acAsrConf: 0 },
                    { utf8: "Ważne ", tOffsetMs: 1184, acAsrConf: 0 },
                    { utf8: "jest ", tOffsetMs: 1776, acAsrConf: 0 },
                    { utf8: "to, ", tOffsetMs: 2368, acAsrConf: 0 },
                    { utf8: "co", tOffsetMs: 2960, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 3110,
                dDurationMs: 1770,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 3120,
                dDurationMs: 3199,
                wWinId: 1,
                segs: [
                    { utf8: "znajdziemy ", acAsrConf: 0 },
                    { utf8: "później.  ", tOffsetMs: 506, acAsrConf: 0 },
                    { utf8: "To ", tOffsetMs: 1012, acAsrConf: 0 },
                    { utf8: "właśnie", tOffsetMs: 1518, acAsrConf: 0 },
                ],
            },
            {
                tStartMs: 4870,
                dDurationMs: 1449,
                wWinId: 1,
                aAppend: 1,
                segs: [{ utf8: "\n" }],
            },
            {
                tStartMs: 4880,
                dDurationMs: 3280,
                wWinId: 1,
                segs: [
                    { utf8: "budujemy ", acAsrConf: 0 },
                    { utf8: "dzisiaj.  ", tOffsetMs: 260, acAsrConf: 0 },
                    { utf8: "Te ", tOffsetMs: 520, acAsrConf: 0 },
                    { utf8: "same ", tOffsetMs: 780, acAsrConf: 0 },
                    { utf8: "postacie", tOffsetMs: 1040, acAsrConf: 0 },
                ],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 3);

    // Cue 0: Sentence 1 + 2 merged cleanly from 0.0s to 4.24s
    assert.equal(aligned[0].startTime, 0);
    assert.equal(aligned[0].endTime, 4.24);
    assert.equal(aligned[0].text, "Storms pass. What matters is what we find afterward.");
    assert.equal(aligned[0].translation, "Burze przemijają. Ważne jest to, co znajdziemy później.");

    // Cue 1: Sentence 3 runs from 4.24s to 5.52s
    assert.equal(aligned[1].startTime, 4.24);
    assert.equal(aligned[1].endTime, 5.52);
    assert.equal(aligned[1].text, "That's what we're building today.");
    assert.equal(aligned[1].translation, "To właśnie budujemy dzisiaj.");

    // Cue 2: Sentence 4 starts at 5.52s
    assert.equal(aligned[2].startTime, 5.52);
    assert.equal(aligned[2].endTime, 8.16);
    assert.equal(aligned[2].text, "The same characters");
    assert.equal(aligned[2].translation, "Te same postacie");
});







test("preserveCueBoundaries prevents independent sentence repairs from shifting bilingual cue text", () => {
    const texts = ["Więc Apple wkrótce to zrobi. Widzisz", "to była decyzja taktyczna."];
    const json = JSON.stringify({ events: texts.map((text, i) => ({
        tStartMs: i * 2000, dDurationMs: 2000, segs: [{ utf8: text }],
    })) });
    const cues = SubtitleService.parseTimedText(json, "", "", {
        preserveTiming: true, preserveCueBoundaries: true,
    });
    assert.deepEqual(cues.map((cue) => cue.text), texts);
    assert.deepEqual(cues.map((cue) => [cue.startTime, cue.endTime]), [[0, 2], [2, 4]]);
});

test("YouTube JSON3 repairs machine-translated bundled sentences followed by empty cues ('\\n')", () => {
    const enJson = JSON.stringify({
        events: [
            {
                tStartMs: 51760,
                dDurationMs: 1920,
                segs: [{ utf8: "Here since one and\nthe party ain’t done" }],
            },
            {
                tStartMs: 53680,
                dDurationMs: 1880,
                segs: [{ utf8: "So we still gon have\nsome fun now" }],
            },
        ],
    });

    const plJson = JSON.stringify({
        events: [
            {
                tStartMs: 51760,
                dDurationMs: 1920,
                segs: [{ utf8: "tu od rana, a\nimpreza się nie skończyła. Więc nadal będziemy się dobrze bawić." }],
            },
            {
                tStartMs: 53680,
                dDurationMs: 1880,
                segs: [{ utf8: "\n" }],
            },
        ],
    });

    const masterCues = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slaveCues = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(masterCues, slaveCues);

    assert.equal(aligned.length, 2);
    assert.equal(aligned[0].startTime, 51.76);
    assert.equal(aligned[0].endTime, 53.68);
    assert.equal(aligned[0].text, "Here since one and the party ain’t done");
    assert.equal(aligned[0].translation, "tu od rana, a impreza się nie skończyła.");

    assert.equal(aligned[1].startTime, 53.68);
    assert.equal(aligned[1].endTime, 55.56);
    assert.equal(aligned[1].text, "So we still gon have some fun now");
    assert.equal(aligned[1].translation, "Więc nadal będziemy się dobrze bawić.");
});

test("YouTube sentence alignment preserves individual timed cues for run-on speech/lyrics without terminal punctuation", () => {
    const enJson = JSON.stringify({
        events: [
            { tStartMs: 15879, dDurationMs: 3641, segs: [{ utf8: "I took a page out of your favorite book" }] },
            { tStartMs: 19520, dDurationMs: 3759, segs: [{ utf8: "you saw me last just by the way you look" }] },
            { tStartMs: 23279, dDurationMs: 3361, segs: [{ utf8: "Tau me a language that I never speak" }] },
        ],
    });
    const plJson = JSON.stringify({
        events: [
            { tStartMs: 15879, dDurationMs: 3641, segs: [{ utf8: "Wziąłem stronę z twojej ulubionej książki" }] },
            { tStartMs: 19520, dDurationMs: 3759, segs: [{ utf8: "Widziałaś mnie ostatnio, po prostu patrząc" }] },
            { tStartMs: 23279, dDurationMs: 3361, segs: [{ utf8: "Tau, język, którym nigdy nie mówię," }] },
        ],
    });

    const master = SubtitleService.parseTimedText(enJson, "", "", { preserveTiming: true });
    const slave = SubtitleService.parseTimedText(plJson, "", "", { preserveTiming: true });
    const aligned = SubtitleService.alignSlaveTrackToMaster(master, slave, { alignSentences: true });

    // Must NOT merge all three cues into one single cue
    assert.equal(aligned.length, 3);
    assert.equal(aligned[0].text, "I took a page out of your favorite book");
    assert.equal(aligned[0].translation, "Wziąłem stronę z twojej ulubionej książki");
    assert.equal(aligned[1].text, "you saw me last just by the way you look");
    assert.equal(aligned[1].translation, "Widziałaś mnie ostatnio, po prostu patrząc");
    assert.equal(aligned[2].text, "Tau me a language that I never speak");
    assert.equal(aligned[2].translation, "Tau, język, którym nigdy nie mówię,");
});

test("YouTube ASR: cascades sentence boundaries across rolling cues so cues end cleanly at periods", () => {
    const events = [
        {
            tStartMs: 1000,
            dDurationMs: 4000,
            segs: [
                { utf8: "against" },
                { utf8: " Darius", tOffsetMs: 400 },
                { utf8: " in", tOffsetMs: 800 },
                { utf8: " the", tOffsetMs: 1000 },
                { utf8: " top", tOffsetMs: 1200 },
                { utf8: " lane.", tOffsetMs: 1500 },
                { utf8: " One", tOffsetMs: 2500 },
                { utf8: " of", tOffsetMs: 2700 },
            ],
        },
        {
            tStartMs: 3800,
            dDurationMs: 100,
            aAppend: 1,
            segs: [{ utf8: "\n" }],
        },
        {
            tStartMs: 3850,
            dDurationMs: 4000,
            segs: [
                { utf8: "the" },
                { utf8: " hardest", tOffsetMs: 300 },
                { utf8: " matchups", tOffsetMs: 600 },
                { utf8: " for", tOffsetMs: 900 },
                { utf8: " mastery.", tOffsetMs: 1200 },
                { utf8: " Today", tOffsetMs: 2200 },
            ],
        },
        {
            tStartMs: 6100,
            dDurationMs: 3000,
            segs: [
                { utf8: "we" },
                { utf8: " are", tOffsetMs: 200 },
                { utf8: " playing.", tOffsetMs: 400 },
            ],
        },
    ];

    const json = JSON.stringify({ wireMagic: "pb3", events });
    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });

    assert.equal(cues.length, 3);
    assert.equal(cues[0].text, "against Darius in the top lane.");
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 3.5);

    assert.equal(cues[1].text, "One of the hardest matchups for mastery.");
    assert.equal(cues[1].startTime, 3.5);
    assert.equal(cues[1].endTime, 6.05);

    assert.equal(cues[2].text, "Today we are playing.");
    assert.equal(cues[2].startTime, 6.05);
    assert.equal(cues[2].endTime, 9.1);
});

test("YouTube ASR: pushes lowercase orphan head forward even when curr starts with uppercase word", () => {
    const events = [
        {
            tStartMs: 1000,
            dDurationMs: 3000,
            segs: [
                { utf8: "against" },
                { utf8: " Darius", tOffsetMs: 200 },
                { utf8: " in", tOffsetMs: 400 },
                { utf8: " the", tOffsetMs: 600 },
                { utf8: " top", tOffsetMs: 800 },
                { utf8: " lane.", tOffsetMs: 1000 },
                { utf8: " one", tOffsetMs: 1500 },
                { utf8: " of", tOffsetMs: 1700 },
            ],
        },
        {
            tStartMs: 2700,
            dDurationMs: 3000,
            segs: [
                { utf8: "Darius'" },
                { utf8: " hardest", tOffsetMs: 300 },
                { utf8: " matchups.", tOffsetMs: 600 },
            ],
        },
    ];

    const json = JSON.stringify({ wireMagic: "pb3", events });
    const cues = SubtitleService.parseTimedText(json, "", "", { preserveTiming: true });

    assert.equal(cues.length, 2);
    assert.equal(cues[0].text, "against Darius in the top lane.");
    assert.equal(cues[0].startTime, 1);
    assert.equal(cues[0].endTime, 2.5);

    assert.equal(cues[1].text, "one of Darius' hardest matchups.");
    assert.equal(cues[1].startTime, 2.5);
});


