/**
 * Lectoro – Shared Utilities
 * Common utility functions used across content scripts, popup, and background.
 */
(function initSharedUtils(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    // Browser contexts load constants.js first; Node tests resolve it via require().
    const constants =
        (root && root.LectoroConstants) ||
        (isNode ? require("./constants") : null);
    const api = factory(constants);
    if (isNode) module.exports = api;
    if (root) root.SharedUtils = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createSharedUtils(C) {
        "use strict";

        const R2_CDN_BASE_URL =
            C?.R2_CDN_BASE_URL ||
            "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev";

        const SharedUtils = {
            /** Escape string to be safe in HTML */
            escapeHtml(str) {
                if (!str) return "";
                return String(str)
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");
            },

            /** Escape string to be safe in HTML attributes */
            escapeAttr(str) {
                if (!str) return "";
                return String(str)
                    .replace(/&/g, "&amp;")
                    .replace(/"/g, "&quot;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
            },

            /** Escape a string for safe interpolation into a RegExp source */
            escapeRegExp(str) {
                return String(str ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            },

            /**
             * Checks whether a text string contains strictly a single word
             * (ignoring surrounding punctuation, symbols, quotes, and whitespace).
             */
            isSingleWord(str) {
                if (!str || typeof str !== "string") return false;
                const cleaned = str.trim().replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
                if (!cleaned) return false;
                const tokens = cleaned.split(/\s+/).filter(Boolean);
                return tokens.length === 1;
            },

            /**
             * Checks whether a word is in the set of simple function words / stopwords
             * (pronouns, auxiliary verbs, articles, prepositions).
             */
            isSimpleWord(str) {
                if (!str || typeof str !== "string") return false;
                const cleanWord = str
                    .normalize("NFKC")
                    .trim()
                    .toLowerCase()
                    .replace(/[’‘]/g, "'")
                    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "");
                if (!/^[\p{L}']+$/u.test(cleanWord)) return false;
                if (!cleanWord || cleanWord.length <= 1) return true;
                const simpleSet = C?.SIMPLE_WORDS;
                if (simpleSet && simpleSet.has(cleanWord)) return true;
                const baseWord = cleanWord.replace(/(n't|'s|'ll|'d|'re|'ve|'m)$/, "");
                if (baseWord.length <= 1) return true;
                return !!(simpleSet && simpleSet.has(baseWord));
            },

            /**
             * Checks whether a given definition or explanation text describes a proper noun,
             * person's name, character, brand, company, or AI model (which must not be treated as vocabulary).
             */
            isProperNounDefinition(text) {
                if (!text || typeof text !== "string") return false;
                const lower = text.toLowerCase().trim();
                return /(?:^|[^\p{L}\p{N}])(?:name of|person's name|character in|fictional character|ai model|brand|company|corporation|trademark|actor|celebrity|nazwa|imię|nazwisko|postać|model ai|marka|firma|przedsiębiorstwo)(?:$|[^\p{L}\p{N}])/iu.test(lower);
            },

            /**
             * Checks whether a text string appears to be in English when the expected target language is non-English.
             */
            isLikelyEnglish(text, targetLang) {
                const tgt = (targetLang || "").toLowerCase().slice(0, 2);
                if (tgt === "en" || !text || typeof text !== "string") return false;
                const lower = text.toLowerCase().trim();

                // If text contains target-specific non-English diacritics / scripts, it is NOT English
                const DIACRITICS = {
                    pl: /[ąćęłńóśźż]/,
                    de: /[äöüß]/,
                    fr: /[éàèùâêîôûëïüçœæ]/,
                    es: /[áéíóúüñ¿¡]/,
                    it: /[àèéìíîòóùú]/,
                    pt: /[ãõáéíóúâêôç]/,
                    cs: /[áčďéěíňóřšťúůýž]/,
                    sk: /[áäčďdžéíĺľňóôŕšťúýž]/,
                    ru: /[\u0400-\u04FF]/,
                    uk: /[іїєґ\u0400-\u04FF]/,
                    zh: /[\u4e00-\u9fff]/,
                    ja: /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/,
                    ko: /[\uac00-\ud7af]/,
                    ar: /[\u0600-\u06FF]/,
                };
                if (DIACRITICS[tgt] && DIACRITICS[tgt].test(lower)) {
                    return false;
                }

                // English distinct multi-word patterns and definition phrasing
                const englishMarkers = [
                    /\b(?:the)\s+[a-z]{2,}/i,
                    /\bname of\b/i,
                    /\bused to\b/i,
                    /\breferring to\b/i,
                    /\bsomeone who\b/i,
                    /\bsomething (?:that|which|to)\b/i,
                    /\bact of\b/i,
                    /\bstate of\b/i,
                    /\bmeaning\b/i,
                    /\bmeans\b/i,
                    /\bkind of\b/i,
                    /\btype of\b/i,
                ];
                for (const marker of englishMarkers) {
                    if (marker.test(lower)) return true;
                }

                const words = lower.split(/[^a-z]+/i).filter(Boolean);
                if (words.length === 0) return false;

                // Words distinct to English that do not clash with Romance/Slavic/Germanic stop words
                const englishDistinct = new Set([
                    "the", "of", "with", "that", "this", "these", "those", "something",
                    "someone", "anything", "anyone", "doing", "saying", "having",
                    "which", "who", "whom", "whose", "why", "where", "when", "how",
                    "because", "should", "would", "could", "been", "being", "were"
                ]);

                let distinctCount = 0;
                for (const w of words) {
                    if (englishDistinct.has(w)) distinctCount++;
                }

                return distinctCount >= 2 || (distinctCount === 1 && words.length <= 4);
            },

            /**
             * Checks whether a context sentence is identical or redundant to the target word/phrase
             * (ignoring surrounding punctuation, quotes, symbols, case, and whitespace).
             * When true, the context sentence should not be displayed or saved separately as a duplicate.
             */
            isRedundantSentence(sentence, word) {
                if (!sentence || !word) return false;
                const normalize = (str) => {
                    const cleaned = typeof SharedUtils?.cleanCardText === "function"
                        ? SharedUtils.cleanCardText(str)
                        : String(str || "");
                    return cleaned
                        .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .toLowerCase();
                };
                const s = normalize(sentence);
                const w = normalize(word);
                if (!s || !w) return false;
                return s === w;
            },

            normalizeLanguageCode(value, fallback = "") {
                const raw = String(value || "").trim().toLowerCase();
                if (!raw) return fallback;
                const code = raw.replace(/_/g, "-").split("-")[0];
                if (/^[a-z]{2,3}$/.test(code)) return code;
                const language = Object.values(C.SUPPORTED_LANGUAGES).find(
                    (item) => [item.name.toLowerCase(), item.native.toLowerCase()].includes(raw),
                );
                return language?.code || fallback;
            },

            /**
             * True when running inside a content script on a regular web page
             * (as opposed to the popup, quiz page or the background service worker).
             * Content scripts must proxy privileged network calls through the background.
             */
            isContentScriptEnvironment() {
                return (
                    typeof window !== "undefined" &&
                    window.location?.protocol !== "chrome-extension:" &&
                    typeof chrome !== "undefined" &&
                    typeof chrome.runtime?.sendMessage === "function"
                );
            },

            /**
             * Promise wrapper for chrome.runtime.sendMessage.
             * Rejects with `error.runtimeError = true` when the port fails (no receiver, SW asleep),
             * and with `error.code` / `error.validation` when the background replied `{ error }`.
             */
            sendRuntimeMessage(message) {
                return new Promise((resolve, reject) => {
                    try {
                        chrome.runtime.sendMessage(message, (response) => {
                            const lastError = chrome.runtime.lastError;
                            if (lastError) {
                                const error = new Error(
                                    lastError.message ||
                                        "Extension communication error.",
                                );
                                error.runtimeError = true;
                                reject(error);
                                return;
                            }
                            if (response?.error) {
                                const error = new Error(response.error);
                                if (response.code) error.code = response.code;
                                if (response.status) error.status = response.status;
                                if (response.retryAt) error.retryAt = response.retryAt;
                                if (response.validation)
                                    error.validation = response.validation;
                                reject(error);
                                return;
                            }
                            resolve(response);
                        });
                    } catch (error) {
                        error.runtimeError = true;
                        reject(error);
                    }
                });
            },

            /** POST a JSON body (optionally with a Bearer token) and return the raw Response */
            postJson(url, body, { token = null, headers = {} } = {}) {
                return fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(token ? { Authorization: `Bearer ${token}` } : {}),
                        ...headers,
                    },
                    body: JSON.stringify(body ?? {}),
                });
            },

            /** Uint8Array → base64 (chunked to avoid call-stack limits on large buffers) */
            bytesToBase64(bytes) {
                let binary = "";
                const chunkSize = 0x8000;
                for (
                    let offset = 0;
                    offset < bytes.length;
                    offset += chunkSize
                ) {
                    binary += String.fromCharCode(
                        ...bytes.subarray(offset, offset + chunkSize),
                    );
                }
                return btoa(binary);
            },

            /** base64 string → Blob of the given MIME type */
            base64ToBlob(base64, mimeType = "application/octet-stream") {
                const byteChars = atob(base64);
                const bytes = new Uint8Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    bytes[i] = byteChars.charCodeAt(i);
                }
                return new Blob([bytes], { type: mimeType });
            },

            /** Generate a stable unique id for a word (survives edits to its content) */
            generateId() {
                if (typeof crypto !== "undefined" && crypto.randomUUID) {
                    return crypto.randomUUID();
                }
                return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
            },

            /**
             * Key used to identify a word across syncs/merges. Prefers the stable
             * `id` (set on creation) so editing a word's content never changes its
             * identity; falls back to a content key only for words saved before
             * ids existed.
             */
            wordKey(w) {
                return w.id || (w.original || "") + "|" + (w.translated || "");
            },

            /** Current UTC month in YYYY-MM format */
            currentMonth() {
                return new Date().toISOString().slice(0, 7);
            },

            /** Date tag YYYY-MM-DD for filenames */
            dateTag(d = new Date()) {
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            },

            /** Escape cell for CSV exports */
            csvCell(str) {
                const val = String(str ?? "");
                if (
                    val.includes(";") ||
                    val.includes('"') ||
                    val.includes("\n") ||
                    val.includes("\r")
                ) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            },

            /**
             * Resolves a screenshot value (relative R2 key, full URL, or base64 data URI)
             * to a full public URL or data URI.
             *
             * Relative path format: "{userId}/{imageId}.webp" or "images/{userId}/{imageId}.webp"
             * Base URL: "{R2_CDN_BASE_URL}/images/"
             */
            resolveImageUrl(screenshot) {
                if (!screenshot || typeof screenshot !== "string") return "";
                const trimmed = screenshot.trim();
                if (!trimmed) return "";
                if (
                    trimmed.startsWith("data:") ||
                    /^https?:\/\//i.test(trimmed)
                ) {
                    return trimmed;
                }
                const cleanPath = trimmed.replace(/^\/+/, "");
                if (cleanPath.startsWith("images/")) {
                    return `${R2_CDN_BASE_URL}/${cleanPath}`;
                }
                return `${R2_CDN_BASE_URL}/images/${cleanPath}`;
            },

            /**
             * Extracts relative path "{userId}/{imageId}.webp" from a full R2 URL or relative key.
             */
            toRelativeImagePath(screenshot) {
                if (!screenshot || typeof screenshot !== "string") return "";
                const trimmed = screenshot.trim();
                if (!trimmed || trimmed.startsWith("data:")) return trimmed;
                const match = trimmed.match(
                    /(?:https?:\/\/[^/]+\/)?(?:images\/)?([^?#]+)/i,
                );
                if (match && match[1]) {
                    return match[1].replace(/^\/+/, "");
                }
                return trimmed.replace(/^images\//, "").replace(/^\/+/, "");
            },

            /**
             * Computes deterministic SHA-256 hex hash from text normalized with .trim().toLowerCase().
             * Works identically in Browser (crypto.subtle) and Node.js.
             *
             * @param {string} text
             * @returns {Promise<string>}
             */
            async computeTextHash(text) {
                const normalized = String(text || "")
                    .trim()
                    .toLowerCase();
                if (
                    typeof crypto !== "undefined" &&
                    crypto.subtle &&
                    typeof TextEncoder !== "undefined"
                ) {
                    const data = new TextEncoder().encode(normalized);
                    const hashBuffer = await crypto.subtle.digest(
                        "SHA-256",
                        data,
                    );
                    const hashArray = Array.from(new Uint8Array(hashBuffer));
                    return hashArray
                        .map((b) => b.toString(16).padStart(2, "0"))
                        .join("");
                }
                if (typeof require !== "undefined") {
                    try {
                        const nodeCrypto = require("crypto");
                        return nodeCrypto
                            .createHash("sha256")
                            .update(normalized)
                            .digest("hex");
                    } catch (_) {}
                }
                let hash = 0;
                for (let i = 0; i < normalized.length; i++) {
                    hash = (hash << 5) - hash + normalized.charCodeAt(i);
                    hash |= 0;
                }
                return Math.abs(hash).toString(16).padStart(8, "0");
            },

            /** Provider/model/voice/language-scoped cache key. Preserve text case for pronunciation. */
            async getGeminiAudioCacheKey(voiceId, text, language = "en") {
                if (!C.ALLOWED_GEMINI_TTS_VOICE_IDS.includes(voiceId)) throw new Error("Invalid Gemini TTS voice.");
                const lang = String(language || "en").trim().toLowerCase();
                if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(lang) || lang.length > 35) throw new Error("Invalid speech language.");
                const value = String(text || "").trim();
                let hash;
                if (typeof crypto !== "undefined" && crypto.subtle) {
                    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
                    hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
                } else if (typeof require !== "undefined") {
                    hash = require("crypto").createHash("sha256").update(value).digest("hex");
                } else {
                    throw new Error("SHA-256 is unavailable.");
                }
                return `audio/gemini/${C.GEMINI_TTS_MODEL}/${C.GEMINI_TTS_CACHE_VERSION}/${voiceId}/${lang}/${hash}.wav`;
            },

            async getR2AudioUrl(voiceId, text, language = "en") {
                const key = await SharedUtils.getGeminiAudioCacheKey(voiceId, text, language);
                return `${R2_CDN_BASE_URL}/${key}`;
            },

            /** Flat (voice-agnostic) R2 audio URL for legacy uploads: {R2_CDN_BASE_URL}/audio/{hash}.mp3 */
            async getR2FlatAudioUrl(text) {
                const hash = await SharedUtils.computeTextHash(text);
                return `${R2_CDN_BASE_URL}/audio/${hash}.mp3`;
            },

            /** Format timestamp into localized date */
            formatDate(
                timestamp,
                options = {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                },
            ) {
                if (!timestamp) return "";
                return new Date(timestamp).toLocaleDateString(globalThis.SharedI18n?.getLang?.() || "en", options);
            },

            /** Format timestamp into localized time */
            formatTime(
                timestamp,
                options = { hour: "2-digit", minute: "2-digit" },
            ) {
                if (!timestamp) return globalThis.SharedI18n?.t("never_synced") || "";
                return new Date(timestamp).toLocaleTimeString(globalThis.SharedI18n?.getLang?.() || "en", options);
            },

            /** Format next monthly quota renewal date (supports Stripe timestamp in seconds/ms or YYYY-MM) */
            formatNextUsageRenewalDate(timestampOrMonth = null) {
                let renewalDate = null;
                if (
                    typeof timestampOrMonth === "number" &&
                    timestampOrMonth > 0
                ) {
                    const ms =
                        timestampOrMonth < 10000000000
                            ? timestampOrMonth * 1000
                            : timestampOrMonth;
                    renewalDate = new Date(ms);
                } else if (timestampOrMonth instanceof Date) {
                    renewalDate = timestampOrMonth;
                } else if (
                    typeof timestampOrMonth === "string" &&
                    timestampOrMonth.trim()
                ) {
                    const num = Number(timestampOrMonth);
                    if (!isNaN(num) && num > 0) {
                        const ms = num < 10000000000 ? num * 1000 : num;
                        renewalDate = new Date(ms);
                    } else {
                        const match = /^(\d{4})-(\d{2})$/.exec(
                            timestampOrMonth.trim(),
                        );
                        if (match) {
                            const year = Number(match[1]);
                            const monthIndex = Number(match[2]) - 1;
                            renewalDate = new Date(
                                Date.UTC(year, monthIndex + 1, 1),
                            );
                        }
                    }
                }

                if (!renewalDate || isNaN(renewalDate.getTime())) {
                    const now = new Date();
                    renewalDate = new Date(
                        Date.UTC(
                            now.getUTCFullYear(),
                            now.getUTCMonth() + 1,
                            1,
                        ),
                    );
                }

                return new Intl.DateTimeFormat(globalThis.SharedI18n?.getLang?.() || "en", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                }).format(renewalDate);
            },

            /** Check if a word is due for review */
            isDueForReview(w, now = Date.now()) {
                if (
                    typeof SRS !== "undefined" &&
                    typeof SRS.isDue === "function"
                ) {
                    return SRS.isDue(w, now);
                }
                if (!w || !w.sr) return true;
                return (w.sr.nextReview || 0) <= now;
            },

            /** Count how many words are due for review */
            countDueWords(words, now = Date.now()) {
                return words.filter((w) => SharedUtils.isDueForReview(w, now))
                    .length;
            },

            /**
             * Cleans subtitle artifacts, music notes, bracketed sound descriptions,
             * chevrons (>>), speaker labels, HTML tags and formatting from card and TTS text.
             */
            cleanCardText(text) {
                if (!text) return "";
                const cleanLine = (line) => {
                    let s = String(line)
                        .replace(/\u00A0/g, " ")
                        .replace(/<[^>]*>/g, " ")
                        .replace(/[♪♫♬♩♭♮♯]/g, " ")
                        .replace(/\[[^\]]*\]/g, " ")
                        .replace(
                            /\((?:music|applause|laughter|screaming|coughing|sighs|footsteps|sound|snorts|groans|chuckles|giggles|cheering|whispering|gasping|singing|sobbing|crying|instrumental|upbeat music|dramatic music|soft music|ambient sound)[^)]*\)/gi,
                            " ",
                        )
                        .replace(/(?:^|\s)(?:>>+|<<+|»+|«+)(?:\s|$)/g, " ")
                        .replace(
                            /^(?:[A-Z0-9\s_-]{2,20}:|speaker\s*\d+:|narrator:|man:|woman:|boy:|girl:|person\s*\d+:)\s*/i,
                            "",
                        )
                        .replace(/[<>~*^|\\@$%&=+]/g, " ")
                        .replace(/[—–―‒]+/g, " ")
                        .replace(/\t+/g, " ")
                        .replace(/\s{2,}/g, " ")
                        .trim();
                    s = s.replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").trim();
                    return s.replace(/[.,\s]+$/, "").trim();
                };

                const raw = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                if (!raw.includes("\n")) {
                    return cleanLine(raw);
                }
                return raw
                    .split("\n")
                    .map(cleanLine)
                    .filter(Boolean)
                    .join("\n");
            },

            cleanTextForTTS(text) {
                return SharedUtils.cleanCardText(text);
            },

            /**
             * Highlights a word within a sentence using the given CSS class.
             */
            highlightWordInSentence(sentence, word, cssClass) {
                if (!sentence) return "";
                const escapedSentence = SharedUtils.escapeHtml(sentence);
                const escapedWord = SharedUtils.escapeHtml(word || "");
                if (!escapedWord) return escapedSentence;

                const regex = new RegExp(
                    `(${SharedUtils.escapeRegExp(escapedWord)})`,
                    "i",
                );
                return escapedSentence.replace(
                    regex,
                    `<span class="${cssClass}">$1</span>`,
                );
            },

            /**
             * Universal robust DOM text walker for subtitle cues.
             * Handles <br> tags, text nodes, and preserves word boundary spacing.
             * Optional preserveNewlines keeps line breaks as \n.
             */
            extractSubtitleText(node, { preserveNewlines = false } = {}) {
                if (!node) return "";
                const parts = [];

                function walk(current) {
                    if (current.nodeType === Node.TEXT_NODE) {
                        const text = current.nodeValue || "";
                        if (text) parts.push(text);
                        return;
                    }

                    if (current.nodeType !== Node.ELEMENT_NODE) return;

                    const tagName = current.localName?.toLowerCase();
                    if (tagName === "br") {
                        parts.push(preserveNewlines ? "\n" : " ");
                        return;
                    }

                    const children = Array.from(current.childNodes);
                    for (let index = 0; index < children.length; index += 1) {
                        const beforeLength = parts.length;
                        walk(children[index]);

                        if (
                            index < children.length - 1 &&
                            parts.length > beforeLength
                        ) {
                            const next = children[index + 1];
                            if (
                                next?.nodeType === Node.ELEMENT_NODE ||
                                next?.nodeType === Node.TEXT_NODE
                            ) {
                                const left = parts[parts.length - 1] || "";
                                const right =
                                    next.textContent || next.nodeValue || "";

                                if (
                                    left &&
                                    right &&
                                    !/\s$/.test(left) &&
                                    !/^\s/.test(right) &&
                                    /[\p{L}\p{N}]$/u.test(left) &&
                                    /^[\p{L}\p{N}]/u.test(right)
                                ) {
                                    parts.push(" ");
                                }
                            }
                        }
                    }
                }

                walk(node);
                if (preserveNewlines) {
                    return parts
                        .join("")
                        .split(/\r?\n/)
                        .map((line) => line.replace(/[^\S\r\n]+/g, " ").trim())
                        .filter(Boolean)
                        .join("\n");
                }
                return parts.join("").replace(/\s+/g, " ").trim();
            },

            /**
             * Universal robust extractor for multi-line subtitle cues.
             * Returns an array of clean line strings preserving natural breaks.
             */
            extractSubtitleLines(node) {
                const text = this.extractSubtitleText(node, {
                    preserveNewlines: true,
                });
                return text ? text.split("\n").filter(Boolean) : [];
            },

            /**
             * Asynchronously ensure Web Speech API voices are loaded.
             * Resolves immediately if voices are already loaded, or listens for 'voiceschanged' with safety timeout.
             */
            ensureVoices(timeoutMs = 250) {
                if (typeof window === "undefined" || !window.speechSynthesis) {
                    return Promise.resolve([]);
                }
                const currentVoices =
                    window.speechSynthesis.getVoices?.() || [];
                if (currentVoices.length > 0) {
                    return Promise.resolve(currentVoices);
                }
                return new Promise((resolve) => {
                    let timer = null;
                    const onVoices = () => {
                        if (timer) clearTimeout(timer);
                        try {
                            window.speechSynthesis?.removeEventListener?.(
                                "voiceschanged",
                                onVoices,
                            );
                        } catch (_) {}
                        resolve(window.speechSynthesis?.getVoices?.() || []);
                    };
                    try {
                        window.speechSynthesis?.addEventListener?.(
                            "voiceschanged",
                            onVoices,
                        );
                    } catch (_) {}
                    timer = setTimeout(() => {
                        try {
                            window.speechSynthesis?.removeEventListener?.(
                                "voiceschanged",
                                onVoices,
                            );
                        } catch (_) {}
                        resolve(window.speechSynthesis?.getVoices?.() || []);
                    }, timeoutMs);
                });
            },

            /**
             * Pick the best available voice.
             * Priority: user-saved > natural/neural > Google > remote > any
             */
            pickBestVoice(savedVoiceName, lang, voicesList = null) {
                const voices =
                    Array.isArray(voicesList) && voicesList.length > 0
                        ? voicesList
                        : window.speechSynthesis?.getVoices?.() || [];
                if (!voices.length) return null;

                const defaultLearning =
                    (typeof LectoroConstants !== "undefined" &&
                        LectoroConstants.DEFAULT_READING_SETTINGS
                            ?.learningLang) ||
                    "en";
                const baseLang = (lang || defaultLearning)
                    .split("-")[0]
                    .toLowerCase();
                const langVoices = voices.filter((v) =>
                    (v.lang || "").toLowerCase().startsWith(baseLang),
                );

                if (savedVoiceName && savedVoiceName !== "random") {
                    const exact = (
                        langVoices.length ? langVoices : voices
                    ).find((v) => v.name === savedVoiceName);
                    if (exact) return exact;
                }

                if (!langVoices.length) return null;

                // Prefer Google voices if available, otherwise take first voice matching language
                const googleVoice = langVoices.find((v) =>
                    /google/i.test(v.name),
                );
                return googleVoice || langVoices[0];
            },
        };

        // Pre-warm voices in background immediately upon module load
        try {
            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.getVoices?.();
            }
        } catch (_) {}

        return SharedUtils;
    },
);
