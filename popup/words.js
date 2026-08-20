/**
 * Lectoro – Words List Tab (Popup)
 * Displays saved words, filtering, editing, and deletion using SharedWordRepository.
 */
(() => {
    "use strict";

    let currentFilter = "all";
    let wordSearchQuery = "";

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
            statsEl.textContent = `${filtered.length} z ${words.length} słów`;
        }

        if (!wordListEl) return;

        if (filtered.length === 0) {
            wordListEl.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <div>Brak zapisanych słów</div>
                </div>`;
            return;
        }

        const sorted = [...filtered].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        wordListEl.innerHTML = sorted
            .map((w, i) => {
                const date = typeof SharedUtils !== "undefined" ? SharedUtils.formatDate(w.timestamp) : "";
                const isNew = !w.downloaded ? " new-item" : "";
                let sentenceHtml = "";
                if (w.sentence) {
                    const highlighted = typeof SharedUtils !== "undefined"
                        ? SharedUtils.highlightWordInSentence(w.sentence, w.original, "wi-cloze")
                        : escapeHtml(w.sentence);
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
                        <button class="wi-edit" type="button" data-index="${i}" title="Edytuj" aria-label="Edytuj ${escapeAttr(w.original)}">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
                        </button>
                        <button class="wi-delete" type="button" data-id="${escapeAttr(w.id || "")}" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="Usuń" aria-label="Usuń ${escapeAttr(w.original)}">✕</button>
                    </div>
                </div>`;
            })
            .join("");

        // Edit handlers
        wordListEl.querySelectorAll(".wi-edit").forEach((btn) => {
            btn.addEventListener("click", () => {
                const word = sorted[parseInt(btn.dataset.index, 10)];
                const item = btn.closest(".word-item");
                if (word && item) showWordEditForm(item, word);
            });
        });

        // Delete handlers
        wordListEl.querySelectorAll(".wi-delete").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const orig = btn.dataset.original;
                const ts = parseInt(btn.dataset.ts, 10);
                deleteWord(id || orig, ts);
            });
        });
    }

    async function deleteWord(idOrOriginal, timestamp) {
        if (!confirm(`Czy na pewno chcesz usunąć to słowo wraz z przypisanym zdaniem?`)) {
            return;
        }
        if (typeof SharedWordRepository !== "undefined") {
            await SharedWordRepository.deleteWord(idOrOriginal, timestamp);
        }
        loadWords();
    }

    function showWordEditForm(item, word) {
        item.classList.add("is-editing");
        item.innerHTML = `
            <form class="wi-edit-form">
                <label>Oryginał</label>
                <input class="wi-edit-original" name="original" type="text" value="${escapeAttr(word.original)}" required>

                <label>Tłumaczenie</label>
                <input name="translated" type="text" value="${escapeAttr(word.translated)}" required>

                <label>Zdanie (oryginał)</label>
                <textarea name="sentence" rows="2">${escapeHtml(word.sentence || "")}</textarea>

                <label>Zdanie (tłumaczenie)</label>
                <textarea name="sentenceTranslated" rows="2">${escapeHtml(word.sentenceTranslated || "")}</textarea>

                <div class="wi-edit-actions">
                    <button class="wi-edit-cancel" type="button">Anuluj</button>
                    <button class="wi-edit-save" type="submit">Zapisz</button>
                </div>
            </form>`;

        const form = item.querySelector(".wi-edit-form");
        item.querySelector(".wi-edit-cancel")?.addEventListener("click", loadWords);
        form?.addEventListener("submit", async (event) => {
            event.preventDefault();
            const formData = new FormData(form);
            const clean =
                typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                    ? SharedUtils.cleanCardText
                    : (s) => String(s || "").replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").replace(/[.,\s]+$/, "").trim();
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
