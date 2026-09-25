const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction, deferred } = require("./helpers");

function harness() {
    let cancels = 0, removed = 0, resumed = 0;
    const context = vm.createContext({
        aiTooltipActive: true, aiPaywallActive: false, aiExplainRequestId: 1,
        aiExplainSpeechToken: 4, aiExplainSpeechPromise: Promise.resolve(),
        aiExplainKeydownHandler: null, aiAutoAdvanceTimer: null, aiAutoAdvanceDisabled: false,
        aiExplainQueue: [], aiExplainIndex: 0, aiExplainLayout: {},
        aiSavedIndices: new Set(), aiAiSavedIndices: new Set(), activeAiVideo: {},
        AI_EXPLAIN_OVERLAY_CLASS: "ai", translationAnchorLayout: {},
        translationOverlay: { classList: { contains: () => true }, remove: () => { removed++; } },
        window: { removeEventListener() {} }, document: { body: { removeAttribute() {} } },
        clearTimeout() {}, SharedTtsService: { cancel: () => { cancels++; } },
        clearSubtitleVideoHighlights() {}, QT: { hideTooltip() {} }, cleanupReading() {},
        removeSubtitleTranslationUnderOriginal() {},
        getPlayerRegistry: () => ({ getVideo: () => ({}) }),
        resumeVideoAfterSubtitleClose: () => { resumed++; },
    });
    for (const name of ["closeAiTooltip", "removeOverlay", "removeAiShimmer"]) {
        loadFunction(context, "video/subtitle-overlay.js", name);
    }
    return { context, counts: () => ({ cancels, removed, resumed }) };
}

for (const method of ["closeAiTooltip", "removeOverlay", "removeAiShimmer"]) {
    test(`${method} ends narration and invalidates pending Enter work`, () => {
        const { context, counts } = harness();
        context[method]();
        assert.equal(context.aiTooltipActive, false);
        assert.equal(context.aiExplainSpeechToken, 5);
        assert.equal(context.aiExplainSpeechPromise, null);
        assert.equal(context.aiExplainRequestId, 2);
        assert.equal(counts().cancels, 1);
        assert.equal(counts().removed, 1);
        assert.equal(counts().resumed, method === "closeAiTooltip" ? 1 : 0);
        context.closeAiTooltip();
        assert.equal(counts().cancels, 1, "repeated dismissal must not stop unrelated new speech");
    });
}

test("panel rebuild preserves the active Enter session", () => {
    const { context, counts } = harness();
    context.removeOverlay({ preserveAiSession: true });
    assert.equal(context.aiTooltipActive, true);
    assert.equal(context.aiExplainSpeechToken, 4);
    assert.equal(counts().cancels, 0);
});

test("speech stops before a failing DOM cleanup", () => {
    const { context, counts } = harness();
    context.clearSubtitleVideoHighlights = () => { throw Error("detached page"); };
    assert.throws(() => context.closeAiTooltip());
    assert.equal(counts().cancels, 1);
    assert.equal(context.aiTooltipActive, false);
});

test("translation completing after dismissal cannot start narration again", async () => {
    const { context } = harness();
    const pending = deferred();
    let played = 0;
    Object.assign(context, {
        PREFIX: "qt", aiExplainTargetLang: "pl", aiExplainSourceLang: "en",
        SharedUtils: { isLikelyEnglish: () => true },
        SharedTranslatorService: { translate: () => pending.promise },
        speakUntilFinished: async (text, lang, opts) => { if (!opts.isCancelled()) played++; },
    });
    context.translationOverlay.querySelector = () => null;
    loadFunction(context, "video/subtitle-overlay.js", "speakAiExplainItem");
    const speaking = context.speakAiExplainItem({ type: "sentence", meaning: "Hello", term: "Hello" }, 4);
    context.removeOverlay();
    pending.resolve({ translated: "Cześć" });
    await speaking;
    assert.equal(played, 0);
});
