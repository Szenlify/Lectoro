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

test("Enter parses CEFR levels and assigns Idiom-only or CEFR-only badges without generic labels", async () => {
    const { service } = explanationService(response({
        cefr: "B1",
        translation: "Odpocznij i nie poddawaj się.",
        items: [
            { term: "take a break", type: "idiom", cefr: "B1", meaning: "zrobić przerwę", explanation: "" },
            { term: "give up", type: "phrasal_verb", cefr: "B2", meaning: "poddawać się", explanation: "" },
            { term: "resilience", type: "vocabulary", cefr: "C1", meaning: "odporność", explanation: "" },
        ],
    }));
    const result = await service.explainSentence("Please take a break, show resilience and don't give up.", "pl");
    assert.equal(result.cefr, "B1");
    assert.equal(result.items.length, 3);
    assert.equal(result.items[0].badge, "Idiom • B1");
    assert.equal(result.items[1].badge, "C1");
    assert.equal(result.items[2].badge, "B2");
});

test("Enter prompt contains strict ban on tautologies, literal combinations and mandates CEFR levels", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const prompt = AIPrompts.explainSentence("Don't leave in the night.", "pl");
    assert.match(prompt, /cefr: sentence level/);
    assert.match(prompt, /FORBIDDEN: never extract literal phrases/);
    assert.match(prompt, /NEVER restate literal words/);
    assert.match(prompt, /badge: if idiom, set 'Idiom'; otherwise ''/);
});

test("Enter skips Gemini sentence translation when Google translation is already known, but falls back when missing", async () => {
    const AIPrompts = require("../shared/ai-prompts");
    const promptWithKnown = AIPrompts.explainSentence("Don't leave in the night.", "pl", null, { knownTranslation: "Nie odchodź w nocy." });
    assert.match(promptWithKnown, /Sentence translation is "Nie odchodź w nocy\."/);
    assert.match(promptWithKnown, /Do not re-translate sentence/);

    const promptWithoutKnown = AIPrompts.explainSentence("Don't leave in the night.", "pl");
    assert.match(promptWithoutKnown, /Translate only the sentence in one natural line/);

    const { service, requests } = explanationService(response({
        translation: "Inne tłumaczenie Gemini",
        items: [{ term: "leave", type: "vocabulary", cefr: "A2", meaning: "odejść", explanation: "" }],
    }));

    const resultWithGoogle = await service.explainSentence("Don't leave in the night.", "pl", null, { knownTranslation: "Nie odchodź w nocy." });
    assert.equal(resultWithGoogle.translation, "Nie odchodź w nocy.");
    assert.match(requests[0].prompt, /Sentence translation is "Nie odchodź w nocy\."/);

    const resultWithoutGoogle = await service.explainSentence("Don't leave in the night.", "pl");
    assert.equal(resultWithoutGoogle.translation, "Inne tłumaczenie Gemini");
    assert.match(requests[1].prompt, /Translate only the sentence in one natural line/);
});

test("Enter prompt mandates extracting difficult individual words, not restricting to idioms only", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const prompt = AIPrompts.explainSentence("He hesitated with reluctance.", "pl");
    assert.match(prompt, /always extract difficult individual words/);
    assert.match(prompt, /never only idioms/);
});

test("Enter prompt enforces ironclad native language and bans proper nouns and AI models", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const prompt = AIPrompts.explainSentence("I asked Claude about this.", "pl");
    assert.match(prompt, /IRONCLAD: Target\/native language is Polish \(pl\)/);
    assert.match(prompt, /strictly in Polish \(pl\)/);
    assert.match(prompt, /FORBIDDEN: NEVER extract proper nouns/);
    assert.ok(prompt.includes("Claude"));
});

test("Enter filters out proper noun and brand name definitions from breakdown items", async () => {
    const { service } = explanationService(response({
        translation: "Zapytałem Claude'a o to z wahaniem.",
        items: [
            { term: "Claude", type: "vocabulary", cefr: "C1", meaning: "a name of an AI model", explanation: "" },
            { term: "hesitation", type: "vocabulary", cefr: "B2", meaning: "wahanie", explanation: "" },
        ],
    }));

    const result = await service.explainSentence("I asked Claude about this with hesitation.", "pl");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].term, "hesitation");
    assert.equal(result.items[0].meaning, "wahanie");
});

test("SharedUtils isProperNounDefinition and isLikelyEnglish correctly categorize content", () => {
    const Utils = require("../shared/utils");
    assert.equal(Utils.isProperNounDefinition("a name of an AI model"), true);
    assert.equal(Utils.isProperNounDefinition("nazwa modelu AI"), true);
    assert.equal(Utils.isProperNounDefinition("imię męskie"), true);
    assert.equal(Utils.isProperNounDefinition("niechęć lub opór"), false);

    assert.equal(Utils.isLikelyEnglish("a name of an AI model", "pl"), true);
    assert.equal(Utils.isLikelyEnglish("the act of hesitating", "pl"), true);
    assert.equal(Utils.isLikelyEnglish("zrobić przerwę", "pl"), false);
    assert.equal(Utils.isLikelyEnglish("wahać się", "pl"), false);
});

test("Z and Enter share scene context while Z requests only the exact translation", async () => {
    const sentence = "I think you're the biggest guys here";
    const context = {
        before: ["Discard this older line", "Welcome to the gym", "Look at those muscles"],
        after: ["How much do you bench?", "We train every day", "Discard this later line"],
    };
    const { service, requests } = explanationService(response({
        translation: "Myślę, że jesteście tu najwięksi.",
    }));
    for (const translationOnly of [true, false]) {
        await service.explainSentence(sentence, "pl", context, { sourceLang: "en", translationOnly });
        const { prompt, options } = requests.at(-1);
        assert.match(prompt, /body size or muscularity, not importance/);
        assert.match(prompt, /Welcome to the gym/);
        assert.match(prompt, /How much do you bench/);
        assert.doesNotMatch(prompt, /Discard this/);
        assert.match(prompt, /Translate only the supplied sentence/);
        assert.equal(options.maxOutputTokens, translationOnly ? 500 : 2000);
        if (translationOnly) assert.match(prompt, /"items":\[\]/);
    }
    const otherScene = AIPrompts.explainSentence(sentence, "pl", { before: ["Meet our executives"] });
    assert.notEqual(requests[1].prompt, otherScene);
});

test("Enter retains eight distinct useful terms instead of truncating at four", async () => {
    const terms = ["resilience", "endurance", "strength", "stamina", "effort", "recovery", "balance", "agility", "discipline"];
    const { service } = explanationService(response({
        items: [...terms.map(term => ({ term, type: "vocabulary", meaning: "znaczenie", explanation: "" })),
            { term: "unrelated", type: "vocabulary", meaning: "spoza zdania" }],
    }));
    const result = await service.explainSentence(terms.join(", "), "pl");
    assert.equal(result.items.length, 8);
    assert.deepEqual(Array.from(result.items, item => item.term), terms.slice(0, 8));
});
