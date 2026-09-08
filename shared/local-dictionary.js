/** Bundled dictionaries: no remote requests, keys are English lemmas. */
(function (root) {
    "use strict";
    const utils = root.SharedUtils || (typeof module !== "undefined" && module.exports ? require("./utils") : null);
    const dictionaries = new Map();
    const indexes = new WeakMap();
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

    async function loadDictionary(language) {
        if (!Object.hasOwn(root.LectoroConstants.SUPPORTED_LANGUAGES, language)) return {};
        if (!dictionaries.has(language)) {
            const pending = fetch(chrome.runtime.getURL(`dictionaries/${language}.json`))
                .then(async (response) => {
                    if (!response.ok) throw new Error("Local dictionary could not be loaded.");
                    return response.json();
                }).catch((error) => { dictionaries.delete(language); throw error; });
            dictionaries.set(language, pending);
        }
        return dictionaries.get(language);
    }

    function indexDictionary(dictionary) {
        if (indexes.has(dictionary)) return indexes.get(dictionary);
        const entries = new Map();
        const phrases = new Map();
        for (const [key, translated] of Object.entries(dictionary)) {
            if (typeof translated !== "string" || !translated.trim()) continue;
            const normalized = normalize(key);
            if (!entries.has(normalized) || key === normalized) entries.set(normalized, translated);
            const tokens = key.split(/\s+/);
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
        for (const form of candidates(word)) {
            if (entries.has(form)) return entries.get(form);
        }
        return null; // Missing words must never trigger a paid call.
    }

    // Keep positions aligned with subtitle spans: one bubble per longest matching phrase.
    // Simple words remain available inside phrases and for explicit hover lookups.
    function lookupWordByWord(words, target, source = null) {
        const result = Array(words.length).fill(null);
        const { phrases } = indexDictionary(target);
        for (let i = 0; i < words.length; i++) {
            let match = null;
            if (!source) {
                const options = candidates(words[i]).flatMap((form) => phrases.get(form) || [])
                    .sort((a, b) => b.tokens.length - a.tokens.length);
                match = options.find(({ tokens }) => tokens.every((token, offset) => {
                    const actual = words[i + offset];
                    if (actual === undefined) return false;
                    const expected = normalize(token);
                    const possessive = /^(?:someone|one)'s$/.test(expected)
                        && /^(?:my|your|his|her|its|our|their|[\p{L}]+['’]s)$/u.test(normalize(actual));
                    if (!possessive && !candidates(actual).includes(expected)) return false;
                    // Do not join unrelated clauses; punctuation written in the idiom is allowed.
                    if (offset < tokens.length - 1) {
                        const punctuation = (text) => (text.match(/[,;:.!?]+["'’”)]*$/u) || [""])[0];
                        if (punctuation(actual) !== punctuation(token)) return false;
                    }
                    return true;
                }));
            }
            if (match) {
                result[i] = { translated: match.translated, length: match.tokens.length };
                i += match.tokens.length - 1;
                continue;
            }
            if (!source && utils.isSimpleWord(words[i])) continue;
            const translated = lookup(words[i], target, source);
            if (translated) result[i] = { translated, length: 1 };
        }
        return result;
    }

    async function lookupWords(words, targetLang, sourceLang = "en", options = {}) {
        if (!Array.isArray(words) || words.length > 500 || words.some((w) => typeof w !== "string" || w.length > 200)) {
            throw new Error("Invalid dictionary lookup.");
        }
        const languageCode = (value) => {
            const code = String(value || "").toLowerCase().replace(/_/g, "-");
            return Object.hasOwn(root.LectoroConstants.SUPPORTED_LANGUAGES, code) ? code : code.split("-")[0];
        };
        targetLang = languageCode(targetLang);
        sourceLang = languageCode(sourceLang);
        const [target, source] = await Promise.all([
            loadDictionary(targetLang),
            sourceLang && sourceLang !== "en" && sourceLang !== "auto" ? loadDictionary(sourceLang) : null,
        ]);
        return options?.wordByWord
            ? lookupWordByWord(words, target, source)
            : words.map((word) => lookup(word, target, source));
    }

    root.LocalDictionary = Object.freeze({ lookupWords, lookup, candidates, lookupWordByWord });
    if (typeof module !== "undefined") module.exports = root.LocalDictionary;
})(globalThis);
