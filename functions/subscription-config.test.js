const test = require("node:test");
const assert = require("node:assert/strict");
const {
    SUBSCRIPTION_LIMITS,
    normalizePlan,
    countCharacters,
    checkAiLimit,
    checkSrsLimit,
    checkElevenLabsLimit,
} = require("./subscription-config");

test("central configuration matches the three product plans", () => {
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(SUBSCRIPTION_LIMITS).map(([plan, value]) => [
                plan,
                {
                    price: value.priceMonthly.amount,
                    currency: value.priceMonthly.currency,
                    ai: value.ai.usesPerMonth,
                    srs: value.srs.maxSavedCards,
                    ttsEnabled: value.elevenLabs.enabled,
                    ttsRequest: value.elevenLabs.maxCharactersPerRequest,
                    ttsMonth: value.elevenLabs.charactersPerMonth,
                },
            ]),
        ),
        {
            free: { price: 0, currency: "PLN", ai: 3, srs: 3, ttsEnabled: false, ttsRequest: 0, ttsMonth: 0 },
            basic: { price: 7.99, currency: "USD", ai: 5, srs: 5, ttsEnabled: true, ttsRequest: 50, ttsMonth: 50 },
            pro: { price: 19.99, currency: "USD", ai: 7, srs: 7, ttsEnabled: true, ttsRequest: 100, ttsMonth: 100 },
        },
    );
});

test("unknown plans safely fall back to FREE", () => {
    assert.equal(normalizePlan("enterprise"), "free");
    assert.equal(checkAiLimit({ plan: "enterprise", used: 2 }).allowed, true);
    assert.equal(checkAiLimit({ plan: "enterprise", used: 3 }).code, "AI_LIMIT_REACHED");
});

test("AI and SRS limits come from the central configuration", () => {
    for (const [plan, limits] of Object.entries(SUBSCRIPTION_LIMITS)) {
        assert.equal(
            checkAiLimit({ plan, used: limits.ai.usesPerMonth - 1 }).allowed,
            true,
        );
        assert.equal(checkAiLimit({ plan, used: limits.ai.usesPerMonth }).allowed, false);
        assert.equal(
            checkSrsLimit({ plan, savedCards: limits.srs.maxSavedCards - 1 }).allowed,
            true,
        );
        assert.equal(
            checkSrsLimit({ plan, savedCards: limits.srs.maxSavedCards }).allowed,
            false,
        );
    }
});

test("FREE cannot use ElevenLabs", () => {
    const result = checkElevenLabsLimit({ plan: "free", text: "Hello", usedCharacters: 0 });
    assert.equal(result.allowed, false);
    assert.equal(result.code, "ELEVENLABS_NOT_INCLUDED");
});

test("ElevenLabs enforces per-request and monthly character quotas", () => {
    assert.equal(
        checkElevenLabsLimit({ plan: "basic", text: "a".repeat(50), usedCharacters: 0 }).allowed,
        true,
    );
    assert.equal(
        checkElevenLabsLimit({ plan: "basic", text: "a".repeat(51), usedCharacters: 0 }).code,
        "ELEVENLABS_REQUEST_TOO_LONG",
    );
    assert.equal(
        checkElevenLabsLimit({ plan: "pro", text: "abc", usedCharacters: 98 }).code,
        "ELEVENLABS_MONTHLY_LIMIT_REACHED",
    );
});

test("character counting handles Unicode code points", () => {
    assert.equal(countCharacters("  A😀B  "), 3);
});
