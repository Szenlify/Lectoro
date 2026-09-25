const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Constants = require("../shared/constants");
const Utils = require("../shared/utils");
const Config = require("../shared/subscription-config");

function service({ stored = {}, synthesize, cdnHit = false } = {}) {
    const storage = { ...Constants.DEFAULT_TTS_SETTINGS, ttsMode: "openai", elVoiceId: "nova", ...stored };
    const cache = new Map();
    const requests = [];
    const syntheses = [];
    const mp3 = new Blob(["test-mp3"], { type: "audio/mpeg" });
    const sandbox = {
        LectoroConstants: Constants,
        SharedUtils: { ...Utils, ensureVoices: async () => [] },
        SubscriptionConfig: Config,
        Blob, AbortSignal, URL, console: { warn() {} },
        window: { speechSynthesis: { cancel() {} } },
        Audio: function () { assert.fail("cancelled requests must not start playback"); },
        chrome: { storage: { local: {
            get: async (defaults) => ({ ...defaults, ...storage }),
            set: async (patch) => Object.assign(storage, patch),
        } } },
        AudioCache: { get: async (key) => cache.get(key), set: async (key, blob) => cache.set(key, blob) },
        SubscriptionService: {
            checkGeminiTts: async () => ({ allowed: true }),
            synthesizeGeminiTts: async (...args) => { syntheses.push(args); return synthesize ? synthesize(...args) : mp3; },
        },
        fetch: async (url) => {
            requests.push(url);
            const isCdn = url.includes("r2.dev");
            return { ok: isCdn ? cdnHit : true,
                headers: { get: () => "audio/mpeg" },
                blob: async () => isCdn ? mp3 : new Blob(["fallback"], { type: "audio/mpeg" }),
            };
        },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("../shared/tts-service"), "utf8"), sandbox);
    return { api: sandbox.SharedTtsService, storage, cache, requests, syntheses, mp3 };
}

test("legacy preference migrates and identical recordings are synthesized once", async () => {
    const ctx = service({ stored: { ttsMode: "elevenlabs", elVoiceId: "TX3LPaxmHKxFdv7VOQHJ" } });
    const first = await ctx.api.getAudioBlob("Cześć", "pl", { allowSynthesis: true, allowFallback: false });
    assert.equal(first.provider, "openai");
    assert.equal(first.voiceId, "alloy");
    assert.equal(ctx.storage.ttsMode, "openai");
    assert.deepEqual(ctx.syntheses[0].slice(0, 4), ["Cześć", "alloy", "review", "pl"]);
    assert.equal(ctx.syntheses[0][4]?.skipCacheCheck, true);
    const second = await ctx.api.getAudioBlob("Cześć", "pl", { allowSynthesis: true, allowFallback: false });
    assert.equal(second.cached, true);
    assert.equal(ctx.syntheses.length, 1);
});

test("cached recordings never cross language, voice or legacy provider boundaries", async () => {
    const ctx = service();
    ctx.cache.set("Gift|nova", ctx.mp3); // Old unscoped cache format.
    await ctx.api.getAudioBlob("Gift", "en", { allowSynthesis: true });
    await ctx.api.getAudioBlob("Gift", "de", { allowSynthesis: true });
    await ctx.api.getAudioBlob("Gift", "en", { allowSynthesis: true, voiceId: "alloy" });
    assert.equal(ctx.syntheses.length, 3);
    assert.equal(ctx.cache.size, 4);
});

test("CDN hits return MP3 without synthesis and are persisted locally", async () => {
    const ctx = service({ cdnHit: true });
    const result = await ctx.api.getAudioBlob("Hello", "en", { allowSynthesis: true });
    assert.equal(result.blob.type, "audio/mpeg");
    assert.equal(result.cached, true);
    assert.equal(ctx.syntheses.length, 0);
    assert.equal(ctx.cache.size, 1);
    assert.match(ctx.requests[0], /audio\/openai\/tts-1\/v1\/nova\/en\//);
});

test("export cache miss does not synthesize and honors disabled fallback", async () => {
    const ctx = service();
    assert.equal(await ctx.api.getAudioBlob("Hello", "en", { allowSynthesis: false, allowFallback: false }), null);
    assert.equal(ctx.syntheses.length, 0);
    const fallback = await ctx.api.getAudioBlob("Hello", "en", { allowSynthesis: false });
    assert.equal(fallback.provider, "google-tts");
    assert.equal(fallback.blob.type, "audio/mpeg");
    assert.equal(ctx.syntheses.length, 0);
});

test("provider errors fall back and are not cached as successful speech", async () => {
    const ctx = service({ synthesize: async () => { throw new Error("network unavailable"); } });
    const result = await ctx.api.getAudioBlob("Hello", "en", { allowSynthesis: true });
    assert.equal(result.provider, "google-tts");
    assert.equal(ctx.cache.size, 0);
});

test("cancelling during synthesis prevents late playback", async () => {
    let finish;
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const ctx = service({ synthesize: async () => {
        started();
        return new Promise((resolve) => { finish = resolve; });
    } });
    const speech = ctx.api.speak("Hello", "en");
    await ready;
    ctx.api.cancel();
    finish(ctx.mp3);
    const result = await speech;
    assert.equal(result.type, "none");
});
