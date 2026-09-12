const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction, deferred } = require("./helpers");

function client(fetch, timers = {}) {
    const context = vm.createContext({
        livePending: new Map(), getToken: async () => "token", setCachedUsage: async () => {},
        PROXY_URL: "https://example.test/proxy", fetch, AbortController, setTimeout, clearTimeout,
        ...timers,
    });
    loadFunction(context, "shared/gemini-proxy.js", "liveTranslation");
    return (word = "Polish") => context.liveTranslation("word", word, "en", "pl");
}

test("live requests deduplicate and release pending state after completion", async () => {
    let calls = 0;
    const gate = deferred();
    const run = client(async () => {
        calls++;
        await gate.promise;
        return { ok: true, json: async () => ({ result: { Polish: { t: "polski" } } }) };
    });
    const first = run();
    assert.equal(run(), first);
    gate.resolve();
    assert.equal((await first).Polish.t, "polski");
    assert.equal(calls, 1);
    await run();
    assert.equal(calls, 2);
});
test("proxy normalizes case before deduplicating and sending word requests", async () => {
    let calls = 0;
    const run = client(async (_, options) => {
        calls++;
        assert.equal(JSON.parse(options.body).text, "wounds");
        return { ok: true, json: async () => ({ result: { wounds: { t: "rany" } } }) };
    });
    const first = run("WOUNDS");
    assert.equal(run("wOunDS"), first);
    assert.equal(run("wounds"), first);
    assert.equal((await first).wounds.t, "rany");
    assert.equal(calls, 1);
});

test("the timeout covers response body reading and returns a useful error", async () => {
    let expire, cleared = false;
    const reading = deferred();
    const run = client(async (_, { signal }) => ({
        ok: true,
        json: () => new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
            reading.resolve();
        }),
    }), { setTimeout: fn => { expire = fn; return 1; }, clearTimeout: () => { cleared = true; } });
    const pending = run();
    await reading.promise;
    assert.equal(cleared, false);
    expire();
    await assert.rejects(pending, { code: "TRANSLATION_TIMEOUT" });
    assert.equal(cleared, true);
});

test("server error codes survive and a generic 503 is not mislabeled as quota exhaustion", async () => {
    for (const code of ["TRANSLATION_STORAGE_FAILED", undefined]) {
        const run = client(async () => ({ ok: false, status: 503,
            json: async () => ({ error: "Could not save the translation.", code }) }));
        await assert.rejects(run(), { code: code || "AI_REQUEST_FAILED", status: 503 });
    }
});
