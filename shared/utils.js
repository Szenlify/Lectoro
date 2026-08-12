/**
 * Lectoro – Shared Utilities
 * Common utility functions used across content scripts, popup, and background.
 */
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
            .replace(/[<>]/g, "")
            .replace(/#/g, "")
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
     * Pick the best available voice.
     * Priority: user-saved > natural/neural > Google > remote > any
     */
    pickBestVoice(savedVoiceName, lang) {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return null;

        // Only use Google voices
        const googleVoices = voices.filter((v) => /google/i.test(v.name));

        if (savedVoiceName) {
            const exact = googleVoices.find((v) => v.name === savedVoiceName);
            if (exact) return exact;
        }

        const baseLang = (lang || "en").split("-")[0].toLowerCase();
        const langVoices = googleVoices.filter((v) =>
            v.lang.toLowerCase().startsWith(baseLang),
        );
        if (!langVoices.length) return null;

        return langVoices[0];
    },

    pickRandomBestVoice(savedVoiceName, lang) {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Only use Google voices
    const googleVoices = voices.filter((v) => /google/i.test(v.name));

    if (savedVoiceName) {
        const exact = googleVoices.find((v) => v.name === savedVoiceName);
        if (exact) return exact;
    }

    const baseLang = (lang || "en").split("-")[0].toLowerCase();
    const langVoices = googleVoices.filter((v) =>
        v.lang.toLowerCase().startsWith(baseLang),
    );
    if (!langVoices.length) return null;

    // Losowanie indeksu z zakresu [0, langVoices.length - 1]
    const randomIndex = Math.floor(Math.random() * langVoices.length);
    return langVoices[randomIndex];
}

    
};
