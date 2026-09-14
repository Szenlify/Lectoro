const test = require("node:test");
const assert = require("node:assert/strict");
const SubtitleService = require("../shared/subtitle-service");

test("pairTwoClusters combines pairs of consecutive clusters like Language Reactor", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "I think", translation: "Myślę" },
        { startTime: 2.05, endTime: 3.2, text: "we should go.", translation: "że powinniśmy iść." },
        { startTime: 4.0, endTime: 5.0, text: "Wait for me", translation: "Poczekaj na mnie" },
        { startTime: 5.1, endTime: 6.0, text: "right here.", translation: "właśnie tutaj." },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 2);

    // First pair
    assert.equal(paired[0].startTime, 1.0);
    assert.equal(paired[0].endTime, 3.2);
    assert.equal(paired[0].text, "I think we should go.");
    assert.deepEqual(paired[0].lines, ["I think", "we should go."]);
    assert.equal(paired[0].translation, "Myślę\nże powinniśmy iść.");
    assert.equal(paired[0].isPairedCluster, true);

    // Second pair
    assert.equal(paired[1].startTime, 4.0);
    assert.equal(paired[1].endTime, 6.0);
    assert.equal(paired[1].text, "Wait for me right here.");
    assert.deepEqual(paired[1].lines, ["Wait for me", "right here."]);
    assert.equal(paired[1].translation, "Poczekaj na mnie\nwłaśnie tutaj.");
    assert.equal(paired[1].isPairedCluster, true);
});

test("pairTwoClusters displays very long clusters singly to avoid errors and overflow", () => {
    const cues = [
        // Very long cluster (11 words)
        { startTime: 1.0, endTime: 4.0, text: "One two three four five six seven eight nine ten eleven", translation: "Jeden dwa trzy..." },
        { startTime: 4.1, endTime: 5.0, text: "short line", translation: "krótka linia" },
        { startTime: 5.2, endTime: 6.0, text: "another line", translation: "inna linia" },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 2);

    // First cue displayed singly
    assert.equal(paired[0].startTime, 1.0);
    assert.equal(paired[0].endTime, 4.0);
    assert.equal(paired[0].text, "One two three four five six seven eight nine ten eleven");
    assert.equal(paired[0].isPairedCluster, undefined);

    // Remaining two cues paired
    assert.equal(paired[1].startTime, 4.1);
    assert.equal(paired[1].endTime, 6.0);
    assert.equal(paired[1].text, "short line another line");
    assert.equal(paired[1].isPairedCluster, true);
});

test("pairTwoClusters pairs cues across natural dialogue pauses (0.8s)", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "Hello there.", translation: "Cześć." },
        // Natural speech pause of 0.8s within dialogue
        { startTime: 2.8, endTime: 3.8, text: "How are you?", translation: "Jak się masz?" },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 1);
    assert.equal(paired[0].text, "Hello there. How are you?");
    assert.deepEqual(paired[0].lines, ["Hello there.", "How are you?"]);
    assert.equal(paired[0].translation, "Cześć.\nJak się masz?");
});

test("pairTwoClusters does not pair across prolonged scene change gaps (> 2.2s)", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "Hello there.", translation: "Cześć." },
        // Prolonged silence gap of 3.5s (scene change)
        { startTime: 5.5, endTime: 6.5, text: "How are you?", translation: "Jak się masz?" },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 2);
    assert.equal(paired[0].text, "Hello there.");
    assert.equal(paired[1].text, "How are you?");
});

test("pairTwoClusters preserves speaker changes within a pair", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "Where are you going?", translation: "Gdzie idziesz?" },
        { startTime: 2.05, endTime: 3.0, text: ">> To the store.", translation: ">> Do sklepu." },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 1);
    assert.deepEqual(paired[0].lines, ["Where are you going?", ">> To the store."]);
    assert.equal(paired[0].translation, "Gdzie idziesz?\n>> Do sklepu.");
});

test("pairTwoClusters handles odd number of cues cleanly", () => {
    const cues = [
        { startTime: 1.0, endTime: 2.0, text: "A", translation: "1" },
        { startTime: 2.05, endTime: 3.0, text: "B", translation: "2" },
        { startTime: 3.05, endTime: 4.0, text: "C", translation: "3" },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    assert.equal(paired.length, 2);
    assert.equal(paired[0].text, "A B");
    assert.equal(paired[1].text, "C");
});

test("long translations keep both languages on single clusters", () => {
    const long = "One two three four five six seven eight nine ten eleven";
    for (const index of [0, 1]) {
        const cues = ["A", "B", "C", "D"].map((text, i) => ({
            startTime: i, endTime: i + 1, text,
            translation: i === index ? long : text.toLowerCase(),
        }));
        const result = SubtitleService.pairTwoClusters(cues);
        const single = result.find((cue) => cue.text === cues[index].text);
        assert.equal(single.translation, long);
        assert.equal(single.isPairedCluster, undefined);
        assert.ok(result.some((cue) => cue.isPairedCluster));
        assert.equal(cues.length, 4);
        assert.equal(cues[0].isPairedCluster, undefined);
    }
});

test("combined translation length prevents oversized bilingual pairs", () => {
    const cues = [0, 1].map((i) => ({
        startTime: i, endTime: i + 1, text: "Short",
        translation: "one two three four five six seven eight",
    }));
    assert.equal(SubtitleService.pairTwoClusters(cues).length, 2);
});

test("reconcileCuesAtTerminalPunctuation pushes orphan head ('We'll') forward when translation ends at period", () => {
    // User scenario:
    // Prev: "collector or I could go for IE. We'll" / "kolekcjonerskim, albo mogę zdecydować się na IE."
    // Curr: "see. But now that I got my LDR, I should" / "Zobaczymy. Ale teraz, kiedy mam już swój związek na odległość, powinnam"
    const cues = [
        {
            startTime: 10.0,
            endTime: 12.5,
            text: "collector or I could go for IE. We'll",
            lines: ["collector or I could go for IE. We'll"],
            translation: "kolekcjonerskim, albo mogę zdecydować się na IE.",
        },
        {
            startTime: 12.5,
            endTime: 16.0,
            text: "see. But now that I got my LDR, I should",
            lines: ["see. But now that I got my LDR, I should"],
            translation: "Zobaczymy. Ale teraz, kiedy mam już swój związek na odległość, powinnam",
        },
    ];

    const reconciled = SubtitleService.reconcileCuesAtTerminalPunctuation(cues);
    assert.equal(reconciled[0].text, "collector or I could go for IE.");
    assert.deepEqual(reconciled[0].lines, ["collector or I could go for IE."]);
    assert.equal(reconciled[0].translation, "kolekcjonerskim, albo mogę zdecydować się na IE.");

    assert.equal(reconciled[1].text, "We'll see. But now that I got my LDR, I should");
    assert.deepEqual(reconciled[1].lines, ["We'll see. But now that I got my LDR, I should"]);
    assert.equal(reconciled[1].translation, "Zobaczymy. Ale teraz, kiedy mam już swój związek na odległość, powinnam");
});

test("reconcileCuesAtTerminalPunctuation pushes orphan translation forward when upper text ends at period", () => {
    const cues = [
        {
            startTime: 10.0,
            endTime: 12.5,
            text: "collector or I could go for IE.",
            lines: ["collector or I could go for IE."],
            translation: "kolekcjonerskim, albo mogę zdecydować się na IE. Zobaczymy",
        },
        {
            startTime: 12.5,
            endTime: 16.0,
            text: "We'll see. But now that I got my LDR, I should",
            lines: ["We'll see. But now that I got my LDR, I should"],
            translation: "Ale teraz, kiedy mam już swój związek na odległość, powinnam",
        },
    ];

    const reconciled = SubtitleService.reconcileCuesAtTerminalPunctuation(cues);
    assert.equal(reconciled[0].text, "collector or I could go for IE.");
    assert.equal(reconciled[0].translation, "kolekcjonerskim, albo mogę zdecydować się na IE.");

    assert.equal(reconciled[1].text, "We'll see. But now that I got my LDR, I should");
    assert.equal(reconciled[1].translation, "Zobaczymy Ale teraz, kiedy mam już swój związek na odległość, powinnam");
});

test("reconcileCuesAtTerminalPunctuation does not split on abbreviations or decimals", () => {
    const cues = [
        {
            startTime: 1.0,
            endTime: 3.0,
            text: "I met with Dr. Smith today",
            lines: ["I met with Dr. Smith today"],
            translation: "Spotkałem się z dr. Smithem dzisiaj",
        },
        {
            startTime: 3.2,
            endTime: 5.0,
            text: "and it cost 3.50 dollars.",
            lines: ["and it cost 3.50 dollars."],
            translation: "i to kosztowało 3.50 dolarów.",
        },
    ];

    const reconciled = SubtitleService.reconcileCuesAtTerminalPunctuation(cues);
    assert.equal(reconciled[0].text, "I met with Dr. Smith today");
    assert.equal(reconciled[1].text, "and it cost 3.50 dollars.");
});

test("pairTwoClusters does not attach incomplete sentence head to completed sentence", () => {
    const cues = [
        { startTime: 1.0, endTime: 3.0, text: "collector or I could go for IE.", translation: "kolekcjonerskim, albo mogę zdecydować się na IE." },
        { startTime: 3.1, endTime: 3.8, text: "We'll", translation: "" },
        { startTime: 3.9, endTime: 4.8, text: "see.", translation: "Zobaczymy." },
        { startTime: 5.0, endTime: 7.0, text: "But now that I got my LDR, I should", translation: "Ale teraz, kiedy mam już swój związek na odległość, powinnam" },
    ];

    const paired = SubtitleService.pairTwoClusters(cues);
    // Cluster 0 ends at period, so it is kept singly and not polluted with "We'll"
    assert.equal(paired[0].text, "collector or I could go for IE.");
    assert.equal(paired[0].translation, "kolekcjonerskim, albo mogę zdecydować się na IE.");

    // "We'll" pairs cleanly with "see."
    assert.equal(paired[1].text, "We'll see.");
    assert.equal(paired[1].translation, "Zobaczymy.");
});

