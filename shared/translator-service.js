/**
 * Lectoro – Universal Translator & AI Service (SSOT)
 * Single Source of Truth for Google Translate queries, translation caching,
 * and Gemini AI explanations / sentence generation via Firebase Proxy.
 */
(function initTranslatorService(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const resolve = (name, path) =>
        (root && root[name]) || (isNode ? require(path) : undefined);
    const api = factory({
        Utils: resolve("SharedUtils", "./utils"),
        Constants: resolve("LectoroConstants", "./constants"),
    });
    if (isNode) module.exports = api;
    if (root) root.SharedTranslatorService = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createTranslatorService(deps) {
        "use strict";

        const { Utils, Constants } = deps;
        const MSG = Constants.MESSAGE_TYPES;
        const PERSISTENT_TRANSLATE_CACHE_KEY =
            Constants.STORAGE_KEYS.PERSISTENT_TRANSLATE_CACHE;
        const PERSISTENT_MAX_ENTRIES = 500;
        const PERSIST_DEBOUNCE_MS = 1000;

        function hasLocalStorage() {
            return typeof chrome !== "undefined" && !!chrome?.storage?.local;
        }

        /**
         * Single persistent translation memo shared by every cache instance, so word- and
         * sentence-level caches never overwrite each other's snapshot in chrome.storage.local.
         */
        const persistentStore = {
            entries: new Map(),
            loading: null,
            saveTimer: null,
            load() {
                if (this.loading) return this.loading;
                if (!hasLocalStorage()) {
                    this.loading = Promise.resolve(this.entries);
                    return this.loading;
                }
                this.loading = new Promise((resolve) => {
                    chrome.storage.local.get(
                        { [PERSISTENT_TRANSLATE_CACHE_KEY]: {} },
                        (data) => {
                            const stored =
                                data?.[PERSISTENT_TRANSLATE_CACHE_KEY] || {};
                            for (const [key, value] of Object.entries(stored)) {
                                if (!this.entries.has(key))
                                    this.entries.set(key, value);
                            }
                            resolve(this.entries);
                        },
                    );
                });
                return this.loading;
            },
            remember(key, value) {
                this.entries.delete(key);
                this.entries.set(key, value);
                while (this.entries.size > PERSISTENT_MAX_ENTRIES) {
                    this.entries.delete(this.entries.keys().next().value);
                }
                this.scheduleSave();
            },
            scheduleSave() {
                if (!hasLocalStorage()) return;
                if (this.saveTimer) clearTimeout(this.saveTimer);
                this.saveTimer = setTimeout(() => {
                    this.saveTimer = null;
                    chrome.storage.local
                        .set({
                            [PERSISTENT_TRANSLATE_CACHE_KEY]:
                                Object.fromEntries(this.entries),
                        })
                        .catch(() => {});
                }, PERSIST_DEBOUNCE_MS);
            },
            clear() {
                this.entries.clear();
                if (hasLocalStorage()) {
                    chrome.storage.local
                        .remove(PERSISTENT_TRANSLATE_CACHE_KEY)
                        .catch(() => {});
                }
            },
        };

        /**
         * In-memory LRU translation cache backed by the shared persistent store.
         */
        function createTranslateCache(maxSize = 500) {
            const cache = new Map();
            const cacheKey = (text, targetLang) => `${text}|${targetLang}`;

            persistentStore.load().then((entries) => {
                for (const [key, value] of entries) {
                    if (!cache.has(key)) cache.set(key, value);
                }
            });

            function store(key, result) {
                cache.set(key, result);
                if (cache.size > maxSize) {
                    cache.delete(cache.keys().next().value);
                }
                persistentStore.remember(key, result);
            }

            return {
                async get(text, targetLang, fetcher = null) {
                    const key = cacheKey(text, targetLang);
                    if (cache.has(key)) return cache.get(key);
                    const fetchFn = fetcher || googleTranslate;
                    const result = await fetchFn(text, targetLang);
                    store(key, result);
                    return result;
                },
                set(text, targetLang, result) {
                    store(cacheKey(text, targetLang), result);
                },
                has(text, targetLang) {
                    return cache.has(cacheKey(text, targetLang));
                },
                clear() {
                    cache.clear();
                    persistentStore.clear();
                },
                get size() {
                    return cache.size;
                },
            };
        }

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
         * Content scripts delegate to the background so the host page's CSP can't block the request.
         */
        async function googleTranslate(text, targetLang = "pl") {
            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.GOOGLE_TRANSLATE,
                        text,
                        targetLang,
                    });
                    if (response?.result) return response.result;
                } catch (_) {
                    // Fallback to direct fetch if the background is unavailable
                }
            }

            const url =
                `${Constants.ENDPOINTS.GOOGLE_TRANSLATE}?client=gtx&sl=auto&tl=` +
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
            const prompt = AIPrompts.explainSentence(
                sentence,
                targetLang,
                context,
            );
            const parsed = await geminiRequest(prompt, {
                temperature: 0.7,
                maxOutputTokens: 600,
            });
            const rawItems = Array.isArray(parsed?.items)
                ? parsed.items
                : Array.isArray(parsed?.breakdown)
                  ? parsed.breakdown
                  : [];
            const items = rawItems
                .filter((item) => item && typeof item === "object" && item.term)
                .map((item) => ({
                    term: String(item.term || "").trim(),
                    type: String(item.type || "idiom").toLowerCase().trim(),
                    meaning: String(item.meaning || item.translation || "").trim(),
                    explanation: String(item.explanation || "").trim(),
                }));

            return {
                detectedLang:
                    parsed?.source_language ||
                    parsed?.sourceLanguage ||
                    parsed?.detected_language ||
                    parsed?.detectedLang ||
                    "",
                translation: parsed?.translation || "",
                explanation: parsed?.explanation || "",
                items,
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
            createTranslateCache,
            getTargetLang,
            geminiRequest,
            generateSentence,
            explainSentence,
            movieTranslate,
        });
    },
);
