const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Config = require("./subscription-config");
const Tts = require("./gemini-tts");

function backend({ plan = "basic", used = 12, cached = null, fail = false, month = Config.currentMonth() } = {}) {
    const data = { plan, elevenLabsCharactersThisMonth: used, elevenLabsResetDate: month };
    const snapshot = () => ({ exists: true, data: () => ({ ...data }) });
    const userRef = { get: async () => snapshot() };
    const db = { collection: () => ({ doc: () => userRef }), runTransaction: async (fn) => fn({
        get: async () => snapshot(), set: (_, patch) => Object.assign(data, patch),
    }) };
    const counts = { synth: 0, cacheRead: 0, cacheWrite: 0 };
    let synthesis;
    const sandbox = {
        exports: {}, Buffer, process: { env: {} }, console: { error() {}, warn() {} },
        setTimeout, clearTimeout,
        require(name) {
            if (name === "firebase-functions/v2/https") return { onRequest: (_, handler) => handler };
            if (name === "firebase-functions/v2/scheduler") return { onSchedule: () => () => {} };
            if (name === "firebase-functions/params") return { defineSecret: (name) => ({ value: () => ["LECTORO_GEMINI_API_KEY", "OPENAI_API_KEY"].includes(name) ? "test-key" : "" }) };
            if (name === "firebase-admin") return { apps: [{}], firestore: () => db, auth: () => ({ verifyIdToken: async () => ({ uid: "test-user", plan }) }) };
            if (["./stripe-billing", "./consolidate-dictionary"].includes(name)) return {};
            if (name === "./subscription-config") return Config;
            if (name === "./gemini-policy") return require(name);
            if (name === "./gemini-tts") return { ...Tts, synthesizeSpeech: async (args) => {
                counts.synth++; synthesis = args;
                if (fail) { const error = new Error("upstream failure"); error.code = "OPENAI_TTS_PROVIDER_QUOTA"; throw error; }
                return Buffer.from([0, 0]);
            } };
            if (name === "./r2-storage") return {
                getCachedAudio: async () => { counts.cacheRead++; return cached; },
                saveCachedAudio: async () => { counts.cacheWrite++; },
            };
            throw new Error(`Unexpected dependency: ${name}`);
        },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("./index"), "utf8"), sandbox);
    return { data, counts, get synthesis() { return synthesis; },
        async request(body = {}) {
            const response = { statusCode: 200, headers: {}, set(k, v) { this.headers[k] = v; },
                status(code) { this.statusCode = code; return this; },
                json(payload) { this.body = payload; return this; }, send(payload) { this.body = payload; return this; },
            };
            await sandbox.exports.geminiProxy({ method: "POST", headers: { authorization: "Bearer test" }, body: {
                action: "synthesizeGeminiTts", context: "review", voiceId: "nova", text: "Hello", language: "en", ...body,
            } }, response);
            return response;
        },
    };
}

test("successful synthesis preserves existing character usage and does not charge the AI analysis quota", async () => {
    const server = backend();
    const response = await server.request({ language: "pl" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "audio/mpeg");
    assert.equal(server.data.elevenLabsCharactersThisMonth, 17);
    assert.equal(server.data.aiCallsThisMonth, undefined);
    assert.equal(server.synthesis.language, "pl");
    assert.equal(server.synthesis.apiKey, "test-key");
    assert.equal(server.counts.cacheWrite, 1);
});

test("provider error rolls back only the current TTS reservation", async () => {
    const server = backend({ fail: true });
    const response = await server.request();
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "OPENAI_TTS_PROVIDER_QUOTA");
    assert.equal(server.data.elevenLabsCharactersThisMonth, 12);
    assert.equal(server.counts.cacheWrite, 0);
});

test("R2 cache hits charge character quota, including after a month rollover", async () => {
    const server = backend({ used: 999, month: "2000-01", cached: { buffer: Buffer.from("mp3"), contentType: "audio/mpeg" } });
    const response = await server.request();
    assert.equal(response.headers["X-Lectoro-Cache"], "HIT");
    assert.equal(response.headers["X-Lectoro-TTS-Used"], "5");
    assert.equal(server.counts.synth, 0);
    assert.equal(server.data.elevenLabsCharactersThisMonth, 5);
});

test("free plan, invalid voice, invalid language and overlong input fail before cache or provider access", async () => {
    for (const [options, body] of [
        [{ plan: "free" }, {}], [{}, { voiceId: "unknown-voice" }], [{}, { language: "../pl" }],
        [{}, { text: "x".repeat(501) }], [{}, { text: " " }], [{}, { context: "content" }],
    ]) {
        const server = backend(options);
        const response = await server.request(body);
        assert.ok(response.statusCode >= 400);
        assert.equal(server.counts.synth, 0);
        assert.equal(server.counts.cacheRead, 0);
        assert.equal(server.data.elevenLabsCharactersThisMonth, 12);
    }
});

test("exhausted monthly quota prevents synthesis and R2 downloads", async () => {
    const limit = Config.getPlanLimits("basic").geminiTts.charactersPerMonth;
    const server = backend({ used: limit });
    const response = await server.request();
    assert.equal(response.statusCode, 429);
    assert.equal(server.counts.synth, 0);
    assert.equal(server.data.elevenLabsCharactersThisMonth, limit);
    const hit = backend({ used: limit, cached: { buffer: Buffer.from("mp3") } });
    assert.equal((await hit.request()).statusCode, 429);
});

test("hover context serves from R2 if cached and returns 404 without synthesizing if miss", async () => {
    const hitServer = backend({ cached: { buffer: Buffer.from("mp3") } });
    const hitRes = await hitServer.request({ context: "hover" });
    assert.equal(hitRes.statusCode, 200);
    assert.equal(hitRes.headers["X-Lectoro-Cache"], "HIT");
    assert.equal(hitServer.counts.synth, 0);
    assert.equal(hitServer.data.elevenLabsCharactersThisMonth, 17);

    const missServer = backend({ cached: null });
    const missRes = await missServer.request({ context: "hover" });
    assert.equal(missRes.statusCode, 404);
    assert.equal(missRes.body.code, "GEMINI_TTS_NOT_CACHED");
    assert.equal(missServer.counts.synth, 0);
    assert.equal(missServer.data.elevenLabsCharactersThisMonth, 12);
});

test("voice catalogue returns exactly the two chosen voices without contacting a provider", async () => {
    const server = backend();
    const response = await server.request({ action: "geminiTtsVoices" });
    assert.deepEqual(response.body.voices.map((v) => v.voice_id), ["nova", "alloy"]);
    assert.equal(server.counts.synth, 0);
});
