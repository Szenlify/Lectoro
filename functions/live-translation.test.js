const test = require("node:test");
const assert = require("node:assert/strict");
const { prepare, validateEntry, handleLiveTranslation, translationError } = require("./live-translation");
const entry = { languageValidation: 1, t: "porzucić coś", d: { s: "To leave something behind.", t: "Zostawić coś za sobą." }, s: ["desert"], e: [
    { s: "They abandon the house.", t: "Porzucają dom." },
    { s: "Do not abandon us.", t: "Nie porzucaj nas." },
    { s: "We abandon the plan.", t: "Porzucamy plan." },
] };
const body = { kind: "word", text: "abandon", sourceLang: "en", targetLang: "pl" };
test("synonyms are limited to two and requested in the source language", () => {
    for (const s of [[], ["desert"], ["desert", "leave"]]) {
        assert.deepEqual(validateEntry({ ...entry, s }).s, s);
    }
    assert.throws(() => validateEntry({ ...entry, s: ["desert", "leave", "forsake"] }));
    for (const [sourceLang, targetLang] of [["en", "pl"], ["de", "en"]]) {
        const job = prepare({ ...body, sourceLang, targetLang }, "u1");
        assert.equal(job.schema.properties.s.maxItems, 2);
        assert.ok(job.prompt.includes(`synonyms in ${sourceLang} (the source language), never translations in ${targetLang}`));
    }
});
function fixture() {
    const records = new Map(), objects = new Map();
    let transactions = Promise.resolve();
    const count = { reserved: 0, refunded: 0, generated: 0 };
    const deps = {
        uid: "u1", usage: { used: 0, limit: 10 },
        db: { collection: () => ({ doc: key => key }), runTransaction: fn => {
            const task = transactions.then(() => fn({ get: async key => ({ data: () => records.get(key) }),
                set: (key, value) => records.set(key, value), delete: key => records.delete(key) }));
            transactions = task.catch(() => {}); return task;
        } },
        read: async key => objects.get(key), write: async (key, value) => objects.set(key, value),
        reserve: async () => { count.reserved++; return { used: count.reserved, limit: 10 }; },
        rollback: async () => { count.refunded++; },
        generate: async payload => { if (payload.generationConfig.responseSchema.required.includes("valid")) return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ valid: true, entry }) }] } }] }; count.generated++; return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(entry) }] } }] }; },
    };
    return { deps, count, objects, records };
}
test("generates compact JSON once, persists it and serves cache before quota", async () => {
    const { deps, count, objects } = fixture();
    const first = await handleLiveTranslation(body, deps);
    assert.deepEqual(first.result, { abandon: entry });
    assert.equal(objects.size, 1);
    deps.reserve = async () => { throw new Error("No quota left"); };
    const second = await handleLiveTranslation(body, deps);
    assert.equal(second.cached, true);
    assert.deepEqual(count, { reserved: 1, refunded: 0, generated: 1 });
});
test("wounds in every letter case shares one backend entry and quota reservation", async () => {
    const { deps, count, objects } = fixture();
    const variants = ["wounds", "WOUNDS", "wOunDS"];
    for (const text of variants) {
        const result = await handleLiveTranslation({ ...body, text }, deps);
        assert.deepEqual(Object.keys(result.result), ["wounds"]);
        assert.equal(prepare({ ...body, text }, "u1").input, "wounds");
    }
    assert.equal(objects.size, 1);
    assert.equal(count.reserved, 1);
    assert.equal(count.generated, 1);
    const sentence = prepare({ ...body, kind: "sentence", text: "WOUNDS heal." }, "u1");
    assert.equal(sentence.input, "WOUNDS heal.");
    assert.notEqual(sentence.key, prepare({ ...body, kind: "sentence", text: "wounds heal." }, "u1").key);
});
test("legacy wrong-language fields are repaired with one review before replacing R2 data", async () => {
    const { deps, objects, count } = fixture();
    const request = { ...body, text: "Polish" };
    const key = prepare(request, "u1").key;
    const bad = { ...entry, t: "Polish language" };
    delete bad.languageValidation;
    objects.set(key, { polish: bad });
    const good = { ...bad, t: "język polski" };
    const responses = [{ valid: true, entry: good }];
    const prompts = [];
    deps.generate = async payload => {
        prompts.push(payload.contents[0].parts[0].text);
        assert.equal(objects.get(key).polish.t, "Polish language", "do not save before review");
        return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(responses.shift()) }] } }] };
    };
    const result = await handleLiveTranslation(request, deps);
    assert.equal(result.result.polish.t, "język polski");
    assert.equal(objects.get(key).polish.languageValidation, 1);
    assert.equal(prompts.length, 1, "repair legacy entries with one AI call");
    assert.match(prompts[0], /Polish language/);
    assert.equal(count.reserved, 1);
    assert.equal(count.refunded, 0);
});
test("new entries need only generation and review, even when review corrects them", async () => {
    const { deps, objects } = fixture();
    const responses = [{ ...entry, t: "wrong language" }, { valid: true, entry }];
    let calls = 0;
    deps.generate = async () => {
        calls++;
        return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(responses.shift()) }] } }] };
    };
    const result = await handleLiveTranslation(body, deps);
    assert.deepEqual(result.result, { abandon: entry });
    assert.equal(calls, 2);
    assert.equal(objects.size, 1);
});
test("public errors distinguish timeouts, stale writes, bad requests and service stages", () => {
    assert.equal(translationError({ name: "TimeoutError" }).code, "TRANSLATION_TIMEOUT");
    assert.equal(translationError({ $metadata: { httpStatusCode: 412 } }).code, "TRANSLATION_PENDING");
    assert.equal(translationError({ status: 400, message: "Invalid request" }).status, 400);
    assert.equal(translationError({ status: 429 }).code, "RATE_LIMITED");
    for (const stage of ["storage", "cache", "generation", "verification"]) {
        const result = translationError({ stage, message: "private provider details" });
        assert.ok(result.code.includes(stage.toUpperCase()));
        assert.ok(!result.error.includes("private provider details"));
    }
});
test("failed or malformed language reviews never save entries and refund usage", async () => {
    for (const verdict of [{ valid: false, issues: ["d.t and e[1].t are in the wrong language"] }, { valid: "true", issues: [] }]) {
        const { deps, count, objects } = fixture();
        deps.generate = async payload => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(
            payload.generationConfig.responseSchema.required.includes("valid") ? verdict : entry
        ) }] } }] });
        await assert.rejects(handleLiveTranslation(body, deps), /verify/);
        assert.equal(objects.size, 0);
        assert.equal(count.reserved, 1);
        assert.equal(count.refunded, 1);
    }
});
test("concurrent users cannot generate the same word twice", async () => {
    const { deps, count } = fixture();
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const original = deps.generate;
    deps.generate = async (...args) => { if (args[0].generationConfig.responseSchema.required.includes("valid")) return original(...args); started(); await new Promise(resolve => { release = resolve; }); return original(...args); };
    const first = handleLiveTranslation(body, deps);
    await waiting;
    await assert.rejects(handleLiveTranslation(body, { ...deps, uid: "u2" }), { code: "TRANSLATION_PENDING" });
    release(); await first;
    assert.equal(count.generated, 1);
});
test("invalid AI JSON and R2 write failures refund quota and release lease", async () => {
    for (const mode of ["invalid", "storage"]) {
        const { deps, count, objects, records } = fixture();
        if (mode === "invalid") deps.generate = async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"t":"bad"}' }] } }] });
        else deps.write = async () => { throw new Error("R2 unavailable"); };
        await assert.rejects(handleLiveTranslation(body, deps));
        assert.equal(count.refunded, 1); assert.equal(objects.size, 0); assert.equal(records.size, 0);
    }
});
test("quota refusal never generates, cache read failure never charges", async () => {
    for (const mode of ["quota", "read"]) {
        const { deps, count, records } = fixture();
        deps[mode === "quota" ? "reserve" : "read"] = async () => { throw new Error("Unavailable"); };
        await assert.rejects(handleLiveTranslation(body, deps));
        assert.equal(count.generated, 0); assert.equal(count.refunded, 0); assert.equal(records.size, 0);
    }
});
test("language pairs are isolated and word case is normalized; both cache folders are shared and have no version prefix", () => {
    assert.notEqual(prepare(body, "a").key, prepare({ ...body, targetLang: "de" }, "a").key);
    assert.equal(prepare(body, "a").key, prepare({ ...body, text: "Abandon" }, "a").key);
    assert.equal(prepare(body, "a").key, prepare(body, "b").key);
    assert.equal(prepare({ ...body, kind: "sentence" }, "a").key, prepare({ ...body, kind: "sentence" }, "b").key);
    assert.match(prepare(body, "a").key, /^dictionaries\/live\/en-pl\/[a-f0-9]{64}\.json$/);
    assert.match(prepare({ ...body, kind: "sentence" }, "a").key, /^dictionaries\/translations\/en-pl\/[a-f0-9]{64}\.json$/);
    for (const sourceLang of ["cs", "de", "en", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt"]) {
        assert.ok(prepare({ ...body, sourceLang, targetLang: sourceLang === "pl" ? "ja" : "pl" }, "a").key);
    }
    for (const invalid of [{ sourceLang: "xx" }, { targetLang: "en" }, { text: "../../x" }, { kind: "anything" }]) {
        assert.throws(() => prepare({ ...body, ...invalid }, "a"), { status: 400 });
    }
    assert.equal(validateEntry(entry).t, "porzucić coś");
});
test("full sentence uses its own schema and returns saved translation", async () => {
    const { deps } = fixture();
    deps.generate = async payload => {
        assert.deepEqual(payload.generationConfig.responseSchema.required, ["t"]);
        return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"t":"Porzucili dom."}' }] } }] };
    };
    const result = await handleLiveTranslation({ ...body, kind: "sentence", text: "They abandoned the house." }, deps);
    assert.deepEqual(result.result, { t: "Porzucili dom." });
});

test("200 source characters are cached; 201 bypass all R2 and shared lock operations", async () => {
    for (const character of ["a", "ą", "😀"]) {
        for (const length of [200, 201]) {
            const { deps, count, objects } = fixture();
            deps.generate = async () => {
                count.generated++;
                return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ t: "z".repeat(250) }) }] } }] };
            };
            if (length > 200) {
                deps.read = deps.write = async () => { throw Error("Long text must not use R2"); };
                deps.db = { collection: () => { throw Error("Long text must not create a cache lock"); } };
            }
            const request = { ...body, kind: "sentence", text: character.repeat(length) };
            const first = await handleLiveTranslation(request, deps);
            assert.equal(first.result.t.length, 250, "output length does not control source caching");
            const second = await handleLiveTranslation(request, deps);
            assert.equal(second.cached, length === 200);
            assert.equal(objects.size, length === 200 ? 1 : 0);
            assert.equal(count.generated, length === 200 ? 1 : 2);
        }
    }
});

test("uncached long-text AI failures still refund quota without touching R2", async () => {
    const { deps, count } = fixture();
    deps.read = deps.write = async () => { throw Error("Unexpected R2 access"); };
    deps.generate = async () => { throw Error("AI unavailable"); };
    await assert.rejects(handleLiveTranslation({ ...body, kind: "sentence", text: "x".repeat(201) }, deps), /AI unavailable/);
    assert.equal(count.reserved, 1);
    assert.equal(count.refunded, 1);
});
