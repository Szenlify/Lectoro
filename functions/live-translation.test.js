const test = require("node:test");
const assert = require("node:assert/strict");
const { prepare, validateEntry, validateResult, handleLiveTranslation, translationError } = require("./live-translation");
const entry = { languageValidation: 1, t: "porzucić coś", d: { s: "To leave something behind.", t: "Zostawić coś za sobą." }, s: ["desert"], e: [
    { s: "They abandon the house.", t: "Porzucają dom." },
    { s: "Do not abandon us.", t: "Nie porzucaj nas." },
    { s: "We abandon the plan.", t: "Porzucamy plan." },
] };
const analysisResponse = (payload, data) => payload.generationConfig.responseSchema.required.includes("valid") ? { valid: true, entry: data } : data;
const body = { kind: "word", text: "abandon", sourceLang: "en", targetLang: "pl" };
test("subtitle analysis saves the whole translation and separate lowercase phrases", async () => {
    const { deps, count, objects } = fixture();
    const request = { ...body, kind: "segments", text: "Get up now.", words: ["Get", "up", "now."] };
    const analyzed = { t: "Wstan teraz.", phrases: [{ start: 0, length: 2, t: "wstawac" }] };
    let calls = 0;
    deps.generate = async payload => {
        calls++;
        if (calls === 1) assert.match(payload.contents[0].parts[0].text, /Do NOT translate independent words/);
        return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(payload.generationConfig.responseSchema.required.includes("valid") ? { valid: true, entry: analyzed } : analyzed) }] } }] };
    };
    const result = await handleLiveTranslation(request, deps);
    assert.equal(result.result.t, analyzed.t);
    assert.equal(result.result.phrases[0].source, "get up");
    assert.equal((await handleLiveTranslation(request, deps)).cached, true);
    assert.equal(calls, 2);
    assert.equal(count.reserved, 1);
    assert.equal(objects.size, 2);
    const sentenceJob = prepare({ ...request, kind: "sentence" }, "u1");
    const job = prepare(request, "u1");
    assert.equal(job.key, sentenceJob.key);
    assert.equal(objects.get(sentenceJob.key).t, analyzed.t);
    const phraseKey = [...objects.keys()].find(key => key.startsWith("dictionaries/phrase/en-pl/"));
    assert.equal(objects.get(phraseKey)["get up"].t, "wstawac");
    assert.ok(![...objects.keys()].some(key => key.includes("/segments/") || key.includes("/live/")));
    assert.notEqual(job.key, prepare({ ...request, text: "Please get up now." }, "u1").key);
    assert.notEqual(job.key, prepare({ ...request, targetLang: "de" }, "u1").key);
    assert.deepEqual((await handleLiveTranslation({ ...request, kind: "sentence" }, deps)).result, { t: analyzed.t });
    assert.equal(calls, 2, "sentence translation reuses the same saved file");
});

test("phrase analysis permits independent words and no phrases, but rejects invalid spans", () => {
    const request = { ...body, kind: "segments", text: "Please take off now", words: ["Please", "take", "off", "now"] };
    const job = prepare(request, "u1");
    assert.equal(validateResult(job, { t: "translation", phrases: [] }).phrases.length, 0);
    assert.equal(validateResult(job, { t: "translation", phrases: [{ start: 1, length: 2, t: "x" }] }).phrases[0].source, "take off");
    for (const phrases of [[{ start: -1, length: 2, t: "x" }], [{ start: 0, length: 5, t: "x" }],
        [{ start: 0, length: 1, t: "x" }], [{ start: 0, length: 0, t: "x" }],
        [{ start: 0, length: 2, t: "x" }, { start: 1, length: 2, t: "x" }]]) {
        assert.throws(() => validateResult(job, { t: "translation", phrases }));
    }
    for (const words of [[], [""], [null], Array(151).fill("word")]) assert.throws(() => prepare({ ...request, words }, "u1"));
    for (const sourceLang of ["en", "de", "fr", "es", "ja", "ko", "cs", "nl", "it", "pt"]) {
        assert.match(prepare({ ...request, sourceLang }, "u1").prompt, new RegExp(`from ${sourceLang} to pl`));
    }
});
test("legacy sentence cache is enriched and phrase write conflicts do not fail translation", async () => {
    const { deps, objects } = fixture();
    const request = { ...body, kind: "segments", text: "GET UP now", words: ["GET", "UP", "now"] };
    const key = prepare(request, "u1").key;
    objects.set(key, { t: "Old sentence translation" });
    const originalWrite = deps.write;
    deps.write = async (key, value) => {
        if (key.includes("/phrase/")) throw Object.assign(new Error("Already saved by another request"), { $metadata: { httpStatusCode: 412 } });
        return originalWrite(key, value);
    };
    deps.generate = async payload => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(analysisResponse(payload, { t: "Wstań teraz", phrases: [{ start: 0, length: 2, t: "wstać" }] })) }] } }] });
    const result = await handleLiveTranslation(request, deps);
    assert.equal(result.cached, false);
    assert.equal(objects.get(key).phraseAnalysis, 2);
    assert.equal(result.result.phrases[0].source, "get up");
    assert.equal((await handleLiveTranslation(request, deps)).cached, true);
});
test("phrase storage errors refund usage and do not mark the sentence as fully saved", async () => {
    const { deps, count, objects } = fixture();
    const request = { ...body, kind: "segments", text: "Get up", words: ["Get", "up"] };
    deps.generate = async payload => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(analysisResponse(payload, { t: "Wstań", phrases: [{ start: 0, length: 2, t: "wstać" }] })) }] } }] });
    deps.write = async () => { throw Error("Storage unavailable"); };
    await assert.rejects(handleLiveTranslation(request, deps), /Storage unavailable/);
    assert.equal(count.refunded, 1);
    assert.equal(objects.size, 0);
});
test("legacy come undone is reviewed once, corrected and saved with only t", async () => {
    const { deps, objects, count } = fixture();
    const request = { ...body, kind: "segments", text: "AND I COME UNDONE", words: ["AND", "I", "COME", "UNDONE"] };
    const job = prepare(request, "u1");
    const old = { t: "I załamuję się", phrases: [{ start: 2, length: 2, t: "come undone" }], tokens: request.words, phraseAnalysis: 1 };
    objects.set(job.key, old);
    const key = `dictionaries/phrase/en-pl/${require("node:crypto").createHash("sha256").update("come undone").digest("hex")}.json`;
    objects.set(key, { "come undone": { t: "come undone", context: request.text } });
    let calls = 0;
    deps.generate = async payload => {
        calls++;
        assert.ok(payload.generationConfig.responseSchema.required.includes("valid"));
        assert.match(payload.contents[0].parts[0].text, /from en to pl/);
        return { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ valid: true,
            entry: { ...old, phrases: [{ start: 2, length: 2, t: "załamać się" }] } }) }] } }] };
    };
    await handleLiveTranslation(request, deps);
    assert.deepEqual(objects.get(key), { "come undone": { t: "załamać się" } });
    assert.equal(objects.get(job.key).phraseAnalysis, 2);
    assert.equal((await handleLiveTranslation(request, deps)).cached, true);
    assert.equal(calls, 1);
    assert.equal(count.reserved, 1);
});
test("a reviewer cannot approve an untranslated phrase by returning valid=true", async () => {
    for (const translation of ["come undone", "COME UNDONE!", "Come   undone"]) {
        const { deps, objects, count } = fixture();
        const request = { ...body, kind: "segments", text: "I come undone", words: ["I", "come", "undone"] };
        const data = { t: "Załamuję się", phrases: [{ start: 1, length: 2, t: translation }] };
        deps.generate = async payload => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(analysisResponse(payload, data)) }] } }] });
        await assert.rejects(handleLiveTranslation(request, deps), { code: "PHRASE_VALIDATION_FAILED" });
        assert.equal(objects.size, 0);
        assert.equal(count.refunded, 1);
    }
});
test("a rejected phrase language review saves nothing", async () => {
    const { deps, objects, count } = fixture();
    deps.generate = async payload => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(
        payload.generationConfig.responseSchema.required.includes("valid") ? { valid: false, entry: null }
            : { t: "Wstań", phrases: [{ start: 0, length: 2, t: "get up" }] }
    ) }] } }] });
    await assert.rejects(handleLiveTranslation({ ...body, kind: "segments", text: "Get up", words: ["Get", "up"] }, deps), { code: "PHRASE_VALIDATION_FAILED" });
    assert.equal(objects.size, 0);
    assert.equal(count.refunded, 1);
});
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
