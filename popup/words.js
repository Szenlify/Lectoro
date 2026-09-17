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
        return SharedWordRepository.filterWords(words, {
            filter: currentFilter,
            query: wordSearchQuery,
        });
    }

    /**
     * Load & render words in the popup Words list.
     */
    async function loadWords() {
        const words = await SharedWordRepository.getStoredWords();
        const filtered = filterWords(words);

        if (statsEl) {
            statsEl.textContent = typeof SharedI18n !== "undefined"
                ? SharedI18n.t("words_stats", null, { filtered: filtered.length, total: words.length })
                : `${filtered.length} of ${words.length} words`;
        }

        if (!wordListEl) return;

        if (filtered.length === 0) {
            const emptyText = typeof SharedI18n !== "undefined" ? SharedI18n.t("words_empty") : "No saved words";
            wordListEl.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <div>${emptyText}</div>
                </div>`;
            return;
        }

        const sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        currentSortedWords = sorted;

        const EDIT_SVG = LectoroConstants.SVG_ICONS.EDIT;
        const editLabel = typeof SharedI18n !== "undefined" ? SharedI18n.t("words_edit") : "Edit";
        const deleteLabel = typeof SharedI18n !== "undefined" ? SharedI18n.t("words_delete") : "Delete";

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
                        <button class="wi-edit" type="button" data-index="${i}" title="${editLabel}" aria-label="${editLabel} ${escapeAttr(w.original)}">
                            ${EDIT_SVG}
                        </button>
                        <button class="wi-delete" type="button" data-id="${escapeAttr(w.id || "")}" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="${deleteLabel}" aria-label="${deleteLabel} ${escapeAttr(w.original)}">✕</button>
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
        const confirmMsg = typeof SharedI18n !== "undefined"
            ? SharedI18n.t("words_delete_confirm")
            : "Are you sure you want to delete this word and its context sentence?";
        if (!confirm(confirmMsg)) {
            return;
        }
        await SharedWordRepository.deleteWord(idOrOriginal, timestamp);
        loadWords();
    }

    function showWordEditForm(item, word) {
        item.classList.add("is-editing");
        const t = (k, d) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k) : d);
        item.innerHTML = `
            <form class="wi-edit-form">
                <label>${t("words_label_original", "Original")}</label>
                <input class="wi-edit-original" name="original" type="text" value="${escapeAttr(word.original)}" required>

                <label>${t("words_label_translated", "Translation")}</label>
                <input name="translated" type="text" value="${escapeAttr(word.translated)}" required>

                <label>${t("words_label_sentence", "Context sentence (original)")}</label>
                <textarea name="sentence" rows="2">${escapeHtml(word.sentence || "")}</textarea>

                <label>${t("words_label_sentence_translated", "Context sentence (translation)")}</label>
                <textarea name="sentenceTranslated" rows="2">${escapeHtml(word.sentenceTranslated || "")}</textarea>

                <div class="wi-edit-actions">
                    <button class="wi-edit-cancel" type="button">${t("btn_cancel", "Cancel")}</button>
                    <button class="wi-edit-save" type="submit">${t("btn_save", "Save")}</button>
                </div>
            </form>`;

        const form = item.querySelector(".wi-edit-form");
        item.querySelector(".wi-edit-cancel")?.addEventListener("click", loadWords);
        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const clean = SharedUtils.cleanCardText || ((s) => String(s || "").trim());
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
        loadWords();
    }

    globalThis.loadWords = loadWords;
    globalThis.filterWords = filterWords;
})();
