const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { prepare, validateEntry, validateResult, handleLiveTranslation, translationError } = require("./live-translation");

const entry = {
    languageValidation: 1,
    t: "porzucić coś",
    d: { s: "To leave something behind.", t: "Zostawić coś za sobą." },
    s: ["desert"],
    e: [
        { s: "They abandon the house.", t: "Porzucają dom." },
        { s: "Do not abandon us.", t: "Nie porzucaj nas." },
        { s: "We abandon the plan.", t: "Porzucamy plan." },
    ],
};
const body = { kind: "word", text: "abandon", sourceLang: "en", targetLang: "pl" };
const phraseKey = (source) => `dictionaries/phrase/en-pl/${createHash("sha256").update(source).digest("hex")}.json`;

function response(data) {
    return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(data) }] } }] };
}

function fixture() {
    const records = new Map();
    const objects = new Map();
    let transactions = Promise.resolve();
    const count = { reserved: 0, refunded: 0, generated: 0, reads: 0, writes: 0 };
    const deps = {
        uid: "u1",
        usage: { used: 0, limit: 10 },
        db: {
            collection: () => ({ doc: key => key }),
            runTransaction: fn => {
                const task = transactions.then(() => fn({
                    get: async key => ({ data: () => records.get(key) }),
                    set: (key, value) => records.set(key, value),
                    delete: key => records.delete(key),
                }));
                transactions = task.catch(() => {});
                return task;
            },
        },
        read: async key => { count.reads++; return objects.get(key); },
        write: async (key, value) => { count.writes++; objects.set(key, value); },
        reserve: async () => { count.reserved++; return { used: count.reserved, limit: 10 }; },
        rollback: async () => { count.refunded++; },
        generate: async payload => {
            count.generated++;
            if (payload.generationConfig.responseSchema.required.includes("valid")) {
                return response({ valid: true, entry });
            }
            if (payload.generationConfig.responseSchema.required.includes("phrases")) {
                return response({ t: "Porzucili dom.", phrases: [] });
            }
            return response(entry);
        },
    };
    return { deps, count, objects, records };
}

test("full sentence uses one AI call, stores only {t}, and seeds reusable phrases", async () => {
    const { deps, count, objects } = fixture();
    deps.generate = async payload => {
        count.generated++;
        assert.deepEqual(payload.generationConfig.responseSchema.required, ["t"]);
        return response({
            t: "Wstań teraz.",
            phrases: [
                { s: "Get up", t: "wstań" },
                { s: "get up", t: "duplikat" },
                { s: "now", t: "teraz" },
            ],
        });
    };

    const request = { ...body, kind: "sentence", text: "Get up now." };
    const result = await handleLiveTranslation(request, deps);
    const key = prepare(request, "u1").key;

    assert.deepEqual(result.result, { t: "Wstań teraz." });
    assert.deepEqual(objects.get(key), { t: "Wstań teraz." }, "translation cache stays lightweight");
    assert.deepEqual(objects.get(phraseKey("get up")), { "get up": { t: "wstań" } });
    assert.equal(count.generated, 1, "sentence+phrases use one AI generation call");
    assert.equal(count.reserved, 1);
});

test("cached sentence is returned before quota and never regenerates phrases", async () => {
    const { deps, count, objects } = fixture();
    const request = { ...body, kind: "sentence", text: "Get up now." };
    objects.set(prepare(request, "u1").key, {
        t: "Wstań teraz.", phrases: [{ start: 0, length: 2, t: "legacy" }], tokens: ["Get", "up"], phraseAnalysis: 2,
    });
    deps.reserve = async () => { throw new Error("No quota left"); };
    deps.generate = async () => { throw new Error("AI must not run"); };

    const result = await handleLiveTranslation(request, deps);
    assert.deepEqual(result.result, { t: "Wstań teraz." });
    assert.equal(result.cached, true);
    assert.equal(count.reserved, 0);
});

test("Word-by-word segments only read dictionaries/phrase and never reserve or generate AI", async () => {
    const { deps, count, objects } = fixture();
    objects.set(phraseKey("get up"), { "get up": { t: "wstać" } });
    objects.set(phraseKey("up now"), { "up now": { t: "teraz w górę" } });
    deps.reserve = async () => { throw new Error("segments must not reserve"); };
    deps.generate = async () => { throw new Error("segments must not generate"); };

    const request = { ...body, kind: "segments", text: "Get up now", words: ["Get", "up", "now"] };
    const result = await handleLiveTranslation(request, deps);

    assert.equal(result.result.phrases.length, 1, "longest non-overlapping stored phrase wins");
    assert.deepEqual(result.result.phrases[0], { start: 0, length: 2, source: "get up", t: "wstać" });
    assert.equal(count.reserved, 0);
    assert.equal(count.generated, 0);
    assert.equal(count.writes, 0);
});


test("Word-by-word finds CAN'T GET UP and CAN’T GET UP through the same stored phrase hash", async () => {
    const expectedHash = "4ec1cdd6a186d7baaf1c6bc5fbe457058dc75beebcccf1defc676c00bdb87bf9";
    for (const apostropheVariant of ["CAN’T", "CAN'T"]) {
        const { deps, count, objects } = fixture();
        const storedKey = `dictionaries/phrase/en-pl/${expectedHash}.json`;
        objects.set(storedKey, { "can’t get up": { t: "nie mogę wstać" } });
        deps.reserve = async () => { throw new Error("segments must not reserve AI"); };
        deps.generate = async () => { throw new Error("segments must not generate AI"); };

        const words = ["I’VE", "HAD", "MY", "SHARE", "OF", "MONDAY", "MORNINGS", "WHEN", "I", apostropheVariant, "GET", "UP"];
        const request = { ...body, kind: "segments", text: words.join(" "), words };
        const result = await handleLiveTranslation(request, deps);

        assert.deepEqual(result.result.phrases, [{
            start: 9, length: 3, source: "can’t get up", t: "nie mogę wstać",
        }]);
        assert.equal(count.reserved, 0);
        assert.equal(count.generated, 0);
        assert.equal(count.writes, 0);
    }
});

test("Word-by-word phrase lookup is best-effort when R2 reads fail", async () => {
    const { deps, count } = fixture();
    deps.read = async () => { count.reads++; throw new Error("R2 temporarily unavailable"); };
    deps.generate = async () => { throw new Error("AI must not run"); };
    const request = { ...body, kind: "segments", text: "Get up now", words: ["Get", "up", "now"] };
    const result = await handleLiveTranslation(request, deps);
    assert.deepEqual(result.result.phrases, []);
    assert.equal(result.result.t, "");
    assert.equal(count.reserved, 0);
});

test("phrase lookup is bounded for long subtitles", async () => {
    const { deps, count } = fixture();
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`);
    await handleLiveTranslation({ ...body, kind: "segments", text: words.join(" "), words }, deps);
    assert.ok(count.reads <= 24, `expected <= 24 bounded phrase reads, got ${count.reads}`);
    assert.equal(count.generated, 0);
});

test("bad phrase items never hide a valid full-sentence translation", async () => {
    const { deps, objects } = fixture();
    deps.generate = async () => response({
        t: "Załamuję się.",
        phrases: [
            { s: "come undone", t: "COME UNDONE!" },
            { s: "I", t: "ja" },
            { s: "come undone", t: "załamać się" },
        ],
    });
    const request = { ...body, kind: "sentence", text: "I come undone." };
    const result = await handleLiveTranslation(request, deps);
    assert.deepEqual(result.result, { t: "Załamuję się." });
    assert.deepEqual(objects.get(prepare(request, "u1").key), { t: "Załamuję się." });
    assert.deepEqual(objects.get(phraseKey("come undone")), { "come undone": { t: "załamać się" } });
});

test("phrase storage failure does not replace a valid sentence with an error", async () => {
    const { deps, objects } = fixture();
    const originalWrite = deps.write;
    deps.generate = async () => response({ t: "Wstań.", phrases: [{ s: "get up", t: "wstać" }] });
    deps.write = async (key, value) => {
        if (key.startsWith("dictionaries/phrase/")) throw new Error("Phrase storage unavailable");
        return originalWrite(key, value);
    };
    const request = { ...body, kind: "sentence", text: "Get up." };
    const result = await handleLiveTranslation(request, deps);
    assert.deepEqual(result.result, { t: "Wstań." });
    assert.equal(result.storageWarning, true);
    assert.deepEqual(objects.get(prepare(request, "u1").key), { t: "Wstań." });
});

test("sentence cache write failure still returns the generated translation", async () => {
    const { deps, count } = fixture();
    deps.generate = async () => { count.generated++; return response({ t: "Wstań.", phrases: [] }); };
    deps.write = async () => { throw new Error("R2 unavailable"); };
    const result = await handleLiveTranslation({ ...body, kind: "sentence", text: "Get up." }, deps);
    assert.deepEqual(result.result, { t: "Wstań." });
    assert.equal(result.storageWarning, true);
    assert.equal(count.refunded, 0, "user received the generated result, so usage stays consumed");
});

test("generation failure falls back to a sentence that appeared in the shared DB", async () => {
    const { deps, count } = fixture();
    const request = { ...body, kind: "sentence", text: "Get up." };
    const key = prepare(request, "u1").key;
    let keyReads = 0;
    deps.read = async readKey => {
        if (readKey !== key) return undefined;
        keyReads++;
        if (keyReads >= 3) return { t: "Wstań z bazy." };
        return undefined;
    };
    deps.generate = async () => { count.generated++; throw new Error("AI unavailable"); };
    const result = await handleLiveTranslation(request, deps);
    assert.deepEqual(result.result, { t: "Wstań z bazy." });
    assert.equal(result.fallback, true);
    assert.equal(count.refunded, 1);
});

test("segments validation keeps phrase spans compatible with the client", () => {
    const request = { ...body, kind: "segments", text: "Please take off now", words: ["Please", "take", "off", "now"] };
    const job = prepare(request, "u1");
    assert.deepEqual(validateResult(job, { phrases: [{ start: 1, length: 2, t: "wystartować" }] }).phrases[0], {
        start: 1, length: 2, source: "take off", t: "wystartować",
    });
    assert.throws(() => validateResult(job, { phrases: [{ start: -1, length: 2, t: "x" }] }));
});

test("word dictionary behavior remains case-insensitive with one checked generation", async () => {
    const { deps, count, objects } = fixture();
    for (const word of ["abandon", "ABANDON", "AbAnDoN"]) {
        const result = await handleLiveTranslation({ ...body, text: word }, deps);
        assert.deepEqual(result.result, { abandon: entry });
    }
    assert.equal(objects.size, 1);
    assert.equal(count.reserved, 1);
    assert.equal(count.generated, 1, "one checked response for a new dictionary word");
});

test("legacy unverified word entry is repaired with one review", async () => {
    const { deps, count, objects } = fixture();
    const request = { ...body, text: "Polish" };
    const key = prepare(request, "u1").key;
    const bad = {
        ...entry,
        t: "Polish language",
        d: { s: "The Slavic language spoken in Poland.", t: "Język słowiański używany w Polsce." },
        e: [
            { s: "She speaks Polish well.", t: "Dobrze mówi po polsku." },
            { s: "I am learning Polish.", t: "Uczę się polskiego." },
            { s: "This is a Polish book.", t: "To jest polska książka." },
        ],
    };
    delete bad.languageValidation;
    objects.set(key, { polish: bad });
    const good = { ...bad, t: "język polski" };
    deps.generate = async payload => {
        count.generated++;
        assert.ok(payload.generationConfig.responseSchema.required.includes("valid"));
        return response({ valid: true, entry: good });
    };
    const result = await handleLiveTranslation(request, deps);
    assert.equal(result.result.polish.t, "język polski");
    assert.equal(count.generated, 1);
    assert.equal(objects.get(key).polish.languageValidation, 1);
});

test("failed word review refunds usage and saves nothing", async () => {
    const { deps, count, objects } = fixture();
    deps.generate = async payload => response(
        payload.generationConfig.responseSchema.required.includes("valid")
            ? { valid: false, entry: null }
            : entry,
    );
    await assert.rejects(handleLiveTranslation(body, deps), /verify/);
    assert.equal(count.refunded, 1);
    assert.equal(objects.size, 0);
});

test("concurrent users cannot generate the same word twice", async () => {
    const { deps, count } = fixture();
    let release;
    let started;
    const waiting = new Promise(resolve => { started = resolve; });
    const original = deps.generate;
    deps.generate = async payload => {
        started();
        await new Promise(resolve => { release = resolve; });
        return original(payload);
    };
    const first = handleLiveTranslation(body, deps);
    await waiting;
    await assert.rejects(handleLiveTranslation(body, { ...deps, uid: "u2" }), { code: "TRANSLATION_PENDING" });
    release();
    await first;
    assert.equal(count.reserved, 1);
});

test("200 source characters are cached; 201 bypass translation R2 and shared lock", async () => {
    for (const length of [200, 201]) {
        const { deps, count, objects } = fixture();
        deps.generate = async payload => {
            count.generated++;
            if (length > 200) {
                assert.deepEqual(Object.keys(payload.generationConfig.responseSchema.properties), ["t"], "uncached text never requests unused phrases");
            }
            return response({ t: "z".repeat(250), phrases: [] });
        };
        if (length > 200) {
            deps.read = deps.write = async () => { throw new Error("Long text must not use R2"); };
            deps.db = { collection: () => { throw new Error("Long text must not create a cache lock"); } };
        }
        const request = { ...body, kind: "sentence", text: "a".repeat(length) };
        const first = await handleLiveTranslation(request, deps);
        const second = await handleLiveTranslation(request, deps);
        assert.equal(first.result.t.length, 250);
        assert.equal(second.cached, length === 200);
        assert.equal(objects.size, length === 200 ? 1 : 0);
        assert.equal(count.generated, length === 200 ? 1 : 2);
    }
});

test("R2 only receives phrase spans actually present as complete words in the source", async () => {
    const cases = [
        ["They take off at noon.", "take off", "wystartować", true],
        ["They take it off.", "take off", "zdjąć", false],
        ["Take. Off we go.", "take off", "wystartować", false],
        ["Retake offcuts.", "take off", "wystartować", false],
        ["They stay home.", "give up", "poddać się", false],
        ["She's playing devil's advocate.", "devil’s advocate", "adwokat diabła", true],
        ["GET\tUP!", "get up", "wstać", true],
        ["We leave at the drop of a hat.", "at the drop of a hat", "bez wahania", false],
        ["Tout à coup, il part.", "tout à coup", "nagle", true, "fr"],
    ];
    for (const [input, source, translated, stored, sourceLang = "en"] of cases) {
        const { deps, count, objects } = fixture();
        deps.generate = async () => response({ t: "Poprawne tłumaczenie.", phrases: [{ s: source, t: translated, explanation: "discard this" }] });
        const request = { ...body, kind: "sentence", text: input, sourceLang };
        const result = await handleLiveTranslation(request, deps);
        assert.deepEqual(result.result, { t: "Poprawne tłumaczenie." });
        const phraseObjects = [...objects.entries()].filter(([key]) => key.startsWith("dictionaries/phrase/"));
        assert.equal(phraseObjects.length, stored ? 1 : 0, input);
        assert.equal(count.writes, stored ? 2 : 1, input);
        if (stored) {
            assert.deepEqual(phraseObjects[0][1], { [source]: { t: translated } });
            assert.ok(phraseObjects[0][0].startsWith(`dictionaries/phrase/${sourceLang}-pl/`));
        }
    }
});

test("a checked dictionary response is validated and stripped before any R2 write", async () => {
    for (const invalid of [false, true]) {
        const { deps, count, objects } = fixture();
        deps.generate = async payload => {
            count.generated++;
            assert.deepEqual(payload.generationConfig.responseSchema.required, ["valid", "entry"]);
            assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget, 0);
            return response({ valid: true, entry: { ...entry, e: invalid ? [] : entry.e, explanation: "unused" }, reason: "unused" });
        };
        if (invalid) {
            await assert.rejects(handleLiveTranslation(body, deps), /Invalid generated dictionary entry/);
            assert.equal(objects.size, 0);
            assert.equal(count.refunded, 1);
        } else {
            const result = await handleLiveTranslation(body, deps);
            assert.deepEqual(result.result, { abandon: entry });
            assert.deepEqual(objects.get(prepare(body, "u1").key), { abandon: entry });
            assert.equal(count.refunded, 0);
        }
        assert.equal(count.generated, 1);
    }
});

test("overlapping phrase variants never create extra R2 objects", async () => {
    const { deps, count, objects } = fixture();
    deps.generate = async () => response({
        t: "Nie trać nadziei i wstań.",
        phrases: [
            { s: "give up", t: "poddać się" },
            { s: "give up hope", t: "stracić nadzieję" },
            { s: "up hope", t: "nadzieja" },
            { s: "get up", t: "wstać" },
        ],
    });
    await handleLiveTranslation({ ...body, kind: "sentence", text: "Don't give up hope and get up." }, deps);
    assert.deepEqual(objects.get(phraseKey("give up")), { "give up": { t: "poddać się" } });
    assert.deepEqual(objects.get(phraseKey("get up")), { "get up": { t: "wstać" } });
    assert.equal(objects.has(phraseKey("give up hope")), false);
    assert.equal(objects.has(phraseKey("up hope")), false);
    assert.equal(count.writes, 3, "one sentence and two non-overlapping expressions");
});

test("paths remain shared, language-pair isolated, and translations path is unchanged", () => {
    assert.equal(prepare(body, "a").key, prepare(body, "b").key);
    assert.equal(prepare({ ...body, text: "Abandon" }, "a").key, prepare(body, "a").key);
    assert.notEqual(prepare(body, "a").key, prepare({ ...body, targetLang: "de" }, "a").key);
    assert.match(prepare(body, "a").key, /^dictionaries\/live\/en-pl\/[a-f0-9]{64}\.json$/);
    assert.match(prepare({ ...body, kind: "sentence" }, "a").key, /^dictionaries\/translations\/en-pl\/[a-f0-9]{64}\.json$/);
    assert.equal(validateEntry(entry).t, "porzucić coś");
});

test("public errors still hide provider details and identify failure stages", () => {
    assert.equal(translationError({ name: "TimeoutError" }).code, "TRANSLATION_TIMEOUT");
    assert.equal(translationError({ $metadata: { httpStatusCode: 412 } }).code, "TRANSLATION_PENDING");
    assert.equal(translationError({ status: 429 }).code, "RATE_LIMITED");
    for (const stage of ["storage", "cache", "generation", "verification"]) {
        const result = translationError({ stage, message: "private provider details" });
        assert.ok(result.code.includes(stage.toUpperCase()));
        assert.ok(!result.error.includes("private provider details"));
    }
});

test("dictionary schema orders definition d before translation t, and pronoun i gets strict guardrails", () => {
    const jobI = prepare({ kind: "word", text: "i", sourceLang: "en", targetLang: "pl" }, "u1");
    assert.deepEqual(Object.keys(jobI.schema.properties.entry.properties), ["d", "t", "s", "e"]);
    assert.ok(jobI.prompt.includes('Special rule for English "i"'));
    assert.ok(jobI.prompt.includes("CRITICAL: Define and exemplify ONLY the source term Input"));

    const jobAbandon = prepare({ kind: "word", text: "abandon", sourceLang: "en", targetLang: "pl" }, "u1");
    assert.ok(!jobAbandon.prompt.includes('Special rule for English "i"'));
    assert.ok(jobAbandon.prompt.includes("CRITICAL: Define and exemplify ONLY the source term Input"));
});

test("validateEntry rejects alphabet letter hallucinations and strips synonyms for English pronoun i", () => {
    const hallucinatedI = {
        t: "ja",
        d: { s: "The first letter of the English alphabet.", t: "Pierwsza litera alfabetu angielskiego." },
        s: ["a", "A"],
        e: [
            { s: "The word 'apple' starts with i.", t: "Słowo 'apple' zaczyna się na i." },
            { s: "I is a vowel.", t: "I jest samogłoską." },
            { s: "She wrote the letter i.", t: "Napisała literę i." },
        ],
    };
    assert.throws(
        () => validateEntry(hallucinatedI, "i", "en"),
        /English pronoun 'I' must not be defined as an alphabet letter/
    );

    const validI = {
        t: "ja",
        d: { s: "Used by a speaker to refer to himself or herself.", t: "Używane przez osobę mówiącą w odniesieniu do siebie." },
        s: ["myself", "a"],
        e: [
            { s: "I am ready.", t: "Jestem gotowy." },
            { s: "Yesterday I saw a movie.", t: "Wczoraj widziałem film." },
            { s: "Can I help you?", t: "Czy mogę ci pomóc?" },
        ],
    };
    const validated = validateEntry(validI, "i", "en");
    assert.equal(validated.t, "ja");
    assert.deepEqual(validated.s, [], "synonyms must be emptied for closed-class / single-letter words");
    assert.equal(validated.e.length, 3);
});

test("validateEntry rejects examples that do not contain the input term and strips closed-class synonyms", () => {
    const hallucinatedIt = {
        t: "to",
        d: { s: "A preposition indicating movement toward a place or person.", t: "Przyimek wskazujący ruch..." },
        s: ["towards", "into"],
        e: [
            { s: "He went to the store.", t: "Poszedł do sklepu." },
            { s: "She spoke to her friend.", t: "Rozmawiała ze swoją przyjaciółką." },
            { s: "The train is going to London.", t: "Pociąg jedzie do Londynu." },
        ],
    };
    assert.throws(
        () => validateEntry(hallucinatedIt, "it", "en"),
        /examples do not contain the input term/
    );

    const validIt = {
        t: "to",
        d: { s: "Used to refer to an inanimate thing or situation previously mentioned.", t: "Używane w odniesieniu do rzeczy lub sytuacji..." },
        s: ["this"],
        e: [
            { s: "Give it to me.", t: "Daj mi to." },
            { s: "Where is it?", t: "Gdzie to jest?" },
            { s: "It is raining.", t: "Pada deszcz." },
        ],
    };
    const validatedIt = validateEntry(validIt, "it", "en");
    assert.equal(validatedIt.t, "to");
    assert.deepEqual(validatedIt.s, [], "pronoun 'it' has synonyms stripped");
});

test("prepare includes context sentence when provided for a word and applies article rules", () => {
    const jobWithContext = prepare({
        kind: "word",
        text: "the",
        sourceLang: "en",
        targetLang: "pl",
        context: "Look at the dog.",
    }, "u1");
    assert.ok(jobWithContext.prompt.includes('Context sentence where "the" was found: "Look at the dog."'));
    assert.ok(jobWithContext.prompt.includes('Special rule for English article "the"'));
    assert.ok(jobWithContext.prompt.includes('For "the" into Polish, use "ten"'));
});

test("validateEntry rejects English function words translating to themselves", () => {
    const selfTranslatedThe = {
        t: "the",
        d: { s: "The definite article.", t: "Rodzajnik określony." },
        s: [],
        e: [
            { s: "Look at the dog.", t: "Spójrz na tego psa." },
            { s: "The sun is shining.", t: "Słońce świeci." },
            { s: "Open the door.", t: "Otwórz drzwi." },
        ],
    };
    assert.throws(
        () => validateEntry(selfTranslatedThe, "the", "en", "pl"),
        /English function word 'the' cannot translate to itself/
    );

    const validThe = {
        t: "ten",
        d: { s: "The definite article, denoting a particular person or thing.", t: "Rodzajnik określony..." },
        s: [],
        e: [
            { s: "Look at the dog.", t: "Spójrz na tego psa." },
            { s: "The sun is shining.", t: "Słońce świeci." },
            { s: "Open the door.", t: "Otwórz drzwi." },
        ],
    };
    const validated = validateEntry(validThe, "the", "en", "pl");
    assert.equal(validated.t, "ten");
});

test("validateEntry handles typographic apostrophes and inflected forms", () => {
    const contractionWithCurlyInExamples = {
        t: "nie",
        d: { s: "Contraction of do not.", t: "Skrót od do not." },
        s: [],
        e: [
            { s: "Please don’t do that.", t: "Proszę nie rób tego." },
            { s: "I don’t know.", t: "Nie wiem." },
            { s: "They don’t care.", t: "Nie zależy im." },
        ],
    };
    // straight apostrophe input matches curly apostrophe examples
    const validated1 = validateEntry(contractionWithCurlyInExamples, "don't", "en", "pl");
    assert.equal(validated1.t, "nie");

    // curly apostrophe input matches straight apostrophe examples
    const contractionWithStraightInExamples = {
        t: "nie",
        d: { s: "Contraction of do not.", t: "Skrót od do not." },
        s: [],
        e: [
            { s: "Please don't do that.", t: "Proszę nie rób tego." },
            { s: "I don't know.", t: "Nie wiem." },
            { s: "They don't care.", t: "Nie zależy im." },
        ],
    };
    const validated2 = validateEntry(contractionWithStraightInExamples, "don’t", "en", "pl");
    assert.equal(validated2.t, "nie");

    // Inflected word where 1 example contains the inflected form
    const inflectedEntry = {
        t: "poszedł",
        d: { s: "Past tense of go.", t: "Czas przeszły od go." },
        s: ["departed"],
        e: [
            { s: "Yesterday I went to the store.", t: "Wczoraj poszedłem do sklepu." },
            { s: "I want to go home.", t: "Chcę iść do domu." },
            { s: "Let's go together.", t: "Chodźmy razem." },
        ],
    };
    const validated3 = validateEntry(inflectedEntry, "went", "en", "pl");
    assert.equal(validated3.t, "poszedł");
});

test("prepare and validateEntry handle polysemous word 'like' with slash-separated equivalents", () => {
    const job = prepare({
        kind: "word",
        text: "like",
        sourceLang: "en",
        targetLang: "pl",
        context: "She looks like her mother.",
    }, "u1");
    assert.ok(job.prompt.includes('Special rule for English "like"'));
    assert.ok(job.prompt.includes('"jak / lubić"'));

    const polysemousLike = {
        t: "jak / lubić",
        d: { s: "To resemble or be similar to someone or something.", t: "Być podobnym do kogoś lub czegoś." },
        s: ["similar to", "as"],
        e: [
            { s: "She looks like her mother.", t: "Ona wygląda jak jej matka." },
            { s: "He acts like a child.", t: "On zachowuje się jak dziecko." },
            { s: "This tastes like chicken.", t: "To smakuje jak kurczak." },
        ],
    };
    const validated = validateEntry(polysemousLike, "like", "en", "pl");
    assert.equal(validated.t, "jak / lubić");
    assert.deepEqual(validated.s, ["similar to", "as"]);
});


