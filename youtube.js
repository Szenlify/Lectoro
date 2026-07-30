/**
 * Quick Translator – YouTube Module (Smart & Integrated Edition)
 * Works directly with core.js (window.QT)
 */
(() => {
    "use strict";
    if (!location.hostname.includes("youtube.com")) return;

    const {
        PREFIX,
        showTooltip,
        hideTooltip,
        showLoading,
        speak,
        getTargetLang,
        escapeHtml,
        buildTooltipHtml,
        attachTooltipHandlers,
        createTranslateCache,
        createSubtitleBuffer,
        splitIntoWordSpans,
        createHint,
        addDismissHandler,
        pauseVideo,
        resumeVideo,
        geminiExplainSentence,
    } = QT;

    // ── Internal State ──────────────────────────────────────────────
    const cache = createTranslateCache();
    const buffer = createSubtitleBuffer();
    const hint = createHint(`${PREFIX}yt-sub-hint`);
    const WORD_CLASS = `${PREFIX}yt-word`;
    const LOG = "[Lectoro]";

    let hoverTimer = null,
        isHovering = false,
        wasPlayingBeforeHover = false;
    let clickLocked = false,
        clickWasPlaying = false;

    // AI Explain State
    let aiTooltipActive = false;
    let aiWasPlaying = false;

    // Reels Mode State
    let reelsMode = false,
        reelsContainer = null,
        reelsBigWord = null;
    let reelsPrevText = "",
        reelsPollTimer = null,
        reelsFadeTimer = null;
    let reelsClickLocked = false,
        reelsWasPlaying = false;

    // ── Helper Utilities ────────────────────────────────────────────
    const isEditing = (el) =>
        ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName) ||
        el?.isContentEditable;
    const isYTUIText = (txt) =>
        /\(auto-generated\)|Click for settings|\bsubtitles?\/CC\b/i.test(txt);
    const getPlayer = () =>
        document.querySelector("#movie_player, .html5-video-player");

    function getElementRect(el) {
        if (!el)
            return {
                left: innerWidth / 2 - 100,
                top: innerHeight - 150,
                width: 200,
                height: 50,
            };
        const r = el.getBoundingClientRect();
        return {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
        };
    }

    // ── AI Explanation (Enter key) ──────────────────────────────────
    function closeAiTooltip() {
        if (!aiTooltipActive) return;
        aiTooltipActive = false;
        hideTooltip();
        if (aiWasPlaying) {
            aiWasPlaying = false;
            resumeVideo();
        }
    }

async function handleAIExplain() {
        // Jeśli chmurka AI już jest aktywna, drugie naciśnięcie Enter ją zamyka i wznawia wideo
        if (aiTooltipActive) {
            closeAiTooltip();
            return;
        }

        let text = "";
        let targetEl = null;

        if (reelsMode && reelsBigWord) {
            text = reelsBigWord.textContent.trim();
            targetEl = reelsBigWord;
        } else {
            const container = document.querySelector(".ytp-caption-window-container");
            // Pobieramy element bezpośrednio otaczający napisy (czarne tło)
            const captionWindow = document.querySelector(".caption-window");
            
            if (container) {
                text = container.textContent.trim();
                // Jeśli znajdziemy captionWindow, używamy go do pozycji. Jeśli nie - fallback na container
                targetEl = captionWindow || container; 
            }
        }

        if (!text) return;

        aiTooltipActive = true;
        if (pauseVideo()) aiWasPlaying = true;

        const rect = getElementRect(targetEl);
        showLoading(rect, "top");

        try {
            const targetLang = await getTargetLang();
            const res = await geminiExplainSentence(text, targetLang);

            // Jeśli użytkownik zamknął okienko w trakcie ładowania, przerywamy
            if (!aiTooltipActive) return;

            // Zmieniono kolejność: TŁU (Tłumaczenie) jest teraz NAD ZDS (Zdaniem oryginalnym)
            const html = `
                <div class="${PREFIX}header"><span>✨ AI</span></div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">EN</span>
                        <span class="${PREFIX}text ${PREFIX}original">${escapeHtml(text)}</span>
                    </div>
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">PL</span>
                        <span class="${PREFIX}text ${PREFIX}translated" >${escapeHtml(res.translation || "")}</span>
                    </div>
                    
                    <div class="${PREFIX}ai-result">
                        <div class="${PREFIX}ai-label">Wyjaśnienie:</div>
                        <div class="${PREFIX}ai-text">${escapeHtml(res.explanation || res)}</div>
                    </div>
                </div>`;

            // Pokazujemy chmurkę używając rect z dokładnego tła napisów
            showTooltip(html, rect, "top");
            attachTooltipHandlers();
        } catch (err) {
            console.error(LOG, "Gemini Error:", err);
            if (aiTooltipActive) {
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
                    "top",
                );
            }
        }
    }

    // ── Single Keyboard Dispatcher (Capturing Mode) ────────────────
    window.addEventListener(
        "keydown",
        (e) => {
            if (isEditing(e.target) || e.ctrlKey || e.altKey || e.metaKey)
                return;

            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                handleAIExplain();
                return;
            }

            const key = e.key.toLowerCase();
            if (key === "r") {
                setReelsMode(!reelsMode);
                return;
            }
            if (key === "u") {
                return;
            }

            if (reelsMode && ["s", "arrowdown", "e"].includes(key)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                reelsClickLocked
                    ? reelsDismiss()
                    : translateWord(
                          reelsBigWord?.textContent.trim(),
                          reelsBigWord,
                          true,
                      );
            }
        },
        true,
    );

    // ── Universal Word Translation Logic ──────────────────────────
    async function translateWord(rawWord, targetEl, isReels = false) {
        if (!rawWord) return;
        const cleanWord =
            rawWord.replace(/[.,!?;:"""''()[\]{}]/g, "").trim() || rawWord;
        const rect = getElementRect(targetEl);

        if (isReels) {
            reelsClickLocked = true;
            if (pauseVideo()) reelsWasPlaying = true;
            stopReelsPoll();
        }

        showLoading(rect);
        try {
            const targetLang = await getTargetLang();
            const { translated, detectedLang } = await cache.get(
                cleanWord,
                targetLang,
            );
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";

            speak(translated, targetLang);
            showTooltip(
                buildTooltipHtml({
                    srcLang,
                    targetLang,
                    original: cleanWord,
                    translated,
                }),
                rect,
            );
            attachTooltipHandlers();
        } catch (err) {
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
            );
        }
    }

    // ── Reels Mode Component ────────────────────────────────────────
    function createReelsOverlay() {
        if (reelsContainer) return;
        reelsContainer = document.createElement("div");
        reelsContainer.id = `${PREFIX}reels-container`;
        reelsContainer.className = `${PREFIX}reels-container`;

        reelsBigWord = document.createElement("div");
        reelsBigWord.className = `${PREFIX}reels-bigword`;
        reelsContainer.appendChild(reelsBigWord);

        ["mousedown", "mouseup", "click"].forEach((evt) => {
            reelsBigWord.addEventListener(evt, (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (evt === "click") {
                    getSelection()?.removeAllRanges();
                    reelsClickLocked
                        ? reelsDismiss()
                        : translateWord(
                              reelsBigWord.textContent.trim(),
                              reelsBigWord,
                              true,
                          );
                }
            });
        });

        (getPlayer() || document.body).appendChild(reelsContainer);
    }

    function reelsDismiss() {
        if (!reelsClickLocked) return;
        reelsClickLocked = false;
        hideTooltip();
        window.speechSynthesis?.cancel();
        if (reelsWasPlaying) {
            reelsWasPlaying = false;
            resumeVideo();
        }
        startReelsPoll();
    }

    function readCaptionText() {
        return Array.from(
            document.querySelectorAll(
                ".ytp-caption-window-container .ytp-caption-segment",
            ),
        )
            .map((s) => s.textContent.trim())
            .filter((t) => t && !isYTUIText(t))
            .join(" ");
    }

    function reelsPoll() {
        if (!reelsMode) return;
        const text = readCaptionText();
        if (!text) {
            reelsContainer?.classList.remove("visible");
            reelsPrevText = "";
            return;
        }
        if (text === reelsPrevText) return;

        const words = text.split(/\s+/).filter(Boolean);
        const word = words[words.length - 1] || "";
        reelsPrevText = text;

        if (!reelsContainer) createReelsOverlay();
        if (reelsClickLocked) return;

        reelsBigWord.textContent = word;
        reelsBigWord.classList.remove(`${PREFIX}reels-pop`);
        void reelsBigWord.offsetWidth;
        reelsBigWord.classList.add(`${PREFIX}reels-pop`);
        reelsContainer.classList.add("visible");

        clearTimeout(reelsFadeTimer);
        reelsFadeTimer = setTimeout(
            () => reelsContainer?.classList.remove("visible"),
            4000,
        );
    }

    const startReelsPoll = () => {
        stopReelsPoll();
        reelsPollTimer = setInterval(reelsPoll, 120);
    };
    const stopReelsPoll = () => {
        clearInterval(reelsPollTimer);
        reelsPollTimer = null;
    };

    function setReelsMode(on) {
        reelsMode = on;
        if (on) {
            createReelsOverlay();
            document.body.classList.add(`${PREFIX}reels-active`);
            startReelsPoll();
            hint.show("Reels ON 🎬 Enter = Wyjaśnienie AI", 3000);
        } else {
            stopReelsPoll();
            if (reelsClickLocked) reelsDismiss();
            reelsContainer?.remove();
            reelsContainer = reelsBigWord = null;
            document.body.classList.remove(`${PREFIX}reels-active`);
            reelsPrevText = "";
            hint.show("Reels OFF – normalne napisy", 2500);
        }
    }

    // ── Standard Subtitle Hover / Click Handlers ───────────────────
    function handleWordHover(wordSpan) {
        if (reelsMode || clickLocked) return;
        isHovering = true;
        clearTimeout(hoverTimer);
        if (pauseVideo()) wasPlayingBeforeHover = true;

        const word = wordSpan.textContent.trim();
        const rect = getElementRect(wordSpan);

        hoverTimer = setTimeout(async () => {
            if (!isHovering) return;
            showLoading(rect);
            try {
                const targetLang = await getTargetLang();
                const { translated, detectedLang } = await cache.get(
                    word,
                    targetLang,
                );
                if (!isHovering) return;
                showTooltip(
                    buildTooltipHtml({
                        srcLang: detectedLang || "auto",
                        targetLang,
                        original: word,
                        translated,
                    }),
                    rect,
                );
                attachTooltipHandlers();
                speak(word, detectedLang || "auto");
            } catch (err) {
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
                );
            }
        }, 250);
    }

    function handleWordLeave() {
        isHovering = false;
        clearTimeout(hoverTimer);
        if (clickLocked) return;
        setTimeout(() => {
            if (
                !isHovering &&
                !clickLocked &&
                !QT.getTooltipEl()?.matches(":hover")
            ) {
                hideTooltip();
                if (wasPlayingBeforeHover) {
                    wasPlayingBeforeHover = false;
                    resumeVideo();
                }
            }
        }, 400);
    }

    function makeSubtitleClickable(el) {
        if (el.dataset[PREFIX + "bound"]) return;
        el.dataset[PREFIX + "bound"] = "1";
        el.classList.add(`${PREFIX}clickable`);
        splitIntoWordSpans(el, WORD_CLASS);

        el.addEventListener("mouseover", (e) => {
            const w = e.target.closest(`.${WORD_CLASS}`);
            if (w) handleWordHover(w);
        });
        el.addEventListener("mouseleave", handleWordLeave);
        el.addEventListener("click", (e) => {
            const w = e.target.closest(`.${WORD_CLASS}`);
            if (w && !reelsMode) {
                e.stopPropagation();
                e.preventDefault();
                clearTimeout(hoverTimer);
                clickLocked = true;
                if (pauseVideo()) clickWasPlaying = true;
                translateWord(w.textContent.trim(), w);
            }
        });
    }

    // ── Dismiss Handlers & Mutation Observer ───────────────────────
    addDismissHandler(() => {
        if (clickLocked) {
            clickLocked = false;
            hideTooltip();
            if (clickWasPlaying) {
                clickWasPlaying = false;
                resumeVideo();
            }
        }
    });
    addDismissHandler(reelsDismiss);
    addDismissHandler(() => {
        aiTooltipActive = false;
    }); // Integracja z kliknięciami poza tooltipem

    function init() {
        const processSegs = () => {
            document
                .querySelectorAll(
                    ".ytp-caption-window-container .ytp-caption-segment",
                )
                .forEach((seg) => {
                    if (!isYTUIText(seg.textContent))
                        buffer.append(seg.textContent);
                    if (!reelsMode) makeSubtitleClickable(seg);
                });
        };

        new MutationObserver(processSegs).observe(document.body, {
            childList: true,
            subtree: true,
        });
        processSegs();
        setReelsMode(false);
    }

    document.readyState === "loading"
        ? document.addEventListener("DOMContentLoaded", init)
        : init();
})();
