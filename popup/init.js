const { escapeHtml, escapeAttr, isDueForReview, countDueWords, dateTag } = SharedUtils;

// ── Centralized Initial Popup State (Batch Read) ──────────────────
const POPUP_INIT_KEYS = Object.freeze({
    targetLang: "pl",
    speechVoice: "",
    speechRate: 1.1,
    ttsVolume: 1,
    subtitleTTS: false,
    wordCloudMode: true,
    reviewDirection: "normal",
    ttsMode: "browser",
    elVoiceId: "",
    savedWords: [],
    lastFirebaseSync: null,
    pendingFirebaseChanges: {},
    aiUsageCache: null,
    subscriptionProfileCache: null,
    subtitlePosition: (typeof LectoroConstants !== "undefined" && LectoroConstants.DEFAULT_SUBTITLE_SETTINGS?.POSITION) ?? 14,
    subtitleBgOpacity: (typeof LectoroConstants !== "undefined" && LectoroConstants.DEFAULT_SUBTITLE_SETTINGS?.BG_OPACITY) ?? 0,
});

let popupState = { ...POPUP_INIT_KEYS };
let _popupReadyResolver = null;
const popupReadyPromise = new Promise((resolve) => {
    _popupReadyResolver = resolve;
});

function whenPopupReady(fn) {
    if (fn) return popupReadyPromise.then(fn);
    return popupReadyPromise;
}

chrome.storage.local.get(POPUP_INIT_KEYS, (data) => {
    popupState = { ...POPUP_INIT_KEYS, ...data };
    _popupReadyResolver(popupState);
});

// ── Elements ──────────────────────────────────────────────────────
const select = document.getElementById("targetLang");
const savedMsg = document.getElementById("saved");
let wordListEl = document.getElementById("wordList");
let statsEl = document.getElementById("stats");

// ── Lazy tab mounting + centralized switching ───────────────────
const TAB_SCRIPTS = Object.freeze({
    words: ["popup/words.js", "popup/export.js"],
    library: ["popup/library.js"],
    review: ["popup/review.js"],
    help: [],
});
const loadedPopupScripts = new Map();
const tabLoadPromises = new Map();
let requestedTab = "settings";

function loadPopupScript(src) {
    if (loadedPopupScripts.has(src)) return loadedPopupScripts.get(src);
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}.`));
        document.body.appendChild(script);
    });
    loadedPopupScripts.set(src, promise);
    return promise;
}

async function ensureTabLoaded(tabName) {
    const existing = document.getElementById(`tab-${tabName}`);
    if (existing) return existing;
    if (tabLoadPromises.has(tabName)) return tabLoadPromises.get(tabName);

    const promise = (async () => {
        const template = document.getElementById(`tab-${tabName}-template`);
        if (!(template instanceof HTMLTemplateElement)) {
            throw new Error(`Missing tab template: ${tabName}.`);
        }
        template.replaceWith(template.content.cloneNode(true));
        const content = document.getElementById(`tab-${tabName}`);
        if (!content) throw new Error(`Failed to mount tab: ${tabName}.`);

        if (tabName === "words") {
            wordListEl = document.getElementById("wordList");
            statsEl = document.getElementById("stats");
        }
        for (const src of TAB_SCRIPTS[tabName] || []) {
            await loadPopupScript(src);
        }
        return content;
    })();
    tabLoadPromises.set(tabName, promise);
    return promise;
}

function activateMountedTab(tabName) {
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

async function switchTab(tabName) {
    requestedTab = tabName;
    if (typeof stopPopupSpeak === "function") stopPopupSpeak();
    if (document.getElementById(`tab-${tabName}`)) {
        activateMountedTab(tabName);
        return;
    }

    const selectedButton = document.querySelector(`.tab[data-tab="${tabName}"]`);
    selectedButton?.classList.add("is-loading");
    try {
        await ensureTabLoaded(tabName);
    } catch (error) {
        tabLoadPromises.delete(tabName);
        console.error("[Lectoro] Tab loading error:", error);
        return;
    } finally {
        selectedButton?.classList.remove("is-loading");
    }
    if (requestedTab === tabName) activateMountedTab(tabName);
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (tab.dataset.tab) void switchTab(tab.dataset.tab);
    });
});

// ── Voice, rate & subtitle elements ──────────────────────────────
const voiceSelect = document.getElementById("voiceSelect");
const rateRange = document.getElementById("rateRange");
const rateValue = document.getElementById("rateValue");
const volumeRange = document.getElementById("volumeRange");
const volumeValue = document.getElementById("volumeValue");
const subPositionRange = document.getElementById("subPositionRange");
const subPositionValue = document.getElementById("subPositionValue");
const subBgRange = document.getElementById("subBgRange");
const subBgValue = document.getElementById("subBgValue");

// ── Review badge from the initial storage batch (without loading the tab) ──
function updateInitialReviewBadge(words = []) {
    if (typeof countDueWords !== "function") return;
    const dueCount = countDueWords(words, Date.now());
    const tab = document.getElementById("tabReview");
    if (!tab) return;
    const badge = dueCount > 0
        ? `<span class="tab-badge">${dueCount > 999 ? "999+" : dueCount}</span>`
        : "";
    tab.innerHTML = `<span class="tab-icon">🧠</span><span class="tab-label">Review</span>${badge}`;
}

whenPopupReady((state) => {
    updateInitialReviewBadge(state.savedWords || []);
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.savedWords) {
        updateInitialReviewBadge(changes.savedWords.newValue || []);
    }
});

// ── Flash saved message ───────────────────────────────────────────
function flashSaved() {
    savedMsg.classList.add("show");
    setTimeout(() => savedMsg.classList.remove("show"), 1500);
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

    // Original text (srcLang) uses chosen voice (e.g. ElevenLabs);
    // Translation (tgtLang) uses system voice.
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
//   ← / A   → "Don't know" (Again) — works from either side, front or back
//   → / D   → "Know" (Good)        — works from either side, front or back
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
