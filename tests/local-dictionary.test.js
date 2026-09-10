const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../shared/utils");
const dictionary = require("../shared/local-dictionary");
// Engine fixtures are independent of downloadable dictionaries.
const pl = {
    apple: "fruit", book: "volume", play: "have fun", walk: "go on foot", run: "move fast",
    write: "put into words", make: "create", child: "young person", eat: "consume", business: "commerce",
    Monday: "first weekday", January: "first month", May: "fifth month", may: "might", you: "the reader",
    "give up": "stop trying", "look forward to": "anticipate",
    "don't judge a book by its cover": "do not judge appearances",
};

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
    for (const word of ["zzqvxx", "123", "constructor", "__proto__"]) {
        assert.equal(dictionary.lookup(word, pl), null, word);
    }
});

test("every fixture phrase is matched as a whole with its exact translation", () => {
    for (const [phrase, translated] of Object.entries(pl).filter(([key]) => key.includes(" "))) {
        const words = phrase.split(" ");
        const results = dictionary.lookupWordByWord(words, pl);
        assert.deepEqual(results[0], { translated, length: words.length }, phrase);
        assert.ok(results.slice(1).every((value) => value === null), phrase);
    }
});

test("phrases use inflections, possessive slots, curly apostrophes and longest matches", () => {
    // Stable engine fixtures: user-editable dictionaries may add exact inflected phrases.
    const phrases = {
        "give up": "poddać się", "look forward to": "wyczekiwać", "take care of": "opiekować się",
        "run out of": "wyczerpać", "pull someone's leg": "żartować", "lose one's touch": "stracić wprawę",
        "don't judge a book by its cover": "nie oceniaj po okładce",
    };
    for (const [text, key] of [
        ["gave up", "give up"], ["looking forward to", "look forward to"],
        ["took care of", "take care of"], ["ran out of", "run out of"],
        ["pulled my leg", "pull someone's leg"], ["lost her touch", "lose one's touch"],
        ["don’t judge a book by its cover", "don't judge a book by its cover"],
    ]) {
        assert.equal(dictionary.lookupWordByWord(text.split(" "), phrases)[0].translated, phrases[key], text);
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
    assert.equal(dictionary.lookup("you", pl), pl.you);
    assert.deepEqual(dictionary.lookupWordByWord(["you"], { key: "znaczenie" }, { key: "you" }),
        [{ translated: "znaczenie", length: 1 }]);
});
