// ═══════════════════════════════════════════════════════════════════
//  SPACED REPETITION  –  see shared/srs.js for the Anki SM-2 algorithm
// ═══════════════════════════════════════════════════════════════════
const {
    update: srUpdate,
    previewLabel,
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

// ── Review direction: "normal" = show original, guess translation
//                      "reverse" = show translation, guess original
let reviewDirection = "normal";
let ttsMode = "browser";
let reviewSystemVoice = "";
let reviewElVoiceId = "";
let reviewElVoices = [];
let reviewVoiceProfile = null;
let reviewVoicesLoading = false;

let reviewTargetLang = LectoroConstants.DEFAULT_READING_SETTINGS.targetLang;
let reviewLearningLang = LectoroConstants.DEFAULT_READING_SETTINGS.learningLang;

whenPopupReady((data) => {
    reviewDirection = data.reviewDirection || "normal";
    reviewTargetLang = data.targetLang || LectoroConstants.DEFAULT_READING_SETTINGS.targetLang;
    reviewLearningLang = data.learningLang || LectoroConstants.DEFAULT_READING_SETTINGS.learningLang;
    reviewSystemVoice =
        data.speechVoice === "random" ? "" : data.speechVoice || "";
    if (data.speechVoice === "random") {
        chrome.storage.local.set({ speechVoice: "" });
    }
    ttsMode = data.ttsMode || "browser";
    reviewElVoiceId = data.elVoiceId || "";
    updateDirBtnLabel();
    void updateReviewVoiceUI();
});

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (changes.targetLang) {
            reviewTargetLang = changes.targetLang.newValue || LectoroConstants.DEFAULT_READING_SETTINGS.targetLang;
            updateDirBtnLabel();
        }
        if (changes.learningLang) {
            reviewLearningLang = changes.learningLang.newValue || LectoroConstants.DEFAULT_READING_SETTINGS.learningLang;
            updateDirBtnLabel();
        }
    });
}

// ── Direction toggle button ───────────────────────────────────────
function getActiveReviewLangs() {
    const card = reviewQueue?.[reviewIndex];
    const src = card?.srcLang || reviewLearningLang;
    const tgt = card?.tgtLang || reviewTargetLang;
    return {
        srcTag: LectoroConstants.langTag(src),
        tgtTag: LectoroConstants.langTag(tgt),
    };
}

function updateDirBtnLabel() {
    const btn = document.getElementById("reviewDirBtn");
    if (!btn) return;
    const { srcTag, tgtTag } = getActiveReviewLangs();
    const titleNormal = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("review_dir_title", null, { src: srcTag, tgt: tgtTag })
        : `Change review direction (${srcTag} → ${tgtTag})`;
    const titleReverse = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("review_dir_title", null, { src: tgtTag, tgt: srcTag })
        : `Change review direction (${tgtTag} → ${srcTag})`;
    if (reviewDirection === "normal") {
        btn.innerHTML = `${srcTag} <span class="dir-arrow">→</span> ${tgtTag}`;
        btn.title = titleNormal;
    } else {
        btn.innerHTML = `${tgtTag} <span class="dir-arrow">→</span> ${srcTag}`;
        btn.title = titleReverse;
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

function closeReviewVoiceMenu() {
    const menu = document.getElementById("reviewVoiceMenu");
    const btn = document.getElementById("reviewVoiceBtn");
    if (menu) menu.hidden = true;
    btn?.setAttribute("aria-expanded", "false");
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
        enabled &&
        ttsMode === "elevenlabs" &&
        !!reviewElVoiceId &&
        reviewElVoiceId !== "random";

    btn.classList.toggle("is-elevenlabs", usingElevenLabs);
    systemOption?.classList.toggle("active", !usingElevenLabs);
    badge.classList.toggle("is-locked", !enabled);
    badge.textContent = usingElevenLabs ? "EL" : "AI";
    label.textContent = usingElevenLabs ? voice?.name || "ElevenLabs" : "Voice";
    btn.title = usingElevenLabs
        ? `ElevenLabs: ${voice?.name || "selected voice"}`
        : "Choose review voice";
}

function renderFreeVoiceTeaser() {
    const content = document.getElementById("reviewElevenLabsContent");
    if (!content) return;
    if (content.querySelector(".review-voice-teaser")) return;
    const t = (k, d) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k) : d);
    content.innerHTML = `
        <div class="review-voice-teaser">
            <div class="review-voice-teaser-title"><span>${t("review_voice_natural_title", "Natural AI voices")}</span><span>🔒</span></div>
            <p>${t("review_voice_natural_desc", "Listen to authentic accents and choose a voice for your reviews.")}</p>
            <div class="review-voice-chips" aria-hidden="true">
                <span class="review-voice-chip">Liam</span>
                <span class="review-voice-chip">Matilda</span>
            </div>
            <button type="button" class="review-voice-upgrade" id="reviewVoiceUpgrade">${t("review_voice_unlock_btn", "Unlock ElevenLabs voices")}</button>
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
            ttsMode === "elevenlabs" && reviewElVoiceId === btn.dataset.voiceId;
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
            const voiceMsg = typeof SharedI18n !== "undefined"
                ? SharedI18n.t("review_voice_selected", null, { name: voice.name })
                : `✓ Voice selected: ${voice.name}`;
            setReviewVoiceStatus(voiceMsg, "ok");
        });

        list.appendChild(item);
    });

    content.appendChild(list);
}

async function loadReviewElevenLabsVoices() {
    if (reviewVoicesLoading || reviewElVoices.length) return;
    reviewVoicesLoading = true;
    const loadingMsg = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("review_voice_loading")
        : "Loading voices…";
    setReviewVoiceStatus(loadingMsg);
    try {
        const rawVoices =
            await SubscriptionService.getElevenLabsVoices("review");
        reviewElVoices = Array.isArray(rawVoices) ? rawVoices : [];
        if (reviewElVoices.length > 0) {
            const currentValid = reviewElVoices.some(
                (v) => v.voice_id === reviewElVoiceId,
            );
            if (!currentValid) {
                reviewElVoiceId = reviewElVoices[0].voice_id;
                if (ttsMode === "elevenlabs") {
                    await chrome.storage.local.set({
                        elVoiceId: reviewElVoiceId,
                    });
                }
            }
        }
        renderElevenLabsVoiceSelect();
        const availMsg = reviewElVoices.length
            ? (typeof SharedI18n !== "undefined"
                ? SharedI18n.t("review_voice_available", null, { count: reviewElVoices.length })
                : `${reviewElVoices.length} voices available`)
            : (typeof SharedI18n !== "undefined"
                ? SharedI18n.t("review_voice_none")
                : "No voices available.");
        setReviewVoiceStatus(
            availMsg,
            reviewElVoices.length ? "" : "error",
        );
        syncReviewVoiceButton();
    } catch (error) {
        const fetchFailedMsg = typeof SharedI18n !== "undefined"
            ? SharedI18n.t("review_voice_fetch_failed")
            : (error.message || "Failed to fetch voices.");
        setReviewVoiceStatus(
            fetchFailedMsg,
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
        const planFailedMsg = typeof SharedI18n !== "undefined"
            ? SharedI18n.t("review_voice_plan_failed")
            : (error.message || "Failed to check plan.");
        setReviewVoiceStatus(planFailedMsg, "error");
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
        if (enabled && !reviewElVoices.length)
            await loadReviewElevenLabsVoices();
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
        const sysMsg = typeof SharedI18n !== "undefined"
            ? SharedI18n.t("review_voice_system_used")
            : "✓ Using system voice.";
        setReviewVoiceStatus(sysMsg, "ok");
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

// ── Delete review words & queue management ────────────────────────
async function deleteReviewWord(w) {
    const confirmMsg = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("review_delete_word_confirm", null, { word: w.original })
        : `Delete "${w.original}" from database?`;
    if (!confirm(confirmMsg)) return;
    if (typeof stopPopupSpeak === "function") stopPopupSpeak();
    try {
        await SharedWordRepository.deleteWord(
            w.id || w.original,
            w.timestamp,
        );
    } catch (err) {
        console.error("[Lectoro] Failed to delete word:", err);
    }
    // Remove from current queue and continue
    reviewQueue.splice(reviewIndex, 1);
    reviewTotalDue = reviewQueue.length;
    if (reviewIndex >= reviewQueue.length) reviewIndex = reviewQueue.length - 1;
    if (reviewIndex < 0) reviewIndex = 0;
    reviewAnswerShown = false;
    renderReview();
}

async function deleteAllReviews() {
    const confirmMsg = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("review_delete_all_confirm")
        : "Delete ALL words in the review queue?";
    if (!confirm(confirmMsg)) return;
    if (typeof stopPopupSpeak === "function") stopPopupSpeak();
    try {
        await SharedWordRepository.deleteDueReviews();
    } catch (err) {
        console.error("[Lectoro] Failed to delete review words:", err);
    }
    reviewQueue = [];
    reviewIndex = 0;
    reviewTotalDue = 0;
    reviewAnswerShown = false;
    renderReview();
}

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
    tab.innerHTML = `<span class="tab-icon">🧠</span><span class="tab-label">Review</span>${badge}`;
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

let reviewCardEl = null;
function getReviewCard() {
    if (!reviewCardEl || !reviewCardEl.isConnected) {
        reviewCardEl = document.getElementById("reviewCard");
    }
    return reviewCardEl;
}

// ── Render review card ────────────────────────────────────────────
function renderReview() {
    const card = getReviewCard();
    const countEl = document.getElementById("reviewCount");
    const progressBar = document.getElementById("reviewProgressBar");
    const deleteAllBtn = document.getElementById("reviewDeleteAll");

    if (reviewQueue.length === 0) {
        countEl.textContent = "";
        progressBar.style.width = "100%";
        if (deleteAllBtn) deleteAllBtn.style.display = "none";
        const emptyTitle = typeof SharedI18n !== "undefined" ? SharedI18n.t("review_empty_title") : "No cards to review!";
        const emptySub = typeof SharedI18n !== "undefined" ? SharedI18n.t("review_empty_sub") : "Add new words or come back later.";
        card.innerHTML = `
            <div class="review-empty">
                <div class="review-empty-icon">✅</div>
                <div class="review-empty-text">${emptyTitle}</div>
                <div class="review-empty-sub">${emptySub}</div>
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
        const doneTitle = typeof SharedI18n !== "undefined" ? SharedI18n.t("review_done_title") : "Congratulations!";
        const doneSub = typeof SharedI18n !== "undefined"
            ? SharedI18n.t("review_done_sub", null, { total: reviewTotalDue })
            : `You completed all ${reviewTotalDue} reviews for now!`;
        card.innerHTML = `
            <div class="review-done">
                <div class="review-done-icon">🎉</div>
                <div class="review-done-text">${doneTitle}</div>
                <div class="review-done-sub">${doneSub}</div>
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

function reviewControlsHtml(sr, answerShown) {
    const labels = [1, 2].map((grade) => previewLabel(sr, grade));
    const t = (k, d) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k) : d);
    const flipText = answerShown
        ? t("review_show_question", "Show question")
        : t("review_show_answer", "Show answer");

    return `
<button class="review-flip-btn" type="button">
    <span class="review-flip-keys">
        <kbd>↓</kbd>
        <kbd>S</kbd>
    </span>
    <span>${flipText}</span>
</button>

<div class="review-controls">
    <div class="review-rating">
        <div class="review-rating-label">${t("review_know_question", "Did you know the answer?")}</div>

        <div class="review-rating-buttons review-rating-buttons-2">
            <button class="review-rate-btn rate-no" data-grade="1" type="button">
                <span class="rate-key-pair">
                    <kbd>←</kbd>
                    <kbd>A</kbd>
                </span>

                <span class="rate-copy">
                    <span class="rate-label">${t("review_dont_know_btn", "Don't know")}</span>
                    <span class="review-next-info">${labels[0]}</span>
                </span>
            </button>

            <button class="review-rate-btn rate-yes" data-grade="2" type="button">
                <span class="rate-key-pair">
                    <kbd>→</kbd>
                    <kbd>D</kbd>
                </span>

                <span class="rate-copy">
                    <span class="rate-label">${t("review_know_btn", "Know")}</span>
                    <span class="review-next-info">${labels[1]}</span>
                </span>
            </button>
        </div>
    </div>

    <div class="review-shortcuts" aria-label="Review keyboard shortcuts">
        <span>
            <span class="shortcut-keys">
                <kbd>↑</kbd>
                <kbd>W</kbd>
            </span>
            ${t("review_shortcut_speak", "speak")}
        </span>

        <span>
            <span class="shortcut-keys">
                <kbd>↓</kbd>
                <kbd>S</kbd>
            </span>
            ${t("review_shortcut_flip", "flip")}
        </span>
    </div>

    <div class="review-actions-row">
        <button class="review-edit-btn" type="button">
            <span aria-hidden="true">✏️</span> ${t("words_edit", "Edit")}
        </button>

        <button class="review-delete-btn" type="button">
            <span aria-hidden="true">🗑</span> ${t("words_delete", "Delete")}
        </button>
    </div>
</div>
`;
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

function reviewScreenshotHtml(url) {
    if (!url) return "";
    const resolvedUrl =
        typeof SharedUtils !== "undefined" &&
        typeof SharedUtils.resolveImageUrl === "function"
            ? SharedUtils.resolveImageUrl(url)
            : url;
    return `
        <div class="review-screenshot">
            <div class="review-screenshot-box">
                <img src="${escapeAttr(resolvedUrl)}"
                     alt="Screenshot"
                     class="review-screenshot-img"
                     loading="eager">
            </div>
        </div>`;
}

function renderQuestion(w) {
    const card = getReviewCard();
    const srcL = w.srcLang || reviewLearningLang;
    const tgtL = w.tgtLang || reviewTargetLang;
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
    const isRedundant =
        typeof SharedUtils !== "undefined" &&
        typeof SharedUtils.isRedundantSentence === "function"
            ? SharedUtils.isRedundantSentence(showSentence, showWord)
            : showSentence &&
              showSentence.trim().toLowerCase() ===
                  showWord.trim().toLowerCase();
    const sentenceHtml =
        showSentence && !isRedundant
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
            qShotImg
                .closest(".review-screenshot-box")
                ?.classList.add("is-loaded");
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
    const card = getReviewCard();
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
/** Swipe the current card off-screen (like a real flashcard being tossed
 * left/right) before applying the grade and loading the next card. */
function animateSwipeAndRate(grade) {
    const card = getReviewCard();
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

function renderAnswer(w) {
    const card = getReviewCard();
    const sr = w.sr || { step: 0, interval: 0 };
    const srcL = w.srcLang || reviewLearningLang;
    const tgtL = w.tgtLang || reviewTargetLang;
    const isReverse = reviewDirection === "reverse";

    // In reverse mode: question=translated, answer=original
    const aWord = isReverse ? w.original : w.translated;
    const aLang = isReverse ? srcL : tgtL;
    const aSentence = isReverse ? w.sentence || "" : w.sentenceTranslated || "";
    const isRedundantA =
        typeof SharedUtils !== "undefined" &&
        typeof SharedUtils.isRedundantSentence === "function"
            ? SharedUtils.isRedundantSentence(aSentence, aWord)
            : aSentence &&
              aSentence.trim().toLowerCase() === aWord.trim().toLowerCase();
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
                    )}" data-lang="${escapeAttr(aLang)}" ${forceBrowserAttr} ${cacheAttrs} title="Listen">${SPEAK_SVG}</button>
                </div>
                ${
                    aSentence && !isRedundantA
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
            shotImg
                .closest(".review-screenshot-box")
                ?.classList.add("is-loaded");
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
    const card = getReviewCard();
    card.innerHTML = `
        <div class="review-edit-form">
            <label>Original</label>
            <input type="text" id="editOriginal" value="${escapeAttr(w.original)}">
            <label>Translation</label>
            <input type="text" id="editTranslated" value="${escapeAttr(w.translated)}">
            <label>Context sentence (original)</label>
            <input type="text" id="editSentence" value="${escapeAttr(w.sentence || "")}">
            <label>Context sentence (translation)</label>
            <input type="text" id="editSentenceTr" value="${escapeAttr(w.sentenceTranslated || "")}">
            <div class="review-edit-actions">
                <button class="review-edit-cancel" id="editCancel">Cancel</button>
                <button class="review-edit-save" id="editSave">💾 Save</button>
            </div>
        </div>`;

    document.getElementById("editCancel").addEventListener("click", () => {
        returnToAnswer ? renderAnswer(w) : renderQuestion(w);
    });

    document.getElementById("editSave").addEventListener("click", () => {
        const clean =
            typeof SharedUtils !== "undefined" &&
            typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (s) => String(s || "").trim();

        const newOriginal = clean(
            document.getElementById("editOriginal").value,
        );
        const newTranslated = clean(
            document.getElementById("editTranslated").value,
        );
        const newSentence = clean(
            document.getElementById("editSentence").value,
        );
        const newSentenceTr = clean(
            document.getElementById("editSentenceTr").value,
        );
        if (!newOriginal || !newTranslated) return;

        // Keep old keys for finding in storage
        const oldOriginal = w.original;
        const oldTranslated = w.translated;

        const isRedundantOrig =
            typeof SharedUtils !== "undefined" &&
            typeof SharedUtils.isRedundantSentence === "function"
                ? SharedUtils.isRedundantSentence(newSentence, newOriginal)
                : newSentence &&
                  newSentence.trim().toLowerCase() ===
                      newOriginal.trim().toLowerCase();
        const finalSentence = isRedundantOrig ? "" : newSentence;
        const finalSentenceTr = isRedundantOrig ? "" : newSentenceTr;

        // Update queue object in-place
        w.original = newOriginal;
        w.translated = newTranslated;
        w.sentence = finalSentence;
        w.sentenceTranslated = finalSentenceTr;
        const editedAt = Date.now();
        w.ttsCacheInvalidatedAt = editedAt;

        // Persist to storage (updates word list too and enqueues sync)
        const updatePayload = {
            original: newOriginal,
            translated: newTranslated,
            sentence: finalSentence,
            sentenceTranslated: finalSentenceTr,
            updatedAt: editedAt,
            ttsCacheInvalidatedAt: editedAt,
        };

        const onDone = () => {
            returnToAnswer ? renderAnswer(w) : renderQuestion(w);
        };

        SharedWordRepository.updateWord(
            (candidate) =>
                w.id
                    ? candidate.id === w.id
                    : (candidate.original === oldOriginal &&
                          candidate.translated === oldTranslated) ||
                      (candidate.original === oldOriginal &&
                          candidate.timestamp === w.timestamp),
            (existing) => ({
                ...existing,
                ...updatePayload,
                id:
                    existing.id ||
                    w.id ||
                    SharedUtils?.generateId?.() ||
                    String(editedAt),
            }),
        )
            .then((updated) => {
                if (updated?.id) w.id = updated.id;
                onDone();
            })
            .catch((err) => {
                console.error(
                    "[Lectoro] Failed to save review edits:",
                    err,
                );
                onDone();
            });
    });

    // Focus first field
    document.getElementById("editOriginal").focus();
}

// ── Rate word & update storage ────────────────────────────────────
async function rateWord(grade) {
    // Stop voice playback
    stopPopupSpeak();

    const w = reviewQueue[reviewIndex];
    if (!w) return;

    // Ensure card has SRS metadata
    ensureSR(w);

    _reviewSaving = true;

    try {
        const updated = await SharedWordRepository.recordReviewRating(
            w,
            grade,
        );
        if (updated?.sr) {
            w.sr = updated.sr;
        } else {
            w.sr = srUpdate(w.sr, grade);
        }
    } catch (err) {
        console.error("[Lectoro] Failed to save review:", err);
    } finally {
        _reviewSaving = false;
        reviewIndex++;
        reviewAnswerShown = false;
        renderReview();
    }
}
