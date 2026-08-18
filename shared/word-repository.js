/**
 * Lectoro – Central Word Repository & Storage Service (SSOT)
 * Single Source of Truth for word creation, updates, deletes, SRS rating updates,
 * filtering, deduplication, and subscription limit enforcement.
 */
(function initWordRepository(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) {
        root.SharedWordRepository = api;
        root.WordRepository = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function createWordRepository() {
    "use strict";

    let saveWordQueue = Promise.resolve();

    function generateId() {
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function wordKey(w) {
        return w.id || `${w.original || ""}|${w.translated || ""}`;
    }

    function createDefaultSR() {
        return {
            step: 0,
            easeFactor: 2.5,
            interval: 0,
            nextReview: Date.now(),
            lastReview: null,
        };
    }

    async function getStoredWords() {
        if (!chrome?.storage?.local) return [];
        const data = await chrome.storage.local.get({ savedWords: [] });
        return data.savedWords || [];
    }

    async function setStoredWords(words) {
        if (!chrome?.storage?.local) return;
        await chrome.storage.local.set({ savedWords: words });
    }

    /**
     * Check if an entry already exists in the words collection.
     */
    function isDuplicateEntry(words, entry) {
        return words.some(
            (w) =>
                (entry.id && w.id === entry.id) ||
                (w.original === entry.original &&
                    w.translated === entry.translated &&
                    (w.sentence || "") === (entry.sentence || "") &&
                    (w.aiSentence || "") === (entry.aiSentence || "")),
        );
    }

    /**
     * Save a new word entry with concurrency serialization,
     * subscription quota validation, stable ID assignment, and default SRS state.
     */
    function saveWord(entry) {
        const operation = saveWordQueue.then(() => saveWordInternal(entry));
        saveWordQueue = operation.catch(() => {});
        return operation;
    }

    async function saveWordInternal(entry) {
        if (!chrome?.storage?.local) {
            return { saved: false, reason: "STORAGE_UNAVAILABLE" };
        }
        const words = await getStoredWords();
        if (isDuplicateEntry(words, entry)) {
            return { saved: false, duplicate: true };
        }

        // Validate SRS word limit for the user's active plan
        if (typeof SubscriptionService !== "undefined" && SubscriptionService.checkSrsSave) {
            const validation = await SubscriptionService.checkSrsSave(words.length);
            if (typeof SubscriptionConfig !== "undefined" && SubscriptionConfig.assertAllowed) {
                try {
                    SubscriptionConfig.assertAllowed(validation);
                } catch (error) {
                    SubscriptionService.showUpgradePrompt(validation);
                    throw error;
                }
            }
        }

        const now = Date.now();
        const newEntry = {
            ...entry,
            id: entry.id || generateId(),
            sr: entry.sr ? { ...entry.sr } : createDefaultSR(),
            timestamp: entry.timestamp || now,
            updatedAt: now,
            downloaded: !!entry.downloaded,
        };

        words.push(newEntry);
        await setStoredWords(words);
        return { saved: true, entry: newEntry };
    }

    /**
     * Update an existing word by ID or matching predicate.
     */
    async function updateWord(idOrPredicate, updater) {
        const words = await getStoredWords();
        const predicate =
            typeof idOrPredicate === "function"
                ? idOrPredicate
                : (w) => w.id === idOrPredicate || wordKey(w) === idOrPredicate;

        const index = words.findIndex(predicate);
        if (index === -1) return null;

        const existing = words[index];
        const updated = {
            ...existing,
            ...(typeof updater === "function" ? updater(existing) : updater),
            updatedAt: Date.now(),
        };
        words[index] = updated;
        await setStoredWords(words);
        return updated;
    }

    /**
     * Record an SRS review rating (1 = Again/Nie znam, 2 = Good/Znam).
     */
    async function recordReviewRating(word, rating) {
        return updateWord(
            (w) => (word.id && w.id === word.id) || wordKey(w) === wordKey(word),
            (existing) => {
                const srBase = existing.sr || createDefaultSR();
                const updatedSR =
                    typeof SRS !== "undefined" && typeof SRS.update === "function"
                        ? SRS.update(srBase, rating)
                        : {
                              ...srBase,
                              step: rating === 1 ? 0 : srBase.step + 1,
                              nextReview: Date.now() + (rating === 1 ? 60000 : 86400000),
                              lastReview: Date.now(),
                          };
                return { sr: updatedSR };
            },
        );
    }

    /**
     * Delete a single word from storage.
     */
    async function deleteWord(idOrOriginal, timestamp = null) {
        const words = await getStoredWords();
        const filtered = words.filter((w) => {
            if (w.id && w.id === idOrOriginal) return false;
            if (timestamp !== null && w.original === idOrOriginal && w.timestamp === timestamp) {
                return false;
            }
            if (w.original === idOrOriginal && !timestamp) return false;
            return true;
        });
        await setStoredWords(filtered);
        return { deleted: words.length - filtered.length };
    }

    /**
     * Filter words collection by timeframe ('all', 'today', 'week', 'month', 'new') and search query.
     */
    function filterWords(words, { filter = "all", query = "" } = {}) {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const startOfWeek = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1),
        ).getTime();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

        let result = words;
        switch (filter) {
            case "today":
                result = words.filter((w) => (w.timestamp || 0) >= startOfDay);
                break;
            case "week":
                result = words.filter((w) => (w.timestamp || 0) >= startOfWeek);
                break;
            case "month":
                result = words.filter((w) => (w.timestamp || 0) >= startOfMonth);
                break;
            case "new":
                result = words.filter((w) => !w.downloaded);
                break;
            default:
                result = words;
        }

        const q = String(query || "").trim().toLowerCase();
        if (q) {
            result = result.filter((w) => {
                return (
                    (w.original || "").toLowerCase().includes(q) ||
                    (w.translated || "").toLowerCase().includes(q) ||
                    (w.sentence || "").toLowerCase().includes(q) ||
                    (w.sentenceTranslated || "").toLowerCase().includes(q) ||
                    (w.aiSentence || "").toLowerCase().includes(q) ||
                    (w.aiSentenceTranslated || "").toLowerCase().includes(q)
                );
            });
        }

        return result;
    }

    return Object.freeze({
        getStoredWords,
        setStoredWords,
        saveWord,
        updateWord,
        deleteWord,
        recordReviewRating,
        filterWords,
        generateId,
        wordKey,
        isDuplicateEntry,
    });
});
