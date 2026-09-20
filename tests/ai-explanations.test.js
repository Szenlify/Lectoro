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

test("Enter tolerates missing or object sentence explanations and rejects empty translations", async () => {
    for (const overrides of [{ explanation: null }, { explanation: {} }]) {
        const { service } = explanationService(response(overrides));
        const result = await service.explainSentence("I'm gonna leave.", "pl");
        assert.equal(result.explanation, "");
    }
    const { service } = explanationService(response({ translation: " " }));
    await assert.rejects(service.explainSentence("I'm gonna leave.", "pl"));
});

test("Enter always uses native language, including obsolete stored preferences", async () => {
    for (const [mode, outputLanguage] of [["native", "es"], ["simple_target", "es"]]) {
        const { service, requests } = explanationService(response({
            source_language: "de",
            output_language: outputLanguage,
            badge: "Frase",
            translation: "Buena suerte!",
        }), { learningLang: "de", targetLang: "es", aiExplanationLanguage: mode });
        const result = await service.explainSentence("Viel Erfolg!", await service.getTargetLang());
        assert.equal(result.detectedLang, "de");
        assert.match(requests[0].prompt, /German \(de\)/);
        assert.match(requests[0].prompt, /"learning_language":"de"/);
        assert.match(requests[0].prompt, /"output_language":"es"/);
        assert.equal(result.explanation, "");
    }

    const { service } = explanationService(response(), { learningLang: "de" });
    await assert.rejects(service.explainSentence("Viel Erfolg!", "pl"), /different source language/);
});

