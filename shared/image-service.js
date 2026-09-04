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
    function createImageService() {
        "use strict";

        const MAX_CACHE_ENTRIES = 150;
        const REQUEST_TIMEOUT_MS = 4500;
        const MAX_RESULTS = 6;

        /** In-memory LRU cache for visual associations */
        const memoryCache = new Map();

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
         * for images are primarily tagged in English.
         */
        function resolveSearchQueries(query, context = {}) {
            const isEn = (l) => /^en/i.test(l || "");
            const original = cleanQuery(context.original || query || "");
            const translated = cleanQuery(context.translated || "");
            const srcLang = context.srcLang || "";
            const tgtLang = context.targetLang || "";

            // Prioritize English anchor because image databases tag clipart/illustrations predominantly in English
            let anchor = original;
            if (!isEn(srcLang) && isEn(tgtLang) && translated) {
                anchor = translated;
            } else if (isEn(srcLang) && original) {
                anchor = original;
            } else if (translated && !original) {
                anchor = translated;
            }

            const words = anchor.split(/\s+/).filter(Boolean);
            const queries = [];

            if (words.length <= 3) {
                // Short phrase or single word (e.g., "long", "run", "apple", "cold winter")
                queries.push(`${anchor} clipart`);
                queries.push(`${anchor} illustration`);
                queries.push(`${anchor} vector`);
                if (translated && translated.toLowerCase() !== anchor.toLowerCase()) {
                    queries.push(`${translated} clipart`);
                }
            } else {
                // Sentences (e.g. "The cat sleeps on the mat", "He is running fast", "I have an umbrella")
                // Search first 7-8 words with clipart for maximum semantic matching
                const shortSentence = words.slice(0, 8).join(" ");
                queries.push(`${shortSentence} clipart`);
                queries.push(`${shortSentence} illustration`);

                // Also generate query with stop words stripped to highlight core action/nouns
                const stopWords = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "is", "are", "was", "were", "been", "be", "it", "this", "that", "i", "you", "he", "she", "we", "they", "my", "your", "his", "her", "their", "our"]);
                const keyWords = words.filter(w => !stopWords.has(w.toLowerCase()));
                if (keyWords.length >= 2 && keyWords.length < words.length) {
                    queries.push(`${keyWords.slice(0, 5).join(" ")} clipart`);
                }
            }

            return queries;
        }

        /**
         * Converts thumbnail URL to base64 data URI to bypass host page CSP restrictions.
         */
        async function toDataUrl(url) {
            if (!isValidHttpsUrl(url)) return url;
            try {
                const res = await fetchWithTimeout(url, {}, 2500);
                if (!res.ok) return url;
                const buffer = await res.arrayBuffer();
                const mime = res.headers.get("content-type") || "image/jpeg";
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
                return url;
            }
        }

        /**
         * Primary Provider: DuckDuckGo Educational Clipart & Illustration Search
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

                // Filter &f=,,,type:clipart,, activates strict educational illustration & clipart classification
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

                // Convert thumbnails to data URIs in parallel so host page CSP never blocks them
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
         * Search visual associations for a given word or phrase with semantic accuracy using DuckDuckGo.
         *
         * @param {string} query - The word or sentence to look up
         * @param {Object} [context={}] - Optional translation context { original, translated, srcLang, targetLang }
         * @returns {Promise<Array<{ id: string, title: string, thumbnail: string, fullUrl: string, source: string }>>}
         */
        async function search(query, context = {}) {
            const raw = typeof query === "string" ? query : (query?.query || "");
            const ctx = typeof query === "object" && query !== null ? query : context;
            const cleaned = cleanQuery(raw || ctx.original || "");
            if (!cleaned) return [];

            const queries = resolveSearchQueries(cleaned, ctx);
            const cacheKey = `${cleaned.toLowerCase()}|${(ctx.translated || "").toLowerCase()}`;

            const cached = getCache(cacheKey);
            if (cached) return cached;

            let results = [];
            for (const q of queries) {
                results = await searchDuckDuckGo(q, cleaned);
                if (results && results.length >= 2) break;
            }

            if (results && results.length > 0) {
                // Ensure strictly maximum MAX_RESULTS (6)
                results = results.slice(0, MAX_RESULTS);
                setCache(cacheKey, results);
            }
            return results || [];
        }

        return Object.freeze({
            search,
            cleanQuery,
            cleanTitle,
            resolveSearchQueries,
            clearCache: () => memoryCache.clear(),
        });
    }
);
