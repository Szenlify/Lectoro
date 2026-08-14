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
