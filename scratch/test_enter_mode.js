/** Behavior regressions for Enter mode; prompt validation lives in functions/ai-quality.test.js. */
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction, cssRule, read } = require("../tests/helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const file = "video/subtitle-overlay.js";

function session(mode = "native") {
    const spoken = [],
        scheduled = [],
        navigated = [],
        rendered = [];
    const context = vm.createContext({
        C,
        PREFIX: C.PREFIX,
        SVG: C.SVG_ICONS,
        TTS_QUOTE_CLASS: "quote",
        aiTooltipActive: true,
        aiExplainMode: mode,
        aiExplainSourceLang: "en",
        aiExplainTargetLang: "pl",
        aiExplainSpeechToken: 1,
        aiExplainIndex: 0,
        aiExplainQueue: [],
        aiAutoAdvanceDisabled: false,
        aiAutoAdvanceTimer: null,
        aiSubTranslationEl: null,
        aiExplainLayout: {},
        aiSavedIndices: new Set(),
        aiAiSavedIndices: new Set(),
        translationOverlay: { querySelector: () => null },
        speakUntilFinished: async (text, lang) => spoken.push({ text, lang }),
        showAiExplainItem: (index, options) =>
            navigated.push({ index, options }),
        setTimeout: (fn) => {
            scheduled.push(fn);
            return scheduled.length;
        },
        clearTimeout() {},
        SharedTtsService: { cancel() {} },
        ensureAiExplainKeydownListener() {},
        removeSubtitleTranslationUnderOriginal() {},
        updateSubtitleVideoHighlights() {},
        wireAiExplainSpeakButton() {},
        wireAiExplainSaveButton() {},
        applyAiExplanation: (html) => {
            rendered.push(html);
            return { querySelectorAll: () => [], querySelector: () => null };
        },
        QT: { ...U, formatSpeechMarkup: U.escapeHtml },
        document: { contains: () => true },
    });
    loadFunction(context, "core.js", "buildSaveFooterHtml");
    context.escapeHtml = U.escapeHtml;
    context.escapeAttr = U.escapeAttr;
    context.QT.buildSaveFooterHtml = context.buildSaveFooterHtml;
    for (const name of [
        "speakAiExplainItem",
        "navigateAiExplain",
        "saveCurrentAiExplainItem",
        "renderAiExplainContent",
    ]) {
        loadFunction(context, file, name);
    }
    return { context, spoken, scheduled, navigated, rendered };
}

for (const mode of ["native", "simple_target"]) {
    test(`Enter speaks sentence and word meanings in the correct ${mode} language`, async () => {
        const { context, spoken } = session(mode);
        await context.speakAiExplainItem(
            {
                type: "sentence",
                term: "hello",
                meaning: "meaning",
                explanation: "detail",
            },
            1,
        );
        await context.speakAiExplainItem(
            {
                type: "vocabulary",
                term: "hello",
                meaning: "meaning",
                explanation: "detail",
            },
            1,
        );
        assert.deepEqual(spoken, [
            { text: "meaning", lang: mode === "native" ? "pl" : "en" },
            { text: "hello", lang: "en" },
            { text: "meaning. detail", lang: mode === "native" ? "pl" : "en" },
        ]);
    });
}

test("last Enter item stays open without scheduling playback or another item", async () => {
    const state = session();
    state.context.aiExplainQueue = [
        { type: "sentence", meaning: "translation" },
    ];
    await state.context.speakAiExplainItem(state.context.aiExplainQueue[0], 1);
    assert.equal(state.scheduled.length, 0);
    assert.equal(state.context.aiTooltipActive, true);
});

test("manual navigation suppresses automatic advance and clamps queue boundaries", async () => {
    const state = session();
    state.context.aiExplainQueue = [
        { type: "sentence", meaning: "one" },
        { type: "vocabulary", meaning: "two" },
    ];
    state.context.aiAutoAdvanceDisabled = true;
    await state.context.speakAiExplainItem(state.context.aiExplainQueue[0], 1);
    assert.equal(state.scheduled.length, 0);
    assert.equal(state.context.navigateAiExplain(-1, { manual: true }), true);
    assert.equal(state.navigated.length, 0);
    state.context.navigateAiExplain(1, { manual: true });
    assert.equal(state.navigated[0].index, 1);
    assert.equal(state.navigated[0].options.manual, true);
});

test("stale speech token does not play or advance", async () => {
    const state = session();
    await state.context.speakAiExplainItem(
        { type: "sentence", meaning: "old" },
        0,
    );
    assert.equal(state.spoken.length, 0);
    assert.equal(state.scheduled.length, 0);
});

test("Z delegates to the real save button; no button never marks a phantom save", () => {
    const state = session();
    state.context.aiExplainQueue = [
        { type: "sentence", term: "hello", meaning: "cześć" },
    ];
    assert.equal(state.context.saveCurrentAiExplainItem(), false);
    assert.equal(state.context.aiSavedIndices.size, 0);
    let clicks = 0;
    state.context.translationOverlay.querySelector = () => ({
        click: () => clicks++,
    });
    assert.equal(state.context.saveCurrentAiExplainItem(), true);
    assert.equal(clicks, 1);
});

test("Enter renders escaped sentence translation, queue and shared Save/AI buttons", () => {
    const { context } = session();
    context.aiExplainQueue = [
        {
            type: "sentence",
            title: "Sentence",
            term: "original",
            meaning: "<img onerror=bad>",
            explanation: "hidden on sentence",
        },
        {
            type: "vocabulary",
            title: "Word",
            term: "hello",
            meaning: "cześć",
            explanation: "explanation",
            badge: "Słowo",
        },
    ];
    const sentence = context.renderAiExplainContent(0);
    assert.ok(sentence.includes("&lt;img onerror=bad&gt;"));
    assert.ok(!sentence.includes("<img onerror=bad>"));
    assert.ok(!sentence.includes("hidden on sentence"));
    assert.ok(sentence.includes("1/2"));
    assert.ok(sentence.includes("__qt_save-word-btn"));
    assert.ok(sentence.includes("__qt_save-ai-btn"));
    assert.ok(sentence.includes('data-lang="pl"'));
    const word = context.renderAiExplainContent(1);
    assert.ok(word.includes("explanation"));
    assert.ok(word.includes("2/2"));
});

test("last card remains rendered after showAiExplainItem with manual navigation", () => {
    const state = session();
    state.context.aiExplainQueue = [
        { type: "sentence", meaning: "translation" },
    ];
    loadFunction(state.context, file, "showAiExplainItem");
    state.context.showAiExplainItem(5, { manual: true });
    assert.equal(state.context.aiExplainIndex, 0);
    assert.equal(state.context.aiAutoAdvanceDisabled, true);
    assert.equal(state.context.aiTooltipActive, true);
    assert.equal(state.rendered.length, 1);
});

test("highlight CSS preserves geometry and retired sentence-step styling is absent", () => {
    for (const selector of [".__qt_ai-sub-wrap", ".__qt_ai-sub-active"]) {
        const rule = cssRule("styles.css", selector);
        assert.equal(rule.padding, "0 !important");
        assert.equal(rule.margin, "0 !important");
    }
    assert.match(
        cssRule("styles.css", ".__qt_ai-sub-active")["box-shadow"],
        /inset 0 0 0 1px #4ecdc4/,
    );
    assert.equal(
        cssRule("popup.css", ".review-word")["white-space"],
        "pre-line",
    );
    assert.ok(!read("styles.css").includes("qtSubTranslationActivePulse"));
});
