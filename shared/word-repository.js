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

        const clean =
            typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (t) => String(t || "").trim();

        const cleanedOriginal = clean(entry?.original) || String(entry?.original || "").trim();
        const cleanedTranslated = clean(entry?.translated) || String(entry?.translated || "").trim();
        const cleanedSentence = clean(entry?.sentence);
        const cleanedSentenceTranslated = clean(entry?.sentenceTranslated);
        const cleanedAiSentence = clean(entry?.aiSentence);
        const cleanedAiSentenceTranslated = clean(entry?.aiSentenceTranslated);

        const sanitizedEntry = {
            ...entry,
            original: cleanedOriginal,
            translated: cleanedTranslated,
            sentence: cleanedSentence,
            sentenceTranslated: cleanedSentenceTranslated,
            aiSentence: cleanedAiSentence,
            aiSentenceTranslated: cleanedAiSentenceTranslated,
        };

        const words = await getStoredWords();
        if (isDuplicateEntry(words, sanitizedEntry)) {
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
            ...sanitizedEntry,
            id: sanitizedEntry.id || generateId(),
            sr: sanitizedEntry.sr ? { ...sanitizedEntry.sr } : createDefaultSR(),
            timestamp: sanitizedEntry.timestamp || now,
            updatedAt: now,
            downloaded: !!sanitizedEntry.downloaded,
        };

        words.push(newEntry);
        await setStoredWords(words);

        // Asynchronously offload screenshot to Cloudflare R2 if present
        if (
            newEntry.screenshot &&
            newEntry.screenshot.startsWith("data:") &&
            typeof GeminiProxy !== "undefined" &&
            typeof GeminiProxy.uploadCardImage === "function"
        ) {
            GeminiProxy.uploadCardImage(newEntry.id, newEntry.screenshot)
                .then(async (uploaded) => {
                    if (uploaded && uploaded.url) {
                        await updateWord(newEntry.id, { screenshot: uploaded.url });
                    }
                })
                .catch((err) => {
                    console.warn("[WordRepository] Background R2 upload failed:", err);
                });
        }

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
        const changes = typeof updater === "function" ? updater(existing) : updater;
        const clean =
            typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (t) => String(t || "").trim();

        const sanitizedChanges = { ...changes };
        if (typeof sanitizedChanges.original === "string") {
            sanitizedChanges.original =
                clean(sanitizedChanges.original) || sanitizedChanges.original.trim();
        }
        if (typeof sanitizedChanges.translated === "string") {
            sanitizedChanges.translated =
                clean(sanitizedChanges.translated) || sanitizedChanges.translated.trim();
        }
        if (typeof sanitizedChanges.sentence === "string") {
            sanitizedChanges.sentence = clean(sanitizedChanges.sentence);
        }
        if (typeof sanitizedChanges.sentenceTranslated === "string") {
            sanitizedChanges.sentenceTranslated = clean(sanitizedChanges.sentenceTranslated);
        }
        if (typeof sanitizedChanges.aiSentence === "string") {
            sanitizedChanges.aiSentence = clean(sanitizedChanges.aiSentence);
        }
        if (typeof sanitizedChanges.aiSentenceTranslated === "string") {
            sanitizedChanges.aiSentenceTranslated = clean(sanitizedChanges.aiSentenceTranslated);
        }

        const updated = {
            ...existing,
            ...sanitizedChanges,
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
     * Delete a single word from storage and clean up associated image from R2.
     */
    async function deleteWord(idOrOriginal, timestamp = null) {
        const words = await getStoredWords();
        const removedWords = [];
        const filtered = words.filter((w) => {
            const matchesId = w.id && w.id === idOrOriginal;
            const matchesTimestamp =
                timestamp !== null && w.original === idOrOriginal && w.timestamp === timestamp;
            const matchesOriginal = w.original === idOrOriginal && !timestamp;

            if (matchesId || matchesTimestamp || matchesOriginal) {
                removedWords.push(w);
                return false;
            }
            return true;
        });

        await setStoredWords(filtered);

        // Asynchronously clean up images from Cloudflare R2
        if (typeof GeminiProxy !== "undefined" && typeof GeminiProxy.deleteCardImage === "function") {
            const wordIds = removedWords.map((w) => w.id).filter(Boolean);
            if (wordIds.length > 0) {
                GeminiProxy.deleteCardImage(wordIds).catch((err) => {
                    console.warn("[WordRepository] R2 deleteCardImage error:", err);
                });
            }
        }

        return { deleted: words.length - filtered.length };
    }

    /**
     * Delete a list of words from storage and clean up their images from R2.
     */
    async function deleteWords(wordsToDelete = []) {
        if (!Array.isArray(wordsToDelete) || wordsToDelete.length === 0) {
            return { deleted: 0 };
        }
        const words = await getStoredWords();
        const deleteIds = new Set(wordsToDelete.map((w) => w.id).filter(Boolean));
        const deleteKeys = new Set(wordsToDelete.map((w) => wordKey(w)));

        const removedWords = [];
        const remaining = words.filter((w) => {
            if ((w.id && deleteIds.has(w.id)) || deleteKeys.has(wordKey(w))) {
                removedWords.push(w);
                return false;
            }
            return true;
        });

        await setStoredWords(remaining);

        // Asynchronously clean up images from Cloudflare R2
        if (typeof GeminiProxy !== "undefined" && typeof GeminiProxy.deleteCardImage === "function") {
            const wordIds = removedWords.map((w) => w.id).filter(Boolean);
            if (wordIds.length > 0) {
                GeminiProxy.deleteCardImage(wordIds).catch((err) => {
                    console.warn("[WordRepository] R2 batch deleteCardImage error:", err);
                });
            }
        }

        return { deleted: removedWords.length };
    }

    /**
     * Clear all words and wipe all associated user images from Cloudflare R2.
     */
    async function clearAllWords() {
        await setStoredWords([]);
        if (typeof GeminiProxy !== "undefined" && typeof GeminiProxy.deleteAllUserImages === "function") {
            GeminiProxy.deleteAllUserImages().catch((err) => {
                console.warn("[WordRepository] R2 deleteAllUserImages error:", err);
            });
        }
        return { ok: true };
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
        deleteWords,
        clearAllWords,
        recordReviewRating,
        filterWords,
        generateId,
        wordKey,
        isDuplicateEntry,
    });
});
