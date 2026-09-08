/** Bundled dictionaries: no remote requests, keys are English lemmas. */
(function (root) {
    "use strict";
    const dictionaries = new Map();
    const normalize = (word) => String(word || "").normalize("NFKC").toLowerCase()
        .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, "");
    const irregular = Object.freeze({
        children: "child", men: "man", women: "woman", people: "person",
        feet: "foot", teeth: "tooth", mice: "mouse", went: "go", gone: "go",
        ran: "run", ate: "eat", eaten: "eat", drank: "drink", drunk: "drink",
        wrote: "write", written: "write", made: "make", bought: "buy", taught: "teach",
        was: "be", were: "be", been: "be", had: "have", did: "do", done: "do",
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

    function lookup(word, target, source = null) {
        if (source) {
            const entry = Object.entries(source).find(([, value]) => normalize(value) === normalize(word));
            return entry ? target[entry[0]] || null : null;
        }
        for (const form of candidates(word)) {
            if (Object.hasOwn(target, form) && typeof target[form] === "string") return target[form];
        }
        return null; // Missing words must never trigger a paid call.
    }

    async function lookupWords(words, targetLang, sourceLang = "en") {
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
        return words.map((word) => lookup(word, target, source));
    }

    root.LocalDictionary = Object.freeze({ lookupWords, lookup, candidates });
    if (typeof module !== "undefined") module.exports = root.LocalDictionary;
})(globalThis);
