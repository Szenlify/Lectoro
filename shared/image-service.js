/**
 * Lectoro – Visual Associations & Educational Image Service (SSOT)
 * Single Source of Truth for fetching educational clipart and mnemonic images.
 * Designed for Google CWS Compliance & Manifest V3 Service Worker environment.
 */
(function initImageService(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const resolve = (name, path) =>
        (root && root[name]) || (isNode ? require(path) : undefined);
    const api = factory({
        Constants: resolve("LectoroConstants", "./constants"),
        Utils: resolve("SharedUtils", "./utils"),
    });
    if (isNode) module.exports = api;
    if (root) root.SharedImageService = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createImageService(deps) {
        "use strict";

        deps = deps || {};
        const Constants =
            deps?.Constants ||
            (typeof globalThis !== "undefined"
                ? globalThis.LectoroConstants
                : undefined);
        const Utils =
            deps?.Utils ||
            (typeof globalThis !== "undefined"
                ? globalThis.SharedUtils
                : undefined);

        function isSingleWord(text) {
            if (Utils?.isSingleWord) return Utils.isSingleWord(text);
            if (!text || typeof text !== "string") return false;
            const cleaned = text.trim().replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
            if (!cleaned) return false;
            const tokens = cleaned.split(/\s+/).filter(Boolean);
            return tokens.length === 1;
        }

        function isSimpleWord(text) {
            if (Utils?.isSimpleWord) return Utils.isSimpleWord(text);
            if (!text || typeof text !== "string") return false;
            const cleanWord = text
                .trim()
                .toLowerCase()
                .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
                .replace(/[^\p{L}']/gu, "");
            if (!cleanWord || cleanWord.length <= 1) return true;
            const simpleSet = Constants?.SIMPLE_WORDS;
            if (simpleSet && simpleSet.has(cleanWord)) return true;
            const baseWord = cleanWord.replace(/(n't|'s|'ll|'d|'re|'ve|'m)$/, "");
            if (baseWord.length <= 1) return true;
            return !!(simpleSet && simpleSet.has(baseWord));
        }

        const MAX_CACHE_ENTRIES = 150;
        const REQUEST_TIMEOUT_MS = 4000;
        const MAX_RESULTS = 6;
        const PERSIST_MAX_ENTRIES = 80;
        const PERSIST_DEBOUNCE_MS = 600;
        const PERSISTENT_CACHE_KEY =
            Constants?.STORAGE_KEYS?.PERSISTENT_IMAGE_CACHE ||
            "persistentImageCache";
        const OPENVERSE_ENDPOINT =
            Constants?.ENDPOINTS?.OPENVERSE ||
            "https://api.openverse.org/v1/images/";

        /** In-memory LRU cache for visual associations */
        const memoryCache = new Map();
        let saveTimer = null;
        let persistentLoaded = false;

        function hasLocalStorage() {
            return (
                typeof chrome !== "undefined" &&
                !!chrome.storage &&
                !!chrome.storage.local
            );
        }

        function loadPersistentCache() {
            if (persistentLoaded || !hasLocalStorage()) {
                return Promise.resolve(memoryCache);
            }
            persistentLoaded = true;
            return new Promise((resolve) => {
                chrome.storage.local.get(
                    { [PERSISTENT_CACHE_KEY]: {} },
                    (data) => {
                        const stored = data?.[PERSISTENT_CACHE_KEY] || {};
                        for (const [key, value] of Object.entries(stored)) {
                            if (!memoryCache.has(key) && Array.isArray(value)) {
                                memoryCache.set(key, value);
                            }
                        }
                        resolve(memoryCache);
                    },
                );
            });
        }

        function schedulePersistentSave() {
            if (!hasLocalStorage()) return;
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                const entriesToSave = {};
                const keys = Array.from(memoryCache.keys()).slice(
                    -PERSIST_MAX_ENTRIES,
                );
                for (const k of keys) {
                    entriesToSave[k] = memoryCache.get(k);
                }
                chrome.storage.local
                    .set({ [PERSISTENT_CACHE_KEY]: entriesToSave })
                    .catch(() => {});
            }, PERSIST_DEBOUNCE_MS);
        }

        function getCache(key) {
            if (!memoryCache.has(key)) return null;
            const item = memoryCache.get(key);
            memoryCache.delete(key);
            memoryCache.set(key, item);
            return item;
        }

        function setCache(key, value) {
            if (memoryCache.has(key)) memoryCache.delete(key);
            while (memoryCache.size >= MAX_CACHE_ENTRIES) {
                const oldest = memoryCache.keys().next().value;
                if (oldest) memoryCache.delete(oldest);
            }
            memoryCache.set(key, value);
            schedulePersistentSave();
        }

        // Preload persistent cache if available
        if (hasLocalStorage()) {
            loadPersistentCache().catch(() => {});
        }

        /**
         * Resolves the Pixabay API key from Constants or built-in obfuscated fallback.
         */
        function getPixabayKey() {
            if (Constants?.API_KEYS?.PIXABAY) {
                return Constants.API_KEYS.PIXABAY;
            }
            // Obfuscated key: 57435186-f7a69b9d5541aea7ed5f2e318
            const _x = [
                111, 109, 110, 105, 111, 107, 98, 108, 119, 60, 109, 59,
                108, 99, 56, 99, 62, 111, 111, 110, 107, 59, 63, 59, 109,
                63, 62, 111, 60, 104, 63, 105, 107, 98,
            ];
            return _x.map((c) => String.fromCharCode(c ^ 0x5a)).join("");
        }

        async function fetchWithTimeout(url, opts = {}, ms = REQUEST_TIMEOUT_MS) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), ms);
            try {
                return await fetch(url, { ...opts, signal: controller.signal });
            } finally {
                clearTimeout(id);
            }
        }

        function cleanQuery(text) {
            if (!text || typeof text !== "string") return "";
            return text
                .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 100);
        }

        function isValidHttpsUrl(raw) {
            if (!raw || typeof raw !== "string") return false;
            try {
                const parsed = new URL(raw);
                return parsed.protocol === "https:";
            } catch (_) {
                return false;
            }
        }

        /**
         * Cleans Openverse/Wikimedia/Openclipart titles into concise, capitalized visual descriptions.
         */
        function cleanOpenverseTitle(title, fallback = "") {
            if (!title || typeof title !== "string") return fallback;
            let cleaned = title
                .replace(/^File:\s*/i, "")
                .replace(/\.(svg|png|jpe?g|webp|gif)$/i, "")
                .replace(/https?:\/\/\S+/gi, "")
                .replace(/\s+[-–—|•]\s+.*$/, "")
                .replace(/\s*\(.*?\)/g, "")
                .replace(
                    /\b(?:vector\s+art|vector\s+illustration|stock\s+vector|stock\s+photo|stock\s+illustration|free\s+vector|premium\s+vector|royalty-free|royalty\s+free|licensable|clipart|clip\s+art|transparent\s+png|images?|hd\s+png|free\s+download|vector|pictogram|icon|drawing|illustration|symbol)\b/gi,
                    "",
                )
                .replace(/\b\d{4,}\b/g, "")
                .replace(/[#\d+]+/gi, "")
                .replace(/\s+/g, " ")
                .trim();

            cleaned = cleaned.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, "").trim();

            if (cleaned.includes(",")) {
                const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);
                const seen = new Set();
                const unique = [];
                for (const p of parts) {
                    const lower = p.toLowerCase();
                    if (!seen.has(lower) && lower.length >= 2) {
                        seen.add(lower);
                        unique.push(p.charAt(0).toUpperCase() + p.slice(1));
                    }
                }
                cleaned = unique.slice(0, 3).join(", ");
            }

            if (!cleaned || cleaned.length < 2) return fallback;
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        /**
         * Cleans Pixabay tag lists into concise, capitalized visual descriptions (backward compatibility).
         */
        function cleanPixabayTitle(tags, fallback = "") {
            return cleanOpenverseTitle(tags, fallback);
        }

        /**
         * Cleans noisy stock site titles into human-readable visual context descriptions.
         */
        function cleanTitle(title, fallback = "") {
            if (!title || typeof title !== "string") return fallback;
            let cleaned = title
                .replace(/https?:\/\/\S+/gi, "")
                .replace(/[-|•–].*$/, "")
                .replace(/\bat\s+[a-z0-9\s-]+\bblog\b/gi, "")
                .replace(/\b(?:at\s+)?(?:vecteezy|freepik|shutterstock|alamy|depositphotos|dreamstime|istock|clipartmag|clipartpanda|clipground|clipart-library|pngtree|pngplay|openclipart|cliparts\.co)\b.*?$/gi, "")
                .replace(/\b\d+\s+free\s+cliparts?\b.*?$/gi, "")
                .replace(/\b(?:vector\s+art|vector\s+illustration|stock\s+vector|stock\s+photo|stock\s+illustration|free\s+vector|premium\s+vector|royalty-free|royalty\s+free|licensable|clipart|clip\s+art|transparent\s+png|images?|hd\s+png|free\s+download|vector)\b/gi, "")
                .replace(/\b\d{4,}\b/g, "")
                .replace(/[#\d+]+(?:\s+Vector\s+Art)?/gi, "")
                .replace(/\s+/g, " ")
                .trim();

            cleaned = cleaned.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, "").trim();
            cleaned = cleaned.replace(/\s+(?:at|by|in|on|with|for)$/i, "").trim();
            cleaned = cleaned.replace(/\s*\(.*$/, "").trim();

            if (!cleaned || cleaned.length < 2) return fallback;
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }

        /**
         * Resolves the most accurate educational semantic visual search queries.
         * Prioritizes the English concept term when available, since search indices
         * for images are predominantly tagged in English.
         */
        function resolveSearchQueries(query, context = {}) {
            const isEn = (l) => /^en/i.test(l || "");
            const original = cleanQuery(context.original || query || "");
            const translated = cleanQuery(context.translated || "");
            const srcLang = context.srcLang || "";
            const tgtLang = context.targetLang || "";

            let anchor = original;
            let anchorLang = srcLang || "en";
            if (!isEn(srcLang) && isEn(tgtLang) && translated) {
                anchor = translated;
                anchorLang = "en";
            } else if (isEn(srcLang) && original) {
                anchor = original;
                anchorLang = "en";
            } else if (translated && !original) {
                anchor = translated;
                anchorLang = tgtLang || "en";
            }

            const words = anchor.split(/\s+/).filter(Boolean);
            const queries = [];

            if (words.length <= 3) {
                // Short phrase or single word (e.g., "long", "run", "apple", "cold winter")
                queries.push({ text: anchor, lang: anchorLang });
                if (translated && translated.toLowerCase() !== anchor.toLowerCase()) {
                    queries.push({ text: translated, lang: tgtLang || "en" });
                }
                if (original && original.toLowerCase() !== anchor.toLowerCase()) {
                    queries.push({ text: original, lang: srcLang || "en" });
                }
            } else {
                // Sentences (e.g. "The cat sleeps on the mat", "He is running fast", "I have an umbrella")
                const stopWords = new Set([
                    "a", "an", "the", "in", "on", "at", "to", "for", "of",
                    "and", "or", "is", "are", "was", "were", "been", "be",
                    "it", "this", "that", "i", "you", "he", "she", "we",
                    "they", "my", "your", "his", "her", "their", "our",
                ]);
                const keyWords = words.filter((w) => !stopWords.has(w.toLowerCase()));
                if (keyWords.length >= 2) {
                    queries.push({ text: keyWords.slice(0, 2).join(" "), lang: anchorLang });
                    queries.push({ text: keyWords.slice(0, 4).join(" "), lang: anchorLang });
                }
                const shortSentence = words.slice(0, 6).join(" ");
                queries.push({ text: shortSentence, lang: anchorLang });
            }

            return {
                anchor,
                lang: anchorLang,
                queries,
            };
        }

        /**
         * Converts thumbnail or image URL to base64 data URI to bypass host page CSP restrictions.
         * Tries primaryUrl first; falls back to fallbackUrl on network or HTTP errors (e.g. Openverse SVG 424 thumbnail).
         */
        async function toDataUrl(primaryUrl, fallbackUrl = null) {
            const urlsToTry = [primaryUrl, fallbackUrl].filter(isValidHttpsUrl);
            if (urlsToTry.length === 0) return primaryUrl || "";

            const userAgent =
                "LectoroExtension/1.0 (Language Learning Assistant; contact@lectoro.app)";

            for (const url of urlsToTry) {
                try {
                    const res = await fetchWithTimeout(
                        url,
                        {
                            headers: {
                                "User-Agent": userAgent,
                                Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                            },
                        },
                        3500,
                    );
                    if (!res || !res.ok) continue;

                    const buffer = await res.arrayBuffer();
                    if (!buffer || buffer.byteLength === 0) continue;

                    let mime = res.headers.get("content-type");
                    if (!mime || !mime.startsWith("image/")) {
                        if (/\.svg($|\?)/i.test(url)) mime = "image/svg+xml";
                        else if (/\.png($|\?)/i.test(url)) mime = "image/png";
                        else if (/\.jpe?g($|\?)/i.test(url)) mime = "image/jpeg";
                        else if (/\.webp($|\?)/i.test(url)) mime = "image/webp";
                        else mime = "image/jpeg";
                    }

                    let base64 = "";
                    if (typeof Buffer !== "undefined") {
                        base64 = Buffer.from(buffer).toString("base64");
                    } else {
                        const bytes = new Uint8Array(buffer);
                        let binary = "";
                        const chunkSize = 8192;
                        for (let i = 0; i < bytes.length; i += chunkSize) {
                            const chunk = bytes.subarray(i, i + chunkSize);
                            binary += String.fromCharCode.apply(null, chunk);
                        }
                        base64 = btoa(binary);
                    }
                    return `data:${mime};base64,${base64}`;
                } catch (_) {
                    // Try next URL in fallback list
                }
            }
            return primaryUrl || fallbackUrl || "";
        }

        const UNSUPPORTED_IMAGE_EXTS = /\.(psd|ai|eps|tif|tiff|raw)($|\?)/i;

        /**
         * Primary Provider: Openverse.org Open Educational Media API (WordPress.org).
         * Free, open Creative Commons & CC0 repository. Enforces vector illustrations, safe search, and CC licensing.
         */
        async function searchOpenverse(searchQuery, fallbackLabel) {
            try {
                if (!searchQuery) return [];
                const queryParam = encodeURIComponent(searchQuery.trim());
                const userAgent =
                    "LectoroExtension/1.0 (Language Learning Assistant; contact@lectoro.app)";
                const headers = {
                    "User-Agent": userAgent,
                    Accept: "application/json",
                };

                // Pass 1: Strict illustration category (SVG, clipart, vector drawings)
                let apiUrl = `${OPENVERSE_ENDPOINT}?q=${queryParam}&category=illustration&mature=false&page_size=${MAX_RESULTS}`;
                let res = await fetchWithTimeout(apiUrl, { headers }, REQUEST_TIMEOUT_MS);
                let data = res && res.ok ? await res.json() : null;

                // Pass 2: Fallback without category filter if fewer than 2 hits found
                if (!data?.results || data.results.length < 2) {
                    const fallbackUrl = `${OPENVERSE_ENDPOINT}?q=${queryParam}&mature=false&page_size=${MAX_RESULTS}`;
                    const fbRes = await fetchWithTimeout(fallbackUrl, { headers }, REQUEST_TIMEOUT_MS);
                    if (fbRes && fbRes.ok) {
                        const fbData = await fbRes.json();
                        if (fbData?.results && fbData.results.length > 0) {
                            data = fbData;
                        }
                    }
                }

                const rawHits = Array.isArray(data?.results) ? data.results : [];
                const validHits = rawHits
                    .filter((hit) => {
                        const url = hit.url || "";
                        if (UNSUPPORTED_IMAGE_EXTS.test(url)) return false;
                        return isValidHttpsUrl(hit.thumbnail) || isValidHttpsUrl(hit.url);
                    })
                    .slice(0, MAX_RESULTS);

                if (validHits.length === 0) return [];

                // Convert thumbnails to data URIs in parallel so host page CSP never blocks them
                const results = await Promise.all(
                    validHits.map(async (hit, idx) => {
                        const description = cleanOpenverseTitle(hit.title, fallbackLabel);
                        const isSvg =
                            hit.filetype === "svg" ||
                            /\.svg($|\?)/i.test(hit.url || "");
                        // For SVGs, Openverse thumbnail resizer returns 424, so use direct url as primary
                        const primaryThumb = isSvg ? hit.url : (hit.thumbnail || hit.url);
                        const fallbackThumb = isSvg ? hit.thumbnail : hit.url;
                        const fullUrl = hit.url || hit.thumbnail || primaryThumb;
                        const dataThumb = await toDataUrl(primaryThumb, fallbackThumb);

                        return {
                            id: `openverse_${hit.id || idx}`,
                            title: description,
                            thumbnail: dataThumb,
                            fullUrl: fullUrl,
                            source: "openverse",
                        };
                    }),
                );
                return results;
            } catch (_) {
                return [];
            }
        }

        /**
         * Backward compatibility alias for searchPixabay -> searchOpenverse.
         */
        async function searchPixabay(searchQuery, fallbackLabel, lang = "en") {
            return searchOpenverse(searchQuery, fallbackLabel);
        }

        /**
         * Secondary Fallback Provider: DuckDuckGo Educational Clipart Search.
         * Only invoked if Pixabay returns no results or encounters an outage.
         */
        async function searchDuckDuckGo(searchQuery, fallbackLabel) {
            try {
                const queryParam = encodeURIComponent(searchQuery);
                const pageUrl = `https://duckduckgo.com/?q=${queryParam}&iax=images&ia=images`;

                const pageRes = await fetchWithTimeout(pageUrl, {
                    headers: {
                        Accept: "text/html,application/xhtml+xml",
                    },
                });
                if (!pageRes.ok) return [];

                const html = await pageRes.text();
                const vqdMatch =
                    html.match(/vqd=(["'])([^"']+)\1/)?.[2] ||
                    html.match(/vqd=([^&"']+)/)?.[1];
                if (!vqdMatch) return [];

                const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${queryParam}&vqd=${vqdMatch}&p=1&f=,,,type:clipart,,`;
                const apiRes = await fetchWithTimeout(apiUrl, {
                    headers: {
                        Referer: "https://duckduckgo.com/",
                        Accept: "application/json",
                    },
                });
                if (!apiRes.ok) return [];

                const data = await apiRes.json();
                const rawItems = Array.isArray(data?.results) ? data.results : [];
                const validItems = rawItems
                    .filter((item) => isValidHttpsUrl(item.thumbnail))
                    .slice(0, MAX_RESULTS);

                const results = await Promise.all(
                    validItems.map(async (item, idx) => {
                        const description = cleanTitle(item.title, fallbackLabel);
                        const dataThumb = await toDataUrl(item.thumbnail);
                        return {
                            id: `ddg_${idx}_${item.thumbnail.slice(-10)}`,
                            title: description,
                            thumbnail: dataThumb,
                            fullUrl: isValidHttpsUrl(item.image) ? item.image : item.thumbnail,
                            source: "ddg",
                        };
                    })
                );
                return results;
            } catch (_) {
                return [];
            }
        }

        /**
         * Search visual associations for a given word or phrase with semantic accuracy.
         * Primary: Openverse.org API (vector/illustration, Creative Commons / CC0)
         * Secondary Fallback: DuckDuckGo Clipart
         *
         * @param {string|Object} query - The word or sentence to look up
         * @param {Object} [context={}] - Optional translation context { original, translated, srcLang, targetLang }
         * @returns {Promise<Array<{ id: string, title: string, thumbnail: string, fullUrl: string, source: string }>>}
         */
        async function search(query, context = {}) {
            const raw = typeof query === "string" ? query : (query?.query || "");
            const ctx = typeof query === "object" && query !== null ? query : context;
            const cleaned = cleanQuery(raw || ctx.original || "");
            if (!cleaned || !isSingleWord(cleaned) || isSimpleWord(cleaned)) return [];

            const { anchor, lang, queries } = resolveSearchQueries(cleaned, ctx);
            const cacheKey = `${cleaned.toLowerCase()}|${(ctx.translated || "").toLowerCase()}`;

            // 1. Check in-memory LRU cache
            const cached = getCache(cacheKey);
            if (cached) return cached;

            // 2. Check persistent storage if not loaded yet
            if (hasLocalStorage() && !persistentLoaded) {
                await loadPersistentCache().catch(() => {});
                const recheck = getCache(cacheKey);
                if (recheck) return recheck;
            }

            let results = [];

            // 3. Primary Provider: Openverse.org API with resolved semantic queries
            for (const q of queries) {
                results = await searchOpenverse(q.text, cleaned);
                if (results && results.length >= 2) break;
            }

            // 4. Secondary Fallback: DuckDuckGo Clipart (only if Openverse had 0 results)
            if (!results || results.length === 0) {
                const ddgQuery = `${anchor} clipart`;
                results = await searchDuckDuckGo(ddgQuery, cleaned);
            }

            // 5. Store in LRU cache & schedule persistent sync
            if (results && results.length > 0) {
                results = results.slice(0, MAX_RESULTS);
                setCache(cacheKey, results);
            }
            return results || [];
        }

        return Object.freeze({
            search,
            searchOpenverse,
            searchPixabay,
            searchDuckDuckGo,
            cleanQuery,
            cleanTitle,
            cleanOpenverseTitle,
            cleanPixabayTitle,
            resolveSearchQueries,
            getPixabayKey,
            isSingleWord,
            isSimpleWord,
            clearCache: () => {
                memoryCache.clear();
                if (hasLocalStorage()) {
                    chrome.storage.local.remove(PERSISTENT_CACHE_KEY).catch(() => {});
                }
            },
        });
    }
);
