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
     * In-memory & chrome.storage.local backed LRU cache factory for translations.
     */
    const PERSISTENT_TRANSLATE_CACHE_KEY = "persistentTranslateCache";

    function createTranslateCache(maxSize = 500) {
        const cache = new Map();

        // Load cached translations asynchronously from chrome.storage.local
        if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            chrome.storage.local.get({ [PERSISTENT_TRANSLATE_CACHE_KEY]: {} }, (data) => {
                const stored = data[PERSISTENT_TRANSLATE_CACHE_KEY] || {};
                for (const [k, v] of Object.entries(stored)) {
                    if (!cache.has(k)) cache.set(k, v);
                }
            });
        }

        let saveTimeout = null;
        function schedulePersistentSave() {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) return;
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveTimeout = null;
                const obj = {};
                let count = 0;
                for (const [k, v] of cache.entries()) {
                    if (count++ >= maxSize) break;
                    obj[k] = v;
                }
                chrome.storage.local.set({ [PERSISTENT_TRANSLATE_CACHE_KEY]: obj }).catch(() => {});
            }, 1000);
        }

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
                schedulePersistentSave();
                return result;
            },
            set(text, targetLang, result) {
                const key = `${text}|${targetLang}`;
                cache.set(key, result);
                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                }
                schedulePersistentSave();
            },
            has(text, targetLang) {
                return cache.has(`${text}|${targetLang}`);
            },
            clear() {
                cache.clear();
                if (typeof chrome !== "undefined" && chrome?.storage?.local) {
                    chrome.storage.local.remove(PERSISTENT_TRANSLATE_CACHE_KEY).catch(() => {});
                }
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

    function isContentScriptEnvironment() {
        return (
            typeof window !== "undefined" &&
            window.location?.protocol !== "chrome-extension:" &&
            typeof chrome !== "undefined" &&
            typeof chrome.runtime?.sendMessage === "function"
        );
    }

    /**
     * Google Translate (client=gtx, no API key needed).
     */
    async function googleTranslate(text, targetLang = "pl") {
        if (isContentScriptEnvironment()) {
            try {
                const response = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { type: "QT_GOOGLE_TRANSLATE", text, targetLang },
                        (res) => {
                            if (chrome.runtime.lastError) {
                                return reject(new Error(chrome.runtime.lastError.message));
                            }
                            if (res?.error) {
                                return reject(new Error(res.error));
                            }
                            resolve(res?.result);
                        },
                    );
                });
                if (response) return response;
            } catch (_) {
                // Fallback to direct fetch if sendMessage is unavailable
            }
        }

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
                "GeminiProxy is unavailable – ensure Firebase modules are loaded.",
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
            throw new Error("AIPrompts is unavailable.");
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
    async function explainSentence(sentence, targetLang, context = null) {
        if (typeof AIPrompts === "undefined") {
            throw new Error("AIPrompts is unavailable.");
        }
        const prompt = AIPrompts.explainSentence(sentence, targetLang, context);
        const parsed = await geminiRequest(prompt, {
            temperature: 0.7,
            maxOutputTokens: 350,
        });
        return {
            detectedLang:
                parsed.source_language ||
                parsed.sourceLanguage ||
                parsed.detected_language ||
                parsed.detectedLang ||
                "",
            translation: parsed.translation || "",
            explanation: parsed.explanation || "",
        };
    }

    /**
     * AI Movie dialogue translation with contextual explanation.
     */
    async function movieTranslate(text, targetLang, context = null) {
        if (typeof AIPrompts === "undefined") {
            throw new Error("AIPrompts is unavailable.");
        }
        const prompt = AIPrompts.movieTranslate(text, targetLang, context);
        const parsed = await geminiRequest(prompt, {
            temperature: 0.8,
            maxOutputTokens: 350,
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
