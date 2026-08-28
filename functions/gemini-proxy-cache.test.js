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
    assert.equal(result.relativePath, "user-1/word-1.webp");
    assert.equal(result.path, "user-1/word-1.webp");
    assert.equal(sentBody.action, "uploadCardImage");
    assert.equal(sentBody.wordId, "word-1");
    assert.equal(sentBody.contentType, "image/webp");
});

test("GeminiProxy.uploadCardImage retries with refreshed token on 401", async (t) => {
    let callCount = 0;
    const tokensUsed = [];
    global.FirebaseSync = {
        getUser: async () => ({ uid: "user-1" }),
        getValidToken: async (force) => (force ? "token-refreshed" : "token-expired"),
    };
    global.chrome = {
        storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    global.fetch = async (_url, options) => {
        callCount++;
        tokensUsed.push(options.headers.Authorization);
        if (callCount === 1) {
            return {
                status: 401,
                ok: false,
                json: async () => ({ error: "Invalid token" }),
            };
        }
        return {
            status: 200,
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
    const result = await GeminiProxy.uploadCardImage("word-1", "data:image/webp;base64,AAA");
    assert.ok(result);
    assert.equal(callCount, 2);
    assert.deepEqual(tokensUsed, ["Bearer token-expired", "Bearer token-refreshed"]);
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
    assert.ok(standard.includes("understand the word \"run\" in English"));
    assert.ok(standard.includes("Word: \"run\""));
});

test("AIPrompts formats surrounding subtitle context (before and after) and constrains translation to target sentence", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const context = {
        before: ["Did you see the suspect?", "Yes, he was tall."],
        after: ["Where did he run?", "Toward the subway station."],
    };

    const explainWithContext = AIPrompts.explainSentence("He dropped this envelope.", "pl", context);
    assert.ok(explainWithContext.includes("Explain this video subtitle sentence in pl:"));
    assert.ok(explainWithContext.includes('"He dropped this envelope."'));
    assert.ok(explainWithContext.includes("SURROUNDING MOVIE DIALOGUE CONTEXT"));
    assert.ok(explainWithContext.includes("Previous dialogue:"));
    assert.ok(explainWithContext.includes('- "Did you see the suspect?"'));
    assert.ok(explainWithContext.includes('- "Yes, he was tall."'));
    assert.ok(explainWithContext.includes("Following dialogue:"));
    assert.ok(explainWithContext.includes('- "Where did he run?"'));
    assert.ok(explainWithContext.includes('- "Toward the subway station."'));
    assert.ok(explainWithContext.includes("Translate ONLY the target sentence"));
    assert.ok(explainWithContext.includes("DO NOT translate the previous or following dialogue"));

    const movieWithContext = AIPrompts.movieTranslate("He dropped this envelope.", "pl", context);
    assert.ok(movieWithContext.includes('"He dropped this envelope."'));
    assert.ok(movieWithContext.includes("SURROUNDING MOVIE DIALOGUE CONTEXT"));
    assert.ok(movieWithContext.includes("Translate ONLY the target text"));
    assert.ok(movieWithContext.includes("NEVER translate the surrounding dialogue context"));
});

test("SharedSubtitleService.getSurroundingContext extracts before and after cues accurately", () => {
    const SubtitleService = require("../shared/subtitle-service");
    const cues = [
        { startTime: 1.0, endTime: 3.0, text: "Line 1: Hello everyone." },
        { startTime: 3.5, endTime: 5.5, text: "Line 2: Welcome to the show." },
        { startTime: 6.0, endTime: 8.0, text: "Line 3: Today we discuss AI." },
        { startTime: 8.5, endTime: 11.0, text: "Line 4: It changes everything." },
        { startTime: 11.5, endTime: 14.0, text: "Line 5: Thanks for watching." },
    ];

    // Search at time 7.0 (during Line 3)
    const ctx = SubtitleService.getSurroundingContext(cues, 7.0, "Today we discuss AI", { maxBefore: 2, maxAfter: 2 });
    assert.equal(ctx.current, "Line 3: Today we discuss AI.");
    assert.deepEqual(ctx.before, ["Line 1: Hello everyone.", "Line 2: Welcome to the show."]);
    assert.deepEqual(ctx.after, ["Line 4: It changes everything.", "Line 5: Thanks for watching."]);

    // Boundary: first cue
    const firstCtx = SubtitleService.getSurroundingContext(cues, 1.5, "Line 1: Hello everyone.", { maxBefore: 2, maxAfter: 2 });
    assert.deepEqual(firstCtx.before, []);
    assert.equal(firstCtx.current, "Line 1: Hello everyone.");
    assert.deepEqual(firstCtx.after, ["Line 2: Welcome to the show.", "Line 3: Today we discuss AI."]);

    // Boundary: last cue
    const lastCtx = SubtitleService.getSurroundingContext(cues, 12.0, "Line 5: Thanks for watching.", { maxBefore: 2, maxAfter: 2 });
    assert.deepEqual(lastCtx.before, ["Line 3: Today we discuss AI.", "Line 4: It changes everything."]);
    assert.equal(lastCtx.current, "Line 5: Thanks for watching.");
    assert.deepEqual(lastCtx.after, []);

    // Empty cues fallback
    const emptyCtx = SubtitleService.getSurroundingContext([], 5.0, "Fallback text");
    assert.deepEqual(emptyCtx.before, []);
    assert.equal(emptyCtx.current, "Fallback text");
    assert.deepEqual(emptyCtx.after, []);
});

test("SharedUtils.resolveImageUrl resolves relative R2 paths and preserves URLs/data URIs", () => {
    const SharedUtils = require("../shared/utils");
    assert.equal(
        SharedUtils.resolveImageUrl("user123/word456.webp"),
        "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/images/user123/word456.webp",
    );
    assert.equal(
        SharedUtils.resolveImageUrl("images/user123/word456.webp"),
        "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/images/user123/word456.webp",
    );
    assert.equal(
        SharedUtils.resolveImageUrl("https://custom.cdn.com/myimg.webp"),
        "https://custom.cdn.com/myimg.webp",
    );
    assert.equal(
        SharedUtils.resolveImageUrl("data:image/webp;base64,abc"),
        "data:image/webp;base64,abc",
    );
    assert.equal(SharedUtils.resolveImageUrl(""), "");
    assert.equal(SharedUtils.resolveImageUrl(null), "");
});

test("SharedUtils.toRelativeImagePath extracts clean relative path from URLs or keys", () => {
    const SharedUtils = require("../shared/utils");
    assert.equal(
        SharedUtils.toRelativeImagePath("https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/images/user123/word456.webp"),
        "user123/word456.webp",
    );
    assert.equal(
        SharedUtils.toRelativeImagePath("images/user123/word456.webp"),
        "user123/word456.webp",
    );
    assert.equal(
        SharedUtils.toRelativeImagePath("user123/word456.webp"),
        "user123/word456.webp",
    );
    assert.equal(
        SharedUtils.toRelativeImagePath("data:image/webp;base64,abc"),
        "data:image/webp;base64,abc",
    );
});

test("SharedUtils.computeTextHash standardizes text with trim and lowercase", async () => {
    const SharedUtils = require("../shared/utils");
    const crypto = require("crypto");

    const hash1 = await SharedUtils.computeTextHash("Apple ");
    const hash2 = await SharedUtils.computeTextHash("  apple");
    const hash3 = await SharedUtils.computeTextHash("APPLE");

    const expected = crypto.createHash("sha256").update("apple").digest("hex");

    assert.equal(hash1, expected);
    assert.equal(hash2, expected);
    assert.equal(hash3, expected);
});

test("SharedUtils.getR2AudioUrl builds deterministic CDN URL", async () => {
    const SharedUtils = require("../shared/utils");
    const crypto = require("crypto");

    const url = await SharedUtils.getR2AudioUrl("21m00Tcm4TlvDq8ikWAM", "Hello World! ");
    const expectedHash = crypto.createHash("sha256").update("hello world!").digest("hex");

    assert.equal(
        url,
        `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/audio/21m00Tcm4TlvDq8ikWAM/${expectedHash}.mp3`,
    );
});

test("GeminiProxy delegates to chrome.runtime.sendMessage in content script environment", async (t) => {
    const sentMessages = [];
    global.window = {
        location: { protocol: "https:" },
    };
    global.chrome = {
        runtime: {
            sendMessage: (msg, callback) => {
                sentMessages.push(msg);
                if (msg.type === "QT_GEMINI_REQUEST") {
                    callback({ ok: true, result: { text: '{"sentence":"Test sentence.","translation":"Zdanie testowe."}', usage: {} } });
                } else if (msg.type === "QT_GEMINI_REFRESH_USAGE") {
                    callback({ ok: true, usage: { plan: "free", used: 1, limit: 10 } });
                }
            },
        },
        storage: {
            local: {
                get: async (def) => def,
                set: async () => {},
            },
            onChanged: {
                addListener: () => {},
            },
        },
    };
    global.FirebaseSync = {
        getUser: async () => ({ uid: "cs-user" }),
    };

    t.after(() => {
        delete global.window;
        delete global.chrome;
        delete global.FirebaseSync;
        delete require.cache[require.resolve("../shared/gemini-proxy")];
    });

    delete require.cache[require.resolve("../shared/gemini-proxy")];
    const GeminiProxy = require("../shared/gemini-proxy");

    const res = await GeminiProxy.request("Generate sentence", { cache: false });
    assert.ok(res.text.includes("Test sentence"));
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "QT_GEMINI_REQUEST");
    assert.equal(sentMessages[0].prompt, "Generate sentence");

    const usage = await GeminiProxy.refreshUsage(true);
    assert.equal(usage.plan, "free");
    assert.equal(sentMessages.length, 2);
    assert.equal(sentMessages[1].type, "QT_GEMINI_REFRESH_USAGE");
});

test("SubscriptionService delegates to chrome.runtime.sendMessage in content script environment", async (t) => {
    const sentMessages = [];
    global.SubscriptionConfig = SubscriptionConfig;
    global.window = {
        location: { protocol: "https:" },
    };
    global.chrome = {
        runtime: {
            sendMessage: (msg, callback) => {
                sentMessages.push(msg);
                if (msg.type === "QT_SUBSCRIPTION_REFRESH_PROFILE") {
                    callback({ ok: true, profile: { uid: "sub-user", plan: "pro", usage: { ai: { month: "2026-08", used: 0 }, elevenLabsCharacters: { month: "2026-08", used: 0 } } } });
                }
            },
        },
        storage: {
            local: {
                get: async (def) => def,
                set: async () => {},
            },
        },
    };
    global.FirebaseSync = {
        getUser: async () => ({ uid: "sub-user" }),
    };

    t.after(() => {
        delete global.SubscriptionConfig;
        delete global.window;
        delete global.chrome;
        delete global.FirebaseSync;
        delete require.cache[require.resolve("../shared/subscription-service")];
    });

    delete require.cache[require.resolve("../shared/subscription-service")];
    const SubscriptionService = require("../shared/subscription-service");

    const profile = await SubscriptionService.refreshProfile(true);
    assert.equal(profile.plan, "pro");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "QT_SUBSCRIPTION_REFRESH_PROFILE");
});

test("SharedTranslatorService delegates googleTranslate to chrome.runtime.sendMessage in content scripts", async (t) => {
    const sentMessages = [];
    global.window = {
        location: { protocol: "https:" },
    };
    global.chrome = {
        runtime: {
            sendMessage: (msg, callback) => {
                sentMessages.push(msg);
                if (msg.type === "QT_GOOGLE_TRANSLATE") {
                    callback({ ok: true, result: { translated: "Witaj świecie", detectedLang: "en" } });
                }
            },
        },
        storage: {
            local: {
                get: async (def) => def,
                set: async () => {},
            },
        },
    };

    t.after(() => {
        delete global.window;
        delete global.chrome;
        delete require.cache[require.resolve("../shared/translator-service")];
    });

    delete require.cache[require.resolve("../shared/translator-service")];
    const TranslatorService = require("../shared/translator-service");

    const res = await TranslatorService.translate("Hello world", "pl");
    assert.equal(res.translated, "Witaj świecie");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, "QT_GOOGLE_TRANSLATE");
    assert.equal(sentMessages[0].text, "Hello world");
});

test("SubscriptionConfig.checkSubtitleLimit enforces 15k limit on free plan and unlimited on paid plans", () => {
    const SubscriptionConfig = require("./subscription-config");

    // Free plan: 15,000 characters
    const allowedFree = SubscriptionConfig.checkSubtitleLimit({
        plan: "free",
        usedCharacters: 14000,
        requestedCharacters: 500,
    });
    assert.equal(allowedFree.allowed, true);
    assert.equal(allowedFree.remaining, 1000);

    const blockedFree = SubscriptionConfig.checkSubtitleLimit({
        plan: "free",
        usedCharacters: 14800,
        requestedCharacters: 300,
    });
    assert.equal(blockedFree.allowed, false);
    assert.equal(blockedFree.code, SubscriptionConfig.LIMIT_ERROR_CODES.SUBTITLES_HOURLY_LIMIT_REACHED);
    assert.equal(blockedFree.upgradeRequired, true);

    // Basic and Pro plans: Unlimited
    const basicCheck = SubscriptionConfig.checkSubtitleLimit({
        plan: "basic",
        usedCharacters: 500000,
        requestedCharacters: 1000,
    });
    assert.equal(basicCheck.allowed, true);
    assert.equal(basicCheck.remaining, Infinity);

    const proCheck = SubscriptionConfig.checkSubtitleLimit({
        plan: "pro",
        usedCharacters: 1000000,
        requestedCharacters: 2000,
    });
    assert.equal(proCheck.allowed, true);
    assert.equal(proCheck.remaining, Infinity);
});

test("SubscriptionService local subtitle quota tracking respects 15,000 characters/hour", async (t) => {
    delete require.cache[require.resolve("./subscription-config")];
    delete require.cache[require.resolve("../shared/subscription-config")];
    delete require.cache[require.resolve("../shared/subscription-service")];

    const SubscriptionConfig = require("../shared/subscription-config");
    global.SubscriptionConfig = SubscriptionConfig;

    const mockStorage = {
        subscriptionProfileCache: {
            plan: "free",
        },
        lectoro_subtitle_hourly_usage: {
            windowStart: Date.now(),
            used: 14950,
        },
    };

    global.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const res = {};
                    for (const [k, def] of Object.entries(keys)) {
                        res[k] = mockStorage[k] !== undefined ? mockStorage[k] : def;
                    }
                    return res;
                },
                set: async (items) => {
                    Object.assign(mockStorage, items);
                },
            },
        },
    };

    t.after(() => {
        delete global.SubscriptionConfig;
        delete global.chrome;
        delete require.cache[require.resolve("../shared/subscription-service")];
    });

    const SubscriptionService = require("../shared/subscription-service");

    // 14950 used + 30 chars requested => allowed (total 14980 <= 15000)
    const status1 = await SubscriptionService.consumeSubtitleQuota(30);
    assert.equal(status1.allowed, true);
    assert.equal(status1.used, 14980);
    assert.equal(status1.remaining, 20);

    // 14980 used + 50 chars requested => exceeds 15000 limit, blocked!
    const status2 = await SubscriptionService.consumeSubtitleQuota(50);
    assert.equal(status2.allowed, false);
    assert.equal(status2.code, "SUBTITLES_HOURLY_LIMIT_REACHED");
    assert.equal(status2.remaining, 20);

    // Storage is not corrupted with failed requested chars
    assert.equal(mockStorage.lectoro_subtitle_hourly_usage.used, 14980);
});



