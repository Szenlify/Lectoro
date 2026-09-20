const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const { dictionaryTerm } = require("../shared/translator-service");

function page(text, { failure = false, googleFailure = false, geminiTranslation = null } = {}) {
    const lookups = [], translations = [], rendered = [], translationOpts = [];
    const dictionary = { translated: "dom", primaryTranslation: "dom", senses: [{
        definition: "A place to live.", definitionTranslated: "Miejsce do mieszkania.",
        synonyms: ["home"], examples: [1, 2, 3].map(n => ({ source: `House ${n}.`, target: `Dom ${n}.` })),
    }] };
    let aiCalled = false;
    const context = vm.createContext({ currentText: text, currentRect: {}, currentRange: {}, selectionRevision: 1,
        isReading: false, rangeAnchorElement: () => null, hideIcon() {}, showLoading() {}, attachTooltipHandlers() {},
        getTargetLang: async () => "pl", PREFIX: "__qt_", escapeHtml: value => value, console: { error() {}, warn() {} },
        SharedTranslatorService: { dictionaryTerm, getReadingSettings: async () => ({ learningLang: "en" }),
            lookupWords: async (words, target, source, options) => {
                lookups.push({ words: Array.from(words), target, source, options });
                if (failure) throw Error("Dictionary unavailable");
                return [dictionary];
            } },
        googleTranslate: async (input, tgt, src, opts) => {
            translations.push(input);
            translationOpts.push(opts);
            if (googleFailure) throw new Error("Google Translate 429 Rate Limit");
            return { translated: "cały tekst", detectedLang: "en" };
        },
        QT: {
            geminiExplainSentence: async (sentence, tgt) => {
                aiCalled = true;
                if (geminiTranslation) return { translation: geminiTranslation, detectedLang: "en" };
                throw new Error("Gemini quota exhausted");
            }
        },
        buildTooltipHtml: options => options,
        showTooltip: html => rendered.push(html),
    });
    loadFunction(context, "content.js", "onIconClick");
    return {
        run: () => context.onIconClick({ stopPropagation() {}, preventDefault() {} }),
        lookups, translations, translationOpts, rendered, dictionary,
        get aiCalled() { return aiCalled; }
    };
}

test("a website word uses live details including examples, even with surrounding punctuation", async () => {
    const state = page('“house!”'); await state.run();
    assert.deepEqual(state.lookups[0].words, ["house"]);
    assert.equal(state.lookups[0].options.details, true);
    assert.equal(state.translations.length, 0);
    assert.equal(state.rendered[0].dictionary, state.dictionary);
    assert.equal(state.rendered[0].dictionary.senses[0].examples.length, 3);
});
test("multiword selections go directly to text translation, without creating a live phrase entry", async () => {
    for (const text of ["a house", "123 house", "two\nwords", "two\twords"]) {
        const state = page(text); await state.run();
        assert.equal(state.lookups.length, 0); assert.deepEqual(state.translations, [text]);
        assert.equal(state.rendered[0].dictionary, null);
    }
});
test("a failed word lookup is shown as an error instead of creating a sentence entry for the word", async () => {
    const state = page("house", { failure: true }); await state.run();
    assert.equal(state.translations.length, 0);
    assert.match(state.rendered[0], /Dictionary unavailable/);
});
test("multiword selections prioritize Google Translate with preferGoogle option", async () => {
    const state = page("in the morning");
    await state.run();
    assert.equal(state.translations.length, 1);
    assert.equal(state.translationOpts[0]?.preferGoogle, true);
    assert.equal(state.aiCalled, false);
    assert.equal(state.rendered[0].translated, "cały tekst");
});
test("multiword selections fall back to Gemini AI when Google Translate fails", async () => {
    const state = page("in the morning", { googleFailure: true, geminiTranslation: "o poranku" });
    await state.run();
    assert.equal(state.aiCalled, true);
    assert.equal(state.rendered[0].translated, "o poranku");
    assert.equal(state.rendered[0].provider, "gemini");
});
test("multiword selections display error when both Google and Gemini fail", async () => {
    const state = page("in the morning", { googleFailure: true });
    await state.run();
    assert.equal(state.aiCalled, true);
    assert.match(state.rendered[0], /Google Translate 429 Rate Limit/);
});

