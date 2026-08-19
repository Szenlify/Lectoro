const { escapeHtml, escapeAttr, isDueForReview, countDueWords, dateTag, csvCell } = SharedUtils;

// ── Elements ──────────────────────────────────────────────────────
const select = document.getElementById("targetLang");
const savedMsg = document.getElementById("saved");
const wordListEl = document.getElementById("wordList");
const statsEl = document.getElementById("stats");

// ── Tab switching (Centralized) ──────────────────────────────────
function switchTab(tabName) {
    if (typeof stopPopupSpeak === "function") stopPopupSpeak();
    document.querySelectorAll(".tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    document.querySelectorAll(".tab-content").forEach((content) => {
        content.classList.toggle("active", content.id === "tab-" + tabName);
    });

    if (tabName === "words" && typeof loadWords === "function") {
        loadWords();
    } else if (tabName === "review" && typeof loadReviewQueue === "function") {
        loadReviewQueue();
    } else if (tabName === "library" && typeof renderLibraryGrid === "function") {
        renderLibraryGrid();
    }
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.dataset.tab) switchTab(tab.dataset.tab);
    });
});

// ── Voice & rate elements ─────────────────────────────────────────
const voiceSelect = document.getElementById("voiceSelect");
const rateRange = document.getElementById("rateRange");
const rateValue = document.getElementById("rateValue");
const volumeRange = document.getElementById("volumeRange");
const volumeValue = document.getElementById("volumeValue");

// ── Auto-switch to Review tab if there are due reviews ────────────
document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const now = Date.now();
        if (typeof countDueWords !== "function") return;
        const dueCount = countDueWords(words, now);
        if (dueCount > 0) {
            switchTab("review");
        }
    });
});


// ── Flash saved message ───────────────────────────────────────────
function flashSaved() {
    savedMsg.classList.add("show");
    setTimeout(() => savedMsg.classList.remove("show"), 1500);
}

// ── Delete single review word (from review tab) ──────────────────
function deleteReviewWord(w) {
    if (!confirm(`Usunąć "${w.original}" z bazy danych?`)) return;
    stopPopupSpeak();
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords.filter(
            (x) =>
                !(x.original === w.original && x.translated === w.translated),
        );
        chrome.storage.local.set({ savedWords: words }, () => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słowa:",
                    chrome.runtime.lastError.message,
                );
            }
            // Remove from current queue and continue
            reviewQueue.splice(reviewIndex, 1);
            reviewTotalDue = reviewQueue.length;
            if (reviewIndex >= reviewQueue.length)
                reviewIndex = reviewQueue.length - 1;
            if (reviewIndex < 0) reviewIndex = 0;
            reviewAnswerShown = false;
            renderReview();
        });
    });
}

// ── Delete all due reviews ───────────────────────────────────────
function deleteAllReviews() {
    if (!confirm("Usunąć WSZYSTKIE słowa w kolejce powtórek?")) return;
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const allWords = data.savedWords || [];
        const now = Date.now();
        const dueWords = allWords.filter((w) => isDueForReview(w, now));
        if (dueWords.length === 0) return;

        const dueSet = new Set(
            dueWords.map((w) => w.original + "|" + w.translated),
        );
        const remaining = allWords.filter(
            (w) => !dueSet.has(w.original + "|" + w.translated),
        );
        chrome.storage.local.set({ savedWords: remaining }, () => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słów:",
                    chrome.runtime.lastError.message,
                );
            }
            reviewQueue = [];
            reviewIndex = 0;
            reviewTotalDue = 0;
            reviewAnswerShown = false;
            renderReview();
        });
    });
}

// ── Download helper ───────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Utils ─────────────────────────────────────────────────────────

function buildReviewSpeakText(word, sentence) {
    if (!word) return "";
    return sentence ? `${word}. ${sentence}` : word;
}

// Only speak automatically when the user is actually looking at the
// Review tab. Without this guard, any background refresh of the review
// queue (e.g. after a Firebase sync completes on the Sync tab) would
// still render the next due card and read it aloud, even though the
// user never opened the Review tab.
function isReviewTabActive() {
    return !!document
        .getElementById("tab-review")
        ?.classList.contains("active");
}

function autoSpeakReviewCard(w, answerVisible = false) {
    if (!w || !isReviewTabActive()) return;
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";
    const cacheOptions = {
        cacheFirst: true,
        cacheNotBefore: Number(w.ttsCacheInvalidatedAt || 0),
    };

    // Zawsze oryginalny tekst (srcLang) używa wybranego głosu lektora (np. ElevenLabs);
    // Tłumaczenie (tgtLang) ZAWSZE czyta darmowy głos systemowy.
    const isSpeakingOriginal = !answerVisible ? !isReverse : isReverse;
    const speakWord = isSpeakingOriginal ? w.original : w.translated;
    const speakSentence = isSpeakingOriginal
        ? w.sentence || ""
        : w.sentenceTranslated || "";
    const speakLang = isSpeakingOriginal ? srcL : tgtL;

    popupSpeak(
        buildReviewSpeakText(speakWord, speakSentence),
        speakLang,
        {
            ...cacheOptions,
            forceBrowser: !isSpeakingOriginal,
        },
    ).catch(() => {});
}

// ── Keyboard shortcuts for review — flashcard-style controls ──────
//   ↑ / W   → read word + sentence aloud (current side)
//   ↓ / S   → flip the card in place to reveal the answer
//   ← / A   → "Nie znam" (Again) — works from either side, front or back
//   → / D   → "Znam" (Good)      — works from either side, front or back
//   Enter   → fetch a fresh, on-demand standard AI translation
document.addEventListener("keydown", (e) => {
    const reviewTab = document.getElementById("tab-review");
    if (!reviewTab || !reviewTab.classList.contains("active")) return;
    if (reviewIndex >= reviewQueue.length || reviewQueue.length === 0) return;

    // Don't hijack WASD/arrows/Enter while the user is typing in the
    // inline edit form (e.g. editing the word's spelling).
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;

    const key = e.key;
    const lowerKey = key.length === 1 ? key.toLowerCase() : key;

    if (key === "ArrowUp" || lowerKey === "w") {
        e.preventDefault();
        autoSpeakReviewCard(reviewQueue[reviewIndex], reviewAnswerShown);
        return;
    }

    if (key === "ArrowDown" || lowerKey === "s") {
        e.preventDefault();
        flipCard();
        return;
    }

    if (key === "ArrowLeft" || lowerKey === "a") {
        e.preventDefault();
        animateSwipeAndRate(1);
        return;
    }

    if (key === "ArrowRight" || lowerKey === "d") {
        e.preventDefault();
        animateSwipeAndRate(2);
        return;
    }

    if (key === "Enter" || key === "NumpadEnter") {
        e.preventDefault();
        aiTranslateReviewCard();
        return;
    }
});
