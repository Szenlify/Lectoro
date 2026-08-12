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
let reviewRandomVoice = false;

// Load saved direction and random voice setting from storage
chrome.storage.sync.get({ reviewDirection: "normal", reviewRandomVoice: false, ttsMode: "browser" }, (data) => {
    reviewDirection = data.reviewDirection;
    reviewRandomVoice = data.reviewRandomVoice;
    ttsMode = data.ttsMode;
    updateDirBtnLabel();
    updateRandomVoiceBtnLabel();
    updateElevenLabsBtnLabel();
});

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
    chrome.storage.sync.set({ reviewDirection }, flashSaved);
    updateDirBtnLabel();
    // Restart current card without changing queue position
    reviewAnswerShown = false;
    renderReview();
});

// ── Random Voice toggle button ────────────────────────────────────
function updateRandomVoiceBtnLabel() {
    const btn = document.getElementById("reviewRandomVoiceBtn");
    if (!btn) return;
    if (reviewRandomVoice) {
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
    }
}

document.getElementById("reviewRandomVoiceBtn")?.addEventListener("click", () => {
    reviewRandomVoice = !reviewRandomVoice;
    chrome.storage.sync.set({ reviewRandomVoice }, flashSaved);
    updateRandomVoiceBtnLabel();
});

// ── ElevenLabs toggle button ──────────────────────────────────────
let ttsMode = "browser";

function updateElevenLabsBtnLabel() {
    const btn = document.getElementById("reviewElevenLabsBtn");
    if (!btn) return;
    if (ttsMode === "elevenlabs") {
        btn.classList.add("active");
    } else {
        btn.classList.remove("active");
    }
}

document.getElementById("reviewElevenLabsBtn")?.addEventListener("click", () => {
    const newMode = ttsMode === "elevenlabs" ? "browser" : "elevenlabs";
    // Symulacja kliknięcia w główny przycisk w ustawieniach
    const settingsBtn = document.getElementById(newMode === "elevenlabs" ? "modeEL" : "modeBrowser");
    if (settingsBtn) settingsBtn.click();
    
    ttsMode = newMode;
    updateElevenLabsBtnLabel();
});

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

// ── Question (front) side ──────────────────────────────────────────
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
            <button class="review-reveal-btn" id="revealBtn">▸ Pokaż odpowiedź</button>
            <div class="review-hint"><kbd>↓</kbd>/<kbd>S</kbd> odwróć &nbsp; <kbd>↑</kbd>/<kbd>W</kbd> czytaj &nbsp; <kbd>←</kbd>/<kbd>A</kbd> nie znam &nbsp; <kbd>→</kbd>/<kbd>D</kbd> znam &nbsp; <kbd>Enter</kbd> tłumacz AI</div>`;

    attachReviewSpeakHandlers(card);
    autoSpeakReviewCard(w, false);
    document.getElementById("revealBtn").addEventListener("click", flipCard);

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
    const rating = card?.querySelector(".review-rating");
    const actions = card?.querySelector(".review-actions-row");

    if (flashcard) {
        flashcard.classList.add(
            grade === 1 ? "qt-swipe-left" : "qt-swipe-right",
        );
        rating?.classList.add("qt-fade-out");
        actions?.classList.add("qt-fade-out");
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

    const { geminiApiKey } = await new Promise((r) =>
        chrome.storage.sync.get({ geminiApiKey: "" }, r),
    );
    if (!geminiApiKey) {
        panel.innerHTML = `<div class="review-ai-translate-error">Ustaw klucz Gemini API w zakładce ⚙️ Ustawienia.</div>`;
        return;
    }

    try {
        const prompt = AIPrompts.standardTranslate(
            qWord,
            qSentence,
            qLang,
            aLang,
        );
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 300,
                    },
                }),
            },
        );
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(
                errData?.error?.message || `Gemini HTTP ${res.status}`,
            );
        }
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
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

    // Preview labels for each grade (1 = Nie znam, 2 = Znam)
    const labels = [1, 2].map((g) => previewLabel(sr, g));

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
        <div class="review-rating">
            <div class="review-rating-label">Znałeś odpowiedź?</div>
            <div class="review-rating-buttons review-rating-buttons-2">
                <button class="review-rate-btn rate-no" data-grade="1" title="Nie znam (←)">
                    <span class="rate-key">←</span>
                    <span class="rate-label">Nie znam</span>
                    <span class="review-next-info">${labels[0]}</span>
                </button>
                <button class="review-rate-btn rate-yes" data-grade="2" title="Znam (→)">
                    <span class="rate-key">→</span>
                    <span class="rate-label">Znam</span>
                    <span class="review-next-info">${labels[1]}</span>
                </button>
            </div>
            <div class="review-hint"><kbd>←</kbd>/<kbd>A</kbd> nie znam &nbsp; <kbd>→</kbd>/<kbd>D</kbd> znam &nbsp; <kbd>↑</kbd>/<kbd>W</kbd> czytaj &nbsp; <kbd>↓</kbd>/<kbd>S</kbd> odwróć &nbsp; <kbd>Enter</kbd> tłumacz AI</div>
        </div>
        <div class="review-actions-row">
            <button class="review-edit-btn" id="reviewEditBtn">✏️ Edytuj</button>
            <button class="review-delete-btn" id="reviewDeleteBtn">🗑 Usuń</button>
        </div>`;

    // Attach TTS handlers
    attachReviewSpeakHandlers(card);
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

    // Attach rating handlers
    card.querySelectorAll(".review-rate-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            animateSwipeAndRate(parseInt(btn.dataset.grade));
        });
    });

    // Edit button
    document.getElementById("reviewEditBtn").addEventListener("click", () => {
        showReviewEditForm(w);
    });

    // Delete button
    document.getElementById("reviewDeleteBtn").addEventListener("click", () => {
        deleteReviewWord(w);
    });
}

// ── Edit form in review ───────────────────────────────────────────
function showReviewEditForm(w) {
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
        renderAnswer(w);
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
            const idx = words.findIndex(
                (x) =>
                    x.original === oldOriginal &&
                    x.translated === oldTranslated,
            );
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
                    renderAnswer(w);
                });
            } else {
                renderAnswer(w);
            }
        });
    });

    // Focus first field
    document.getElementById("editOriginal").focus();
}

// ── Rate word & update storage ────────────────────────────────────
function rateWord(grade) {
    stopPopupSpeak(); // cut off any card audio immediately, don't wait for the save round-trip
    const w = reviewQueue[reviewIndex];
    ensureSR(w);

    // Apply SR update
    w.sr = srUpdate(w.sr, grade);

    // Track session attempts per word (max 3 views, then move on)
    w._sessionAttempts = (w._sessionAttempts || 0) + 1;

    // Persist
    _reviewSaving = true;
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const idx = words.findIndex(
            (x) => x.original === w.original && x.translated === w.translated,
        );
        if (idx !== -1) {
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
                if (grade === 1 && w._sessionAttempts < 3) {
                    // Grade 1 (Again): re-insert word later in the queue
                    // so it comes back again in this session (max 3 attempts)
                    reviewQueue.splice(reviewIndex, 1);
                    // Insert a few cards later (or at end if queue is short)
                    const insertAt = Math.min(
                        reviewIndex + 2 + Math.floor(Math.random() * 3),
                        reviewQueue.length,
                    );
                    reviewQueue.splice(insertAt, 0, w);
                    // Don't increment reviewIndex – current index now has next word
                    reviewTotalDue = reviewQueue.length;
                } else {
                    // Grade 2 (Good) or max attempts reached: word is done, advance
                    reviewIndex++;
                }
                reviewAnswerShown = false;
                renderReview();
            });
        } else {
            // word may have been deleted – just advance
            _reviewSaving = false;
            reviewIndex++;
            reviewAnswerShown = false;
            renderReview();
        }
    });
}
