const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load } = require("./helpers");
const C = require("../shared/constants");
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
    for (const word of ["unknown", "pineapples", "123", "business", "constructor", "__proto__"]) {
        assert.equal(dictionary.lookup(word, pl), null, word);
    }
});

test("one lazy local file read per language; unknown words never request a remote service", async () => {
    const urls = [];
    const context = vm.createContext({
        LectoroConstants: C,
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
});
