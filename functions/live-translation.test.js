const test = require("node:test");
const assert = require("node:assert/strict");
const { prepare, validateEntry, handleLiveTranslation } = require("./live-translation");
const entry = { t: "porzucić coś", d: { s: "To leave something behind.", t: "Zostawić coś za sobą." }, s: ["desert"], e: [
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
        generate: async () => { count.generated++; return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(entry) }] } }] }; },
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
test("concurrent users cannot generate the same word twice", async () => {
    const { deps, count } = fixture();
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const original = deps.generate;
    deps.generate = async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return original(...args); };
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
test("language pairs and case are isolated; both cache folders are shared and have no version prefix", () => {
    assert.notEqual(prepare(body, "a").key, prepare({ ...body, targetLang: "de" }, "a").key);
    assert.notEqual(prepare(body, "a").key, prepare({ ...body, text: "Abandon" }, "a").key);
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
