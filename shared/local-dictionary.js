/** Per-term live dictionary lookup. No catalog, language packs or bundled downloads. */
(function (root) {
    "use strict";
    const utils = root.SharedUtils || (typeof module !== "undefined" && module.exports ? require("./utils") : null);
    const indexes = new WeakMap();
    const compiled = new WeakMap();
    const languages = new WeakMap();
    const senseIndexes = new WeakMap();
    const tokenizer = root.DictionaryTokenizer || (typeof module !== "undefined" && module.exports ? require("./dictionary-tokenizer") : null);
    const normalize = (word) => String(word || "").normalize("NFKC").toLowerCase()
        .replace(/[’‘]/g, "'").replace(/\s+/g, " ")
        .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
    const irregular = Object.freeze({
        children: "child", men: "man", women: "woman", people: "person",
        feet: "foot", teeth: "tooth", mice: "mouse", went: "go", gone: "go",
        ran: "run", ate: "eat", eaten: "eat", drank: "drink", drunk: "drink",
        wrote: "write", written: "write", made: "make", bought: "buy", taught: "teach",
        was: "be", were: "be", been: "be", had: "have", did: "do", done: "do",
        took: "take", taken: "take", gave: "give", given: "give", got: "get", gotten: "get",
        brought: "bring", found: "find", held: "hold", kept: "keep", let: "let",
        lost: "lose", felt: "feel", broke: "break", broken: "break", wore: "wear", worn: "wear",
        woke: "wake", woken: "wake", stood: "stand", saw: "see", seen: "see",
        said: "say", told: "tell", thought: "think", came: "come", left: "leave",
        knew: "know", known: "know", sat: "sit", slept: "sleep", spoke: "speak", spoken: "speak",
    });

    function candidates(value) {
        const word = normalize(value);
        const forms = new Set([word]); // Exact dictionary entries always win.
        const add = (form) => { if (form.length >= 2) forms.add(form); };
        if (irregular[word]) add(irregular[word]);
        if (/['’]s$/.test(word)) add(word.slice(0, -2));
        if (/ies$/.test(word)) add(word.slice(0, -3) + "y");
        if (/ied$/.test(word)) add(word.slice(0, -3) + "y");
        if (/(?:ches|shes|sses|xes|zes|oes)$/.test(word)) add(word.slice(0, -2));
        if (/s$/.test(word) && !/(?:ss|us|is)$/.test(word)) add(word.slice(0, -1));
        const suffix = word.match(/^(.*?)(ing|ed)$/);
        if (suffix && suffix[1].length >= 2) {
            const stem = suffix[1];
            add(stem);
            add(stem + "e");
            if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
            if (suffix[2] === "ing" && stem.endsWith("y")) add(stem.slice(0, -1) + "ie");
        }
        return [...forms];
    }

    function formsFor(word, dictionary) {
        return (languages.get(dictionary) || "en") === "en" ? candidates(word) : [normalize(word)];
    }

    function lexicalTranslations(values) {
        return [...new Set(values.flatMap((value) => String(value).split(/\s*\/\s*/))
            .filter((value) => !/^(?:czasownik pomocniczy|rodzajnik|znacznik|wykładnik|podmiot formalny|relacja przynależności|odbiorca czynności)\b/iu.test(value.trim()))
            .map((value) => value.replace(/\s*\([^)]*\)/g, "").trim())
            .filter(Boolean))];
    }
    const primaryIndexes = new WeakMap();
    function singleTranslation(translated) {
        return lexicalTranslations([translated || ""])[0] || null;
    }

    function compilePack(pack) {
        if (compiled.has(pack)) return compiled.get(pack);
        const dictionary = Object.create(null);
        const sensesByTerm = new Map();
        for (const [term, value] of Object.entries(pack.entries)) {
            const senses = pack.schemaVersion === 2 ? [{ senseId: term, translations: [value.t],
                definition: typeof value.d === "string" ? value.d : value.d.s ?? value.d.source,
                definitionTranslated: typeof value.d === "string" ? "" : value.d.t ?? value.d.target,
                synonyms: value.s, examples: value.e.map(example => typeof example === "string" ? ({ source: example, target: "" }) : ({source: example.s ?? example.source, target: example.t ?? example.target})) }] : value.map(sense => ({...sense,
                    examples: (sense.examples || []).map(example => ({source: example.s ?? example.source, target: example.t ?? example.target}))}));
            dictionary[term] = lexicalTranslations(senses.flatMap((sense) => sense.translations)).join(" / ");
            sensesByTerm.set(term, senses);
            if (!sensesByTerm.has(normalize(term)) || term === normalize(term)) sensesByTerm.set(normalize(term), senses);
        }
        for (const [form, lemmas] of Object.entries(pack.forms || {})) {
            if (!Object.hasOwn(dictionary, form)) {
                dictionary[form] = [...new Set(lemmas.map((lemma) => dictionary[lemma]).filter(Boolean))].join(" / ");
                const senses = lemmas.flatMap((lemma) => pack.entries[lemma] || []);
                sensesByTerm.set(form, senses);
                if (!sensesByTerm.has(normalize(form))) sensesByTerm.set(normalize(form), senses);
            }
        }
        primaryIndexes.set(dictionary, pack.primaryTranslations || {});
        senseIndexes.set(dictionary, sensesByTerm);
        languages.set(dictionary, pack.sourceLanguage);
        compiled.set(pack, dictionary);
        return dictionary;
    }

    function indexDictionary(dictionary) {
        if (indexes.has(dictionary)) return indexes.get(dictionary);
        const entries = new Map();
        const phrases = new Map();
        for (const [key, translated] of Object.entries(dictionary)) {
            if (typeof translated !== "string" || !translated.trim()) continue;
            const normalized = normalize(key);
            if (!entries.has(normalized) || key === normalized) entries.set(normalized, translated);
            const tokens = tokenizer ? tokenizer.tokenize(key).filter((token) => token.type === "word").map((token) => token.text) : key.split(/\s+/);
            if (tokens.length < 2) continue;
            const first = normalize(tokens[0]);
            if (!phrases.has(first)) phrases.set(first, []);
            phrases.get(first).push({ tokens, translated });
        }
        for (const list of phrases.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
        const index = { entries, phrases };
        indexes.set(dictionary, index);
        return index;
    }

    function lookup(word, target, source = null) {
        if (source) {
            const entry = Object.entries(source).find(([, value]) => normalize(value) === normalize(word));
            return entry && Object.hasOwn(target, entry[0]) ? target[entry[0]] || null : null;
        }
        const exact = String(word).normalize("NFKC").trim()
            .replace(/[’‘]/g, "'").replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
        if (Object.hasOwn(target, exact) && typeof target[exact] === "string") return target[exact];
        const { entries } = indexDictionary(target);
        for (const form of formsFor(word, target)) {
            if (entries.has(form)) return entries.get(form);
        }
        return null; // Missing words must never trigger a paid call.
    }

    const contextTokens = (text) => String(text || "").match(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[.!?;,。！？；]/gu) || [];
    const contextStops = new Set("a an the i you he she it we they me my your his her its our their this that these those to of in on at for with by from as is am are was were be been being have has had do does did and or but if so not no yes very here there".split(" "));

    function rankSenses(senses, word, contextWords, wordIndex, language) {
        if (senses.length < 2 || !contextWords.length) return { senses, selection: "dictionary" };
        const tokens = contextWords.map(normalize);
        const term = normalize(word);
        // Positional signals must refer to this occurrence, never the first repeated word.
        let index = Number.isInteger(wordIndex) && normalize(contextWords[wordIndex]) === term ? wordIndex : -1;
        if (index < 0 && tokens.filter((token) => token === term).length === 1) index = tokens.indexOf(term);
        if (index < 0) return { senses, selection: "ambiguous" };
        let left = index, right = index;
        const boundary = (value) => /[.!?;,。！？；]/u.test(value);
        while (left > 0 && index - left < 6 && !boundary(contextWords[left - 1])) left--;
        while (right < tokens.length - 1 && right - index < 6 && !boundary(contextWords[right])) {
            right++;
            if (boundary(contextWords[right])) break;
        }
        const stem = (token) => language === "en" ? candidates(token).at(-1) : token;
        const useful = (token) => token && token !== term && (language !== "en" || !contextStops.has(token));
        const context = new Set(tokens.slice(left, right + 1).filter(useful).map(stem));
        const exampleSets = senses.map((sense) => new Set((sense.examples || []).flatMap((e) => contextTokens(e.source).map(normalize)).filter(useful).map(stem)));
        const previous = left < index ? tokens[index - 1] : "";
        const next = right > index ? tokens[index + 1] : "";
        const scored = senses.map((sense, order) => {
            let score = 0;
            for (const token of exampleSets[order]) {
                if (context.has(token) && !exampleSets.some((set, i) => i !== order && set.has(token))) score += 2;
            }
            if (language === "en") {
                if (/^(a|an|the|this|that|my|your|his|her|our|their)$/.test(previous) && sense.partOfSpeech === "noun") score += 3;
                if (/^(i|you|we|they|he|she|to)$/.test(previous) && sense.partOfSpeech === "verb") score += 3;
                if (/^(am|is|are|was|were|be|been)$/.test(term) && /ing$/.test(next) && sense.partOfSpeech === "auxiliary") score += 6;
                if (/^(have|has|had)$/.test(term) && (/ed$/.test(next) || /^(been|gone|done|seen|eaten|written|taken|left|made|said|found|bought)$/.test(next)) && sense.partOfSpeech === "auxiliary") score += 6;
            }
            return { sense, score, order };
        }).sort((a, b) => b.score - a.score || a.order - b.order);
        if (scored[0].score < 2 || scored[0].score - scored[1].score < 2) return { senses, selection: "ambiguous" };
        return { senses: scored.map((item) => item.sense), selection: "context" };
    }

    function lookupDetails(word, target, contextWords = [], wordIndex = -1) {
        const translated = lookup(word, target);
        if (!translated) return null;
        const index = senseIndexes.get(target);
        const exact = String(word).normalize("NFKC").trim().replace(/[’‘]/g, "'")
            .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
        let senses = index?.get(exact);
        if (!senses) {
            for (const form of formsFor(word, target)) {
                if (index?.has(form)) { senses = index.get(form); break; }
            }
        }
        if (!senses?.length) return { translated: lexicalTranslations([translated]).join(" / "), primaryTranslation: singleTranslation(translated), senses: [], selection: "dictionary" };
        const ranked = rankSenses(senses, word, contextWords, wordIndex, languages.get(target) || "en");
        const choices = lexicalTranslations([translated]);
        const configured = primaryIndexes.get(target)?.[exact] || primaryIndexes.get(target)?.[normalize(word)];
        const preferred = configured || ((languages.get(target) === "en" && normalize(word) === "all" && choices.includes("wszystko")) ? "wszystko" : null);
        const contextual = ranked.selection === "context" ? lexicalTranslations(ranked.senses[0].translations)[0] : null;
        return {
            translated: choices.join(" / "),
            primaryTranslation: contextual || (choices.includes(preferred) ? preferred : choices[0]),
            // Bound message payloads even for forms that point at many lemmas.
            senses: ranked.senses.slice(0, 32), selection: ranked.selection,
            selectedSenseId: ranked.selection === "context" ? ranked.senses[0].senseId : null,
        };
    }

    // Keep positions aligned with subtitle spans: one bubble per longest matching phrase.
    // Simple words remain available inside phrases and for explicit hover lookups.
    function lookupWordByWord(words, target, source = null) {
        const result = Array(words.length).fill(null);
        const { phrases } = indexDictionary(target);
        for (let i = 0; i < words.length; i++) {
            let match = null;
            if (!source) {
                const options = formsFor(words[i], target).flatMap((form) => phrases.get(form) || [])
                    .sort((a, b) => b.tokens.length - a.tokens.length);
                match = options.find(({ tokens }) => tokens.every((token, offset) => {
                    const actual = words[i + offset];
                    if (actual === undefined) return false;
                    const expected = normalize(token);
                    const possessive = (languages.get(target) || "en") === "en" && /^(?:someone|one)'s$/.test(expected)
                        && /^(?:my|your|his|her|its|our|their|[\p{L}]+['’]s)$/u.test(normalize(actual));
                    if (!possessive && !formsFor(actual, target).includes(expected)) return false;
                    // Do not join unrelated clauses; punctuation written in the idiom is allowed.
                    if (offset < tokens.length - 1) {
                        const punctuation = (text) => (text.match(/[,;:.!?。！？、；：]+["'’”)]*$/u) || [""])[0];
                        if (punctuation(actual) !== punctuation(token)) return false;
                    }
                    return true;
                }));
            }
            if (match) {
                const phrase = words.slice(i, i + match.tokens.length).join(" ");
                const details = lookupDetails(phrase, target, words, i);
                result[i] = { translated: details?.primaryTranslation || singleTranslation(match.translated), length: match.tokens.length };
                i += match.tokens.length - 1;
                continue;
            }
            if (!source && (languages.get(target) || "en") === "en" && utils.isSimpleWord(words[i])) continue;
            const translated = source ? singleTranslation(lookup(words[i], target, source)) : lookupDetails(words[i], target, words, i)?.primaryTranslation;
            if (translated) result[i] = { translated, length: 1 };
        }
        return result;
    }

    const livePending = new Map();
    let liveRunning = 0;
    const liveQueue = [];
    async function generateLive(word, source, target) {
        const key = JSON.stringify([word, source, target]);
        if (livePending.has(key)) return livePending.get(key);
        const task = (async () => {
            if (liveRunning >= 3) await new Promise(resolve => liveQueue.push(resolve));
            else liveRunning++;
            try {
                const saved = await root.DictionaryStore?.getLive?.(source, target, word, { localOnly: true });
                if (saved) return saved;
                const result = await root.GeminiProxy.liveTranslation("word", word, source, target);
                const entry = result?.[word];
                if (!entry) throw new Error("Missing generated entry.");
                await root.DictionaryStore.putLive(source, target, word, entry);
                return entry;
            } finally {
                if (liveQueue.length) liveQueue.shift()();
                else liveRunning--;
            }
        })().finally(() => livePending.delete(key));
        livePending.set(key, task);
        return task;
    }

    async function lookupWords(words, targetLang, sourceLang = "en", options = {}) {
        if (!Array.isArray(words) || words.length > 500 || words.some((w) => typeof w !== "string" || w.length > 200)) {
            throw new Error("Invalid dictionary lookup.");
        }
        options = options || {};
        if (options.context !== undefined && (typeof options.context !== "string" || options.context.length > 10000)) throw new Error("Invalid dictionary context.");
        if (options.contextWords !== undefined && (!Array.isArray(options.contextWords) || options.contextWords.length > 500 || options.contextWords.some((w) => typeof w !== "string" || w.length > 200))) throw new Error("Invalid dictionary context words.");
        const languageCode = (value) => {
            const code = String(value || "").toLowerCase().replace(/_/g, "-");
            return Object.hasOwn(root.LectoroConstants.SUPPORTED_LANGUAGES, code) ? code : code.split("-")[0];
        };
        targetLang = languageCode(targetLang);
        sourceLang = languageCode(sourceLang);
        if (!Object.hasOwn(root.LectoroConstants.SUPPORTED_LANGUAGES, targetLang) || !Object.hasOwn(root.LectoroConstants.SUPPORTED_LANGUAGES, sourceLang)) return words.map(() => null);
        if (sourceLang === targetLang) return words.map((word) => options.wordByWord ? null : options.details ? { translated: word, senses: [], selection: "dictionary" } : word);
        const context = options.contextWords || contextTokens(options.context);
        const result = words.map(() => null);
        await Promise.all(words.map(async (raw, i) => {
            if (options.wordByWord && sourceLang === "en" && utils.isSimpleWord(raw)) return;
            const word = raw.normalize("NFKC").trim().toLowerCase().replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
            if (!word || word.length > 120 || !/^[\p{L}\p{M}][\p{L}\p{M}\p{N}'’ -]*$/u.test(word)) return;
            let entry = await root.DictionaryStore?.getLive?.(sourceLang, targetLang, word, { localOnly: options.localOnly === true });
            if (!entry && !options.localOnly && options.generateMissing !== false && root.GeminiProxy?.liveTranslation) {
                entry = await generateLive(word, sourceLang, targetLang);
            }
            if (!entry) return;
            const dictionary = compilePack({ schemaVersion: 2, sourceLanguage: sourceLang, entries: { [word]: entry } });
            result[i] = options.details ? lookupDetails(word, dictionary, context, options.wordIndex)
                : options.wordByWord ? { translated: entry.t, length: 1 } : entry.t;
        }));
        return result;
    }

    root.LocalDictionary = Object.freeze({ lookupWords, lookup, candidates, lookupWordByWord, compilePack, lookupDetails, rankSenses });
    if (typeof module !== "undefined") module.exports = root.LocalDictionary;
})(globalThis);
