// ═══════════════════════════════════════════════════════════════════
//  SPACED REPETITION  –  see shared/srs.js for the Anki SM-2 algorithm
// ═══════════════════════════════════════════════════════════════════
const {
    update: srUpdate,
    previewLabel,
    formatIntervalDays,
    formatIntervalMinutes,
    ensure: ensureSR,
} = SRS; // shared/srs.js

// ── Review state ──────────────────────────────────────────────────
let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswerShown = false;
let reviewTotalDue = 0;
let _reviewSaving = false; // guard: skip storage listener while rating
let _reviewQueueStale = false; // set when a background sync happens mid-session

// ── Review direction: "normal" = show original, guess translation
//                      "reverse" = show translation, guess original
let reviewDirection = "normal";
let ttsMode = "browser";
let reviewElVoiceId = "";
let reviewElVoices = [];
let reviewVoiceProfile = null;
let reviewVoicesLoading = false;

// Load the saved review direction and voice setting.
chrome.storage.local.get(
    { reviewDirection: "normal", ttsMode: "browser", elVoiceId: "" },
    (data) => {
        reviewDirection = data.reviewDirection;
        ttsMode = data.ttsMode;
        reviewElVoiceId = data.elVoiceId;
        updateDirBtnLabel();
        void updateReviewVoiceUI();
    },
);

// ── Direction toggle button ───────────────────────────────────────
function updateDirBtnLabel() {
    const btn = document.getElementById("reviewDirBtn");
    if (!btn) return;
    if (reviewDirection === "normal") {
        btn.innerHTML = 'EN <span class="dir-arrow">→</span> PL';
    } else {
        btn.innerHTML = 'PL <span class="dir-arrow">→</span> EN';
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

// ── Random Voice toggle button ────────────────────────────────────
// Compact voice picker for the review workflow.
function setReviewVoiceStatus(message = "", type = "") {
    const status = document.getElementById("reviewVoiceStatus");
    if (!status) return;
    status.textContent = message;
    status.className = `review-voice-status${type ? ` ${type}` : ""}`;
}

async function reportReviewVoiceFailure(error) {
    const useSystemVoice = [
        "ELEVENLABS_PROVIDER_DISABLED",
        "ELEVENLABS_PROVIDER_QUOTA",
        "ELEVENLABS_REQUEST_FAILED",
        "ELEVENLABS_MONTHLY_LIMIT_REACHED",
    ].includes(error?.code);
    if (useSystemVoice) {
        ttsMode = "browser";
        await chrome.storage.local.set({ ttsMode });
        if (reviewElVoices.length) renderElevenLabsVoiceSelect();
        syncReviewVoiceButton();
    }
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
    const preferredKeys = ["age", "language", "accent", "use_case", "gender", "description"];
    return preferredKeys
        .map((key) => voice?.labels?.[key])
        .filter(Boolean)
        .slice(0, 4)
        .join(" · ");
}

function selectedReviewVoice() {
    return reviewElVoices.find((voice) => voice.voice_id === reviewElVoiceId) || null;
}

function syncReviewVoiceButton() {
    const btn = document.getElementById("reviewVoiceBtn");
    const label = document.getElementById("reviewVoiceBtnLabel");
    const badge = document.getElementById("reviewVoiceAiBadge");
    const systemOption = document.getElementById("reviewBrowserVoiceOption");
    if (!btn || !label || !badge) return;

    const enabled = !!reviewVoiceProfile &&
        SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs.enabled;
    const voice = selectedReviewVoice();
    const usingElevenLabs = enabled && ttsMode === "elevenlabs" && !!reviewElVoiceId;

    btn.classList.toggle("is-elevenlabs", usingElevenLabs);
    systemOption?.classList.toggle("active", !usingElevenLabs);
    badge.classList.toggle("is-locked", !enabled);
    badge.textContent = usingElevenLabs ? "EL" : "AI";
    label.textContent = usingElevenLabs
        ? reviewElVoiceId === "random"
            ? "Losowy"
            : voice?.name || "ElevenLabs"
        : "Głos";
    btn.title = usingElevenLabs
        ? `ElevenLabs: ${voice?.name || "losowy głos"}`
        : "Wybierz głos powtórek";
}

function renderFreeVoiceTeaser() {
    const content = document.getElementById("reviewElevenLabsContent");
    if (!content) return;
    content.innerHTML = `
        <div class="review-voice-teaser">
            <div class="review-voice-teaser-title"><span>Naturalne głosy AI</span><span>🔒</span></div>
            <p>Usłysz różne akcenty i wybierz lektora do swoich powtórek.</p>
            <div class="review-voice-chips" aria-hidden="true">
                <span class="review-voice-chip">Darian</span>
                <span class="review-voice-chip">Talia</span>
                <span class="review-voice-chip">Florence</span>
            </div>
            <button type="button" class="review-voice-upgrade" id="reviewVoiceUpgrade">Odblokuj głosy ElevenLabs</button>
        </div>`;
    content.querySelector("#reviewVoiceUpgrade")?.addEventListener("click", () => {
        closeReviewVoiceMenu();
        SubscriptionService.openPlans();
    });
}

function renderElevenLabsVoiceSelect() {
    const content = document.getElementById("reviewElevenLabsContent");
    if (!content) return;
    content.replaceChildren();

    const wrap = document.createElement("div");
    wrap.className = "review-voice-select-wrap";
    const select = document.createElement("select");
    select.id = "reviewElVoiceSelect";
    select.setAttribute("aria-label", "Głos ElevenLabs");

    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = "Wybierz głos…";
    placeholderOption.disabled = true;
    select.appendChild(placeholderOption);

    const randomOption = document.createElement("option");
    randomOption.value = "random";
    randomOption.textContent = "✦ Losowy głos przy każdej karcie";
    select.appendChild(randomOption);

    reviewElVoices.forEach((voice) => {
        const option = document.createElement("option");
        option.value = voice.voice_id;
        option.textContent = voice.name;
        select.appendChild(option);
    });

    if (ttsMode === "elevenlabs" && reviewElVoiceId &&
        (reviewElVoiceId === "random" || reviewElVoices.some((voice) => voice.voice_id === reviewElVoiceId))) {
        select.value = reviewElVoiceId;
    } else {
        select.value = "";
    }

    const meta = document.createElement("div");
    meta.className = "review-voice-meta";
    const updateMeta = () => {
        if (select.value === "random") {
            meta.textContent = "Inny naturalny głos przy każdej powtórce.";
            return;
        }
        const voice = reviewElVoices.find((item) => item.voice_id === select.value);
        meta.textContent = voice
            ? formatVoiceLabels(voice) || "Naturalny głos ElevenLabs"
            : "Wybierz lektora, aby włączyć ElevenLabs.";
    };
    updateMeta();

    select.addEventListener("change", async () => {
        reviewElVoiceId = select.value;
        ttsMode = "elevenlabs";
        await chrome.storage.local.set({
            ttsMode,
            elVoiceId: reviewElVoiceId,
        });
        updateMeta();
        syncReviewVoiceButton();
        setReviewVoiceStatus("✓ Głos ElevenLabs włączony.", "ok");
    });

    wrap.append(select, meta);
    content.appendChild(wrap);
}

async function loadReviewElevenLabsVoices() {
    if (reviewVoicesLoading || reviewElVoices.length) return;
    reviewVoicesLoading = true;
    setReviewVoiceStatus("Ładowanie głosów…");
    try {
        reviewElVoices = await SubscriptionService.getElevenLabsVoices();
        renderElevenLabsVoiceSelect();
        setReviewVoiceStatus(
            reviewElVoices.length ? `${reviewElVoices.length} głosów do wyboru` : "Brak dostępnych głosów.",
            reviewElVoices.length ? "" : "error",
        );
        syncReviewVoiceButton();
    } catch (error) {
        setReviewVoiceStatus(error.message || "Nie udało się pobrać głosów.", "error");
    } finally {
        reviewVoicesLoading = false;
    }
}

async function updateReviewVoiceUI() {
    try {
        reviewVoiceProfile = await SubscriptionService.effectiveProfile(false);
    } catch (error) {
        reviewVoiceProfile = null;
        setReviewVoiceStatus(error.message || "Nie udało się sprawdzić planu.", "error");
    }

    const enabled = !!reviewVoiceProfile &&
        SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs.enabled;
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

document.getElementById("reviewVoiceBtn")?.addEventListener("click", async () => {
    const menu = document.getElementById("reviewVoiceMenu");
    const btn = document.getElementById("reviewVoiceBtn");
    if (!menu || !btn) return;
    const willOpen = menu.hidden;
    menu.hidden = !willOpen;
    btn.setAttribute("aria-expanded", String(willOpen));
    if (!willOpen) return;

    await updateReviewVoiceUI();
    const enabled = !!reviewVoiceProfile &&
        SubscriptionConfig.getPlanLimits(reviewVoiceProfile.plan).elevenLabs.enabled;
    if (enabled) await loadReviewElevenLabsVoices();
});

document.getElementById("reviewVoiceClose")?.addEventListener("click", closeReviewVoiceMenu);

document.getElementById("reviewBrowserVoiceOption")?.addEventListener("click", async () => {
    ttsMode = "browser";
    await chrome.storage.local.set({ ttsMode });
    if (reviewElVoices.length) renderElevenLabsVoiceSelect();
    syncReviewVoiceButton();
    setReviewVoiceStatus("✓ Używasz głosu systemowego.", "ok");
});

document.addEventListener("click", (event) => {
    const picker = document.getElementById("reviewVoicePicker");
    if (picker && !picker.contains(event.target)) closeReviewVoiceMenu();
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
function loadReviewQueue() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
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
    loadReviewQueue();
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

// ── On popup open → load badge count ──────────────────────────────
function initReviewBadge() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = countDueWords(words, now);
        updateReviewTabBadge(dueCount);
    });
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
                <span><span class="shortcut-keys"><kbd>Enter</kbd></span> tłumacz AI</span>
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
    const sr = w.sr || { step: 0, interval: 0 };
    const sentenceHtml = showSentence
        ? `
                <div class="review-context-row">
                    <span class="review-context">"${SharedUtils.highlightWordInSentence(
                        showSentence,
                        showWord,
                        wordClass,
                    )}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(
                        showSentence,
                    )}" data-lang="${escapeAttr(showLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
        : "";
    card.innerHTML = `
            <div class="review-flashcard">
                <div class="review-question">
                    <div class="review-word-row">
                        <span class="review-word ${wordClass}">${escapeHtml(showWord)}</span>
                        <button class="review-speak-btn" data-text="${escapeAttr(
                            buildReviewSpeakText(showWord, showSentence),
                        )}" data-lang="${escapeAttr(showLang)}" title="Odczytaj">${SPEAK_SVG}</button>
                    </div>
                    ${sentenceHtml}
                    ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
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
    if (qShotImg && !qShotImg.complete) {
        qShotImg.addEventListener("load", scrollToTop, { once: true });
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
 * translation of the currently shown word + sentence via Gemini and shows it
 * inline, without flipping or rating the card. Independent of reveal state.
 */
async function aiTranslateReviewCard() {
    const card = document.getElementById("reviewCard");
    if (!card || reviewIndex >= reviewQueue.length) return;
    const w = reviewQueue[reviewIndex];
    if (!w) return;

    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";
    const qWord = isReverse ? w.translated : w.original;
    const qLang = isReverse ? tgtL : srcL;
    const qSentence = isReverse ? w.sentenceTranslated || "" : w.sentence || "";
    const aLang = isReverse ? srcL : tgtL;
    if (!qWord) return;

    const flashcard = card.querySelector(".review-flashcard");
    let panel = card.querySelector("#reviewAiTranslate");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "reviewAiTranslate";
        panel.className = "review-ai-translate";
        (flashcard || card).appendChild(panel);
    }
    panel.innerHTML = `<div class="review-ai-translate-loading"><span class="review-ai-spinner"></span>Tłumaczę (AI)…</div>`;

    try {
        const prompt = AIPrompts.standardTranslate(
            qWord,
            qSentence,
            qLang,
            aLang,
        );

        // Bezpieczne proxy – klucz Gemini API jest TYLKO na serwerze Firebase.
        if (typeof GeminiProxy === "undefined") {
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
            if (limitReached) {
                panel.remove();
            } else {
                panel.innerHTML = `<div class="review-ai-translate-error">${escapeHtml(aiErr.message)}</div>`;
            }
            return;
        }
        const wordTr = parsed.word_translation || "";
        const sentTr = parsed.sentence_translation || "";

        // Bail out silently if the user already moved to a different card
        // while the request was in flight.
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;

        panel.innerHTML = `
            <div class="review-ai-translate-label">Tłumaczenie AI</div>
            <div class="review-ai-translate-word">${escapeHtml(wordTr || "—")}</div>
            ${sentTr ? `<div class="review-ai-translate-sentence">"${escapeHtml(sentTr)}"</div>` : ""}
        `;

        // Read the AI translation aloud too, just like every other card
        // face — cuts off whatever was speaking before (question/answer
        // auto-speak) so the two don't overlap.
        const speakText = buildReviewSpeakText(wordTr, sentTr);
        if (speakText) {
            stopPopupSpeak();
            popupSpeak(speakText, aLang).catch(() => {});
        }
    } catch (err) {
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;
        panel.innerHTML = `<div class="review-ai-translate-error">Błąd AI: ${escapeHtml(err.message)}</div>`;
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
                    )}" data-lang="${escapeAttr(aLang)}" title="Odczytaj">${SPEAK_SVG}</button>
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
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(aSentence)}" data-lang="${escapeAttr(aLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
                        : ""
                }
                ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
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
    if (shotImg && !shotImg.complete) {
        shotImg.addEventListener("load", scrollToTop, { once: true });
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
        const newOriginal = document
            .getElementById("editOriginal")
            .value.trim();
        const newTranslated = document
            .getElementById("editTranslated")
            .value.trim();
        const newSentence = document
            .getElementById("editSentence")
            .value.trim();
        const newSentenceTr = document
            .getElementById("editSentenceTr")
            .value.trim();
        if (!newOriginal || !newTranslated) return;

        // Keep old keys for finding in storage
        const oldOriginal = w.original;
        const oldTranslated = w.translated;

        // Update queue object in-place
        w.original = newOriginal;
        w.translated = newTranslated;
        w.sentence = newSentence;
        w.sentenceTranslated = newSentenceTr;

        // Persist to storage (updates word list too)
        chrome.storage.local.get({ savedWords: [] }, (data) => {
            const words = data.savedWords || [];
            const idx = words.findIndex((x) => x.id === w.id);
            if (idx !== -1) {
                // Assign a stable id on first edit so this doc's identity in
                // Firestore never changes again, even though its content just did
                if (!words[idx].id) words[idx].id = SharedUtils.generateId();
                words[idx].original = newOriginal;
                words[idx].translated = newTranslated;
                words[idx].sentence = newSentence;
                words[idx].sentenceTranslated = newSentenceTr;
                words[idx].updatedAt = Date.now();
                w.id = words[idx].id;
                chrome.storage.local.set({ savedWords: words }, () => {
                    if (chrome.runtime.lastError) {
                        console.error(
                            "[Lectoro] Nie udało się zapisać edycji:",
                            chrome.runtime.lastError.message,
                        );
                    }
                    returnToAnswer ? renderAnswer(w) : renderQuestion(w);
                });
            } else {
                returnToAnswer ? renderAnswer(w) : renderQuestion(w);
            }
        });
    });

    // Focus first field
    document.getElementById("editOriginal").focus();
}

// ── Rate word & update storage ────────────────────────────────────
function rateWord(grade) {
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

    // Zapisujemy zmiany
    _reviewSaving = true;

    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];

        const idx = words.findIndex((x) => x.id === w.id);

        if (idx !== -1) {
            // Zapisz nowe dane SRS
            words[idx].sr = w.sr;
            words[idx].updatedAt = Date.now();

            chrome.storage.local.set({ savedWords: words }, () => {
                _reviewSaving = false;

                if (chrome.runtime.lastError) {
                    console.error(
                        "[Lectoro] Nie udało się zapisać powtórki:",
                        chrome.runtime.lastError.message,
                    );
                }

                // Karta jest zakończona.
                // NIE wkładamy jej ponownie do reviewQueue.
                reviewIndex++;

                reviewAnswerShown = false;

                renderReview();
            });
        } else {
            // Karta została usunięta w międzyczasie.
            _reviewSaving = false;

            reviewIndex++;
            reviewAnswerShown = false;

            renderReview();
        }
    });
}
