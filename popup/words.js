// ── Filter state ──────────────────────────────────────────────────
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

// ── Time helpers ──────────────────────────────────────────────────
function startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function startOfWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    return d.getTime();
}
function startOfMonth() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.getTime();
}

// ── Filter words ──────────────────────────────────────────────────
function filterWords(words) {
    let result;
    switch (currentFilter) {
        case "today":
            result = words.filter((w) => w.timestamp >= startOfDay());
            break;
        case "week":
            result = words.filter((w) => w.timestamp >= startOfWeek());
            break;
        case "month":
            result = words.filter((w) => w.timestamp >= startOfMonth());
            break;
        case "new":
            result = words.filter((w) => !w.downloaded);
            break;
        default:
            result = words;
    }

    const q = wordSearchQuery.trim().toLowerCase();
    if (q) {
        result = result.filter((w) => {
            return (
                (w.original || "").toLowerCase().includes(q) ||
                (w.translated || "").toLowerCase().includes(q) ||
                (w.sentence || "").toLowerCase().includes(q) ||
                (w.sentenceTranslated || "").toLowerCase().includes(q)
            );
        });
    }

    return result;
}

// ── Load & render words ───────────────────────────────────────────
function loadWords() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const all = data.savedWords || [];
        const filtered = filterWords(all);

        statsEl.textContent = `${filtered.length} z ${all.length} słów`;

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

        // Sort newest first
        const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);

        wordListEl.innerHTML = sorted
            .map((w, i) => {
                const date = new Date(w.timestamp).toLocaleDateString("pl-PL", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                });
                const isNew = !w.downloaded ? " new-item" : "";
                let sentenceHtml = "";
                if (w.sentence) {
                    const highlighted = SharedUtils.highlightWordInSentence(
                        w.sentence,
                        w.original,
                        "wi-cloze"
                    );
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
                        <button class="wi-delete" type="button" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="Usuń" aria-label="Usuń ${escapeAttr(w.original)}">✕</button>
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
                const orig = btn.dataset.original;
                const ts = parseInt(btn.dataset.ts);
                deleteWord(orig, ts);
            });
        });
    });
}

// ── Delete word ───────────────────────────────────────────────────
function deleteWord(original, timestamp) {
    if (
        !confirm(
            `Czy na pewno chcesz usunąć zapis „${original}” wraz z przypisanym zdaniem?`,
        )
    )
        return;

    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords.filter(
            (w) => !(w.original === original && w.timestamp === timestamp),
        );
        chrome.storage.local.set({ savedWords: words }, () => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słowa:",
                    chrome.runtime.lastError.message,
                );
            }
            loadWords();
        });
    });
}

// ── Edit word / sentence ─────────────────────────────────────────
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
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const edits = {
            original: String(formData.get("original") || "").trim(),
            translated: String(formData.get("translated") || "").trim(),
            sentence: String(formData.get("sentence") || "").trim(),
            sentenceTranslated: String(
                formData.get("sentenceTranslated") || "",
            ).trim(),
        };
        if (!edits.original || !edits.translated) {
            form.querySelector("input:invalid")?.reportValidity();
            return;
        }
        saveWordEdits(word, edits);
    });

    item.querySelector(".wi-edit-original")?.focus();
}

function saveWordEdits(word, edits) {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const index = words.findIndex((candidate) =>
            word.id
                ? candidate.id === word.id
                : candidate.original === word.original &&
                  candidate.timestamp === word.timestamp,
        );
        if (index === -1) {
            loadWords();
            return;
        }

        const editedAt = Date.now();
        words[index] = {
            ...words[index],
            ...edits,
            id: words[index].id || SharedUtils.generateId(),
            updatedAt: editedAt,
            ttsCacheInvalidatedAt: editedAt,
        };
        chrome.storage.local.set({ savedWords: words }, () => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się zapisać edycji:",
                    chrome.runtime.lastError.message,
                );
            }
            loadWords();
        });
    });
}
