const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const { dictionaryTerm } = require("../shared/translator-service");

function page(text, { failure = false } = {}) {
    const lookups = [], translations = [], rendered = [];
    const dictionary = { translated: "dom", primaryTranslation: "dom", senses: [{
        definition: "A place to live.", definitionTranslated: "Miejsce do mieszkania.",
        synonyms: ["home"], examples: [1, 2, 3].map(n => ({ source: `House ${n}.`, target: `Dom ${n}.` })),
    }] };
    const context = vm.createContext({ currentText: text, currentRect: {}, currentRange: {}, selectionRevision: 1,
        isReading: false, rangeAnchorElement: () => null, hideIcon() {}, showLoading() {}, attachTooltipHandlers() {},
        getTargetLang: async () => "pl", PREFIX: "__qt_", escapeHtml: value => value, console: { error() {} },
        SharedTranslatorService: { dictionaryTerm, getReadingSettings: async () => ({ learningLang: "en" }),
            lookupWords: async (words, target, source, options) => {
                lookups.push({ words: Array.from(words), target, source, options });
                if (failure) throw Error("Dictionary unavailable");
                return [dictionary];
            } },
        googleTranslate: async input => { translations.push(input); return { translated: "cały tekst", detectedLang: "en" }; },
        buildTooltipHtml: options => options,
        showTooltip: html => rendered.push(html),
    });
    loadFunction(context, "content.js", "onIconClick");
    return { run: () => context.onIconClick({ stopPropagation() {}, preventDefault() {} }), lookups, translations, rendered, dictionary };
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
