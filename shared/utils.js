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
             * (pronouns, auxiliary verbs, articles, prepositions) where showing a visual concept
             * creates visual clutter and has no mnemonic value.
             */
            isSimpleWord(str) {
                if (!str || typeof str !== "string") return false;
                const cleanWord = str
                    .trim()
                    .toLowerCase()
                    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
                    .replace(/[^\p{L}']/gu, "");
                if (!cleanWord || cleanWord.length <= 1) return true;
                const simpleSet = C?.SIMPLE_WORDS;
                if (simpleSet && simpleSet.has(cleanWord)) return true;
                const baseWord = cleanWord.replace(/(n't|'s|'ll|'d|'re|'ve|'m)$/, "");
                if (baseWord.length <= 1) return true;
                return !!(simpleSet && simpleSet.has(baseWord));
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

            /**
             * Returns the deterministic Cloudflare R2 CDN URL for a given voice and text.
             * Format: {R2_CDN_BASE_URL}/audio/{voiceId}/{sha256_hash_tekstu}.mp3
             *
             * @param {string} voiceId
             * @param {string} text
             * @returns {Promise<string>}
             */
            async getR2AudioUrl(voiceId, text) {
                const safeVoiceId = String(voiceId || "default").replace(
                    /[^a-zA-Z0-9_-]/g,
                    "",
                );
                const hash = await SharedUtils.computeTextHash(text);
                return `${R2_CDN_BASE_URL}/audio/${safeVoiceId}/${hash}.mp3`;
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
                return new Date(timestamp).toLocaleDateString("en-US", options);
            },

            /** Format timestamp into localized time */
            formatTime(
                timestamp,
                options = { hour: "2-digit", minute: "2-digit" },
            ) {
                if (!timestamp) return "never";
                return new Date(timestamp).toLocaleTimeString("en-US", options);
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

                return new Intl.DateTimeFormat("en-US", {
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
                let s = String(text)
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
                    .replace(/[\r\n\t]+/g, " ")
                    .replace(/\s{2,}/g, " ")
                    .trim();
                s = s.replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").trim();
                return s.replace(/[.,\s]+$/, "").trim();
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

                const baseLang = (lang || "en").split("-")[0].toLowerCase();
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
