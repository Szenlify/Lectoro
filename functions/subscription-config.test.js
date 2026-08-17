const test = require("node:test");
const assert = require("node:assert/strict");
const {
    SUBSCRIPTION_LIMITS,
    currentMonth,
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
            free: { price: 0, currency: "PLN", ai: 10, srs: 100, ttsEnabled: false, ttsRequest: 0, ttsMonth: 0 },
            basic: { price: 7.99, currency: "USD", ai: 100, srs: 2000, ttsEnabled: true, ttsRequest: 500, ttsMonth: 30000 },
            pro: { price: 19.99, currency: "USD", ai: 1000, srs: 8000, ttsEnabled: true, ttsRequest: 1000, ttsMonth: 150000 },
        },
    );
});

test("unknown plans safely fall back to FREE", () => {
    const freeAiLimit = SUBSCRIPTION_LIMITS.free.ai.usesPerMonth;
    assert.equal(normalizePlan("enterprise"), "free");
    assert.equal(
        checkAiLimit({ plan: "enterprise", used: freeAiLimit - 1 }).allowed,
        true,
    );
    assert.equal(
        checkAiLimit({ plan: "enterprise", used: freeAiLimit }).code,
        "AI_LIMIT_REACHED",
    );
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
    const basicLimits = SUBSCRIPTION_LIMITS.basic.elevenLabs;
    const proLimits = SUBSCRIPTION_LIMITS.pro.elevenLabs;
    assert.equal(
        checkElevenLabsLimit({
            plan: "basic",
            text: "a".repeat(basicLimits.maxCharactersPerRequest),
            usedCharacters: 0,
        }).allowed,
        true,
    );
    assert.equal(
        checkElevenLabsLimit({
            plan: "basic",
            text: "a".repeat(basicLimits.maxCharactersPerRequest + 1),
            usedCharacters: 0,
        }).code,
        "ELEVENLABS_REQUEST_TOO_LONG",
    );
    assert.equal(
        checkElevenLabsLimit({
            plan: "pro",
            text: "abc",
            usedCharacters: proLimits.charactersPerMonth - 2,
        }).code,
        "ELEVENLABS_MONTHLY_LIMIT_REACHED",
    );
    const lastCharacter = checkElevenLabsLimit({
        plan: "pro",
        text: "a",
        usedCharacters: proLimits.charactersPerMonth - 1,
    });
    assert.equal(lastCharacter.allowed, true);
    assert.equal(lastCharacter.remaining, 1);
    assert.equal(
        checkElevenLabsLimit({
            plan: "pro",
            text: "a",
            usedCharacters: proLimits.charactersPerMonth,
        }).code,
        "ELEVENLABS_MONTHLY_LIMIT_REACHED",
    );
});

test("character counting handles Unicode code points", () => {
    assert.equal(countCharacters("  A😀B  "), 3);
});

test("currentMonth returns YYYY-MM format", () => {
    assert.match(currentMonth(), /^\d{4}-\d{2}$/);
});
