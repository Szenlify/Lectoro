const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { load, storage, tick } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");

const ok = (text = "przykład") => ({
    ok: true,
    json: async () => [[[text]], null, "en"],
});
function worker(fetcher = async () => ok(), initial = {}) {
    const store = storage(initial);
    const context = vm.createContext({
        LectoroConstants: C,
        SharedUtils: U,
        chrome: { storage: store },
        fetch: fetcher,
        AbortController,
        setTimeout,
        clearTimeout,
    });
    load(context, "shared/translator-service.js");
    return { context, store, service: context.SharedTranslatorService };
}

test("native language defaults and changes use the same storage setting", async () => {
    const { service, store } = worker();
    assert.equal(await service.getTargetLang(), "pl");
    await store.local.set({
        targetLang: "de",
        aiExplanationLanguage: "simple_target",
    });
    assert.equal(await service.getTargetLang(), "de");
    assert.equal((await service.getReadingSettings()).targetLang, "de");
});

test("identical concurrent requests share one fetch; languages have separate caches", async () => {
    const urls = [];
    const { service } = worker(async (url) => {
        urls.push(url);
        await tick();
        return ok();
    });
    await Promise.all([
        service.translate("example", "pl"),
        service.translate("example", "pl"),
    ]);
    assert.equal(urls.length, 1);
    await service.translate("example", "de");
    assert.equal(urls.length, 2);
    assert.deepEqual(
        urls.map((url) => new URL(url).searchParams.get("tl")),
        ["pl", "de"],
    );
});

test("word caches coalesce custom fetchers and hydrate before a cache miss", async () => {
    const key = C.STORAGE_KEYS.PERSISTENT_TRANSLATE_CACHE;
    let requests = 0;
    const { service } = worker(
        async () => {
            requests++;
            return ok();
        },
        {
            [key]: {
                [JSON.stringify(["en", "pl", "example"])]: { translated: "przykład", detectedLang: "en" },
            },
        },
    );
    const cache = service.createTranslateCache(1);
    assert.equal((await cache.get("example", "pl")).translated, "przykład");
    assert.equal(requests, 0);
    const fetcher = async () => {
        requests++;
        await tick();
        return { translated: "słowo" };
    };
    await Promise.all([
        cache.get("word", "pl", fetcher),
        cache.get("word", "pl", fetcher),
    ]);
    assert.equal(requests, 1);
    assert.equal(cache.size, 1);
});

test("transport never exceeds two simultaneous fetches", async () => {
    let active = 0,
        maximum = 0;
    const { service } = worker(async () => {
        maximum = Math.max(maximum, ++active);
        await tick();
        active--;
        return ok();
    });
    await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
            service.translate(`word ${index}`, "pl"),
        ),
    );
    assert.equal(maximum, 2);
});

test("HTTP 429 preserves Retry-After, rejects queued requests and survives worker restart", async () => {
    let count = 0;
    const { service, store } = worker(async () => {
        count++;
        return { ok: false, status: 429, headers: { get: () => "120" } };
    });
    const before = Date.now();
    await assert.rejects(
        service.translate("one", "pl"),
        (error) =>
            error.status === 429 &&
            error.code === "RATE_LIMITED" &&
            error.retryAt >= before + 120000,
    );
    await assert.rejects(service.translate("two", "pl"), {
        code: "RATE_LIMITED",
    });
    assert.equal(count, 1);
    const restarted = worker(async () => {
        count++;
        return ok();
    }, store.data);
    await assert.rejects(restarted.service.translate("three", "pl"), {
        code: "RATE_LIMITED",
    });
    assert.equal(count, 1);
});

test("content scripts propagate worker HTTP errors without direct network fallback", async () => {
    let direct = 0;
    const context = vm.createContext({
        window: {},
        chrome: { runtime: { sendMessage() {} } },
        LectoroConstants: C,
        SharedUtils: {
            sendRuntimeMessage: async () => {
                throw Object.assign(new Error("HTTP 429"), { status: 429 });
            },
        },
        fetch: async () => {
            direct++;
            return ok();
        },
    });
    load(context, "shared/translator-service.js");
    await assert.rejects(
        context.SharedTranslatorService.translate("example", "pl"),
        { status: 429 },
    );
    assert.equal(direct, 0);
});

test("empty/malformed results and network errors are not cached; a retry can succeed", async () => {
    for (const response of [
        ok(""),
        { ok: true, json: async () => ({}) },
        null,
    ]) {
        let requests = 0;
        const { service } = worker(async () => {
            if (++requests > 1) return ok();
            if (!response) throw new TypeError("Failed to fetch");
            return response;
        });
        await assert.rejects(service.translate("example", "pl"));
        assert.equal(
            (await service.translate("example", "pl")).translated,
            "przykład",
        );
        assert.equal(requests, 2);
    }
});

test("request timeout aborts transport and releases its queue slot", async () => {
    const { context, service } = worker(
        (url, { signal }) =>
            new Promise((resolve, reject) => {
                signal.addEventListener(
                    "abort",
                    () => reject(new DOMException("aborted", "AbortError")),
                    { once: true },
                );
            }),
    );
    context.setTimeout = (fn) => setTimeout(fn, 5);
    await assert.rejects(service.translate("example", "pl"), {
        code: "TRANSLATION_TIMEOUT",
    });
    context.fetch = async () => ok();
    assert.equal(
        (await service.translate("retry", "pl")).translated,
        "przykład",
    );
});

test("subtitle quota charges successful unique translations once, never failed attempts", async () => {
    let requests = 0,
        charges = 0,
        allowed = true;
    const { context, service } = worker(async () => {
        if (++requests === 1) throw new Error("offline");
        return ok();
    });
    context.SubscriptionService = {
        getSubtitleQuotaStatus: async () => ({ allowed }),
        consumeSubtitleQuota: async (characters) => {
            charges += characters;
            return { allowed };
        },
    };
    load(context, "shared/subtitle-translation-service.js");
    const subtitles = context.SharedSubtitleTranslationService;
    await assert.rejects(subtitles.translate("example", "pl"));
    assert.equal(charges, 0);
    const results = await Promise.all([
        subtitles.translate("example", "pl"),
        subtitles.translate("example", "pl"),
    ]);
    assert.ok(results.every((value) => value.status === "success"));
    assert.equal(charges, "example".length);
    assert.equal(requests, 2);
    allowed = false;
    assert.equal(
        (await subtitles.translate("new sentence", "pl")).status,
        "limit",
    );
    assert.equal(requests, 2);
    assert.equal(
        (await service.getCachedTranslation("example", "pl")).translated,
        "przykład",
    );
});

test("simultaneous subtitles from different tabs cannot overspend the remaining quota", async () => {
    let remaining = 7,
        count = 0;
    const { context } = worker(async () => {
        count++;
        await tick();
        return ok();
    });
    context.SubscriptionService = {
        getSubtitleQuotaStatus: async (n) => ({ allowed: remaining >= n }),
        consumeSubtitleQuota: async (n) => {
            remaining -= n;
            return { allowed: true };
        },
    };
    load(context, "shared/subtitle-translation-service.js");
    const results = await Promise.all(
        ["example", "another"].map((text) =>
            context.SharedSubtitleTranslationService.translate(text, "pl"),
        ),
    );
    assert.deepEqual(
        results.map((result) => result.status),
        ["success", "limit"],
    );
    assert.equal(count, 1);
    assert.equal(remaining, 0);
});

test("runtime error serialization preserves HTTP status and retry time for the UI", async () => {
    const context = vm.createContext({
        LectoroConstants: C,
        chrome: {
            runtime: {
                sendMessage: (message, done) =>
                    done({
                        error: "HTTP 429",
                        code: "RATE_LIMITED",
                        status: 429,
                        retryAt: 123456,
                    }),
            },
        },
    });
    load(context, "shared/utils.js");
    await assert.rejects(
        context.SharedUtils.sendRuntimeMessage({
            type: C.MESSAGE_TYPES.GOOGLE_TRANSLATE,
        }),
        (error) =>
            error.status === 429 &&
            error.retryAt === 123456 &&
            error.code === "RATE_LIMITED",
    );
});

test("popup requests also use the worker instead of a separate direct transport", async () => {
    let sent;
    const context = vm.createContext({
        window: { location: { protocol: "chrome-extension:" } },
        chrome: { runtime: { sendMessage() {} } },
        LectoroConstants: C,
        SharedUtils: {
            sendRuntimeMessage: async (message) => {
                sent = message;
                return {
                    result: { translated: "Beispiel", detectedLang: "en" },
                };
            },
        },
        fetch: () => assert.fail("Popup must use the worker"),
    });
    load(context, "shared/translator-service.js");
    assert.equal(
        (await context.SharedTranslatorService.translate("example", "de"))
            .translated,
        "Beispiel",
    );
    assert.equal(sent.targetLang, "de");
});

test("word-by-word options and token order reach the dictionary worker", async () => {
    let sent;
    const context = vm.createContext({
        window: {},
        chrome: { runtime: { sendMessage() {} } },
        LectoroConstants: C,
        SharedUtils: {
            sendRuntimeMessage: async (message) => {
                sent = message;
                return { result: [null, { translated: "poddawać się", length: 2 }, null] };
            },
        },
    });
    load(context, "shared/translator-service.js");
    const words = ["you", "gave", "up"];
    const result = await context.SharedTranslatorService.lookupWords(words, "pl", "en", { wordByWord: true });
    assert.equal(sent.type, C.MESSAGE_TYPES.LOOKUP_WORDS);
    assert.equal(sent.sourceLang, "en");
    assert.equal(sent.targetLang, "pl");
    assert.equal(sent.options.wordByWord, true);
    assert.deepEqual(sent.words, words);
    assert.equal(result[1].length, 2);
});
