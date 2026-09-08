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
                assert.equal(body.action, undefined, "translation must not send a separate usage request");
                return respond ? respond(body) : { ok: true, json: async () => ({ text: "Cześć!", usage: { plan: "free", used: 1, limit: 100 } }) };
            }
            return { ok: true, json: async () => [[["Google result"]], null, "en"] };
        },
    });
    // Use the actual proxy transport with the VM's fetch rather than Node's global fetch.
    context.SharedUtils = { ...U, postJson: (url, body, options) => context.fetch(url, { body: JSON.stringify(body), options }) };
    load(context, "shared/gemini-proxy.js");
    load(context, "shared/translator-service.js");
    return { context, store, calls, service: context.SharedTranslatorService };
}

test("signed-in translations use one plain-text AI request and a persistent shared cache", async () => {
    const state = app();
    const results = await Promise.all([state.service.translate("Hello!", "pl"), state.service.translate("Hello!", "pl")]);
    assert.equal(results[0].translated, "Cześć!");
    assert.equal(results[0].detectedLang, "en");
    assert.equal(state.calls.length, 1);
    const body = state.calls[0].body;
    assert.equal(body.temperature, 0);
    assert.equal(body.responseFormat, "text");
    assert.ok(body.prompt.includes("Polish"));
    assert.ok(body.maxOutputTokens <= 1024);
    const restarted = app({ initial: state.store.data });
    assert.equal((await restarted.service.translate("Hello!", "pl")).translated, "Cześć!");
    assert.equal(restarted.calls.length, 0);
    await state.service.translate("Hello!", "de");
    assert.equal(state.calls.length, 2);
    assert.ok(state.calls[1].body.prompt.includes("German"));
});

test("guests and current exhausted accounts use Google without contacting Firebase", async () => {
    for (const options of [
        { user: null },
        { initial: { aiUsageCache: { uid: "reader", month: U.currentMonth(), used: 100, limit: 100 } } },
    ]) {
        const state = app(options);
        assert.equal((await state.service.translate("Hello!", "pl")).translated, "Google result");
        assert.equal(state.calls.length, 1);
        assert.ok(state.calls[0].url.startsWith(C.ENDPOINTS.GOOGLE_TRANSLATE));
    }
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

test("server quota rejection falls back once and records exhaustion locally", async () => {
    const state = app({ respond: () => ({ ok: false, status: 429, json: async () => ({ code: "AI_LIMIT_REACHED", plan: "free", used: 100, limit: 100 }) }) });
    assert.equal((await state.service.translate("Hello!", "pl")).translated, "Google result");
    await state.service.translate("Another sentence", "pl");
    assert.equal(state.calls.filter((call) => call.url === C.ENDPOINTS.GEMINI_PROXY).length, 1);
    assert.equal(state.calls.length, 3);
});

test("a busy AI service keeps credits and permits an explicit retry without Google fallback", async () => {
    let fail = true;
    const state = app({
        initial: { aiUsageCache: { uid: "reader", month: U.currentMonth(), used: 2, limit: 100 } },
        respond: () => fail
            ? { ok: false, status: 429, json: async () => ({ error: "Busy" }) }
            : { ok: true, json: async () => ({ text: "Cześć!", usage: { used: 3, limit: 100 } }) },
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
