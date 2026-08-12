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
                    <button class="wi-delete" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="Usuń">✕</button>
                </div>`;
            })
            .join("");

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
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const wordToDelete = data.savedWords.find(
            (w) => w.original === original && w.timestamp === timestamp,
        );
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
            // Delete from Firestore (fire-and-forget via background)
            if (wordToDelete) {
                chrome.runtime.sendMessage({
                    type: "QT_FIRESTORE_DELETE",
                    word: {
                        id: wordToDelete.id,
                        original: wordToDelete.original,
                        translated: wordToDelete.translated,
                    },
                });
            }
        });
    });
}