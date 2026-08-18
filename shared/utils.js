/**
 * Lectoro – Shared Utilities
 * Common utility functions used across content scripts, popup, and background.
 */
(function initSharedUtils(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.SharedUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSharedUtils() {
    "use strict";

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

        /** Generate a stable unique id for a word (survives edits to its content) */
        generateId() {
            if (typeof crypto !== "undefined" && crypto.randomUUID) {
                return crypto.randomUUID();
            }
            return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        },

        /** Assign a stable id to a word if it doesn't have one yet (mutates in place). Returns true if one was assigned. */
        ensureWordId(w) {
            if (!w.id) {
                w.id = SharedUtils.generateId();
                return true;
            }
            return false;
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
            if (val.includes(";") || val.includes('"') || val.includes("\n")) {
                return '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
        },

        /** Format timestamp into localized Polish date */
        formatDate(timestamp, options = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) {
            if (!timestamp) return "";
            return new Date(timestamp).toLocaleDateString("pl-PL", options);
        },

        /** Format timestamp into localized Polish time */
        formatTime(timestamp, options = { hour: "2-digit", minute: "2-digit" }) {
            if (!timestamp) return "nigdy";
            return new Date(timestamp).toLocaleTimeString("pl-PL", options);
        },

        /** Format next monthly quota renewal date */
        formatNextUsageRenewalDate(month) {
            const match = /^(\d{4})-(\d{2})$/.exec(month || "");
            const now = new Date();
            const year = match ? Number(match[1]) : now.getUTCFullYear();
            const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
            const renewalDate = new Date(Date.UTC(year, monthIndex + 1, 1));

            return new Intl.DateTimeFormat("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
            }).format(renewalDate);
        },

        /** Check if a word is due for review */
        isDueForReview(w, now = Date.now()) {
            if (!w.sr) return true;
            return w.sr.nextReview <= now;
        },

        /** Count how many words are due for review */
        countDueWords(words, now = Date.now()) {
            return words.filter((w) => SharedUtils.isDueForReview(w, now)).length;
        },

        cleanTextForTTS(text) {
            return String(text ?? "")
                .replace(/<[^>]*>/g, " ")
                .replace(/[♪♫♬♩]/g, " ")
                .replace(/\[[^\]]*\]/g, " ")
                .replace(/[<>#~*_^|\\/@$%&=+]/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim();
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
                `(${escapedWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")})`,
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
         */
        extractSubtitleText(node) {
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
                    parts.push(" ");
                    return;
                }

                const children = Array.from(current.childNodes);
                for (let index = 0; index < children.length; index += 1) {
                    const beforeLength = parts.length;
                    walk(children[index]);

                    if (index < children.length - 1 && parts.length > beforeLength) {
                        const next = children[index + 1];
                        if (next?.nodeType === Node.ELEMENT_NODE || next?.nodeType === Node.TEXT_NODE) {
                            const left = parts[parts.length - 1] || "";
                            const right = next.textContent || next.nodeValue || "";

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
            return parts.join("").replace(/\s+/g, " ").trim();
        },

        /**
         * Asynchronously ensure Web Speech API voices are loaded.
         * Resolves immediately if voices are already loaded, or listens for 'voiceschanged' with safety timeout.
         */
        ensureVoices(timeoutMs = 250) {
            if (typeof window === "undefined" || !window.speechSynthesis) {
                return Promise.resolve([]);
            }
            const currentVoices = window.speechSynthesis.getVoices?.() || [];
            if (currentVoices.length > 0) {
                return Promise.resolve(currentVoices);
            }
            return new Promise((resolve) => {
                let timer = null;
                const onVoices = () => {
                    if (timer) clearTimeout(timer);
                    try {
                        window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoices);
                    } catch (_) {}
                    resolve(window.speechSynthesis?.getVoices?.() || []);
                };
                try {
                    window.speechSynthesis?.addEventListener?.("voiceschanged", onVoices);
                } catch (_) {}
                timer = setTimeout(() => {
                    try {
                        window.speechSynthesis?.removeEventListener?.("voiceschanged", onVoices);
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
            const voices = (Array.isArray(voicesList) && voicesList.length > 0)
                ? voicesList
                : (window.speechSynthesis?.getVoices?.() || []);
            if (!voices.length) return null;

            const baseLang = (lang || "en").split("-")[0].toLowerCase();
            const langVoices = voices.filter((v) =>
                (v.lang || "").toLowerCase().startsWith(baseLang),
            );

            if (savedVoiceName && savedVoiceName !== "random") {
                const exact = (langVoices.length ? langVoices : voices).find((v) => v.name === savedVoiceName);
                if (exact) return exact;
            }

            if (!langVoices.length) return null;

            if (savedVoiceName === "random") {
                return langVoices[Math.floor(Math.random() * langVoices.length)];
            }

            // Prefer Google voices if available, otherwise take first voice matching language
            const googleVoice = langVoices.find((v) => /google/i.test(v.name));
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
});

