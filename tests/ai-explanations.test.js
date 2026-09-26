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
            meaning: "zamierzać",
            explanation: "",
        }],
    }));

    const result = await service.explainSentence("I'm gonna leave.", "pl");

    assert.equal(requests.length, 1);
    assert.equal(result.explanation, "");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].term, "gonna");
    assert.equal(result.items[0].meaning, "zamierzać");
    assert.equal(result.items[0].explanation, "");
});

test("Enter accepts a plain sentence without manufactured learning items", async () => {
    const { service } = explanationService(response({ translation: "Cześć!" }));
    const result = await service.explainSentence("Hello!", "pl");
    assert.equal(result.translation, "Cześć!");
    assert.equal(result.explanation, "");
    assert.equal(result.items.length, 0);
});

test("Enter retains wanna with contraction and spoken-reduction categories", async () => {
    for (const type of ["slang", "vocabulary", "contraction", "reduced_form", " Contraction "]) {
        const { service } = explanationService(response({
            translation: "Chcę wrócić do domu.",
            items: [{ term: "wanna", type, meaning: "chcę", explanation: "Forma potoczna." }],
        }));
        const result = await service.explainSentence("I wanna go home.", "pl");
        assert.equal(result.items.length, 1, type);
        assert.equal(result.items[0].term, "wanna");
        assert.equal(result.items[0].meaning, "chcę");
        assert.equal(result.items[0].explanation, "Forma potoczna.");
    }
});

test("Enter keeps useful spoken forms alongside a longer expression", async () => {
    const { service } = explanationService(response({
        items: [
            { term: "wanna", type: "reduced_form", meaning: "chcesz" },
            { term: "wanna call it a day", type: "lexical_chunk", meaning: "chcesz skończyć na dziś" },
            { term: "want to", type: "contraction", meaning: "chcieć" },
            { term: "wanna", type: "contraction", meaning: "chcesz" },
        ],
    }));
    const result = await service.explainSentence("Do you wanna call it a day?", "pl");
    assert.deepEqual(Array.from(result.items, item => item.term), ["wanna", "wanna call it a day"]);
});

test("Enter explicitly requests spoken reductions in their original spelling", () => {
    const prompt = AIPrompts.explainSentence("I wanna go home.", "pl");
    assert.match(prompt, /Always include spoken reductions and contractions present/);
    assert.match(prompt, /wanna, gonna, gotta, lemme, gimme, ain't/);
    assert.match(prompt, /never replace wanna with want to/);
    assert.match(prompt, /distinct learning point even inside a longer chunk/);
});

test("Enter retains wanna in No bad vibes / Wanna have a good time", async () => {
    const { service, requests } = explanationService(response({
        translation: "Bez złej atmosfery. Chcę się dobrze bawić.",
        items: [
            { term: "No bad vibes", type: "lexical_chunk", meaning: "bez złej atmosfery", explanation: "" },
            { term: "Wanna", type: "contraction", meaning: "chcieć", explanation: "Forma potoczna." },
            { term: "have a good time", type: "collocation", meaning: "dobrze się bawić", explanation: "" },
        ],
    }));
    const sentence = "No bad vibes\nWanna have a good time";
    const result = await service.explainSentence(sentence, "pl");
    assert.equal(requests.length, 1);
    assert.deepEqual(Array.from(result.items, item => [item.term, item.meaning]), [
        ["No bad vibes", "bez złej atmosfery"],
        ["Wanna", "chcieć"],
        ["have a good time", "dobrze się bawić"],
    ]);
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

test("Enter prompt includes reusable literal chunks without tautologies and mandates CEFR levels", () => {
    const AIPrompts = require("../shared/ai-prompts");
    const prompt = AIPrompts.explainSentence("Don't leave in the night.", "pl");
    assert.match(prompt, /cefr: sentence level/);
    assert.match(prompt, /Literal collocations and useful everyday chunks ARE allowed/);
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
        before: ["We arrived at the gym", "Welcome to the gym", "Look at those muscles"],
        after: ["How much do you bench?", "We train every day", "Tomorrow is leg day"],
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
        assert.match(prompt, /We arrived at the gym/);
        assert.match(prompt, /Tomorrow is leg day/);
        assert.match(prompt, /Translate only the supplied sentence/);
        assert.match(prompt, /30 seconds before and 15 after/);
        assert.match(prompt, /speaker intent, referents, tone, idioms/);
        if (!translationOnly) assert.match(prompt, /first Enter card: use the scene context/);
        assert.equal(options.maxOutputTokens, translationOnly ? 500 : 8192);
        if (translationOnly) assert.match(prompt, /"items":\[\]/);
    }
    const otherScene = AIPrompts.explainSentence(sentence, "pl", { before: ["Meet our executives"] });
    assert.notEqual(requests[1].prompt, otherScene);
});

test("Enter retains all grounded useful terms instead of truncating at eight", async () => {
    const terms = ["resilience", "endurance", "strength", "stamina", "effort", "recovery", "balance", "agility", "discipline"];
    const { service } = explanationService(response({
        items: [...terms.map(term => ({ term, type: "vocabulary", meaning: "znaczenie", explanation: "" })),
            { term: "unrelated", type: "vocabulary", meaning: "spoza zdania" }],
    }));
    const result = await service.explainSentence(terms.join(", "), "pl");
    assert.equal(result.items.length, terms.length);
    assert.deepEqual(Array.from(result.items, item => item.term), terms);
});

test("Enter keeps complete short expressions, split verbs and tutor notes in sentence order", async () => {
    const { service } = explanationService(response({
        translation: "Czy go odstraszyłem? Wezwij wsparcie, zakończmy na dziś i trzymaj się.",
        items: [
            { term: "take care", type: "fixed_phrase", cefr: "A1", meaning: "trzymaj się", explanation: "Formuła pożegnania." },
            { term: "call it a day", type: "idiom", meaning: "skończyć na dziś" },
            { term: "call in", type: "phrasal_verb", meaning: "wezwać" },
            { term: "scare him off", type: "phrasal_verb", meaning: "odstraszyć go", explanation: "Zaimek stawiamy między czasownikiem a partykułą." },
        ],
    }));
    const result = await service.explainSentence("Did I scare him off? Call in backup, call it a day and take care.", "pl");
    assert.deepEqual(Array.from(result.items, item => item.term), ["scare him off", "call in", "call it a day", "take care"]);
    assert.equal(result.items[0].explanation, "Zaimek stawiamy między czasownikiem a partykułą.");
    assert.equal(result.items[3].cefr, "A1");
    assert.equal(result.items[3].meaning, "trzymaj się");
});

test("Enter preserves the contextual sense of call it without forcing a phrasal-verb label", async () => {
    for (const [sentence, meaning] of [
        ["Let's call it Hope.", "nazwijmy to"],
        ["It's late. Let's call it.", "skończmy"],
    ]) {
        const { service } = explanationService(response({
            items: [{ term: "call it", type: "lexical_chunk", meaning }],
        }));
        const result = await service.explainSentence(sentence, "pl");
        assert.equal(result.items[0].term, "call it");
        assert.equal(result.items[0].meaning, meaning);
        assert.equal(result.items[0].type, "lexical_chunk");
    }
});

test("Enter supports short learning units in every supported source language", async () => {
    const cases = [
        ["en", "I'm a bit tired.", "a bit", "lexical_chunk", "trochę"],
        ["pl", "To na pewno działa.", "na pewno", "mwe", "z pewnością"],
        ["de", "Ruf mich an!", "Ruf mich an", "phrasal_verb", "zadzwoń do mnie"],
        ["es", "Te echo de menos.", "echo de menos", "idiom", "tęsknię"],
        ["fr", "Ça va bien.", "Ça va", "fixed_phrase", "wszystko w porządku"],
        ["it", "Ci penso io.", "Ci", "grammar", "o tym"],
        ["ja", "どうもありがとう。", "ありがとう", "fixed_phrase", "dziękuję"],
        ["ko", "마음에 들어요.", "마음에 들어요", "mwe", "podoba mi się"],
        ["nl", "Dank je wel!", "Dank je wel", "fixed_phrase", "dziękuję"],
        ["cs", "To je v pořádku.", "v pořádku", "collocation", "w porządku"],
        ["pt", "Por favor, venha cá.", "Por favor", "fixed_phrase", "proszę"],
    ];
    assert.deepEqual(cases.map(([lang]) => lang).sort(), Object.keys(Constants.SUPPORTED_LANGUAGES).sort());
    for (const [sourceLang, sentence, term, type, meaning] of cases) {
        const { service } = explanationService(response({
            source_language: sourceLang,
            items: [{ term, type, meaning }],
        }));
        const result = await service.explainSentence(sentence, "pl", null, { sourceLang });
        assert.equal(result.items.length, 1, sourceLang);
        assert.equal(result.items[0].term, term, sourceLang);
        assert.equal(result.items[0].meaning, meaning, sourceLang);
    }
});

test("Enter normalizes Unicode and whitespace without accepting fragments of unrelated words", async () => {
    const { service } = explanationService(response({
        source_language: "fr",
        items: [
            { term: "in", type: "vocabulary", meaning: "w" },
            { term: "now here", type: "lexical_chunk", meaning: "teraz tutaj" },
            { term: "a", type: "vocabulary", meaning: "rodzajnik" },
            { term: "ça va", type: " Fixed_Phrase ", meaning: "w porządku" },
            { term: "café", type: "vocabulary", meaning: "kawa" },
            { term: "CAFE\u0301", type: "vocabulary", meaning: "kawa" },
            { term: "d'accord", type: "mwe", meaning: "zgoda" },
            { term: "!", type: "vocabulary", meaning: "wykrzyknik" },
            { term: "hors contexte", type: "mwe", meaning: "poza kontekstem" },
        ],
    }));
    const result = await service.explainSentence("inside nowhere a Ça\u00a0va cafe\u0301 d’accord!", "pl", null, { sourceLang: "fr" });
    assert.deepEqual(Array.from(result.items, item => item.term), ["a", "ça va", "café", "d'accord"]);
    assert.equal(result.items[1].type, "fixed_phrase");
});

test("Enter tutor contract covers short, complete and multilingual expressions before returning", () => {
    const prompt = AIPrompts.explainSentence("Did I scare him off?", "pl");
    for (const rule of [
        "private language tutor", "no fixed item count", "multi-word expressions (MWEs)",
        "EVERY supported source language", "A1-C2", "call in", "take care", "call it",
        "not automatically a phrasal verb", "scare him off", "Ruf mich an",
        "preserve ambiguity", "exact word or complete expression span",
        "Before returning JSON", "split verbs", "lexical_chunk", "collocation",
    ]) assert.ok(prompt.includes(rule), rule);
    assert.doesNotMatch(prompt, /up to 8|never extract literal phrases/);
});

test("AI explanations require a short natural meaning and optional native-only note", () => {
    const enter = AIPrompts.explainSentence("Did I scare him off?", "pl");
    const word = AIPrompts.standardTranslate("scare him off", "Did I scare him off?", "en", "pl");
    for (const prompt of [enter, word]) {
        assert.match(prompt, /one short.*natural everyday equivalent/);
        assert.match(prompt, /up to 12 words/);
        assert.match(prompt, /No .*quoted phrases.*foreign-language inserts/);
        assert.doesNotMatch(prompt, /except quoted source forms|only quoted source terms may differ/);
    }
    assert.match(enter, /Item explanation: default to ''/);
    assert.match(enter, /do not use quotation marks as formatting/);
    assert.match(enter, /Keep the source wording only in term/);
    assert.match(enter, /If the translation already explains the meaning, ALWAYS return ''/);
    assert.match(enter, /leave in the night.*explanation must be ''/);
    assert.match(enter, /its category alone is no reason/);
    assert.match(enter, /If removing the note loses no necessary information, omit it/);
    assert.match(word, /explanation: "" if translation already explains the meaning/);
});
