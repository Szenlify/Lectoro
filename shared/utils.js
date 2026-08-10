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
};
