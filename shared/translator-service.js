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
        const REQUEST_TIMEOUT_MS = 12000;
        const MAX_CONCURRENT_REQUESTS = 2;
        const RETRY_KEY = Constants.STORAGE_KEYS.TRANSLATE_RETRY_AT;

        function hasLocalStorage() {
            return typeof chrome !== "undefined" && !!chrome?.storage?.local;
        }

        // Popup and content scripts share the worker's transport, cache and rate limit.
        function shouldProxy() {
            return (
                typeof window !== "undefined" &&
                typeof chrome !== "undefined" &&
                typeof chrome.runtime?.sendMessage === "function"
            );
        }

        const cacheKey = (text, targetLang) => `${text}|${targetLang}`;
        const validResult = (value) =>
            typeof value?.translated === "string" &&
            value.translated.trim().length > 0;
        const persistentStore = {
            entries: new Map(),
            loading: null,
            writes: Promise.resolve(),
            load() {
                if (!this.loading) {
                    this.loading = (async () => {
                        if (hasLocalStorage()) {
                            const data = await chrome.storage.local.get({
                                [PERSISTENT_TRANSLATE_CACHE_KEY]: {},
                            });
                            for (const [key, value] of Object.entries(
                                data[PERSISTENT_TRANSLATE_CACHE_KEY] || {},
                            )) {
                                if (
                                    validResult(value) &&
                                    !this.entries.has(key)
                                )
                                    this.entries.set(key, value);
                            }
                            this.trim();
                        }
                    })().catch(() => {});
                }
                return this.loading;
            },
            trim() {
                while (this.entries.size > PERSISTENT_MAX_ENTRIES) {
                    this.entries.delete(this.entries.keys().next().value);
                }
            },
            async remember(key, value) {
                await this.load();
                this.entries.delete(key);
                this.entries.set(key, value);
                this.trim();
                // Only the worker writes shared snapshots; tabs cannot overwrite each other.
                if (hasLocalStorage() && !shouldProxy()) {
                    this.writes = this.writes
                        .catch(() => {})
                        .then(() =>
                            chrome.storage.local.set({
                                [PERSISTENT_TRANSLATE_CACHE_KEY]:
                                    Object.fromEntries(this.entries),
                            }),
                        );
                    await this.writes.catch(() => {});
                }
            },
            clear() {
                this.entries.clear();
                if (hasLocalStorage()) {
                    this.writes = this.writes
                        .catch(() => {})
                        .then(() =>
                            chrome.storage.local.remove(
                                PERSISTENT_TRANSLATE_CACHE_KEY,
                            ),
                        );
                    this.writes.catch(() => {});
                }
            },
        };

        /** LRU cache with coalesced requests and storage hydration before the first miss. */
        function createTranslateCache(maxSize = 500) {
            maxSize = Math.max(1, Math.floor(Number(maxSize) || 500));
            const cache = new Map();
            const pending = new Map();
            let generation = 0;
            function store(key, result) {
                if (!validResult(result))
                    throw translationError(
                        "Invalid translation response.",
                        "INVALID_RESPONSE",
                    );
                cache.delete(key);
                cache.set(key, result);
                while (cache.size > maxSize)
                    cache.delete(cache.keys().next().value);
                return persistentStore.remember(key, result);
            }
            async function peek(text, targetLang) {
                await persistentStore.load();
                const key = cacheKey(text, targetLang);
                const value =
                    cache.get(key) || persistentStore.entries.get(key);
                if (value) {
                    cache.delete(key);
                    cache.set(key, value);
                    while (cache.size > maxSize)
                        cache.delete(cache.keys().next().value);
                }
                return value;
            }
            return {
                async get(text, targetLang, fetcher = null) {
                    const fetchFn = fetcher || googleTranslate;
                    const cached = await peek(text, targetLang);
                    if (cached) return cached;
                    const key = cacheKey(text, targetLang);
                    if (pending.has(key)) return pending.get(key);
                    const revision = generation;
                    const task = (async () => {
                        const result = await fetchFn(text, targetLang);
                        if (generation === revision) await store(key, result);
                        return result;
                    })();
                    pending.set(key, task);
                    try {
                        return await task;
                    } finally {
                        if (pending.get(key) === task) pending.delete(key);
                    }
                },
                peek,
                set(text, targetLang, result) {
                    return store(cacheKey(text, targetLang), result);
                },
                has(text, targetLang) {
                    const key = cacheKey(text, targetLang);
                    return cache.has(key) || persistentStore.entries.has(key);
                },
                clear() {
                    generation++;
                    cache.clear();
                    pending.clear();
                    persistentStore.clear();
                },
                get size() {
                    return cache.size;
                },
            };
        }

        async function getReadingSettings() {
            const defaults = Constants.DEFAULT_READING_SETTINGS;
            const data = hasLocalStorage()
                ? await chrome.storage.local.get(defaults)
                : defaults;
            return {
                ...defaults,
                ...data,
                targetLang: data.targetLang || defaults.targetLang,
                aiExplanationLanguage:
                    data.aiExplanationLanguage === "simple_target"
                        ? "simple_target"
                        : "native",
            };
        }
        async function getTargetLang() {
            return (await getReadingSettings()).targetLang;
        }
        async function getAiExplanationLanguage() {
            return (await getReadingSettings()).aiExplanationLanguage;
        }

        function translationError(message, code, details = {}) {
            return Object.assign(new Error(message), { code, ...details });
        }

        let activeRequests = 0;
        let retryAt = 0;
        const requestQueue = [];
        function drainQueue() {
            while (
                activeRequests < MAX_CONCURRENT_REQUESTS &&
                requestQueue.length
            ) {
                const { run, resolve, reject } = requestQueue.shift();
                activeRequests++;
                Promise.resolve()
                    .then(run)
                    .then(resolve, reject)
                    .finally(() => {
                        activeRequests--;
                        drainQueue();
                    });
            }
        }
        function scheduleRequest(run) {
            return new Promise((resolve, reject) => {
                requestQueue.push({ run, resolve, reject });
                drainQueue();
            });
        }

        async function fetchTranslation(text, targetLang) {
            if (hasLocalStorage()) {
                const data = await chrome.storage.local.get({ [RETRY_KEY]: 0 });
                retryAt = Math.max(retryAt, Number(data[RETRY_KEY]) || 0);
            }
            if (retryAt > Date.now()) {
                throw translationError(
                    "Translation service is busy. Please try again shortly.",
                    "RATE_LIMITED",
                    { status: 429, retryAt },
                );
            }
            const controller = new AbortController();
            const timeout = setTimeout(
                () => controller.abort(),
                REQUEST_TIMEOUT_MS,
            );
            try {
                const url = `${Constants.ENDPOINTS.GOOGLE_TRANSLATE}?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
                const response = await fetch(url, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    if (response.status === 429) {
                        const retryAfter = response.headers?.get("Retry-After");
                        const seconds = retryAfter ? Number(retryAfter) : NaN;
                        const serverRetryAt = Number.isFinite(seconds)
                            ? Date.now() + seconds * 1000
                            : Date.parse(retryAfter);
                        retryAt = Math.max(
                            retryAt,
                            Date.now() + 60000,
                            serverRetryAt || 0,
                        );
                        if (hasLocalStorage())
                            await chrome.storage.local.set({
                                [RETRY_KEY]: retryAt,
                            });
                    }
                    throw translationError(
                        `Translation service returned HTTP ${response.status}.`,
                        response.status === 429
                            ? "RATE_LIMITED"
                            : "TRANSLATION_HTTP_ERROR",
                        {
                            status: response.status,
                            retryAt:
                                response.status === 429 ? retryAt : undefined,
                        },
                    );
                }
                let data;
                try {
                    data = await response.json();
                } catch (_) {
                    throw translationError(
                        "Invalid translation response.",
                        "INVALID_RESPONSE",
                    );
                }
                if (!Array.isArray(data?.[0]))
                    throw translationError(
                        "Invalid translation response.",
                        "INVALID_RESPONSE",
                    );
                const result = {
                    translated: data[0]
                        .map((part) =>
                            typeof part?.[0] === "string" ? part[0] : "",
                        )
                        .join(""),
                    detectedLang: data[2] || "auto",
                };
                if (!validResult(result))
                    throw translationError(
                        "Empty translation response.",
                        "INVALID_RESPONSE",
                    );
                return result;
            } catch (error) {
                if (controller.signal.aborted)
                    throw translationError(
                        "Translation timed out. Please try again.",
                        "TRANSLATION_TIMEOUT",
                    );
                if (error.code) throw error;
                throw translationError(
                    "Could not connect to the translation service.",
                    "TRANSLATION_NETWORK_ERROR",
                );
            } finally {
                clearTimeout(timeout);
            }
        }

        const transportCache = createTranslateCache();
        async function googleTranslate(
            text,
            targetLang = Constants.DEFAULT_READING_SETTINGS.targetLang,
        ) {
            text = String(text || "").trim();
            if (!text)
                throw translationError("No text to translate.", "EMPTY_TEXT");
            if (shouldProxy()) {
                const response = await Utils.sendRuntimeMessage({
                    type: MSG.GOOGLE_TRANSLATE,
                    text,
                    targetLang,
                });
                if (!validResult(response?.result))
                    throw translationError(
                        "Invalid translation response.",
                        "INVALID_RESPONSE",
                    );
                return response.result;
            }
            return transportCache.get(text, targetLang, (value, lang) =>
                scheduleRequest(() => fetchTranslation(value, lang)),
            );
        }

        /**
         * Gemini AI Request via Firebase Secure Proxy.
         */
        async function geminiRequest(
            prompt,
            { temperature = 0.2, maxOutputTokens = 350, validate } = {},
        ) {
            if (typeof GeminiProxy === "undefined") {
                throw new Error(
                    "GeminiProxy is unavailable – ensure Firebase modules are loaded.",
                );
            }
            return GeminiProxy.requestJSON(prompt, {
                temperature,
                maxOutputTokens,
                validate,
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
                temperature: 0.4,
                maxOutputTokens: 350,
                validate(result) {
                    AIPrompts.validateLanguage(result, tgtLang);
                    requireTextFields(result, ["sentence", "translation"]);
                },
            });
            return {
                sentence: parsed.sentence || "",
                translation: parsed.translation || "",
            };
        }

        /**
         * AI Deep Sentence explanation.
         */
        async function explainSentence(
            sentence,
            targetLang,
            context = null,
            options = {},
        ) {
            if (typeof AIPrompts === "undefined") {
                throw new Error("AIPrompts is unavailable.");
            }
            const aiExplanationLanguage =
                options?.aiExplanationLanguage ||
                (await getAiExplanationLanguage());
            const prompt = AIPrompts.explainSentence(
                sentence,
                targetLang,
                context,
                { ...options, aiExplanationLanguage },
            );
            const parsed = await geminiRequest(prompt, {
                temperature: 0.2,
                maxOutputTokens: 1000,
                validate(result) {
                    const detected = AIPrompts.languageCode(
                        result?.source_language,
                    );
                    AIPrompts.validateLanguage(
                        result,
                        aiExplanationLanguage === "simple_target"
                            ? detected
                            : targetLang,
                    );
                    requireTextFields(result, [
                        "translation",
                        "explanation",
                        "badge",
                    ]);
                    if (!Array.isArray(result.items))
                        throw new Error(
                            "AI returned invalid explanation items.",
                        );
                },
            });
            const detectedLang = AIPrompts.languageCode(
                parsed?.source_language,
            );
            const rawItems = parsed.items;
            const seen = new Set();
            const types = new Set([
                "idiom",
                "phrasal_verb",
                "slang",
                "vocabulary",
            ]);
            const items = rawItems
                .filter((item) => {
                    if (
                        !item ||
                        typeof item.term !== "string" ||
                        !item.term.trim() ||
                        !types.has(item.type) ||
                        typeof item.meaning !== "string" ||
                        !item.meaning.trim() ||
                        typeof item.explanation !== "string" ||
                        !item.explanation.trim()
                    )
                        return false;
                    const term = item.term.trim();
                    if (
                        !sentence.includes(term) ||
                        seen.has(term.toLowerCase())
                    )
                        return false;
                    seen.add(term.toLowerCase());
                    return true;
                })
                .sort(
                    (a, b) =>
                        sentence.indexOf(a.term.trim()) -
                        sentence.indexOf(b.term.trim()),
                )
                .slice(0, 4)
                .map((item) => ({
                    term: String(item.term || "").trim(),
                    type: String(item.type || "idiom")
                        .toLowerCase()
                        .trim(),
                    meaning: String(
                        item.meaning || item.translation || "",
                    ).trim(),
                    explanation: String(item.explanation || "").trim(),
                    badge:
                        typeof item.badge === "string" ? item.badge.trim() : "",
                }));

            return {
                detectedLang,
                badge: parsed.badge.trim(),
                translation: parsed?.translation || "",
                explanation: parsed?.explanation || "",
                items,
            };
        }

        function requireTextFields(result, fields) {
            if (
                fields.some(
                    (key) =>
                        typeof result?.[key] !== "string" ||
                        !result[key].trim(),
                )
            ) {
                throw new Error("AI returned an incomplete response.");
            }
        }

        return Object.freeze({
            translate: googleTranslate,
            createTranslateCache,
            getTargetLang,
            getReadingSettings,
            getCachedTranslation: (text, lang) =>
                transportCache.peek(text, lang),
            getAiExplanationLanguage,
            geminiRequest,
            generateSentence,
            explainSentence,
        });
    },
);
