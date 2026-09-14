"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { load } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");

function createTestEnvironment({ fetcher }) {
    const records = new Map();
    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        crypto: webcrypto,
        TextDecoder,
        TextEncoder,
        AbortController,
        setTimeout,
        clearTimeout,
        console: { warn() {}, log() {} },
        require,
        process,
        __dirname: require("node:path").join(__dirname, "../shared"),
        module: { exports: {} },
    });
    load(context, "shared/dictionary-store.js");
    const store = context.module.exports.createStore({
        persistence: {
            get: async key => structuredClone(records.get(key)),
            put: async record => { records.set(record.key, structuredClone(record)); },
            batchPut: async list => {
                for (const r of list) records.set(r.key, structuredClone(r));
            },
        },
        fetcher,
    });
    context.DictionaryStore = store;
    load(context, "shared/dictionary-tokenizer.js");
    load(context, "shared/local-dictionary.js");
    return { store, context, records, lookup: context.LocalDictionary.lookupWords };
}

test("syncPack fetches 200 OK, imports pack to IndexedDB, and lookupWords resolves locally without network", async () => {
    const pack = {
        schemaVersion: 2,
        source: "en",
        target: "pl",
        updatedAt: Date.now(),
        entries: {
            world: {
                languageValidation: 1,
                t: "świat",
                d: { s: "The earth and all its people.", t: "Ziemia i wszyscy jej ludzie." },
                s: ["earth"],
                e: [
                    { s: "Around the world.", t: "Dookoła świata." },
                    { s: "A better world.", t: "Lepszy świat." },
                    { s: "The modern world.", t: "Współczesny świat." },
                ],
            },
        },
    };

    let fetchCount = 0;
    let sentHeaders = {};
    const env = createTestEnvironment({
        fetcher: async (url, options) => {
            fetchCount++;
            sentHeaders = options.headers || {};
            return new Response(JSON.stringify(pack), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "ETag": "\"etag-12345\"",
                },
            });
        },
    });

    // 1. Initial sync
    const res = await env.store.syncPack("en", "pl", { force: true });
    assert.equal(res.updated, true);
    assert.equal(res.wordsCount, 1);
    assert.equal(res.etag, "\"etag-12345\"");
    assert.equal(fetchCount, 1);

    // 2. Lookup word: must resolve instantly from local store without network call or Gemini
    env.context.GeminiProxy = {
        liveTranslation: async () => { throw new Error("Network/Gemini should not be called!"); },
    };
    const [result] = await env.lookup(["world"], "pl", "en", { details: true });
    assert.ok(result);
    assert.equal(result.primaryTranslation, "świat");
    assert.equal(result.senses[0].definitionTranslated, "Ziemia i wszyscy jej ludzie.");
});

test("syncPack sends If-None-Match and skips downloading on 304 Not Modified", async () => {
    let fetchCount = 0;
    let receivedIfNoneMatch = null;

    const env = createTestEnvironment({
        fetcher: async (url, options) => {
            fetchCount++;
            receivedIfNoneMatch = options.headers?.["If-None-Match"];
            if (receivedIfNoneMatch === "\"etag-12345\"") {
                return new Response(null, { status: 304 });
            }
            return new Response(JSON.stringify({ schemaVersion: 2, entries: {} }), {
                status: 200,
                headers: { ETag: "\"etag-12345\"" },
            });
        },
    });

    // First call: gets etag
    await env.store.syncPack("en", "pl", { force: true });
    assert.equal(fetchCount, 1);

    // Second call: sends If-None-Match: "etag-12345"
    const secondSync = await env.store.syncPack("en", "pl", { force: true });
    assert.equal(fetchCount, 2);
    assert.equal(receivedIfNoneMatch, "\"etag-12345\"");
    assert.equal(secondSync.updated, false);
    assert.equal(secondSync.notModified, true);
});
