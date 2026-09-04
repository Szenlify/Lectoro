/**
 * Lectoro – Central Word Repository & Storage Service (SSOT)
 * Single Source of Truth for word creation, updates, deletes, SRS rating updates,
 * filtering, deduplication, and subscription limit enforcement.
 */
(function initWordRepository(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.SharedWordRepository = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createWordRepository() {
        "use strict";

        const { generateId, wordKey, cleanCardText } = SharedUtils;
        const TEXT_FIELDS = Object.freeze([
            "original",
            "translated",
            "sentence",
            "sentenceTranslated",
            "aiSentence",
            "aiSentenceTranslated",
        ]);

        let saveWordQueue = Promise.resolve();

        /** Returns a copy of `entry` with every card text field passed through cleanCardText. */
        function sanitizeTextFields(entry, { onlyStrings = false } = {}) {
            const sanitized = { ...entry };
            for (const field of TEXT_FIELDS) {
                if (onlyStrings && typeof sanitized[field] !== "string")
                    continue;
                sanitized[field] = cleanCardText(sanitized[field]);
            }
            return sanitized;
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

        /** Fire-and-forget: move an inline base64 screenshot to Cloudflare R2 and store its relative path. */
        function offloadScreenshot(word, logLabel) {
            if (
                !word?.screenshot ||
                typeof word.screenshot !== "string" ||
                !word.screenshot.startsWith("data:") ||
                typeof GeminiProxy === "undefined" ||
                typeof GeminiProxy.uploadCardImage !== "function"
            ) {
                return;
            }
            GeminiProxy.uploadCardImage(word.id, word.screenshot)
                .then(async (uploaded) => {
                    const savedPath =
                        uploaded?.relativePath ||
                        uploaded?.path ||
                        uploaded?.url;
                    if (savedPath) {
                        await updateWord(word.id, { screenshot: savedPath });
                    }
                })
                .catch((err) => {
                    console.warn(
                        `[WordRepository] Background R2 upload failed${logLabel}:`,
                        err,
                    );
                });
        }

        /** Fire-and-forget: delete R2 images belonging to removed words. */
        function cleanupCardImages(removedWords, logLabel) {
            if (
                typeof GeminiProxy === "undefined" ||
                typeof GeminiProxy.deleteCardImage !== "function"
            )
                return;
            const wordIds = removedWords.map((w) => w.id).filter(Boolean);
            if (wordIds.length === 0) return;
            GeminiProxy.deleteCardImage(wordIds).catch((err) => {
                console.warn(`[WordRepository] R2 ${logLabel} error:`, err);
            });
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

            const sanitizedEntry = sanitizeTextFields(entry || {});

            const words = await getStoredWords();
            if (isDuplicateEntry(words, sanitizedEntry)) {
                return { saved: false, duplicate: true };
            }

            // Validate SRS word limit for the user's active plan
            if (
                typeof SubscriptionService !== "undefined" &&
                SubscriptionService.checkSrsSave
            ) {
                const validation = await SubscriptionService.checkSrsSave(
                    words.length,
                );
                if (
                    typeof SubscriptionConfig !== "undefined" &&
                    SubscriptionConfig.assertAllowed
                ) {
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
                sr: sanitizedEntry.sr
                    ? { ...sanitizedEntry.sr }
                    : SRS.defaultState(),
                timestamp: sanitizedEntry.timestamp || now,
                updatedAt: now,
                downloaded: !!sanitizedEntry.downloaded,
            };

            words.push(newEntry);
            await setStoredWords(words);
            offloadScreenshot(newEntry, "");

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
                    : (w) =>
                          w.id === idOrPredicate ||
                          wordKey(w) === idOrPredicate;

            const index = words.findIndex(predicate);
            if (index === -1) return null;

            const existing = words[index];
            const changes =
                typeof updater === "function" ? updater(existing) : updater;
            const sanitizedChanges = sanitizeTextFields(changes || {}, {
                onlyStrings: true,
            });

            const updated = {
                ...existing,
                ...sanitizedChanges,
                updatedAt: Date.now(),
            };
            words[index] = updated;
            await setStoredWords(words);
            offloadScreenshot(updated, " on update");

            return updated;
        }

        /**
         * Record an SRS review rating (1 = Again/Nie znam, 2 = Good/Znam).
         */
        async function recordReviewRating(word, rating) {
            return updateWord(
                (w) =>
                    (word.id && w.id === word.id) ||
                    wordKey(w) === wordKey(word),
                (existing) => ({
                    sr: SRS.update(existing.sr || SRS.defaultState(), rating),
                }),
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
                    timestamp !== null &&
                    w.original === idOrOriginal &&
                    w.timestamp === timestamp;
                const matchesOriginal =
                    w.original === idOrOriginal && !timestamp;

                if (matchesId || matchesTimestamp || matchesOriginal) {
                    removedWords.push(w);
                    return false;
                }
                return true;
            });

            await setStoredWords(filtered);
            cleanupCardImages(removedWords, "deleteCardImage");

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
            const deleteIds = new Set(
                wordsToDelete.map((w) => w.id).filter(Boolean),
            );
            const deleteKeys = new Set(wordsToDelete.map((w) => wordKey(w)));

            const removedWords = [];
            const remaining = words.filter((w) => {
                if (
                    (w.id && deleteIds.has(w.id)) ||
                    deleteKeys.has(wordKey(w))
                ) {
                    removedWords.push(w);
                    return false;
                }
                return true;
            });

            await setStoredWords(remaining);
            cleanupCardImages(removedWords, "batch deleteCardImage");

            return { deleted: removedWords.length };
        }

        /**
         * Clear all words and wipe all associated user images from Cloudflare R2.
         */
        async function clearAllWords() {
            await setStoredWords([]);
            if (
                typeof GeminiProxy !== "undefined" &&
                typeof GeminiProxy.deleteAllUserImages === "function"
            ) {
                GeminiProxy.deleteAllUserImages().catch((err) => {
                    console.warn(
                        "[WordRepository] R2 deleteAllUserImages error:",
                        err,
                    );
                });
            }
            return { ok: true };
        }

        /**
         * Filter words collection by timeframe ('all', 'today', 'week', 'month', 'new') and search query.
         */
        function filterWords(words, { filter = "all", query = "" } = {}) {
            const now = new Date();
            const startOfDay = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
            ).getTime();
            const startOfWeek = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1),
            ).getTime();
            const startOfMonth = new Date(
                now.getFullYear(),
                now.getMonth(),
                1,
            ).getTime();

            let result = words;
            switch (filter) {
                case "today":
                    result = words.filter(
                        (w) => (w.timestamp || 0) >= startOfDay,
                    );
                    break;
                case "week":
                    result = words.filter(
                        (w) => (w.timestamp || 0) >= startOfWeek,
                    );
                    break;
                case "month":
                    result = words.filter(
                        (w) => (w.timestamp || 0) >= startOfMonth,
                    );
                    break;
                case "new":
                    result = words.filter((w) => !w.downloaded);
                    break;
                default:
                    result = words;
            }

            const q = String(query || "")
                .trim()
                .toLowerCase();
            if (q) {
                result = result.filter((w) => {
                    return (
                        (w.original || "").toLowerCase().includes(q) ||
                        (w.translated || "").toLowerCase().includes(q) ||
                        (w.sentence || "").toLowerCase().includes(q) ||
                        (w.sentenceTranslated || "")
                            .toLowerCase()
                            .includes(q) ||
                        (w.aiSentence || "").toLowerCase().includes(q) ||
                        (w.aiSentenceTranslated || "").toLowerCase().includes(q)
                    );
                });
            }

            return result;
        }

        /**
         * Mark a list of exported words as downloaded.
         */
        async function markWordsDownloaded(exportedWords = []) {
            if (!Array.isArray(exportedWords) || exportedWords.length === 0)
                return { count: 0 };
            const words = await getStoredWords();
            const exportedSet = new Set(
                exportedWords.map((w) =>
                    w.id ? w.id : `${w.original}|${w.timestamp}`,
                ),
            );
            let updatedCount = 0;
            const updated = words.map((w) => {
                const key = w.id ? w.id : `${w.original}|${w.timestamp}`;
                if (exportedSet.has(key) && !w.downloaded) {
                    updatedCount++;
                    return { ...w, downloaded: true, updatedAt: Date.now() };
                }
                return w;
            });
            if (updatedCount > 0) {
                await setStoredWords(updated);
            }
            return { count: updatedCount };
        }

        /**
         * Delete all words that are currently due for review.
         */
        async function deleteDueReviews(now = Date.now()) {
            const words = await getStoredWords();
            const dueWords = words.filter((w) =>
                SharedUtils.isDueForReview(w, now),
            );
            if (dueWords.length === 0) return { deleted: 0 };
            return deleteWords(dueWords);
        }

        return Object.freeze({
            getStoredWords,
            setStoredWords,
            saveWord,
            updateWord,
            deleteWord,
            deleteWords,
            deleteDueReviews,
            clearAllWords,
            markWordsDownloaded,
            recordReviewRating,
            filterWords,
            isDuplicateEntry,
        });
    },
);
