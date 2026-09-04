/**
 * Lectoro – Words List Tab (Popup)
 * Displays saved words, filtering, editing, and deletion using SharedWordRepository.
 */
(() => {
    "use strict";

    let currentFilter = "all";
    let wordSearchQuery = "";
    let currentSortedWords = [];

    document.querySelectorAll(".filter-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document
                .querySelectorAll(".filter-btn")
                .forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.filter;
            loadWords();
        });
    });

    const wordSearchInput = document.getElementById("wordSearch");
    wordSearchInput?.addEventListener("input", (e) => {
        wordSearchQuery = e.target.value;
        loadWords();
    });

    /**
     * Filter words collection using SharedWordRepository.
     */
    function filterWords(words) {
        if (typeof SharedWordRepository !== "undefined") {
            return SharedWordRepository.filterWords(words, {
                filter: currentFilter,
                query: wordSearchQuery,
            });
        }
        return words;
    }

    /**
     * Load & render words in the popup Words list.
     */
    async function loadWords() {
        const words = typeof SharedWordRepository !== "undefined"
            ? await SharedWordRepository.getStoredWords()
            : [];
        const filtered = filterWords(words);

        if (statsEl) {
            statsEl.textContent = `${filtered.length} of ${words.length} words`;
        }

        if (!wordListEl) return;

        if (filtered.length === 0) {
            wordListEl.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <div>No saved words</div>
                </div>`;
            return;
        }

        const sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        currentSortedWords = sorted;

        const EDIT_SVG = LectoroConstants.SVG_ICONS.EDIT;

        wordListEl.innerHTML = sorted
            .map((w, i) => {
                const date = SharedUtils.formatDate(w.timestamp);
                const isNew = !w.downloaded ? " new-item" : "";
                let sentenceHtml = "";
                if (w.sentence) {
                    const highlighted = SharedUtils.highlightWordInSentence(w.sentence, w.original, "wi-cloze");
                    sentenceHtml = `<div class="wi-sentence">${highlighted}</div>`;
                    if (w.sentenceTranslated) {
                        sentenceHtml += `<div class="wi-sentence" style="color:rgba(255,255,255,0.25);">${escapeHtml(w.sentenceTranslated)}</div>`;
                    }
                }
                return `<div class="word-item${isNew}" data-index="${i}">
                    <div class="wi-texts">
                        <div class="wi-original">${escapeHtml(w.original)}</div>
                        <div class="wi-translated">${escapeHtml(w.translated)}</div>
                        ${sentenceHtml}
                        <div class="wi-meta">${date} · ${(w.srcLang || "?").toUpperCase()}→${(w.tgtLang || "?").toUpperCase()}</div>
                    </div>
                    <div class="wi-actions">
                        <button class="wi-edit" type="button" data-index="${i}" title="Edit" aria-label="Edit ${escapeAttr(w.original)}">
                            ${EDIT_SVG}
                        </button>
                        <button class="wi-delete" type="button" data-id="${escapeAttr(w.id || "")}" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="Delete" aria-label="Delete ${escapeAttr(w.original)}">✕</button>
                    </div>
                </div>`;
            })
            .join("");

        if (!wordListEl._delegatedClickBound) {
            wordListEl._delegatedClickBound = true;
            wordListEl.addEventListener("click", (e) => {
                const editBtn = e.target.closest(".wi-edit");
                if (editBtn) {
                    const idx = parseInt(editBtn.dataset.index, 10);
                    const word = currentSortedWords[idx];
                    const item = editBtn.closest(".word-item");
                    if (word && item) showWordEditForm(item, word);
                    return;
                }
                const deleteBtn = e.target.closest(".wi-delete");
                if (deleteBtn) {
                    const id = deleteBtn.dataset.id;
                    const orig = deleteBtn.dataset.original;
                    const ts = parseInt(deleteBtn.dataset.ts, 10);
                    deleteWord(id || orig, ts);
                }
            });
        }
    }

    async function deleteWord(idOrOriginal, timestamp) {
        if (!confirm(`Are you sure you want to delete this word and its context sentence?`)) {
            return;
        }
        await SharedWordRepository.deleteWord(idOrOriginal, timestamp);
        loadWords();
    }

    function showWordEditForm(item, word) {
        item.classList.add("is-editing");
        item.innerHTML = `
            <form class="wi-edit-form">
                <label>Original</label>
                <input class="wi-edit-original" name="original" type="text" value="${escapeAttr(word.original)}" required>

                <label>Translation</label>
                <input name="translated" type="text" value="${escapeAttr(word.translated)}" required>

                <label>Context sentence (original)</label>
                <textarea name="sentence" rows="2">${escapeHtml(word.sentence || "")}</textarea>

                <label>Context sentence (translation)</label>
                <textarea name="sentenceTranslated" rows="2">${escapeHtml(word.sentenceTranslated || "")}</textarea>

                <div class="wi-edit-actions">
                    <button class="wi-edit-cancel" type="button">Cancel</button>
                    <button class="wi-edit-save" type="submit">Save</button>
                </div>
            </form>`;

        const form = item.querySelector(".wi-edit-form");
        item.querySelector(".wi-edit-cancel")?.addEventListener("click", loadWords);
        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const clean = typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (s) => String(s || "").trim();
            const edits = {
                original: clean(formData.get("original")),
                translated: clean(formData.get("translated")),
                sentence: clean(formData.get("sentence")),
                sentenceTranslated: clean(formData.get("sentenceTranslated")),
            };
            if (!edits.original || !edits.translated) {
                form.querySelector("input:invalid")?.reportValidity();
                return;
            }
            await saveWordEdits(word, edits);
        });

        item.querySelector(".wi-edit-original")?.focus();
    }

    async function saveWordEdits(word, edits) {
        const editedAt = Date.now();
        if (typeof SharedWordRepository !== "undefined") {
            await SharedWordRepository.updateWord(
                (candidate) =>
                    word.id
                        ? candidate.id === word.id
                        : candidate.original === word.original && candidate.timestamp === word.timestamp,
                (existing) => ({
                    ...existing,
                    ...edits,
                    id: existing.id || SharedUtils?.generateId?.() || String(editedAt),
                    updatedAt: editedAt,
                    ttsCacheInvalidatedAt: editedAt,
                }),
            );
        }
        loadWords();
    }

    globalThis.loadWords = loadWords;
    globalThis.filterWords = filterWords;
})();
