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

    /** Generate deterministic key for a word object */
    wordKey(w) {
        return (w.original || "") + "|" + (w.translated || "");
    },

    /** Check if a word is due for review */
    isDueForReview(w, now = Date.now()) {
        if (!w.sr) return true;
        return w.sr.nextReview <= now;
    },

    /** Count how many words are due for review */
    countDueWords(words, now = Date.now()) {
        return words.filter(w => SharedUtils.isDueForReview(w, now)).length;
    }
};
