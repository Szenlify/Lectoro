const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const dictionary = require("../shared/local-dictionary");
const pl = require("../dictionaries/pl.json");

test("every supported language contains the starter entries and permits new user entries", () => {
    const directory = path.join(__dirname, "../dictionaries");
    const files = fs.readdirSync(directory);
    for (const language of Object.keys(C.SUPPORTED_LANGUAGES)) {
        assert.ok(files.includes(`${language}.json`), language);
        const entries = JSON.parse(fs.readFileSync(path.join(directory, `${language}.json`), "utf8"));
        assert.ok(Object.keys(entries).length >= 20, language);
        for (const key of "apple book cat dog house water food friend school work play walk run read write eat drink make happy child".split(" ")) {
            assert.ok(Object.hasOwn(entries, key), `${language}:${key}`);
        }
        assert.ok(Object.values(entries).every((value) => typeof value === "string" && value.trim()));
    }
});

test("language registry, settings and dictionary files contain the supported languages", () => {
    const expected = "en ja de ko fr nl he pl es it cs pt".split(" ");
    assert.deepEqual(Object.keys(C.SUPPORTED_LANGUAGES).sort(), [...expected].sort());
    const files = fs.readdirSync(path.join(__dirname, "../dictionaries")).filter((file) => file.endsWith(".json"));
    assert.deepEqual(files.sort(), expected.map((code) => `${code}.json`).sort());
    const html = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
    const select = html.match(/<select id="targetLang"[^>]*>([\s\S]*?)<\/select>/)[1];
    assert.deepEqual(Array.from(select.matchAll(/<option value="([^"]+)"/g), (match) => match[1]), expected);
});

test("English inflections resolve only to existing entries, with exact matches taking precedence", () => {
    for (const [word, lemma] of Object.entries({
        "“APPLES!”": "apple", "apple’s": "apple", books: "book", playing: "play",
        played: "play", walked: "walk", walking: "walk", running: "run", ran: "run",
        writing: "write", written: "write", making: "make", children: "child", eaten: "eat",
    })) assert.equal(dictionary.lookup(word, pl), pl[lemma], word);
    const extra = { study: "uczyć się", box: "pudełko", stop: "zatrzymać", die: "umierać", class: "klasa" };
    for (const [word, lemma] of Object.entries({ studies: "study", studied: "study", boxes: "box", stopped: "stop", dying: "die", classes: "class" })) {
        assert.equal(dictionary.lookup(word, extra), extra[lemma], word);
    }
    assert.equal(dictionary.lookup("running", { ...pl, running: "bieganie" }), "bieganie");
    assert.equal(dictionary.lookup("business", pl), pl.business);
    for (const word of ["unknown", "pineapples", "123", "constructor", "__proto__"]) {
        assert.equal(dictionary.lookup(word, pl), null, word);
    }
});

test("one lazy local file read per language; unknown words never request a remote service", async () => {
    const urls = [];
    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        chrome: { runtime: { getURL: (file) => `chrome-extension://test/${file}` } },
        fetch: async (url) => {
            urls.push(url);
            assert.ok(url.startsWith("chrome-extension://test/dictionaries/"));
            return { ok: true, json: async () => pl };
        },
    });
    load(context, "shared/local-dictionary.js");
    const service = context.LocalDictionary;
    const result = await Promise.all([
        service.lookupWords(["apples", "missing"], "pl", "en-US"),
        service.lookupWords(["running"], "pl"),
    ]);
    assert.deepEqual(Array.from(result[0]), ["jabłko", null]);
    assert.equal(urls.length, 1);
    assert.deepEqual(Array.from(await service.lookupWords(["jabłko"], "pl", "pl")), ["jabłko"]);
    assert.equal(urls.length, 1);
    await assert.rejects(service.lookupWords(["apple".repeat(100)], "pl"));
    const grouped = await service.lookupWords(["you", "gave", "up"], "pl", "en", { wordByWord: true });
    assert.equal(grouped[0], null);
    assert.equal(grouped[1].translated, pl["give up"]);
    assert.equal(grouped[1].length, 2);
    assert.equal(grouped[2], null);
    assert.equal(urls.length, 1);
});

test("every Polish phrase is matched as a whole with its exact JSON translation", () => {
    for (const [phrase, translated] of Object.entries(pl).filter(([key]) => key.includes(" "))) {
        const words = phrase.split(" ");
        const results = dictionary.lookupWordByWord(words, pl);
        assert.deepEqual(results[0], { translated, length: words.length }, phrase);
        assert.ok(results.slice(1).every((value) => value === null), phrase);
    }
});

test("phrases use inflections, possessive slots, curly apostrophes and longest matches", () => {
    for (const [text, key] of [
        ["gave up", "give up"], ["looking forward to", "look forward to"],
        ["took care of", "take care of"], ["ran out of", "run out of"],
        ["pulled my leg", "pull someone's leg"], ["lost her touch", "lose one's touch"],
        ["don’t judge a book by its cover", "don't judge a book by its cover"],
    ]) {
        assert.equal(dictionary.lookupWordByWord(text.split(" "), pl)[0].translated, pl[key], text);
    }
    const result = dictionary.lookupWordByWord(["look", "forward", "to"], {
        look: "patrzeć", "look forward": "krótsze", "look forward to": "dłuższe",
    });
    assert.deepEqual(result, [{ translated: "dłuższe", length: 3 }, null, null]);
    assert.notEqual(dictionary.lookupWordByWord(["give.", "Up"], pl)[0]?.translated, pl["give up"]);
    assert.notEqual(dictionary.lookupWordByWord(["give,", "up"], pl)[0]?.translated, pl["give up"]);
});

test("case normalization finds capitalized JSON keys while preserving exact meanings", () => {
    assert.equal(dictionary.lookup("MONDAY!", pl), pl.Monday);
    assert.equal(dictionary.lookup("january", pl), pl.January);
    assert.equal(dictionary.lookup("May", pl), pl.May);
    assert.equal(dictionary.lookup("may", pl), pl.may);
    assert.equal(dictionary.lookup("don’t judge a book by its cover", pl), pl["don't judge a book by its cover"]);
});

test("simple English words and contractions are skipped only in automatic word-by-word", () => {
    for (const word of ["YOU!", "are", "we", "I", "him", "You’re", "we’ve", "don't", "isn’t", "OK"]) {
        assert.equal(U.isSimpleWord(word), true, word);
        assert.deepEqual(dictionary.lookupWordByWord([word], pl), [null], word);
    }
    for (const word of ["important", "apple’s", "look forward to", "we are"]) {
        assert.equal(U.isSimpleWord(word), false, word);
    }
    assert.equal(dictionary.lookup("you", pl), "ty");
    assert.deepEqual(dictionary.lookupWordByWord(["you"], { key: "znaczenie" }, { key: "you" }),
        [{ translated: "znaczenie", length: 1 }]);
});
