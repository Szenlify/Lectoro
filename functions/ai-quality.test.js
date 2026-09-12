const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const Prompts = require("../shared/ai-prompts");
const Constants = require("../shared/constants");
const Quiz = require("../shared/quiz-export");
const { generationConfig, readJsonResponse } = require("./ai-response");

test("language codes normalize regions and reject unknown output languages", () => {
    assert.equal(Prompts.languageCode("pt-BR"), "pt");
    assert.equal(Prompts.languageCode("de_DE"), "de");
    assert.equal(Prompts.languageCode("English"), "en");
    assert.throws(() => Prompts.languageCode("unknown"));
    assert.throws(() => Prompts.validateLanguage({ output_language: "pl" }, "de"));
    assert.throws(() => Prompts.validateLanguage({}, "de"));
    for (const code of Object.keys(Constants.SUPPORTED_LANGUAGES)) {
        assert.ok(Prompts.standardTranslate("Hello", "", "en", code).includes(`"output_language":"${Prompts.languageCode(code)}"`));
    }
});

test("quiz prompts include only requested contracts and do not force invented alternatives", () => {
    const prompt = Prompts.quiz({ srcLang: "en", tgtLang: "de", chosenTypes: ["true_false"], wordList: [] });
    assert.ok(!prompt.includes("multiple_choice:"));
    assert.ok(prompt.includes("0-3 genuinely equivalent full answers"));
    assert.ok(prompt.includes("German (de)"));
    assert.equal(Prompts.DEFAULT_QUIZ_TYPES[3], "true_false");
    assert.ok(!Prompts.QUIZ_TYPES.includes("translation"));
    assert.throws(() => Prompts.quiz({ chosenTypes: ["translation"] }));
    assert.throws(() => Prompts.quiz({ chosenTypes: ["essay"] }));
});

test("both quiz formats render true/false and omit retired translation sections and their points", () => {
    const quiz = { title: "Test", sections: [
        { type: "translation", instructions: "RETIRED_TRANSLATION", questions: [{ prompt: "RETIRED_PROMPT", answer: "RETIRED_ANSWER" }] },
        { type: "true_false", instructions: "Oceń prawdziwość zdań.", questions: [
            { statement: "Cat means kot.", answer: true },
            { statement: "Dog means kot.", answer: false },
        ] },
    ] };
    const normalized = Quiz.normalizeQuizData(quiz, null, "pl");
    assert.deepEqual(normalized.sections.map((sec) => sec.type), ["true_false"]);
    for (const render of [Quiz.buildQuizHtml, Quiz.buildInteractiveQuizHtml]) {
        const html = render(quiz, [{ original: "cat", srcLang: "en" }], { tgtLang: "pl" });
        assert.ok(html.includes("1. Prawda czy fałsz"));
        assert.ok(html.includes("Prawda") && html.includes("Fałsz"));
        assert.ok(!html.includes("RETIRED_"));
        assert.ok(!html.includes("Przetłumacz"));
    }
    const html = Quiz.buildInteractiveQuizHtml(quiz, [{ original: "cat", srcLang: "en" }], { tgtLang: "pl" });
    assert.equal((html.match(/data-points="1"/g) || []).length, 2);
    assert.ok(html.includes('data-answer="Prawda"'));
    assert.ok(html.includes('data-answer="Fałsz"'));
});

test("backend rejects truncation, safety blocks, arrays and malformed JSON", () => {
    const response = (text, finishReason = "STOP") => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
    assert.equal(readJsonResponse(response('{"translation":"Hi"}')), '{"translation":"Hi"}');
    for (const value of [response('{}', "MAX_TOKENS"), response('{}', "SAFETY"), response('[]'), response('null'), response('{'), {}]) {
        assert.throws(() => readJsonResponse(value));
    }
    assert.deepEqual(generationConfig("bad", Infinity), { temperature: 0.2, maxOutputTokens: 500, responseMimeType: "application/json" });
    assert.equal(generationConfig(4, 10000).maxOutputTokens, 8192);
});

test("Enter preserves localized badges, filters invented items and enforces language metadata", async (t) => {
    const saved = global.GeminiProxy;
    t.after(() => { global.GeminiProxy = saved; });
    const Translator = require("../shared/translator-service");
    let result = {
        source_language: "de", output_language: "pl", badge: "Satz", translation: "Viel Erfolg!", explanation: "Ein guter Wunsch.",
        items: [
            { term: "Erfolg", type: "vocabulary", badge: "Wort", meaning: "gutes Ergebnis", explanation: "Ein gutes Ergebnis." },
            { term: "invented", type: "idiom", meaning: "x", explanation: "x" },
            { term: "Erfolg", type: "vocabulary", meaning: "duplicate", explanation: "x" },
        ],
    };
    global.GeminiProxy = { requestJSON: async (_prompt, opts) => { opts.validate?.(result); return result; } };
    const parsed = await Translator.explainSentence("Viel Erfolg!", "pl", null, { sourceLang: "de" });
    assert.equal(parsed.badge, "Satz");
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].badge, "Wort");
    result = { ...result, output_language: "de" };
    await assert.rejects(Translator.explainSentence("Viel Erfolg!", "pl", null, { sourceLang: "de" }));
    result = { ...result, output_language: "pl", translation: {} };
    await assert.rejects(Translator.explainSentence("Viel Erfolg!", "pl", null, { sourceLang: "de" }));
});

test("quiz retains answer variants and rejects invalid keys, booleans and ambiguous pairs", () => {
    const valid = { type: "fill_blank", questions: [{ sentence: "She said: ___", hint: "ready now", answer: "I am ready", acceptable_answers: ["I'm ready"] }] };
    const invalid = [
        { type: "multiple_choice", questions: [{ question: "Choose", options: ["a", "b", "c", "d"], answer: "missing" }] },
        { type: "true_false", questions: [{ statement: "Claim", answer: "maybe" }] },
        { type: "matching", pairs: [{ a: "a", b: "same" }, { a: "b", b: "same" }] },
        { type: "fill_blank", questions: [{ sentence: "___ and ___", hint: "hint", answer: "a" }] },
        { type: "correct_form", questions: [{ sentence: "He ___", options: ["run", "Run", "runs"], answer: "runs" }] },
        { type: "unknown", questions: [] }, null,
    ];
    const normalized = Quiz.normalizeQuizData({ sections: [valid, ...invalid] }, null, "en");
    assert.equal(normalized.sections.length, 1);
    assert.deepEqual(normalized.sections[0].questions[0].acceptable_answers, ["I am ready", "I'm ready"]);
    assert.throws(() => Quiz.normalizeQuizData({ sections: invalid }, null, "en"));
    assert.throws(() => Quiz.normalizeQuizData(null, null, "en"));
});

test("quiz generation rejects mixed languages before charging and validates returned sections", async (t) => {
    const saved = global.GeminiProxy;
    t.after(() => { global.GeminiProxy = saved; });
    let calls = 0;
    global.GeminiProxy = { requestJSON: async () => {
        calls++;
        return { source_language: "en", instruction_language: "pl", sections: [
            { type: "true_false", questions: [{ statement: "Cat means kot.", answer: true }, { statement: "Dog means kot.", answer: false }] },
        ] };
    } };
    await assert.rejects(Quiz.generateQuizWithGemini([{ original: "cat", srcLang: "en" }, { original: "Katze", srcLang: "de" }], { tgtLang: "pl" }));
    assert.equal(calls, 0);
    const words = [{ original: "cat", srcLang: "en" }, { original: "dog", srcLang: "en" }];
    assert.equal((await Quiz.generateQuizWithGemini(words, { tgtLang: "pl", chosenTypes: ["true_false"] })).sections.length, 1);
    await assert.rejects(Quiz.generateQuizWithGemini(words, { tgtLang: "pl" }), /incomplete/);
});

test("generated quiz grades full answers and explicit variants, not similar or negated sentences", () => {
    const quiz = { title: "Test", sections: [{ type: "fill_blank", instructions: "Fill the blank", questions: [{ sentence: "She said: ___", hint: "ready now", answer: "I am ready" }] }] };
    const html = Quiz.buildInteractiveQuizHtml(quiz, [{ original: "ready", srcLang: "en" }], { tgtLang: "en" });
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const context = vm.createContext({ document: { querySelectorAll: () => [], getElementById: () => null }, window: {}, setTimeout: () => 0 });
    vm.runInContext(script, context);
    const grade = (value, answer = "I am ready", alts = ["I'm ready"]) => {
        const q = { dataset: { qtype: "text", answer, alternatives: JSON.stringify(alts), qid: "1" },
            classList: { remove() {}, add() {} }, querySelector: (selector) => selector === ".q-input" ? { value } : null };
        return context.gradeQuestion(q, true);
    };
    assert.equal(grade(" I  am ready! "), true);
    assert.equal(grade("I’m ready"), true);
    assert.equal(grade("I am not ready"), false);
    assert.equal(grade("ready"), false);
    assert.equal(grade("I was ready"), false);
    assert.equal(grade("I like it", "I don't like it", []), false);
    assert.equal(grade("si", "sí", []), false);
    assert.equal(grade("a", "a/b", []), false);
});

test("Enter ignores the previous request after closing and reopening the panel", async () => {
    const source = fs.readFileSync(require.resolve("../video/subtitle-overlay.js"), "utf8");
    const start = source.indexOf("    async function handleAIExplain(video)");
    const end = source.indexOf("    function getSpeedOverlayParent", start);
    const pending = [], displayed = [];
    const noop = () => {};
    const context = vm.createContext({
        activeText: "First", aiExplainRequestId: 0, trackedVideo: null, eTranslateActive: false, wordCloudActive: false,
        aiSavedIndices: new Set(), aiAiSavedIndices: new Set(), document: { body: { setAttribute: noop } },
        getPlayerRegistry: () => ({}), cleanupReading: noop, closeSubTooltip: noop,
        removeSubtitleTranslationUnderOriginal: noop, pauseIfPlaying: noop, captureSubtitleLayout: () => ({ rect: {} }), showAiShimmer: noop,
        getActiveSubtitleContext: () => null, normalizeLanguageCode: () => "en",
        SharedTranslatorService: { getLearningLang: async () => "en" },
        resolveAiBadge: () => "Sentence", showAiExplainItem: () => displayed.push(context.aiExplainQueue[0].meaning),
        QT: { hideTooltip: noop, getTargetLang: async () => "pl",
            geminiExplainSentence: () => new Promise((resolve) => pending.push(resolve)) },
    });
    vm.runInContext(source.slice(start, end), context);
    const first = context.handleAIExplain(null);
    await new Promise(setImmediate);
    // Same invalidation performed by closeAiTooltip; then a new Enter request starts.
    context.aiTooltipActive = false;
    context.aiExplainRequestId++;
    context.activeText = "Second";
    const second = context.handleAIExplain(null);
    await new Promise(setImmediate);
    pending[1]({ translation: "New response", explanation: "New", items: [] });
    await second;
    pending[0]({ translation: "Old response", explanation: "Old", items: [] });
    await first;
    assert.deepEqual(displayed, ["New response"]);
});

function proxyHarness(sendRuntimeMessage) {
    const context = vm.createContext({
        LectoroConstants: Constants,
        SharedUtils: { isContentScriptEnvironment: () => true, sendRuntimeMessage },
        chrome: { storage: { local: { get: async () => ({}) } } },
    });
    vm.runInContext(fs.readFileSync(require.resolve("../shared/gemini-proxy"), "utf8"), context);
    return context.GeminiProxy;
}

test("simultaneous identical AI requests share a single request", async () => {
    let calls = 0, resolve;
    const proxy = proxyHarness(() => { calls++; return new Promise((r) => { resolve = r; }); });
    const first = proxy.request("same");
    const second = proxy.request("same");
    assert.equal(calls, 1);
    resolve({ result: { text: '{"ok":true}' } });
    assert.equal((await first).text, (await second).text);
    assert.equal((await proxy.request("same")).cached, true);
    assert.equal(calls, 1);
});

test("invalid JSON or language metadata is rejected and explicit retry bypasses stale caches", async () => {
    const messages = [];
    let text = '{"output_language":"pl"}';
    const proxy = proxyHarness(async (message) => { messages.push(message); return { result: { text } }; });
    const opts = { validate: (result) => Prompts.validateLanguage(result, "de") };
    await assert.rejects(proxy.requestJSON("translate", opts));
    assert.equal(messages[0].opts.validate, undefined, "function is not sent through Chrome messaging");
    text = '{"output_language":"de"}';
    assert.equal((await proxy.requestJSON("translate", opts)).output_language, "de");
    assert.equal(messages[1].opts.cache, false);
    assert.equal((await proxy.requestJSON("translate", opts)).output_language, "de");
    assert.equal(messages.length, 2);
    text = 'Some prose {"ok":true}';
    await assert.rejects(proxy.requestJSON("broken"));
    text = '```json\n{"ok":true}\n```';
    assert.equal((await proxy.requestJSON("broken")).ok, true);
    assert.equal(messages.at(-1).opts.cache, false);
});
