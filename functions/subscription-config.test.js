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
                    trialDays: value.trialDays,
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
            free: { trialDays: 0, price: 0, currency: "PLN", ai: 10, srs: 50, ttsEnabled: false, ttsRequest: 0, ttsMonth: 0 },
            basic: { trialDays: 3, price: 7.99, currency: "USD", ai: 200, srs: 3000, ttsEnabled: true, ttsRequest: 500, ttsMonth: 20000 },
            pro: { trialDays: 3, price: 19.99, currency: "USD", ai: 1200, srs: 10000, ttsEnabled: true, ttsRequest: 1000, ttsMonth: 120000 },
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

test("cleanCardText strips subtitle artifacts, music tags, speaker markers, chevrons, and trailing dots or commas", () => {
    const SharedUtils = require("../shared/utils");
    const cases = [
        ["[music] >> If you going then I will go.", "If you going then I will go"],
        ["[Muzyka]", ""],
        ["[Śmiech]", ""],
        ["[Brawa]", ""],
        ["[Oklaski] Cześć wszystkim!", "Cześć wszystkim!"],
        ["♪ Never gonna give you up ♪", "Never gonna give you up"],
        [">> (music playing) >> Hey guys, welcome back!", "Hey guys, welcome back!"],
        ["[Applause] - Wait, is that true?", "Wait, is that true?"],
        ["NARRATOR: In a world where anything is possible.", "In a world where anything is possible"],
        ["<b>Hello</b> <font color=\"#fff\">world</font>", "Hello world"],
        ["[screaming] [laughter] Just do it!", "Just do it!"],
        ["  >>  Let's do this!  ", "Let's do this!"],
        ["SPEAKER 1: Exactly what I thought.", "Exactly what I thought"],
        ["Hello, world,", "Hello, world"],
        ["Word...", "Word"],
        ["Sentence with dots... and ending with comma,", "Sentence with dots... and ending with comma"],
        ["Napis z kropką na końcu.", "Napis z kropką na końcu"],
        ["Napis z przecinkiem na końcu,", "Napis z przecinkiem na końcu"],
        ["Wielokropek na końcu...", "Wielokropek na końcu"],
    ];

    for (const [input, expected] of cases) {
        assert.equal(SharedUtils.cleanCardText(input), expected);
        assert.equal(SharedUtils.cleanTextForTTS(input), expected);
    }

    require("../shared/subtitle-service");
    const SubtitleService = global.SharedSubtitleService || global.LectoroSubtitleService;
    if (SubtitleService?.cleanCueText) {
        assert.equal(SubtitleService.cleanCueText("[Muzyka]"), "");
        assert.equal(SubtitleService.cleanCueText("[Music] Hello!"), "Hello!");
        assert.equal(SubtitleService.cleanCueText(">> [Śmiech] Dobry wieczór"), "Dobry wieczór");
    }
});

test("formatNextUsageRenewalDate correctly formats Stripe timestamps and months", () => {
    const SharedUtils = require("../shared/utils");
    assert.equal(
        SharedUtils.formatNextUsageRenewalDate(1787140800),
        "August 19, 2026",
    );
    assert.equal(
        SharedUtils.formatNextUsageRenewalDate("2026-08"),
        "September 1, 2026",
    );
    assert.ok(SharedUtils.formatNextUsageRenewalDate(null));
    assert.ok(SharedUtils.formatNextUsageRenewalDate(""));
});
