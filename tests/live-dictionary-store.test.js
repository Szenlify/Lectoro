const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { load } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const { prepare } = require("../functions/live-translation");
const entry = { languageValidation: 1, t: "mały dom", d: { s: "A small home.", t: "Niewielki dom." }, s: ["cottage"],
    e: [1, 2, 3].map(n => ({ s: `Home example ${n}.`, t: `Przykład domu ${n}.` })) };
function environment({ records = new Map(), serve = () => new Response(null, { status: 404 }), failSave = false } = {}) {
    const calls = [];
    const context = vm.createContext({ LectoroConstants: C, SharedUtils: U, crypto: webcrypto,
        TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout, console: { warn() {} }, module: { exports: {} } });
    load(context, "shared/dictionary-store.js");
    const store = context.module.exports.createStore({ persistence: {
        get: async key => structuredClone(records.get(key)),
        put: async record => { if (failSave) throw Error("QuotaExceededError"); records.set(record.key, structuredClone(record)); },
    }, fetcher: async (url, options) => {
        calls.push(url);
        assert.match(url, /\/dictionaries\/live\/[a-z]{2}-[a-z]{2}\/[a-f0-9]{64}\.json$/);
        assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
        return serve(url, options);
    } });
    context.DictionaryStore = store;
    load(context, "shared/dictionary-tokenizer.js");
    load(context, "shared/local-dictionary.js");
    return { store, context, calls, records, lookup: context.LocalDictionary.lookupWords };
}
test("hover reads exactly the live file used by the server, with no catalog or Gemini request", async () => {
    const env = environment({ serve: () => new Response(JSON.stringify({ hütte: entry })) });
    env.context.GeminiProxy = { liveTranslation: async () => { throw Error("Unexpected generation"); } };
    const [details] = await env.lookup(["Hütte"], "pl", "de", { details: true });
    assert.equal(details.primaryTranslation, entry.t);
    assert.equal(details.senses[0].definitionTranslated, entry.d.t);
    assert.equal(details.senses[0].examples.length, 3);
    const key = prepare({ kind: "word", text: "Hütte", sourceLang: "de", targetLang: "pl" }, "user").key;
    assert.equal(new URL(env.calls[0]).pathname, `/${key}`);
    assert.equal(env.calls.length, 1); assert.equal(env.store.getPair, undefined);
});
test("missing hover entries generate by default, deduplicate and persist for offline use", async () => {
    const env = environment(); let requests = 0;
    env.context.GeminiProxy = { liveTranslation: async (kind, word, source, target) => {
        requests++; assert.equal(kind, "word"); assert.equal(source, "de"); assert.equal(target, "pl");
        return { [word]: entry };
    } };
    const [a, b] = await Promise.all([env.lookup(["Hütte"], "pl", "de", { details: true }), env.lookup(["Hütte"], "pl", "de")]);
    assert.equal(a[0].primaryTranslation, entry.t); assert.equal(b[0], entry.t);
    assert.equal(requests, 1); assert.equal(env.calls.length, 1);
    const offline = environment({ records: env.records, serve: () => { throw Error("Offline"); } });
    assert.equal((await offline.lookup(["Hütte"], "pl", "de"))[0], entry.t);
    assert.equal(offline.calls.length, 0);
});
test("legacy entries in local cache and R2 are replaced through verified generation", async () => {
    const legacy = { ...entry, t: "Polish language", s: ["a", "b", "c"] };
    delete legacy.languageValidation;
    const records = new Map([[`live-r2:${JSON.stringify(["en", "pl", "polish"])}`, { data: legacy }]]);
    const env = environment({ records, serve: () => new Response(JSON.stringify({ polish: legacy })) });
    assert.equal(await env.store.getLive("en", "pl", "Polish", { localOnly: true }), null);
    let generated = 0;
    env.context.GeminiProxy = { liveTranslation: async () => {
        generated++;
        return { polish: { ...entry, t: "język polski" } };
    } };
    const result = await env.lookup(["Polish"], "pl", "en", { details: true });
    assert.equal(result[0].primaryTranslation, "język polski");
    assert.equal(generated, 1);
    assert.equal((await env.store.getLive("en", "pl", "Polish", { localOnly: true })).t, "język polski");
    await assert.rejects(env.store.putLive("en", "pl", "Polish", { ...legacy, s: [] }), /verification/);
});
test("word clouds first render local entries and then read only missing live files", async () => {
    const env = environment(); await env.store.putLive("en", "pl", "house", entry);
    env.context.GeminiProxy = { liveTranslation: async () => { throw Error("Unexpected generation"); } };
    const result = await env.lookup(["the", "house", "unknown"], "pl", "en", { wordByWord: true, localOnly: true, generateMissing: false });
    assert.equal(result[0], null); assert.equal(result[1].translated, entry.t); assert.equal(result[2], null);
    assert.equal(env.calls.length, 0);
    assert.equal((await env.lookup(["unknown"], "pl", "en", { generateMissing: false }))[0], null);
    assert.equal(env.calls.length, 1);
});
test("contextual lookup preserves get up as one unit before skipping simple words and caches it offline", async () => {
    const env = environment();
    let calls = 0;
    const words = ["Get", "up", "now"];
    const options = { wordByWord: true, contextual: true, context: "Get up now" };
    env.context.GeminiProxy = { liveTranslation: async (kind, context, source, target, tokens) => {
        calls++;
        assert.equal(kind, "segments");
        assert.equal(context, options.context);
        assert.deepEqual(Array.from(tokens), words);
        return { phraseAnalysis: 2, t: "Wstan teraz", phrases: [{ start: 0, length: 2, t: "wstań" }] };
    } };
    const result = await env.lookup(words, "pl", "en", options);
    assert.equal(result[0].length, 2);
    assert.equal(result[0].translated, "wstań");
    assert.equal(result[1], null);
    assert.equal(calls, 1);
    assert.equal(env.calls.length, 0, "do not fetch individual words");
    const offline = environment({ records: env.records });
    assert.equal((await offline.lookup(words, "pl", "en", options))[0].length, 2);
    assert.equal(offline.calls.length, 0);
});
test("phrase analysis does not replace individual-word translations from the dictionary", async () => {
    const env = environment();
    await env.store.putLive("en", "pl", "window", { ...entry, t: "okno" });
    let calls = 0;
    env.context.GeminiProxy = { liveTranslation: async kind => {
        calls++;
        assert.equal(kind, "segments");
        return { phraseAnalysis: 2, t: "Wstań przy oknie.", phrases: [{ start: 0, length: 2, t: "wstań" }] };
    } };
    const words = ["Get", "up", "near", "the", "window"];
    const options = { wordByWord: true, contextual: true, context: words.join(" ") };
    const result = await env.lookup(words, "pl", "en", options);
    assert.equal(result[0].length, 2);
    assert.equal(result[1], null);
    assert.equal(result[4].translated, "okno");
    assert.equal(result[4].length, 1);
    assert.equal(calls, 1);
    const offline = environment({ records: env.records });
    assert.equal((await offline.lookup(words, "pl", "en", options))[4].translated, "okno");
    assert.equal(offline.calls.length, 0);
});
test("mixed-case words share concurrent generation, R2 reads and offline cache", async () => {
    const env = environment();
    let generated = 0;
    env.context.GeminiProxy = { liveTranslation: async (kind, word) => {
        generated++;
        assert.equal(word, "wounds");
        return { wounds: entry };
    } };
    const variants = ["wounds", "WOUNDS", "wOunDS"];
    const results = await Promise.all(variants.map(word => env.lookup([word], "pl", "en")));
    assert.ok(results.every(result => result[0] === entry.t));
    assert.equal(generated, 1);
    assert.equal(env.calls.length, 1);
    assert.equal(env.records.size, 1);
    const offline = environment({ records: env.records, serve: () => { throw Error("Offline"); } });
    for (const word of variants) assert.equal((await offline.store.getLive("en", "pl", word, { localOnly: true })).t, entry.t);
    assert.equal(offline.calls.length, 0);
});
test("language pairs stay isolated and word case is normalized; old cached packs are ignored", async () => {
    const env = environment({ records: new Map([["en-pl", { data: { entries: { house: "OLD" } } }], ["catalog", { data: {} }]]) });
    for (const [word, source, target] of [["House", "en", "pl"], ["house", "en", "pl"], ["house", "en", "de"], ["house", "fr", "pl"]]) {
        assert.equal((await env.lookup([word], target, source, { generateMissing: false }))[0], null);
    }
    assert.equal(new Set(env.calls).size, 3);
});
test("denied, malformed or oversized remote entries never trigger paid generation", async () => {
    for (const serve of [() => new Response(null, { status: 403 }), () => new Response('{"house":{"t":"bad"}}'),
        () => new Response('{}', { headers: { "content-length": "65537" } })]) {
        const env = environment({ serve }); let generated = 0;
        env.context.GeminiProxy = { liveTranslation: async () => { generated++; } };
        await assert.rejects(env.lookup(["house"], "pl", "en"));
        assert.equal(generated, 0);
        assert.equal(await env.store.getLive("en", "pl", "house", { localOnly: true }), null);
    }
});
test("invalid generation is rejected; valid entries survive full IndexedDB in memory", async () => {
    const invalid = environment();
    invalid.context.GeminiProxy = { liveTranslation: async () => ({ house: { t: "bad" } }) };
    await assert.rejects(invalid.lookup(["house"], "pl", "en")); assert.equal(invalid.records.size, 0);
    const env = environment({ failSave: true, serve: () => new Response(JSON.stringify({ house: entry })) });
    assert.equal((await env.lookup(["house"], "pl", "en"))[0], entry.t);
    assert.equal((await env.lookup(["house"], "pl", "en"))[0], entry.t); assert.equal(env.calls.length, 1);
});
test("unsupported and same-language lookups never touch the network", async () => {
    const env = environment();
    assert.equal((await env.lookup(["house"], "xx", "en"))[0], null);
    assert.equal((await env.lookup(["house"], "en", "en"))[0], "house"); assert.equal(env.calls.length, 0);
});
