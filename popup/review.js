// ═══════════════════════════════════════════════════════════════════
//  SPACED REPETITION  –  see shared/srs.js for the Anki SM-2 algorithm
// ═══════════════════════════════════════════════════════════════════
const {
    update: srUpdate,
    previewLabel,
    formatInterval,
    ensure: ensureSR,
} = SRS; // shared/srs.js

// ── Review state ──────────────────────────────────────────────────
let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswerShown = false;
let reviewTotalDue = 0;
let _reviewSaving = false; // guard: skip storage listener while rating
let _reviewQueueStale = false; // set when a background sync happens mid-session
let _reviewLoading = false; // guard: prevent duplicate concurrent queue loads
// Keep AI results on the in-memory card object. This prevents repeated Enter
// presses (including while a request is still running) from consuming more AI
// credits and lets the result survive flipping the same card back and forth.
const reviewAiStates = new WeakMap();

// ── Review direction: "normal" = show original, guess translation
//                      "reverse" = show translation, guess original
let reviewDirection = "normal";
let ttsMode = "browser";
let reviewSystemVoice = "";
let reviewElVoiceId = "";
let reviewElVoices = [];
let reviewVoiceProfile = null;
let reviewVoicesLoading = false;

let reviewTargetLang = "pl";

// Load the saved review direction, voice setting, and targetLang instantly via whenPopupReady.
if (typeof whenPopupReady === "function") {
    whenPopupReady((data) => {
        reviewDirection = data.reviewDirection || "normal";
        reviewTargetLang = data.targetLang || "pl";
        reviewSystemVoice = data.speechVoice === "random" ? "" : (data.speechVoice || "");
        if (data.speechVoice === "random") {
            chrome.storage.local.set({ speechVoice: "" });
        }
        ttsMode = data.ttsMode || "browser";
        reviewElVoiceId = data.elVoiceId || "";
        updateDirBtnLabel();
        void updateReviewVoiceUI();
    });
} else {
    chrome.storage.local.get(
        {
            reviewDirection: "normal",
            ttsMode: "browser",
            speechVoice: "",
            elVoiceId: "",
            targetLang: "pl",
        },
        (data) => {
            reviewDirection = data.reviewDirection || "normal";
            reviewTargetLang = data.targetLang || "pl";
            reviewSystemVoice = data.speechVoice === "random" ? "" : data.speechVoice;
            if (data.speechVoice === "random") {
                chrome.storage.local.set({ speechVoice: "" });
            }
            ttsMode = data.ttsMode;
            reviewElVoiceId = data.elVoiceId;
            updateDirBtnLabel();
            void updateReviewVoiceUI();
        },
    );
}

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.targetLang) {
            reviewTargetLang = changes.targetLang.newValue || "pl";
            updateDirBtnLabel();
        }
    });
}

// ── Direction toggle button ───────────────────────────────────────
function getActiveReviewLangs() {
    const card = reviewQueue?.[reviewIndex];
    const src = card?.srcLang || "en";
    const tgt = card?.tgtLang || reviewTargetLang || "pl";
    const langTagFn = (typeof LectoroConstants !== "undefined" && typeof LectoroConstants.langTag === "function")
        ? LectoroConstants.langTag
        : (c) => String(c || "?").toUpperCase();
    return {
        srcTag: langTagFn(src),
        tgtTag: langTagFn(tgt),
    };
}

function updateDirBtnLabel() {
    const btn = document.getElementById("reviewDirBtn");
    if (!btn) return;
    const { srcTag, tgtTag } = getActiveReviewLangs();
    if (reviewDirection === "normal") {
        btn.innerHTML = `${srcTag} <span class="dir-arrow">→</span> ${tgtTag}`;
        btn.title = `Zmień kierunek powtórek (${srcTag} → ${tgtTag})`;
    } else {
        btn.innerHTML = `${tgtTag} <span class="dir-arrow">→</span> ${srcTag}`;
        btn.title = `Zmień kierunek powtórek (${tgtTag} → ${srcTag})`;
    }
}

document.getElementById("reviewDirBtn")?.addEventListener("click", () => {
    reviewDirection = reviewDirection === "normal" ? "reverse" : "normal";
    chrome.storage.local.set({ reviewDirection }, flashSaved);
    updateDirBtnLabel();
    // Restart current card without changing queue position
    reviewAnswerShown = false;
    renderReview();
});

// ── Review Voice Picker ──────────────────────────────────────────
// Compact voice picker for the review workflow.
function setReviewVoiceStatus(message = "", type = "") {
    const status = document.getElementById("reviewVoiceStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `review-voice-status${type ? ` ${type}` : ""}`;
}

async function reportReviewVoiceFailure(error) {
    // Keep the chosen ElevenLabs voice active. popupSpeak checks its cache
    // before limits/provider state, so cached recordings remain playable and
    // only an uncached phrase falls back to the system voice.
    setReviewVoiceStatus(
        `${error?.message || "ElevenLabs jest niedostępny."} Używam głosu systemowego.`,
        "error",
    );
}

function closeReviewVoiceMenu() {
    const menu = document.getElementById("reviewVoiceMenu");
    const btn = document.getElementById("reviewVoiceBtn");
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
}

function formatVoiceLabels(voice) {
    const preferredKeys = [
        "age",
        "language",
        "accent",
        "use_case",
        "gender",
        "description",
    ];
    return preferredKeys
        .map((key) => voice?.labels?.[key])
        .filter(Boolean)
        .slice(0, 4)
        .join(" · ");
}

function selectedReviewVoice() {
    return (
        reviewElVoices.find((voice) => voice.voice_id === reviewElVoiceId) ||
        null
    );
}

function syncReviewVoiceButton() {
    const btn = document.getElementById("reviewVoiceBtn");
    const label = document.getElementById("reviewVoiceBtnLabel");
    const badge = document.getElementById("reviewVoiceAiBadge");
    const systemOption = document.getElementById("reviewBrowserVoiceOption");
    if (!btn || !label || !badge) return;

    const enabled =
        !!reviewVoiceProfile &&
        SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs
            .enabled;
    const voice = selectedReviewVoice();
    const usingElevenLabs =
        enabled && ttsMode === "elevenlabs" && !!reviewElVoiceId && reviewElVoiceId !== "random";

    btn.classList.toggle("is-elevenlabs", usingElevenLabs);
    systemOption?.classList.toggle(
        "active",
        !usingElevenLabs,
    );
    badge.classList.toggle("is-locked", !enabled);
    badge.textContent = usingElevenLabs ? "EL" : "AI";
    label.textContent = usingElevenLabs
        ? voice?.name || "ElevenLabs"
        : "Głos";
    btn.title = usingElevenLabs
        ? `ElevenLabs: ${voice?.name || "wybrany głos"}`
        : "Wybierz głos powtórek";
}

function renderFreeVoiceTeaser() {
    const content = document.getElementById("reviewElevenLabsContent");
    if (!content) return;
    if (content.querySelector(".review-voice-teaser")) return;
    content.innerHTML = `
        <div class="review-voice-teaser">
            <div class="review-voice-teaser-title"><span>Naturalne głosy AI</span><span>🔒</span></div>
            <p>Usłysz różne akcenty i wybierz lektora do swoich powtórek.</p>
            <div class="review-voice-chips" aria-hidden="true">
                <span class="review-voice-chip">Roger</span>
                <span class="review-voice-chip">Sarah</span>
                <span class="review-voice-chip">Charlie</span>
            </div>
            <button type="button" class="review-voice-upgrade" id="reviewVoiceUpgrade">Odblokuj głosy ElevenLabs</button>
        </div>`;
    content
        .querySelector("#reviewVoiceUpgrade")
        ?.addEventListener("click", () => {
            closeReviewVoiceMenu();
            SubscriptionService.openPlans();
        });
}

function syncElevenLabsVoiceActiveState() {
    const list = document.querySelector(
        "#reviewElevenLabsContent .review-voice-list",
    );
    if (!list) return false;
    list.querySelectorAll(".review-voice-item").forEach((btn) => {
        const isActive =
            ttsMode === "elevenlabs" &&
            reviewElVoiceId === btn.dataset.voiceId;
        btn.classList.toggle("active", isActive);
    });
    return true;
}

function renderElevenLabsVoiceSelect() {
    const content = document.getElementById("reviewElevenLabsContent");
    if (!content) return;

    if (!reviewElVoices.length) {
        content.replaceChildren();
        return;
    }

    const existingList = content.querySelector(".review-voice-list");
    if (
        existingList &&
        existingList.children.length === reviewElVoices.length
    ) {
        syncElevenLabsVoiceActiveState();
        return;
    }

    content.replaceChildren();

    const list = document.createElement("div");
    list.className = "review-voice-list";

    reviewElVoices.forEach((voice) => {
        const item = document.createElement("button");
        item.type = "button";
        const isActive =
            ttsMode === "elevenlabs" && reviewElVoiceId === voice.voice_id;
        item.className = `review-voice-item${isActive ? " active" : ""}`;
        item.dataset.voiceId = voice.voice_id;

        const avatar = document.createElement("span");
        avatar.className = "review-voice-avatar el";
        avatar.textContent = "🎙️";

        const copy = document.createElement("span");
        copy.className = "review-voice-option-copy";

        const name = document.createElement("strong");
        name.textContent = voice.name;

        copy.append(name);

        const check = document.createElement("span");
        check.className = "review-voice-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = "✓";

        item.append(avatar, copy, check);

        item.addEventListener("click", async (event) => {
            event.stopPropagation();
            reviewElVoiceId = voice.voice_id;
            ttsMode = "elevenlabs";
            if (typeof clearPopupElevenLabsProviderBlock === "function") {
                clearPopupElevenLabsProviderBlock();
            }
            await chrome.storage.local.set({
                ttsMode,
                elVoiceId: reviewElVoiceId,
            });
            syncElevenLabsVoiceActiveState();
            syncReviewVoiceButton();
            setReviewVoiceStatus(`✓ Wybrano głos: ${voice.name}`, "ok");
        });

        list.appendChild(item);
    });

    content.appendChild(list);
}

const ALLOWED_REVIEW_VOICES = ["roger", "sarah", "charlie"];

function filterReviewAllowedVoices(voices) {
    if (!Array.isArray(voices)) return [];
    return voices
        .filter((v) => {
            const name = (v?.name || "").trim().toLowerCase();
            return ALLOWED_REVIEW_VOICES.some((t) => name.startsWith(t) || name.includes(t));
        })
        .sort((a, b) => {
            const nameA = (a?.name || "").trim().toLowerCase();
            const nameB = (b?.name || "").trim().toLowerCase();
            const idxA = ALLOWED_REVIEW_VOICES.findIndex((t) => nameA.startsWith(t) || nameA.includes(t));
            const idxB = ALLOWED_REVIEW_VOICES.findIndex((t) => nameB.startsWith(t) || nameB.includes(t));
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });
}

async function loadReviewElevenLabsVoices() {
    if (reviewVoicesLoading || reviewElVoices.length) return;
    reviewVoicesLoading = true;
    setReviewVoiceStatus("Ładowanie głosów…");
    try {
        const rawVoices = await SubscriptionService.getElevenLabsVoices("review");
        reviewElVoices = filterReviewAllowedVoices(rawVoices);
        renderElevenLabsVoiceSelect();
        setReviewVoiceStatus(
            reviewElVoices.length
                ? `${reviewElVoices.length} dostępnych głosów`
                : "Brak dostępnych głosów.",
            reviewElVoices.length ? "" : "error",
        );
        syncReviewVoiceButton();
    } catch (error) {
        setReviewVoiceStatus(
            error.message || "Nie udało się pobrać głosów.",
            "error",
        );
    } finally {
        reviewVoicesLoading = false;
    }
}

async function updateReviewVoiceUI() {
    try {
        reviewVoiceProfile = await SubscriptionService.effectiveProfile(false);
    } catch (error) {
        reviewVoiceProfile = null;
        setReviewVoiceStatus(
            error.message || "Nie udało się sprawdzić planu.",
            "error",
        );
    }

    const enabled =
        !!reviewVoiceProfile &&
        SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs
            .enabled;
    if (!enabled) {
        if (ttsMode === "elevenlabs") {
            ttsMode = "browser";
            await chrome.storage.local.set({ ttsMode });
        }
        renderFreeVoiceTeaser();
    } else if (reviewElVoices.length) {
        renderElevenLabsVoiceSelect();
    }
    syncReviewVoiceButton();
}

document
    .getElementById("reviewVoiceBtn")
    ?.addEventListener("click", async (event) => {
        event.stopPropagation();
        const menu = document.getElementById("reviewVoiceMenu");
        const btn = document.getElementById("reviewVoiceBtn");
        if (!menu || !btn) return;
        const willOpen = menu.hidden;
        menu.hidden = !willOpen;
        btn.setAttribute("aria-expanded", String(willOpen));
        if (!willOpen) return;

        if (reviewElVoices.length && syncElevenLabsVoiceActiveState()) {
            syncReviewVoiceButton();
            return;
        }

        await updateReviewVoiceUI();
        const enabled =
            !!reviewVoiceProfile &&
            SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs
                .enabled;
        if (enabled && !reviewElVoices.length) await loadReviewElevenLabsVoices();
    });

document
    .getElementById("reviewVoiceMenu")
    ?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

document
    .getElementById("reviewVoiceClose")
    ?.addEventListener("click", (event) => {
        event.stopPropagation();
        closeReviewVoiceMenu();
    });

document
    .getElementById("reviewBrowserVoiceOption")
    ?.addEventListener("click", async (event) => {
        event.stopPropagation();
        ttsMode = "browser";
        if (reviewSystemVoice === "random") reviewSystemVoice = "";
        await chrome.storage.local.set({
            ttsMode,
            elVoiceId: "",
            speechVoice: reviewSystemVoice,
        });
        syncElevenLabsVoiceActiveState();
        syncReviewVoiceButton();
        setReviewVoiceStatus("✓ Używasz głosu systemowego.", "ok");
    });

document.addEventListener("click", (event) => {
    const picker = document.getElementById("reviewVoicePicker");
    if (!picker) return;
    const path = event.composedPath ? event.composedPath() : [];
    if (!path.includes(picker) && !picker.contains(event.target)) {
        closeReviewVoiceMenu();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeReviewVoiceMenu();
});

// Voice selection is handled by the compact picker above.

// ── Delete all reviews button ─────────────────────────────────────
document.getElementById("reviewDeleteAll")?.addEventListener("click", () => {
    deleteAllReviews();
});

// ── Load due reviews ──────────────────────────────────────────────
function loadReviewQueue(options = {}) {
    const force = options?.force === true;
    const sessionInProgress =
        reviewQueue.length > 0 &&
        reviewIndex < reviewQueue.length &&
        !_reviewQueueStale;

    if (!force && sessionInProgress) {
        renderReview();
        return;
    }
    if (_reviewLoading) return;
    _reviewLoading = true;

    chrome.storage.local.get({ savedWords: [] }, (data) => {
        _reviewLoading = false;
        const words = data.savedWords || [];
        const now = Date.now();

        reviewQueue = words.filter((w) => isDueForReview(w, now)).map(ensureSR);

        // Shuffle
        for (let i = reviewQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reviewQueue[i], reviewQueue[j]] = [reviewQueue[j], reviewQueue[i]];
        }

        reviewTotalDue = reviewQueue.length;
        reviewIndex = 0;
        reviewAnswerShown = false;
        _reviewQueueStale = false;
        renderReview();
    });
}

// ── Refresh the review queue without interrupting an active session ──
// Background/Firebase sync can update `savedWords` at any time (every few
// seconds after rating a card, or on a periodic timer). If we naively
// reload+reshuffle the queue on every such change, the card the user is
// currently reading gets yanked out from under them. Instead, defer the
// reload until it's actually safe: when the review tab isn't open, or the
// current session has already finished.
function maybeRefreshReviewQueue() {
    const reviewTabActive = document
        .getElementById("tab-review")
        ?.classList.contains("active");
    const sessionInProgress =
        reviewTabActive &&
        reviewQueue.length > 0 &&
        reviewIndex < reviewQueue.length;

    if (sessionInProgress) {
        _reviewQueueStale = true;
        return;
    }

    if (reviewTabActive) {
        loadReviewQueue({ force: true });
    } else {
        _reviewQueueStale = true;
    }
}

// ── Badge on review tab ───────────────────────────────────────────
function updateReviewTabBadge(count) {
    const tab = document.getElementById("tabReview");
    if (!tab) return;
    const badge =
        count > 0
            ? `<span class="tab-badge">${count > 999 ? "999+" : count}</span>`
            : "";
    tab.innerHTML = `<span class="tab-icon">🧠</span><span class="tab-label">Powtórki</span>${badge}`;
}

// ── On first Review-tab open → refresh badge count ───────────────
function initReviewBadge() {
    if (typeof whenPopupReady === "function") {
        whenPopupReady((data) => {
            const words = data.savedWords || [];
            const now = Date.now();
            const dueCount = countDueWords(words, now);
            updateReviewTabBadge(dueCount);
        });
    } else {
        chrome.storage.local.get({ savedWords: [] }, (data) => {
            const words = data.savedWords || [];
            const now = Date.now();
            const dueCount = countDueWords(words, now);
            updateReviewTabBadge(dueCount);
        });
    }
}
initReviewBadge();

// ── Render review card ────────────────────────────────────────────
function renderReview() {
    const card = document.getElementById("reviewCard");
    const countEl = document.getElementById("reviewCount");
    const progressBar = document.getElementById("reviewProgressBar");
    const deleteAllBtn = document.getElementById("reviewDeleteAll");

    if (reviewQueue.length === 0) {
        countEl.textContent = "";
        progressBar.style.width = "100%";
        if (deleteAllBtn) deleteAllBtn.style.display = "none";
        card.innerHTML = `
            <div class="review-empty">
                <div class="review-empty-icon">✅</div>
                <div class="review-empty-text">Brak słów do powtórki!</div>
                <div class="review-empty-sub">Dodaj nowe słowa lub wróć później.</div>
            </div>`;
        updateReviewTabBadge(0);
        return;
    }

    if (deleteAllBtn) deleteAllBtn.style.display = "";

    if (reviewIndex >= reviewQueue.length) {
        // Session just finished – now it's safe to pull in any words that
        // synced in while the user was reviewing, without disrupting them.
        if (_reviewQueueStale) {
            _reviewQueueStale = false;
            loadReviewQueue();
            return;
        }
        countEl.textContent = `${reviewTotalDue}/${reviewTotalDue}`;
        progressBar.style.width = "100%";
        card.innerHTML = `
            <div class="review-done">
                <div class="review-done-icon">🎉</div>
                <div class="review-done-text">Gratulacje!</div>
                <div class="review-done-sub">Wykonałeś wszystkie ${reviewTotalDue} powtórek na teraz!</div>
            </div>`;
        updateReviewTabBadge(0);
        return;
    }

    const w = reviewQueue[reviewIndex];
    updateDirBtnLabel();
    countEl.textContent = `${reviewIndex + 1}/${reviewTotalDue}`;
    progressBar.style.width = `${Math.round((reviewIndex / reviewTotalDue) * 100)}%`;

    if (!reviewAnswerShown) {
        renderQuestion(w);
    } else {
        renderAnswer(w);
    }
}

// ── Shared card controls + question (front) side ───────────────────
function reviewCardMetaHtml(sideLabel) {
    return `
        <div class="review-card-meta">
            <span class="review-side-badge">${sideLabel}</span>
            <span class="review-keyboard-cue" title="Możesz oceniać kartę klawiaturą">
                <span>Klawiatura</span><kbd>←</kbd><kbd>→</kbd>
            </span>
        </div>`;
}

function reviewControlsHtml(sr, answerShown) {
    const labels = [1, 2].map((grade) => previewLabel(sr, grade));
    const originalSideShown =
        (reviewDirection === "normal" && !answerShown) ||
        (reviewDirection === "reverse" && answerShown);
    return `
        <button class="review-flip-btn" type="button">
            <span class="review-flip-keys"><kbd>↓</kbd><kbd>S</kbd></span>
            <span>${answerShown ? "Pokaż pytanie" : "Pokaż odpowiedź"}</span>
        </button>
        <div class="review-controls">
            <div class="review-rating">
                <div class="review-rating-label">Znałeś odpowiedź?</div>
                <div class="review-rating-buttons review-rating-buttons-2">
                    <button class="review-rate-btn rate-no" data-grade="1" type="button" title="Nie znam (← lub A)">
                        <span class="rate-key-pair"><kbd>←</kbd><kbd>A</kbd></span>
                        <span class="rate-copy">
                            <span class="rate-label">Nie znam</span>
                            <span class="review-next-info">${labels[0]}</span>
                        </span>
                    </button>
                    <button class="review-rate-btn rate-yes" data-grade="2" type="button" title="Znam (→ lub D)">
                        <span class="rate-key-pair"><kbd>→</kbd><kbd>D</kbd></span>
                        <span class="rate-copy">
                            <span class="rate-label">Znam</span>
                            <span class="review-next-info">${labels[1]}</span>
                        </span>
                    </button>
                </div>
            </div>
            <div class="review-shortcuts" aria-label="Skróty klawiszowe powtórki">
                <span><span class="shortcut-keys"><kbd>↑</kbd><kbd>W</kbd></span> czytaj</span>
                <span><span class="shortcut-keys"><kbd>↓</kbd><kbd>S</kbd></span> odwróć</span>
                ${originalSideShown ? '<span><span class="shortcut-keys"><kbd>Enter</kbd></span> tłumacz i wyjaśnij AI</span>' : ""}
            </div>
            <div class="review-actions-row">
                <button class="review-edit-btn" type="button"><span aria-hidden="true">✏️</span> Edytuj</button>
                <button class="review-delete-btn" type="button"><span aria-hidden="true">🗑</span> Usuń</button>
            </div>
        </div>`;
}

function attachReviewCardControls(card, w) {
    card.querySelector(".review-flip-btn")?.addEventListener("click", flipCard);
    card.querySelectorAll(".review-rate-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            animateSwipeAndRate(parseInt(btn.dataset.grade));
        });
    });
    card.querySelector(".review-edit-btn")?.addEventListener("click", () => {
        showReviewEditForm(w, reviewAnswerShown);
    });
    card.querySelector(".review-delete-btn")?.addEventListener("click", () => {
        deleteReviewWord(w);
    });
}

// ── Screenshot Shimmer & Smooth Loading (UX / UI) ────────────────
(function ensureReviewScreenshotStyles() {
    if (typeof document === "undefined" || document.getElementById("review-screenshot-shimmer-styles")) return;
    const style = document.createElement("style");
    style.id = "review-screenshot-shimmer-styles";
    style.textContent = `
        @keyframes reviewScreenshotShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        .review-screenshot {
            margin-top: 14px;
            text-align: center;
            display: flex;
            justify-content: center;
            width: 100%;
        }
        .review-screenshot-box {
            position: relative;
            width: 85%;
            min-height: 140px;
            aspect-ratio: 16 / 9;
            max-height: 250px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 25%, rgba(255, 255, 255, 0.09) 50%, rgba(255, 255, 255, 0.03) 75%);
            background-size: 200% 100%;
            animation: reviewScreenshotShimmer 1.8s infinite ease-in-out;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
            transition: border-color 0.3s ease, background 0.3s ease;
        }
        .review-screenshot-box.is-loaded {
            animation: none;
            background: rgba(0, 0, 0, 0.2);
            border-color: rgba(255, 255, 255, 0.15);
            min-height: 0;
            aspect-ratio: auto;
        }
        .review-screenshot-box .review-screenshot-img {
            width: 100%;
            height: auto;
            max-height: 260px;
            object-fit: contain;
            border-radius: 11px;
            border: none;
            opacity: 0;
            display: block;
            transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .review-screenshot-box.is-loaded .review-screenshot-img {
            opacity: 1;
        }
    `;
    document.head.appendChild(style);
})();

function reviewScreenshotHtml(url) {
    if (!url) return "";
    return `
        <div class="review-screenshot">
            <div class="review-screenshot-box">
                <img src="${escapeAttr(url)}"
                     alt="Screenshot"
                     class="review-screenshot-img"
                     loading="eager">
            </div>
        </div>`;
}

function renderQuestion(w) {
    const card = document.getElementById("reviewCard");
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";
    const showWord = isReverse ? w.translated : w.original;
    const showLang = isReverse ? tgtL : srcL;
    const showSentence = isReverse
        ? w.sentenceTranslated || ""
        : w.sentence || "";
    const wordClass = isReverse ? "__qt_translated" : "__qt_original";
    const forceBrowserAttr = isReverse ? 'data-force-browser-tts="true"' : "";
    const cacheAttrs = `data-cache-first="true" data-cache-not-before="${Number(w.ttsCacheInvalidatedAt || 0)}"`;
    const sr = w.sr || { step: 0, interval: 0 };
    const sentenceHtml = showSentence
        ? `
                <div class="review-context-row">
                    <span class="review-context">"${SharedUtils.highlightWordInSentence(
                        showSentence,
                        showWord,
                        wordClass,
                    )}"</span>
                </div>`
        : "";
    card.innerHTML = `
            <div class="review-flashcard">
                <div class="review-question">
                    <div class="review-word-row">
                        <span class="review-word ${wordClass}">${escapeHtml(showWord)}</span>
                        <button class="review-speak-btn" data-text="${escapeAttr(
                            buildReviewSpeakText(showWord, showSentence),
                        )}" data-lang="${escapeAttr(showLang)}" ${forceBrowserAttr} ${cacheAttrs} title="Odczytaj">${SPEAK_SVG}</button>
                    </div>
                    ${sentenceHtml}
                    ${reviewScreenshotHtml(w.screenshot)}
                </div>
            </div>
            ${reviewControlsHtml(sr, false)}`;

    attachReviewSpeakHandlers(card);
    attachReviewCardControls(card, w);
    restoreReviewAiPanels(w);
    autoSpeakReviewCard(w, false);

    // Every new card must always start fully scrolled to the top — force
    // the scrollable card container itself back to 0 rather than relying
    // on scrollIntoView, which (due to the flex "safe center" alignment)
    // could leave a small residual offset instead of a true top position.
    const scrollToTop = () => {
        card.scrollTop = 0;
    };
    scrollToTop();
    requestAnimationFrame(scrollToTop);
    const qShotImg = card.querySelector(".review-screenshot-img");
    if (qShotImg) {
        const markLoaded = () => {
            qShotImg.closest(".review-screenshot-box")?.classList.add("is-loaded");
            scrollToTop();
        };
        if (qShotImg.complete && qShotImg.naturalWidth > 0) {
            markLoaded();
        } else {
            qShotImg.addEventListener("load", markLoaded, { once: true });
            qShotImg.addEventListener(
                "error",
                () => {
                    qShotImg.closest(".review-screenshot")?.remove();
                },
                { once: true },
            );
        }
    }
}

/**
 * Flip the flashcard in place — toggles between question (front) and
 * answer (back) every time it's called, exactly like flipping a real
 * paper flashcard back and forth as many times as you want, instead of
 * only ever revealing the answer once.
 */
function flipCard() {
    const card = document.getElementById("reviewCard");
    const flashcard = card?.querySelector(".review-flashcard");
    const w = reviewQueue[reviewIndex];
    if (!w) return;

    const showNext = () => {
        reviewAnswerShown = !reviewAnswerShown;
        if (reviewAnswerShown) {
            renderAnswer(w);
        } else {
            renderQuestion(w);
        }
        const newFlashcard = card.querySelector(".review-flashcard");
        newFlashcard?.classList.add("qt-flip-in");
    };

    // Real flashcard "flip" feel: rotate the current face away, then swap
    // in the other side's content rotated in from the opposite direction.
    if (flashcard) {
        flashcard.classList.add("qt-flip-out");
        setTimeout(showNext, 150);
    } else {
        showNext();
    }
}

// Backwards-compatible alias (kept in case anything still calls it by name).
function revealAnswer() {
    flipCard();
}

/** Swipe the current card off-screen (like a real flashcard being tossed
 * left/right) before applying the grade and loading the next card. */
function animateSwipeAndRate(grade) {
    const card = document.getElementById("reviewCard");
    const flashcard = card?.querySelector(".review-flashcard");
    const controls = card?.querySelector(".review-controls");
    const flipButton = card?.querySelector(".review-flip-btn");

    if (flashcard) {
        flashcard.classList.add(
            grade === 1 ? "qt-swipe-left" : "qt-swipe-right",
        );
        controls?.classList.add("qt-fade-out");
        flipButton?.classList.add("qt-fade-out");
        setTimeout(() => rateWord(grade), 200);
    } else {
        rateWord(grade);
    }
}

/**
 * On-demand AI translate ('Enter' shortcut) — fetches a fresh, plain/accurate
 * translation of the original word + sentence via Gemini and shows it inline,
 * without flipping or rating the card. It is available only while the original
 * side is visible and may make at most one successful request per card.
 */
async function aiTranslateReviewCard() {
    const card = document.getElementById("reviewCard");
    if (!card || reviewIndex >= reviewQueue.length) return;
    const w = reviewQueue[reviewIndex];
    if (!w) return;

    const originalSideShown =
        (reviewDirection === "normal" && !reviewAnswerShown) ||
        (reviewDirection === "reverse" && reviewAnswerShown);
    if (!originalSideShown) return;

    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const qWord = w.original;
    const qSentence = String(w.sentence || "").trim();
    if (!qWord) return;

    const state = getReviewAiState(w).translation;
    if (state.status === "loading") return;
    if (state.status === "done") {
        restoreReviewAiPanels(w);
        const res = state.result;
        if (res) {
            const speakText = [res.wordTr, res.sentTr, res.explanation]
                .filter(Boolean)
                .join(". ");
            if (speakText) {
                stopPopupSpeak();
                popupSpeak(speakText, res.targetLang || tgtL, {
                    forceBrowser: true,
                    useConfiguredRate: true,
                }).catch(() => {});
            }
        }
        return;
    }

    const panel = ensureReviewAiPanel("reviewAiTranslate");
    if (!panel) return;
    state.status = "loading";
    panel.innerHTML = `<div class="review-ai-translate-loading"><span class="review-ai-spinner"></span>Tłumaczę (AI)…</div>`;

    try {
        const prompt = AIPrompts.standardTranslate(
            qWord,
            qSentence,
            srcL,
            tgtL,
        );

        // Bezpieczne proxy – klucz Gemini API jest TYLKO na serwerze Firebase.
        if (typeof GeminiProxy === "undefined") {
            state.status = "idle";
            panel.innerHTML = `<div class="review-ai-translate-error">GeminiProxy niedostępny.</div>`;
            return;
        }
        let parsed;
        try {
            parsed = await GeminiProxy.requestJSON(prompt, {
                temperature: 0.3,
                maxOutputTokens: 300,
            });
        } catch (aiErr) {
            const limitReached = GeminiProxy?.isLimitError?.(aiErr);
            state.status = "idle";
            if (limitReached) {
                panel.remove();
            } else {
                panel.innerHTML = `<div class="review-ai-translate-error">${escapeHtml(aiErr.message)}</div>`;
            }
            return;
        }
        const wordTr = parsed.word_translation || "";
        // With no source sentence there must be no placeholder/error message.
        const sentTr = qSentence ? parsed.sentence_translation || "" : "";
        const explanation = parsed.explanation || "";

        state.status = "done";
        state.result = { wordTr, sentTr, explanation, targetLang: tgtL };

        // Bail out silently if the user already moved to a different card
        // while the request was in flight.
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;

        renderReviewTranslationResult(panel, state.result);

        // AI-generated text always uses the free system/browser voice.
        const speakText = [wordTr, sentTr, explanation]
            .filter(Boolean)
            .join(". ");
        if (speakText) {
            stopPopupSpeak();
            popupSpeak(speakText, tgtL, {
                forceBrowser: true,
                useConfiguredRate: true,
            }).catch((ttsErr) => {
                console.warn("[Lectoro] AI Review TTS error:", ttsErr);
            });
        }
    } catch (err) {
        state.status = "idle";
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;
        panel.innerHTML = `<div class="review-ai-translate-error">Błąd AI: ${escapeHtml(err.message)}</div>`;
    }
}

function getReviewAiState(w) {
    let state = reviewAiStates.get(w);
    if (!state) {
        state = {
            translation: { status: "idle", result: null },
        };
        reviewAiStates.set(w, state);
    }
    return state;
}

function ensureReviewAiPanel(id) {
    const card = document.getElementById("reviewCard");
    const flashcard = card?.querySelector(".review-flashcard");
    if (!card || !flashcard) return null;
    let panel = card.querySelector(`#${id}`);
    if (!panel) {
        panel = document.createElement("div");
        panel.id = id;
        panel.className = "review-ai-translate";
        flashcard.appendChild(panel);
    }
    return panel;
}

function renderReviewTranslationResult(panel, result) {
    const speakText = [result.wordTr, result.sentTr, result.explanation]
        .filter(Boolean)
        .join(". ");
    panel.innerHTML = `
        <div class="review-ai-translate-label">Tłumaczenie AI</div>
        <div class="review-ai-result-row">
            <div class="review-ai-translate-word">${escapeHtml(result.wordTr || "—")}</div>
            ${
                speakText
                    ? `
                <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(speakText)}" data-lang="${escapeAttr(result.targetLang)}" data-force-browser-tts="true" data-use-configured-rate="true" title="Odczytaj tłumaczenie i wyjaśnienie głosem systemowym" aria-label="Odczytaj tłumaczenie i wyjaśnienie głosem systemowym">${SPEAK_SVG}</button>
            `
                    : ""
            }
        </div>
        ${result.sentTr ? `<div class="review-ai-translate-sentence">"${escapeHtml(result.sentTr)}"</div>` : ""}
        ${result.explanation ? `<div class="review-ai-translate-explanation">${escapeHtml(result.explanation)}</div>` : ""}
    `;
    attachReviewSpeakHandlers(panel);
}

function restoreReviewAiPanels(w) {
    const originalSideShown =
        (reviewDirection === "normal" && !reviewAnswerShown) ||
        (reviewDirection === "reverse" && reviewAnswerShown);
    if (!originalSideShown) return;

    const state = getReviewAiState(w);
    if (state.translation.status === "done" && state.translation.result) {
        const panel = ensureReviewAiPanel("reviewAiTranslate");
        if (panel)
            renderReviewTranslationResult(panel, state.translation.result);
    } else if (state.translation.status === "loading") {
        const panel = ensureReviewAiPanel("reviewAiTranslate");
        if (panel) {
            panel.innerHTML = `<div class="review-ai-translate-loading"><span class="review-ai-spinner"></span>Tłumaczę (AI)…</div>`;
        }
    }
}

function renderAnswer(w) {
    const card = document.getElementById("reviewCard");
    const sr = w.sr || { step: 0, interval: 0 };
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";

    // In reverse mode: question=translated, answer=original
    const aWord = isReverse ? w.original : w.translated;
    const aLang = isReverse ? srcL : tgtL;
    const aSentence = isReverse ? w.sentence || "" : w.sentenceTranslated || "";
    const aWordClass = isReverse ? "__qt_original" : "__qt_translated";
    const forceBrowserAttr = !isReverse ? 'data-force-browser-tts="true"' : "";
    const cacheAttrs = `data-cache-first="true" data-cache-not-before="${Number(w.ttsCacheInvalidatedAt || 0)}"`;

    // Same layout as the question side (review-word-row / review-context-row
    // / screenshot) so the answer visually *replaces* the original word in
    // the exact same spot — true flashcard flip — instead of stacking a
    // second "translation" block below it.
    card.innerHTML = `
        <div class="review-flashcard">
            <div class="review-question">
                <div class="review-word-row">
                    <span class="review-word ${aWordClass}">${escapeHtml(aWord)}</span>
                    <button class="review-speak-btn" data-text="${escapeAttr(
                        buildReviewSpeakText(aWord, aSentence),
                    )}" data-lang="${escapeAttr(aLang)}" ${forceBrowserAttr} ${cacheAttrs} title="Odczytaj">${SPEAK_SVG}</button>
                </div>
                ${
                    aSentence
                        ? `
                <div class="review-context-row">
                    <span class="review-context">"${SharedUtils.highlightWordInSentence(
                        aSentence,
                        aWord,
                        aWordClass,
                    )}"</span>
                    
                </div>`
                        : ""
                }
                ${reviewScreenshotHtml(w.screenshot)}
            </div>
        </div>
        ${reviewControlsHtml(sr, true)}`;

    // Attach TTS handlers
    attachReviewSpeakHandlers(card);
    attachReviewCardControls(card, w);
    restoreReviewAiPanels(w);
    autoSpeakReviewCard(w, true);

    // Same as the question side: always force a full scroll back to the
    // top of the card container (re-run once the screenshot finishes
    // loading, since its height isn't known until then and could push
    // the container's scroll position back down).
    const scrollToTop = () => {
        card.scrollTop = 0;
    };
    scrollToTop();
    requestAnimationFrame(scrollToTop);
    const shotImg = card.querySelector(".review-screenshot-img");
    if (shotImg) {
        const markLoaded = () => {
            shotImg.closest(".review-screenshot-box")?.classList.add("is-loaded");
            scrollToTop();
        };
        if (shotImg.complete && shotImg.naturalWidth > 0) {
            markLoaded();
        } else {
            shotImg.addEventListener("load", markLoaded, { once: true });
            shotImg.addEventListener(
                "error",
                () => {
                    shotImg.closest(".review-screenshot")?.remove();
                },
                { once: true },
            );
        }
    }
}

// ── Edit form in review ───────────────────────────────────────────
function showReviewEditForm(w, returnToAnswer = reviewAnswerShown) {
    const card = document.getElementById("reviewCard");
    card.innerHTML = `
        <div class="review-edit-form">
            <label>Oryginał</label>
            <input type="text" id="editOriginal" value="${escapeAttr(w.original)}">
            <label>Tłumaczenie</label>
            <input type="text" id="editTranslated" value="${escapeAttr(w.translated)}">
            <label>Zdanie (oryginał)</label>
            <input type="text" id="editSentence" value="${escapeAttr(w.sentence || "")}">
            <label>Zdanie (tłumaczenie)</label>
            <input type="text" id="editSentenceTr" value="${escapeAttr(w.sentenceTranslated || "")}">
            <div class="review-edit-actions">
                <button class="review-edit-cancel" id="editCancel">Anuluj</button>
                <button class="review-edit-save" id="editSave">💾 Zapisz</button>
            </div>
        </div>`;

    document.getElementById("editCancel").addEventListener("click", () => {
        returnToAnswer ? renderAnswer(w) : renderQuestion(w);
    });

    document.getElementById("editSave").addEventListener("click", () => {
        const clean =
            typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (s) => String(s || "").replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").replace(/[.,\s]+$/, "").trim();

        const newOriginal = clean(document.getElementById("editOriginal").value);
        const newTranslated = clean(document.getElementById("editTranslated").value);
        const newSentence = clean(document.getElementById("editSentence").value);
        const newSentenceTr = clean(document.getElementById("editSentenceTr").value);
        if (!newOriginal || !newTranslated) return;

        // Keep old keys for finding in storage
        const oldOriginal = w.original;
        const oldTranslated = w.translated;

        // Update queue object in-place
        w.original = newOriginal;
        w.translated = newTranslated;
        w.sentence = newSentence;
        w.sentenceTranslated = newSentenceTr;
        const editedAt = Date.now();
        w.ttsCacheInvalidatedAt = editedAt;

        // Persist to storage (updates word list too and enqueues sync)
        const updatePayload = {
            original: newOriginal,
            translated: newTranslated,
            sentence: newSentence,
            sentenceTranslated: newSentenceTr,
            updatedAt: editedAt,
            ttsCacheInvalidatedAt: editedAt,
        };

        const onDone = () => {
            returnToAnswer ? renderAnswer(w) : renderQuestion(w);
        };

        if (typeof SharedWordRepository !== "undefined") {
            SharedWordRepository.updateWord(
                (candidate) =>
                    w.id
                        ? candidate.id === w.id
                        : (candidate.original === oldOriginal && candidate.translated === oldTranslated) ||
                          (candidate.original === oldOriginal && candidate.timestamp === w.timestamp),
                (existing) => ({
                    ...existing,
                    ...updatePayload,
                    id: existing.id || w.id || SharedUtils?.generateId?.() || String(editedAt),
                }),
            )
                .then((updated) => {
                    if (updated?.id) w.id = updated.id;
                    onDone();
                })
                .catch((err) => {
                    console.error("[Lectoro] Nie udało się zapisać edycji powtórki:", err);
                    onDone();
                });
        } else {
            chrome.storage.local.get({ savedWords: [] }, (data) => {
                const words = data.savedWords || [];
                const idx = words.findIndex(
                    (x) =>
                        (w.id && x.id === w.id) ||
                        (x.original === oldOriginal && x.translated === oldTranslated) ||
                        (x.original === oldOriginal && x.timestamp === w.timestamp),
                );
                if (idx !== -1) {
                    if (!words[idx].id) words[idx].id = SharedUtils?.generateId?.() || String(editedAt);
                    words[idx] = { ...words[idx], ...updatePayload };
                    w.id = words[idx].id;
                    chrome.storage.local.set({ savedWords: words }, onDone);
                } else {
                    onDone();
                }
            });
        }
    });

    // Focus first field
    document.getElementById("editOriginal").focus();
}

// ── Rate word & update storage ────────────────────────────────────
async function rateWord(grade) {
    // Zatrzymaj odtwarzanie głosu
    stopPopupSpeak();

    const w = reviewQueue[reviewIndex];
    if (!w) return;

    // Upewnij się, że karta ma dane SRS
    ensureSR(w);

    // Aktualizujemy SRS na podstawie odpowiedzi:
    // grade === 1 -> Nie znam
    // grade === 2 -> Znam
    w.sr = srUpdate(w.sr, grade);

    _reviewSaving = true;

    try {
        if (typeof SharedWordRepository !== "undefined") {
            await SharedWordRepository.recordReviewRating(w, grade);
        } else {
            const data = await chrome.storage.local.get({ savedWords: [] });
            const words = data.savedWords || [];
            const idx = words.findIndex((x) => (w.id && x.id === w.id) || (x.original === w.original && x.translated === w.translated));
            if (idx !== -1) {
                words[idx].sr = w.sr;
                words[idx].updatedAt = Date.now();
                await chrome.storage.local.set({ savedWords: words });
            }
        }
    } catch (err) {
        console.error("[Lectoro] Nie udało się zapisać powtórki:", err);
    } finally {
        _reviewSaving = false;
        reviewIndex++;
        reviewAnswerShown = false;
        renderReview();
    }
}
