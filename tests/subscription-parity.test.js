const test = require("node:test");
const assert = require("node:assert/strict");

const clientConfig = require("../shared/subscription-config.js");
const serverConfig = require("../functions/subscription-config.js");

test("subscription plan keys and pricing match between client and backend configs", () => {
    assert.deepEqual(
        Object.keys(clientConfig.SUBSCRIPTION_LIMITS).sort(),
        Object.keys(serverConfig.SUBSCRIPTION_LIMITS).sort(),
    );

    for (const plan of Object.keys(clientConfig.SUBSCRIPTION_LIMITS)) {
        const clientPlan = clientConfig.SUBSCRIPTION_LIMITS[plan];
        const serverPlan = serverConfig.SUBSCRIPTION_LIMITS[plan];

        assert.equal(clientPlan.trialDays, serverPlan.trialDays, `Trial days mismatch for ${plan}`);
        assert.deepEqual(clientPlan.priceMonthly, serverPlan.priceMonthly, `Price mismatch for ${plan}`);
        assert.deepEqual(clientPlan.ai, serverPlan.ai, `AI limits mismatch for ${plan}`);
        assert.deepEqual(clientPlan.srs, serverPlan.srs, `SRS limits mismatch for ${plan}`);
        assert.deepEqual(clientPlan.geminiTts, serverPlan.geminiTts, `Gemini TTS limits mismatch for ${plan}`);
        assert.deepEqual(clientPlan.subtitles, serverPlan.subtitles, `Subtitles limits mismatch for ${plan}`);
    }
});

test("plan normalization behaves identically across client and backend", () => {
    for (const input of ["free", "basic", "pro", "FREE", "BASIC", "PRO", "unknown", null, undefined, 123]) {
        assert.equal(
            clientConfig.normalizePlan(input),
            serverConfig.normalizePlan(input),
            `Normalization mismatch for input ${input}`,
        );
    }
});
