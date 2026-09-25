const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Constants = require("../shared/constants");
const Config = require("../shared/subscription-config");
const Utils = require("../shared/utils");

function catalogue(plan, contentScript = false) {
    const sandbox = {
        LectoroConstants: Constants,
        SubscriptionConfig: Config,
        SharedUtils: { ...Utils,
            isContentScriptEnvironment: () => contentScript,
            postJson: () => assert.fail("voice catalogue must not call the backend"),
            sendRuntimeMessage: () => assert.fail("voice catalogue must not depend on the service worker"),
        },
        chrome: { storage: { local: { get: async () => ({ subscriptionProfileCache: { plan } }) } } },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve("../shared/subscription-service"), "utf8"), sandbox);
    return sandbox.SubscriptionService;
}

test("Review lists the two AI voices without a voice-list request, even before backend deployment", async () => {
    for (const contentScript of [false, true]) {
        const service = catalogue("basic", contentScript);
        const voices = await service.getGeminiTtsVoices("review");
        assert.deepEqual(Array.from(voices, (voice) => voice.voice_id), ["nova", "onyx"]);
        assert.deepEqual(Array.from(voices, (voice) => voice.name), ["Nova", "Onyx"]);
    }
});

test("local Gemini catalogue preserves plan and context restrictions", async () => {
    await assert.rejects(catalogue("free").getGeminiTtsVoices("review"));
    await assert.rejects(catalogue("basic").getGeminiTtsVoices("content"));
});
