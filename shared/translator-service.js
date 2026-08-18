/**
 * Lectoro – Universal Translator & AI Service (SSOT)
 * Single Source of Truth for Google Translate queries, translation caching,
 * and Gemini AI explanations / sentence generation via Firebase Proxy.
 */
(function initTranslatorService(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) {
        root.SharedTranslatorService = api;
        root.TranslatorService = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTranslatorService() {
    "use strict";

    /**
     * In-memory LRU cache factory for translations.
     */
    function createTranslateCache(maxSize = 300) {
        const cache = new Map();
        return {
            async get(text, targetLang, fetcher = null) {
                const key = `${text}|${targetLang}`;
                if (cache.has(key)) return cache.get(key);
                const fetchFn = fetcher || ((t, l) => googleTranslate(t, l));
                const result = await fetchFn(text, targetLang);
                cache.set(key, result);
                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                }
                return result;
            },
            set(text, targetLang, result) {
                const key = `${text}|${targetLang}`;
                cache.set(key, result);
                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                }
            },
            has(text, targetLang) {
                return cache.has(`${text}|${targetLang}`);
            },
            clear() {
                cache.clear();
            },
            get size() {
                return cache.size;
            },
        };
    }

    const defaultCache = createTranslateCache(500);

    /**
     * Get preferred target language from storage.
     */
    async function getTargetLang() {
        if (!chrome?.storage?.local) return "pl";
        const data = await chrome.storage.local.get({ targetLang: "pl" });
        return data.targetLang || "pl";
    }

    /**
     * Google Translate (client=gtx, no API key needed).
     */
    async function googleTranslate(text, targetLang = "pl") {
        const url =
            "https://translate.googleapis.com/translate_a/single" +
            "?client=gtx&sl=auto&tl=" +
            encodeURIComponent(targetLang) +
            "&dt=t&q=" +
            encodeURIComponent(text);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const translated = data[0].map((s) => s[0]).join("");
        const detectedLang = data[2] || "auto";
        return { translated, detectedLang };
    }

    /**
     * Translate with caching.
     */
    async function translateWithCache(text, targetLang = "pl") {
        return defaultCache.get(text, targetLang, googleTranslate);
    }

    /**
     * Gemini AI Request via Firebase Secure Proxy.
     */
    async function geminiRequest(
        prompt,
        { temperature = 0.8, maxOutputTokens = 250 } = {},
    ) {
        if (typeof GeminiProxy === "undefined") {
            throw new Error(
                "GeminiProxy jest niedostępny – upewnij się, że moduły Firebase są załadowane.",
            );
        }
        return GeminiProxy.requestJSON(prompt, {
            temperature,
            maxOutputTokens,
        });
    }

    /**
     * AI Sentence generator for Anki / Spaced Repetition cards.
     */
    async function generateSentence(word, translated, srcLang, tgtLang) {
        if (typeof AIPrompts === "undefined") {
            throw new Error("AIPrompts jest niedostępny.");
        }
        const prompt = AIPrompts.sentenceExample(
            word,
            translated,
            srcLang,
            tgtLang,
        );
        const parsed = await geminiRequest(prompt, {
            temperature: 0.8,
            maxOutputTokens: 200,
        });
        return {
            sentence: parsed.sentence || "",
            translation: parsed.translation || "",
        };
    }

    /**
     * AI Deep Sentence explanation.
     */
    async function explainSentence(sentence, targetLang) {
        if (typeof AIPrompts === "undefined") {
            throw new Error("AIPrompts jest niedostępny.");
        }
        const prompt = AIPrompts.explainSentence(sentence, targetLang);
        const parsed = await geminiRequest(prompt, {
            temperature: 0.7,
            maxOutputTokens: 250,
        });
        return {
            translation: parsed.translation || "",
            explanation: parsed.explanation || "",
        };
    }

    /**
     * AI Movie dialogue translation with contextual explanation.
     */
    async function movieTranslate(text, targetLang) {
        if (typeof AIPrompts === "undefined") {
            throw new Error("AIPrompts jest niedostępny.");
        }
        const prompt = AIPrompts.movieTranslate(text, targetLang);
        const parsed = await geminiRequest(prompt, {
            temperature: 0.8,
            maxOutputTokens: 260,
        });
        return {
            translation: parsed.translation || "",
            explanation: parsed.explanation || "",
        };
    }

    return Object.freeze({
        translate: googleTranslate,
        translateWithCache,
        createTranslateCache,
        getTargetLang,
        geminiRequest,
        generateSentence,
        explainSentence,
        movieTranslate,
        defaultCache,
    });
});
