const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { read, load, storage } = require("./helpers");
const Constants = require("../shared/constants");
const Utils = require("../shared/utils");
const AIPrompts = require("../shared/ai-prompts");

function explanationService(result, settings = {}) {
    const requests = [];
    const context = vm.createContext({
        LectoroConstants: Constants,
        SharedUtils: Utils,
        AIPrompts,
        chrome: { storage: storage(settings) },
        GeminiProxy: {
            async requestJSON(prompt, options) {
                requests.push({ prompt, options });
                options.validate(result);
                return result;
            },
        },
    });
    load(context, "shared/translator-service.js");
    return { service: context.SharedTranslatorService, requests };
}

function response(overrides = {}) {
    return {
        source_language: "en",
        output_language: "pl",
        badge: "Zdanie",
        translation: "Zamierzam odejść.",
        explanation: "",
        items: [],
        ...overrides,
    };
}

test("Enter keeps a useful term with no redundant explanation in one request", async () => {
    const { service, requests } = explanationService(response({
        items: [{
            term: "gonna",
            type: "slang",
            badge: "Potocznie",
            meaning: "going to: zamierzać",
            explanation: "",
        }],
    }));

    const result = await service.explainSentence("I'm gonna leave.", "pl");

    assert.equal(requests.length, 1);
    assert.equal(result.explanation, "");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].term, "gonna");
    assert.equal(result.items[0].meaning, "going to: zamierzać");
    assert.equal(result.items[0].explanation, "");
});

test("Enter accepts a plain sentence without manufactured learning items", async () => {
    const { service } = explanationService(response({ translation: "Cześć!" }));
    const result = await service.explainSentence("Hello!", "pl");
    assert.equal(result.translation, "Cześć!");
    assert.equal(result.explanation, "");
    assert.equal(result.items.length, 0);
});

test("Enter preserves useful usage notes and filters malformed item explanations", async () => {
    const { service } = explanationService(response({
        translation: "Zdejmij to i nie poddawaj się.",
        items: [
            { term: "Take off", type: "phrasal_verb", meaning: "zdjąć", explanation: "Zaimek stawiamy między czasownikiem a partykułą: take it off." },
            { term: "give up", type: "phrasal_verb", meaning: "poddawać się", explanation: null },
            { term: "give up", type: "phrasal_verb", meaning: "poddawać się", explanation: "" },
        ],
    }));
    const result = await service.explainSentence("Take off and don't give up.", "pl");
    assert.equal(result.items.length, 2);
    assert.match(result.items[0].explanation, /take it off/);
    assert.equal(result.items[1].term, "give up");
    assert.equal(result.items[1].explanation, "");
});

test("Enter still rejects malformed sentence explanations and empty translations", async () => {
    for (const overrides of [{ explanation: null }, { explanation: {} }, { translation: " " }]) {
        const { service } = explanationService(response(overrides));
        await assert.rejects(service.explainSentence("I'm gonna leave.", "pl"));
    }
});

test("Enter uses the configured learning language and explanation mode", async () => {
    for (const [mode, outputLanguage] of [["native", "es"], ["simple_target", "de"]]) {
        const { service, requests } = explanationService(response({
            source_language: "de",
            output_language: outputLanguage,
            badge: mode === "native" ? "Frase" : "Satz",
            translation: mode === "native" ? "¡Buena suerte!" : "Ich wünsche dir Erfolg!",
        }), { learningLang: "de", targetLang: "es", aiExplanationLanguage: mode });
        const result = await service.explainSentence("Viel Erfolg!", await service.getTargetLang());
        assert.equal(result.detectedLang, "de");
        assert.match(requests[0].prompt, /German \(de\)/);
        assert.match(requests[0].prompt, /"learning_language":"de"/);
        assert.equal(result.explanation, "");
    }

    const { service } = explanationService(response(), { learningLang: "de" });
    await assert.rejects(service.explainSentence("Viel Erfolg!", "pl"), /different source language/);
});

function reviewTranslation(result, sentence = "I'm gonna leave.", options = {}) {
    const panel = { innerHTML: "", scrollIntoView() {} };
    const state = { translation: { status: "idle", result: null } };
    const requests = [];
    const spoken = [];
    const context = vm.createContext({
        AIPrompts,
        reviewQueue: [{ original: "gonna", sentence, srcLang: "en", tgtLang: "pl", ...options.card }],
        reviewIndex: 0,
        reviewDirection: "normal",
        reviewAnswerShown: false,
        getReviewCard: () => ({}),
        getReviewAiState: () => state,
        SharedTranslatorService: {
            async getReadingSettings() {
                assert.ok(options.settings, "Complete card metadata must not need a settings lookup");
                return options.settings;
            },
        },
        ensureReviewAiPanel: () => panel,
        restoreReviewAiPanels() {},
        document: { body: { contains: () => true }, getElementById: () => panel },
        GeminiProxy: {
            async requestJSON(prompt, options) {
                requests.push(prompt);
                options.validate(result);
                return result;
            },
        },
        stopPopupSpeak() {},
        async popupSpeak(text, lang, options) { spoken.push({ text, lang, options }); },
        escapeHtml: Utils.escapeHtml,
        escapeAttr: Utils.escapeAttr,
        SPEAK_SVG: "",
        attachReviewSpeakHandlers() {},
    });
    const source = read("popup/review.js");
    for (const name of ["aiTranslateReviewCard", "renderReviewTranslationResult"]) {
        const declaration = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`));
        assert.ok(declaration, `Missing ${name}`);
        vm.runInContext(declaration[0], context);
    }
    return { context, panel, state: state.translation, requests, spoken };
}

test("review translation renders an empty explanation and reuses the completed result", async () => {
    for (const sentence of ["I'm gonna leave.", ""]) {
        const fixture = reviewTranslation({
            word_translation: "zamierzać",
            sentence_translation: sentence ? "Zamierzam odejść." : "",
            explanation: "",
            output_language: "pl",
        }, sentence);
        await fixture.context.aiTranslateReviewCard();
        assert.equal(fixture.state.status, "done");
        assert.equal(fixture.state.result.explanation, "");
        assert.ok(!fixture.panel.innerHTML.includes("review-ai-explanation"));
        assert.ok(fixture.panel.innerHTML.includes("zamierzać"));
        assert.equal(fixture.spoken[0].lang, "pl");
        assert.equal(fixture.spoken[0].text, sentence ? "zamierzać. Zamierzam odejść." : "zamierzać");

        await fixture.context.aiTranslateReviewCard();
        assert.equal(fixture.requests.length, 1);
    }
});

test("review translation still rejects missing explanation type and incomplete translations", async () => {
    for (const invalid of [{ explanation: null }, { word_translation: " " }, { sentence_translation: "" }]) {
        const fixture = reviewTranslation({
            word_translation: "zamierzać",
            sentence_translation: "Zamierzam odejść.",
            explanation: "",
            output_language: "pl",
            ...invalid,
        });
        await fixture.context.aiTranslateReviewCard();
        assert.equal(fixture.state.status, "idle");
        assert.equal(fixture.state.result, null);
        assert.ok(fixture.panel.innerHTML.includes("review-ai-translate-error"));
        assert.equal(fixture.spoken.length, 0);
    }
});

test("review AI preserves a card's language pair and uses settings for missing languages", async () => {
    for (const languages of [{ srcLang: "de", tgtLang: "es" }, { srcLang: undefined, tgtLang: undefined }]) {
        const fixture = reviewTranslation({
            word_translation: "suerte",
            sentence_translation: "¡Buena suerte!",
            explanation: "",
            output_language: "es",
        }, "Viel Glück!", {
            card: { original: "Glück", ...languages },
            settings: languages.srcLang ? undefined : { learningLang: "de", targetLang: "es" },
        });
        await fixture.context.aiTranslateReviewCard();
        assert.equal(fixture.state.status, "done");
        assert.match(fixture.requests[0], /German \(de\)/);
        assert.match(fixture.requests[0], /Spanish \(es\)/);
        assert.equal(fixture.state.result.srcLang, "de");
        assert.equal(fixture.state.result.targetLang, "es");
        assert.ok(fixture.panel.innerHTML.includes('data-source-lang="de"'));
        assert.equal(fixture.spoken[0].lang, "es");
        assert.equal(fixture.spoken[0].options.sourceLang, "de");
        await fixture.context.aiTranslateReviewCard();
        assert.equal(fixture.requests.length, 1);
        assert.equal(fixture.spoken[1].options.sourceLang, "de");
    }
});
