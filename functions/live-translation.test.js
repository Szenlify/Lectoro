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

test("full sentence uses one AI call and does not write to R2", async () => {
    const { deps, count, objects } = fixture();
    deps.generate = async payload => {
        count.generated++;
        assert.deepEqual(payload.generationConfig.responseSchema.required, ["t"]);
        return response({ t: "Wstań teraz." });
    };

    const request = { ...body, kind: "sentence", text: "Get up now." };
    const result = await handleLiveTranslation(request, deps);

    assert.deepEqual(result.result, { t: "Wstań teraz." });
    assert.equal(objects.size, 0, "sentence does not write to R2");
    assert.equal(count.generated, 1);
    assert.equal(count.reserved, 1);
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


test("paths remain shared, language-pair isolated, only dictionaries/live has R2 key", () => {
    assert.equal(prepare(body, "a").key, prepare(body, "b").key);
    assert.equal(prepare({ ...body, text: "Abandon" }, "a").key, prepare(body, "a").key);
    assert.notEqual(prepare(body, "a").key, prepare({ ...body, targetLang: "de" }, "a").key);
    assert.match(prepare(body, "a").key, /^dictionaries\/live\/en-pl\/[a-f0-9]{64}\.json$/);
    assert.equal(prepare({ ...body, kind: "sentence" }, "a").key, null);
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

test("prepare maps language codes to full names and enforces source/target language isolation for it -> ja", () => {
    const jobWord = prepare({
        kind: "word",
        text: "perso",
        sourceLang: "it",
        targetLang: "ja",
    }, "u1");

    assert.ok(jobWord.prompt.includes("source language Italian (it) to the target language Japanese (ja)"));
    assert.ok(jobWord.prompt.includes("written in Italian (field s)"));
    assert.ok(jobWord.prompt.includes("translated into Japanese (field t)"));
    assert.ok(jobWord.prompt.includes("All fields labeled s (entry.d.s, entry.s, entry.e[].s) MUST be written in Italian, NEVER in English"));
    assert.ok(jobWord.prompt.includes("All fields labeled t (entry.t, entry.d.t, entry.e[].t) MUST be written in Japanese"));
    assert.ok(jobWord.prompt.includes("NEVER assume English when source language is Italian"));

    const jobSentence = prepare({
        kind: "sentence",
        text: "Ho perso le chiavi.",
        sourceLang: "it",
        targetLang: "ja",
    }, "u1");

    assert.ok(jobSentence.prompt.includes("selected source language Italian (it) to the target language Japanese (ja)"));

    // Validation rejects untranslated Italian word when target is Japanese
    assert.throws(
        () => validateEntry({
            t: "perso", // untranslated
            d: { s: "Che non si trova.", t: "見つからない。" },
            s: ["smarrito"],
            e: [
                { s: "Ho perso le chiavi.", t: "鍵をなくした。" },
                { s: "È perso nel bosco.", t: "森で迷った。" },
                { s: "Tutto è perso.", t: "すべて失われた。" },
            ],
        }, "perso", "it", "ja"),
        /not translated into target language/
    );

    // Validation accepts proper Italian -> Japanese entry
    const validItJa = validateEntry({
        t: "失われた / 迷子になった",
        d: { s: "Che non si trova più.", t: "見つからない。" },
        s: ["smarrito"],
        e: [
            { s: "Ho perso le chiavi.", t: "鍵をなくした。" },
            { s: "È perso nel bosco.", t: "森で迷った。" },
            { s: "Tutto è perso.", t: "すべて失われた。" },
        ],
    }, "perso", "it", "ja");
    assert.equal(validItJa.t, "失われた / 迷子になった");
    assert.equal(validItJa.d.s, "Che non si trova più.");
    assert.equal(validItJa.d.t, "見つからない。");
});



