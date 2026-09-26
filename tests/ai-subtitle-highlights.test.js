const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { loadFunction } = require("./helpers");
const DictionaryTokenizer = require("../shared/dictionary-tokenizer");

function harness(texts, queue = [], index = 0) {
    const spans = texts.map(text => ({ textContent: text, dataset: {}, isConnected: true }));
    const highlights = [];
    const context = vm.createContext({
        DictionaryTokenizer,
        activeWordSpans: spans,
        aiTooltipActive: true,
        aiExplainQueue: queue,
        aiExplainIndex: index,
        C: { UI_CLASSES: { AI_SUB_ACTIVE: "active", AI_SUB_QUEUED: "queued" } },
        clearSubtitleVideoHighlights() { highlights.length = 0; },
        wrapMatchedSpans(matched, cssClass, aiIndex) {
            highlights.push({ words: Array.from(matched, span => span.textContent), cssClass, aiIndex });
        },
    });
    for (const name of ["normalizeWordForMatching", "findMatchingSpanRange", "highlightSpansForTerm", "updateSubtitleVideoHighlights"]) {
        loadFunction(context, "video/subtitle-overlay.js", name);
    }
    const range = term => {
        const result = context.findMatchingSpanRange(spans, term);
        return result ? { ...result } : null;
    };
    return { context, spans, highlights, range };
}

test("Enter highlights all of won't ya despite different apostrophes", () => {
    for (const apostrophe of ["'", "’", "‘", "ʼ", "＇"]) {
        const { range } = harness([`Won${apostrophe}t`, "ya", "lovin’", "and", "leave", "in", "the", "night"]);
        assert.deepEqual(range("won't ya"), { startIndex: 0, count: 2 });
        assert.deepEqual(range("leave in the night"), { startIndex: 4, count: 4 });
    }
});

test("matching preserves complete phrases across lines, whitespace and grouped spans", () => {
    const { range } = harness(["Did", "I", "scare", "him", "off?", "Take care", "of", "her."]);
    assert.deepEqual(range("scare\nhim\u00a0off"), { startIndex: 2, count: 3 });
    assert.deepEqual(range("take care of"), { startIndex: 5, count: 2 });
    assert.equal(range("scare off"), null);
    assert.equal(range("care"), null, "do not highlight an entire grouped span for only part of it");
});

test("matching never falls back to ya alone, prefixes or approximate verb forms", () => {
    const { range } = harness(["ya", "inside", "calling", "in", "nowhere"]);
    assert.equal(range("won't ya"), null);
    assert.equal(range("call in"), null);
    assert.equal(range("now here"), null);
    assert.deepEqual(range("in"), { startIndex: 3, count: 1 });
});

test("matching uses visible text and normalizes accented and unspaced text", () => {
    const french = harness(["Ça", "va", "cafe\u0301"]);
    french.spans[0].dataset.clean = "irrelevant dictionary form";
    assert.deepEqual(french.range("ça va"), { startIndex: 0, count: 2 });
    assert.deepEqual(french.range("café"), { startIndex: 2, count: 1 });
    const japanese = harness(DictionaryTokenizer.tokenize("気をつけて").filter(t => t.type === "word").map(t => t.text));
    assert.deepEqual(japanese.range("気をつけて"), { startIndex: 0, count: japanese.spans.length });
});

test("active phrase owns exactly its words when queued expressions overlap", () => {
    const queue = [
        { type: "sentence", term: "Won’t ya lovin’ and leave in the night" },
        { type: "lexical_chunk", term: "won't ya" },
        { type: "slang", term: "ya" },
        { type: "lexical_chunk", term: "won't ya lovin'" },
        { type: "lexical_chunk", term: "leave in the night" },
    ];
    const { context, highlights } = harness(["Won’t", "ya", "lovin’", "and", "leave", "in", "the", "night"], queue, 1);
    context.updateSubtitleVideoHighlights();
    assert.deepEqual(highlights, [
        { words: ["Won’t", "ya"], cssClass: "active", aiIndex: 1 },
        { words: ["leave", "in", "the", "night"], cssClass: "queued", aiIndex: 4 },
    ]);
    context.aiExplainIndex = 2;
    context.updateSubtitleVideoHighlights();
    assert.deepEqual(highlights[0], { words: ["ya"], cssClass: "active", aiIndex: 2 });
    assert.equal(highlights.length, 2, "overlapping phrases must not expand the active ya selection");
});

test("clearing highlights also clears stale click destinations", () => {
    const removed = [];
    const context = vm.createContext({
        PREFIX: "qt",
        C: { UI_CLASSES: { AI_SUB_ACTIVE: "active", AI_SUB_UPCOMING: "upcoming", AI_SUB_QUEUED: "queued", AI_SUB_WRAP: "wrap" } },
        document: { querySelectorAll(selector) {
            return selector === ".active, .upcoming, .queued" ? [{
                classList: { remove() {} },
                removeAttribute(name) { removed.push(name); },
            }] : [];
        } },
    });
    loadFunction(context, "video/subtitle-overlay.js", "clearSubtitleVideoHighlights");
    context.clearSubtitleVideoHighlights();
    assert.deepEqual(removed, ["data-ai-index"]);
});
