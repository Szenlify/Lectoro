const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { load, storage, tick } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const { generationConfig, readTextResponse } = require("../functions/ai-response");

function app({ initial = {}, user = { uid: "reader" }, respond } = {}) {
    const store = storage(initial);
    const calls = [];
    const context = vm.createContext({
        LectoroConstants: C, SharedUtils: U,
        chrome: { storage: store, i18n: { detectLanguage: async () => ({ languages: [{ language: "en" }] }) } },
        FirebaseSync: { getUser: async () => user, getValidToken: async () => user ? "test-token" : null },
        AbortController, setTimeout, clearTimeout,
        fetch: async (url, options) => {
            const body = options?.body ? JSON.parse(options.body) : null;
            calls.push({ url, body });
            await tick();
            if (url === C.ENDPOINTS.GEMINI_PROXY) {
                assert.equal(body.action, "liveTranslation", "translation checks the server cache in the generation request");
                return respond ? respond(body) : { ok: true, json: async () => ({ result: { t: "Cześć!" }, usage: { plan: "free", used: 1, limit: 100 } }) };
            }
            return { ok: true, json: async () => [[["Google result"]], null, "no"] };
        },
    });
    // Use the actual proxy transport with the VM's fetch rather than Node's global fetch.
    context.SharedUtils = { ...U, postJson: (url, body, options) => context.fetch(url, { body: JSON.stringify(body), options }) };
    load(context, "shared/gemini-proxy.js");
    load(context, "shared/translator-service.js");
    return { context, store, calls, service: context.SharedTranslatorService };
}

test("signed-in translations use one server cache request and a persistent local cache", async () => {
    const state = app();
    const results = await Promise.all([state.service.translate("Hello!", "pl"), state.service.translate("Hello!", "pl")]);
    assert.equal(results[0].translated, "Cześć!");
    assert.equal(results[0].detectedLang, "en");
    assert.equal(state.calls.length, 1);
    const body = state.calls[0].body;
    assert.equal(body.kind, "sentence");
    assert.equal(body.text, "Hello!");
    assert.equal(body.targetLang, "pl");
    assert.equal(body.prompt, undefined);
    const restarted = app({ initial: state.store.data });
    assert.equal((await restarted.service.translate("Hello!", "pl")).translated, "Cześć!");
    assert.equal(restarted.calls.length, 0);
    await state.service.translate("Hello!", "de");
    assert.equal(state.calls.length, 2);
    assert.equal(state.calls[1].body.targetLang, "de");
});

test("guests use Google without contacting Firebase", async () => {
    for (const options of [
        { user: null },
    ]) {
        const state = app(options);
        assert.equal((await state.service.translate("Hello!", "pl")).translated, "Google result");
        assert.equal(state.calls.length, 1);
        assert.ok(state.calls[0].url.startsWith(C.ENDPOINTS.GOOGLE_TRANSLATE));
    }
});

test("exhausted accounts can still retrieve a saved server translation", async () => {
    const state = app({ initial: { aiUsageCache: { uid: "reader", month: U.currentMonth(), used: 100, limit: 100 } } });
    assert.equal((await state.service.translate("Hello!", "pl")).translated, "Cześć!");
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].body.action, "liveTranslation");
});

test("a stale month or another account's exhausted cache cannot disable AI", async () => {
    for (const usage of [
        { uid: "reader", month: "2000-01" },
        { uid: "other-reader", month: U.currentMonth() },
    ]) {
        const state = app({ initial: { aiUsageCache: { ...usage, used: 100, limit: 100 } } });
        await state.service.translate("Hello!", "pl");
        assert.equal(state.calls.length, 1);
        assert.equal(state.calls[0].url, C.ENDPOINTS.GEMINI_PROXY);
    }
});

test("server quota rejection falls back while other sentences still check shared cache", async () => {
    const state = app({ respond: () => ({ ok: false, status: 429, json: async () => ({ code: "AI_LIMIT_REACHED", usage: { plan: "free", used: 100, limit: 100 } }) }) });
    assert.equal((await state.service.translate("Hello!", "pl")).translated, "Google result");
    await state.service.translate("Another sentence", "pl");
    assert.equal(state.calls.filter((call) => call.url === C.ENDPOINTS.GEMINI_PROXY).length, 2);
    assert.equal(state.calls.length, 4);
    assert.equal(state.store.data.aiUsageCache.used, 100);
});

test("a busy AI service keeps credits and permits an explicit retry without Google fallback", async () => {
    let fail = true;
    const state = app({
        initial: { aiUsageCache: { uid: "reader", month: U.currentMonth(), used: 2, limit: 100 } },
        respond: () => fail
            ? { ok: false, status: 429, json: async () => ({ error: "Busy" }) }
            : { ok: true, json: async () => ({ result: { t: "Cześć!" }, usage: { used: 3, limit: 100 } }) },
    });
    await assert.rejects(state.service.translate("Hello!", "pl"), { code: "RATE_LIMITED" });
    assert.equal(state.store.data.aiUsageCache.used, 2);
    fail = false;
    assert.equal((await state.service.translate("Hello!", "pl")).translated, "Cześć!");
    assert.equal(state.calls.length, 2);
    assert.ok(state.calls.every((call) => call.url === C.ENDPOINTS.GEMINI_PROXY));
});

test("text responses disable thinking and reject empty, blocked or truncated output", () => {
    const config = generationConfig(1, 9000, "text");
    assert.equal(config.temperature, 0);
    assert.equal(config.maxOutputTokens, 1024);
    assert.equal(config.responseMimeType, "text/plain");
    assert.equal(config.thinkingConfig.thinkingBudget, 0);
    const response = (text, finishReason = "STOP") => ({ candidates: [{ finishReason, content: { parts: [{ text: "ignore thoughts", thought: true }, { text }] } }] });
    assert.equal(readTextResponse(response(" Cześć! ")), "Cześć!");
    for (const value of [response(""), response("partial", "MAX_TOKENS"), response("blocked", "SAFETY")]) assert.throws(() => readTextResponse(value));
});

test("the learning language controls Google requests and labels instead of detected Norwegian", async () => {
    const state = app({ user: null, initial: { learningLang: "en", targetLang: "pl" } });
    const result = await state.service.translate("president");
    const query = new URL(state.calls[0].url).searchParams;
    assert.equal(query.get("sl"), "en");
    assert.equal(query.get("tl"), "pl");
    assert.equal(result.detectedLang, "en");
    await state.store.local.set({ learningLang: "de", targetLang: "fr" });
    const changed = await state.service.translate("president");
    const changedQuery = new URL(state.calls[1].url).searchParams;
    assert.equal(changedQuery.get("sl"), "de");
    assert.equal(changedQuery.get("tl"), "fr");
    assert.equal(changed.detectedLang, "de");
});

test("AI uses the selected source language and caches each language pair separately", async () => {
    const state = app({ initial: { learningLang: "en" } });
    await state.service.translate("president", "pl");
    assert.equal(state.calls[0].body.sourceLang, "en");
    assert.equal(state.calls[0].body.targetLang, "pl");
    await state.store.local.set({ learningLang: "fr" });
    assert.equal((await state.service.translate("president", "pl")).detectedLang, "fr");
    assert.equal(state.calls[1].body.sourceLang, "fr");
    assert.equal(state.calls[1].body.targetLang, "pl");
    await state.store.local.set({ learningLang: "en" });
    assert.equal((await state.service.translate("president", "pl")).detectedLang, "en");
    assert.equal(state.calls.length, 2);
});

test("legacy detected-language caches are ignored and retired settings use supported defaults", async () => {
    const state = app({ user: null, initial: {
        learningLang: "no", targetLang: "ru",
        [C.STORAGE_KEYS.PERSISTENT_TRANSLATE_CACHE]: { "president|pl": { translated: "old", detectedLang: "no" } },
    } });
    assert.equal(await state.service.getLearningLang(), "en");
    assert.equal(await state.service.getTargetLang(), "pl");
    const result = await state.service.translate("president");
    assert.notEqual(result.translated, "old");
    assert.equal(result.detectedLang, "en");
    assert.equal(state.calls.length, 1);
});

test("other single-word actions read live dictionary before any sentence or Google request", async () => {
    const state = app({ user: null });
    const words = [];
    state.context.LocalDictionary = { lookupWords: async (input, target, source) => {
        words.push([Array.from(input), target, source]); return ["dom"];
    } };
    const result = await state.service.translate("house", "pl", "en");
    assert.equal(result.translated, "dom"); assert.equal(result.provider, "dictionary");
    assert.deepEqual(words, [[["house"], "pl", "en"]]); assert.equal(state.calls.length, 0);
});
