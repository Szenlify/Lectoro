const test = require("node:test");
const assert = require("node:assert/strict");
const SubscriptionConfig = require("./subscription-config");

test("stale same-plan AI limit refreshes without signing out", async (t) => {
    const month = new Date().toISOString().slice(0, 7);
    const currentLimit = SubscriptionConfig.SUBSCRIPTION_LIMITS.pro.ai.usesPerMonth;
    let serverLimit = currentLimit;
    let fetchCalls = 0;
    let storageWrites = 0;
    const storage = {
        aiUsageCache: {
            uid: "user-1",
            month,
            plan: "pro",
            used: 4,
            limit: 7,
            remaining: 3,
            updatedAt: 1,
        },
    };

    global.SubscriptionConfig = SubscriptionConfig;
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getValidToken: async () => "token-1",
    };
    global.chrome = {
        storage: {
            local: {
                get: async (defaults) => ({ ...defaults, ...storage }),
                set: async (changes) => {
                    storageWrites += 1;
                    Object.assign(storage, changes);
                },
            },
        },
    };
    global.fetch = async () => {
        fetchCalls += 1;
        return {
            ok: true,
            json: async () => ({
                usage: {
                    plan: "pro",
                    used: 4,
                    limit: serverLimit,
                    remaining: serverLimit - 4,
                },
            }),
        };
    };
    t.after(() => {
        delete global.SubscriptionConfig;
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");
    const usage = await GeminiProxy.refreshUsage(false);

    assert.equal(usage.used, 4);
    assert.equal(usage.limit, currentLimit);
    assert.equal(usage.remaining, usage.limit - usage.used);
    assert.equal(storage.aiUsageCache.limit, usage.limit);
    assert.equal(fetchCalls, 1);
    assert.equal(storageWrites, 1);

    const cachedUsage = await GeminiProxy.refreshUsage(false);
    assert.equal(cachedUsage.limit, currentLimit);
    assert.equal(fetchCalls, 1);
    assert.equal(storageWrites, 1);

    // During a staggered rollout the backend remains authoritative. Never
    // rewrite its response to the newer local value, because the server is the
    // component that ultimately enforces AI requests.
    serverLimit = 7;
    const serverUsage = await GeminiProxy.refreshUsage(true);
    assert.equal(serverUsage.limit, 7);
    assert.equal(storage.aiUsageCache.limit, 7);
    assert.equal(fetchCalls, 2);
    assert.equal(storageWrites, 2);
});

test("subscription refresh reuses returned AI usage without a second request", async (t) => {
    const month = new Date().toISOString().slice(0, 7);
    const currentLimit = SubscriptionConfig.SUBSCRIPTION_LIMITS.pro.ai.usesPerMonth;
    const requestedActions = [];
    let storageWrites = 0;
    const storage = {
        aiUsageCache: {
            uid: "user-1",
            month,
            plan: "pro",
            used: 4,
            limit: 7,
            remaining: 3,
            updatedAt: 1,
        },
    };

    global.SubscriptionConfig = SubscriptionConfig;
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getIdTokenResult: async () => ({
            token: "token-1",
            claims: { plan: "pro" },
        }),
        getValidToken: async () => "token-1",
    };
    global.chrome = {
        storage: {
            local: {
                get: async (defaults) => ({ ...defaults, ...storage }),
                set: async (changes) => {
                    storageWrites += 1;
                    Object.assign(storage, changes);
                },
            },
        },
    };
    global.fetch = async (_url, options) => {
        const action = JSON.parse(options.body).action;
        requestedActions.push(action);
        assert.equal(action, "subscription");
        return {
            ok: true,
            json: async () => ({
                profile: {
                    uid: "user-1",
                    plan: "pro",
                    subscriptionStatus: "active",
                    usage: {
                        ai: { month, used: 4 },
                        elevenLabsCharacters: { month, used: 66 },
                    },
                },
                usage: {
                    plan: "pro",
                    used: 4,
                    limit: currentLimit,
                    remaining: currentLimit - 4,
                },
            }),
        };
    };
    t.after(() => {
        delete global.SubscriptionConfig;
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete global.GeminiProxy;
        delete global.SubscriptionService;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
        delete require.cache[require.resolve("../shared/subscription-service")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");
    global.GeminiProxy = GeminiProxy;
    const SubscriptionService = require("../shared/subscription-service");
    global.SubscriptionService = SubscriptionService;

    await SubscriptionService.refreshProfile(true);
    const usage = await GeminiProxy.refreshUsage(false);

    assert.equal(usage.used, 4);
    assert.equal(usage.limit, currentLimit);
    assert.equal(usage.remaining, currentLimit - 4);
    assert.deepEqual(requestedActions, ["subscription"]);
    assert.equal(storageWrites, 1);
});

test("GeminiProxy.uploadCardImage sends image to backend and returns url", async (t) => {
    let sentBody = null;
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getValidToken: async () => "token-1",
    };
    global.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    global.fetch = async (_url, options) => {
        sentBody = JSON.parse(options.body);
        return {
            ok: true,
            json: async () => ({
                ok: true,
                key: "images/user-1/word-1.webp",
                url: "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/images/user-1/word-1.webp",
            }),
        };
    };
    t.after(() => {
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");
    const result = await GeminiProxy.uploadCardImage(
        "word-1",
        "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AA/v2y0AAAA",
    );

    assert.ok(result);
    assert.equal(
        result.url,
        "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/images/user-1/word-1.webp",
    );
    assert.equal(sentBody.action, "uploadCardImage");
    assert.equal(sentBody.wordId, "word-1");
    assert.equal(sentBody.contentType, "image/webp");
});

test("GeminiProxy.deleteCardImage and deleteAllUserImages send correct actions", async (t) => {
    const sentBodies = [];
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getValidToken: async () => "token-1",
    };
    global.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    global.fetch = async (_url, options) => {
        sentBodies.push(JSON.parse(options.body));
        return {
            ok: true,
            json: async () => ({ ok: true, deletedCount: 5 }),
        };
    };
    t.after(() => {
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");

    const singleDeleted = await GeminiProxy.deleteCardImage("word-1");
    assert.equal(singleDeleted, true);
    assert.equal(sentBodies[0].action, "deleteCardImage");
    assert.equal(sentBodies[0].wordId, "word-1");

    const batchDeleted = await GeminiProxy.deleteCardImage(["w1", "w2"]);
    assert.equal(batchDeleted, true);
    assert.equal(sentBodies[1].action, "deleteCardImage");
    assert.deepEqual(sentBodies[1].wordIds, ["w1", "w2"]);

    const allDeleted = await GeminiProxy.deleteAllUserImages();
    assert.equal(allDeleted, 5);
    assert.equal(sentBodies[2].action, "deleteAllUserImages");
});

test("SubscriptionService immediately resets limits and AI cache when plan changes from PRO to FREE", async (t) => {
    const month = new Date().toISOString().slice(0, 7);
    const freeLimit = SubscriptionConfig.SUBSCRIPTION_LIMITS.free.ai.usesPerMonth;
    const storage = {
        subscriptionProfileCache: {
            uid: "user-1",
            plan: "pro",
            subscriptionStatus: "active",
            usage: { ai: { month, used: 20 }, elevenLabsCharacters: { month, used: 100 } },
            updatedAt: 1,
        },
        aiUsageCache: {
            uid: "user-1",
            month,
            plan: "pro",
            used: 20,
            limit: 200,
            remaining: 180,
            updatedAt: 1,
        },
    };

    global.SubscriptionConfig = SubscriptionConfig;
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getIdTokenResult: async () => ({
            token: "token-1",
            claims: { plan: "free" },
        }),
        getValidToken: async () => "token-1",
    };
    global.chrome = {
        storage: {
            local: {
                get: async (defaults) => ({ ...defaults, ...storage }),
                set: async (changes) => {
                    Object.assign(storage, changes);
                },
            },
        },
    };
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            profile: {
                uid: "user-1",
                plan: "free",
                subscriptionStatus: "inactive",
                usage: { ai: { month, used: 20 }, elevenLabsCharacters: { month, used: 0 } },
            },
            usage: {
                plan: "free",
                used: 20,
                limit: freeLimit,
                remaining: 0,
            },
        }),
    });

    t.after(() => {
        delete global.SubscriptionConfig;
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete global.GeminiProxy;
        delete global.SubscriptionService;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
        delete require.cache[require.resolve("../shared/subscription-service")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");
    global.GeminiProxy = GeminiProxy;
    const SubscriptionService = require("../shared/subscription-service");
    global.SubscriptionService = SubscriptionService;

    const updated = await SubscriptionService.refreshProfile(true);
    assert.equal(updated.plan, "free");
    assert.equal(storage.subscriptionProfileCache.plan, "free");
    assert.equal(storage.aiUsageCache.plan, "free");
    assert.equal(storage.aiUsageCache.limit, freeLimit);
    assert.equal(storage.aiUsageCache.remaining, 0);
});

test("GeminiProxy reuses cached response for identical prompts without network fetch", async (t) => {
    let networkFetches = 0;
    const storage = {
        aiUsageCache: {
            uid: "user-cache-1",
            month: new Date().toISOString().slice(0, 7),
            plan: "basic",
            used: 1,
            limit: 200,
            remaining: 199,
            updatedAt: Date.now(),
        },
    };

    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-cache-1" }),
        getValidToken: async () => "token-cache-1",
    };
    global.chrome = {
        storage: {
            local: {
                get: async (defaults) => ({ ...defaults, ...storage }),
                set: async (changes) => Object.assign(storage, changes),
            },
        },
    };
    global.fetch = async () => {
        networkFetches += 1;
        return {
            ok: true,
            json: async () => ({
                text: '{"translation":"Cześć","explanation":"Powitanie"}',
                usage: { plan: "basic", used: 2, limit: 200, remaining: 198 },
            }),
        };
    };

    t.after(() => {
        delete global.FirebaseSync;
        delete global.chrome;
        delete global.fetch;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
    });

    const GeminiProxy = require("../shared/gemini-proxy");
    GeminiProxy.clearAiCache();

    // 1st call -> network fetch
    const first = await GeminiProxy.request("Explain Hello", { temperature: 0.7, maxOutputTokens: 250 });
    assert.equal(networkFetches, 1);
    assert.equal(first.cached, false);

    // 2nd call -> served from cache
    const second = await GeminiProxy.request("Explain Hello", { temperature: 0.7, maxOutputTokens: 250 });
    assert.equal(networkFetches, 1); // No new network call!
    assert.equal(second.cached, true);
    assert.equal(second.text, first.text);
});

test("AIPrompts generate concise token-saving prompts with JSON instructions", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const sentence = AIPrompts.sentenceExample("apple", "jabłko", "en", "pl");
    assert.ok(sentence.includes("Create 1 natural everyday sentence"));
    assert.ok(sentence.includes("JSON"));

    const explain = AIPrompts.explainSentence("Break a leg!", "pl");
    assert.ok(explain.includes("Explain this video subtitle sentence in pl:"));
    assert.ok(explain.includes("Break a leg!"));

    const standard = AIPrompts.standardTranslate("run", "She runs fast", "en", "pl");
    assert.ok(standard.includes("Translate \"run\" (English) to Polish."));
});

