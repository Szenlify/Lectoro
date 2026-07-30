/**
 * Quick Translator – LookMovie2 Module
 * Subtitle word-level hover-to-translate and click-to-speak.
 * Uses elementsFromPoint and periodic re-processing for video.js cues.
 *
 * Depends on: core.js (window.QT)
 */
(() => {
    "use strict";
    if (!window.location.hostname.includes("lookmovie")) return;

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
        findWordAtPoint,
        addDismissHandler,
        pauseVideo,
        resumeVideo,
    } = QT;

    // ── Shared instances ───────────────────────────────────────────
    const cache = createTranslateCache();
    const buffer = createSubtitleBuffer();
    const hint = createHint(`${PREFIX}lm-sub-hint`);

    const WORD_CLASS = `${PREFIX}lm-word`;
    const LOG = "[Quick Translator – LM CC]";

    // ── State ──────────────────────────────────────────────────────
    let hoverTimer = null;
    let isHovering = false;
    let wasPlayingBeforeHover = false;
    let clickLocked = false;
    let clickWasPlaying = false;
    let lastHoveredWord = null;

    // ── Dismiss ────────────────────────────────────────────────────
    function dismiss() {
        if (!clickLocked) return;
        clickLocked = false;
        hideTooltip();
        if (clickWasPlaying) {
            clickWasPlaying = false;
            resumeVideo();
        }
    }
    addDismissHandler(dismiss);

    // ── Hover handler ──────────────────────────────────────────────
    async function handleWordEnter(wordSpan) {
        if (clickLocked) return;
        isHovering = true;
        clearTimeout(hoverTimer);

        if (pauseVideo()) wasPlayingBeforeHover = true;

        const word = wordSpan.textContent.trim();
        if (!word) return;

        const wordRect = wordSpan.getBoundingClientRect();
        const container = wordSpan.closest(".vjs-text-track-display") || wordSpan.closest(".vjs-text-track-cue") || wordSpan.parentElement;
        const containerRect = container ? container.getBoundingClientRect() : wordRect;

        let isBottomLine = false;
        if (container) {
            const allSpans = container.querySelectorAll(`.${WORD_CLASS}`);
            if (allSpans.length > 0) {
                let minTop = Infinity;
                allSpans.forEach(s => {
                    const t = s.getBoundingClientRect().top;
                    if (t < minTop) minTop = t;
                });
                if (wordRect.top > minTop + 10) isBottomLine = true;
            }
        }
        const preferredPosition = isBottomLine ? "bottom" : "top";

        const rect = {
            left: wordRect.left,
            width: wordRect.width,
            top: containerRect.top,
            bottom: containerRect.bottom,
            right: wordRect.right,
            height: containerRect.height
        };

        hoverTimer = setTimeout(async () => {
            if (!isHovering) return;
            showLoading(rect, preferredPosition);

            try {
                const targetLang = await getTargetLang();
                const { translated, detectedLang } = await cache.get(
                    word,
                    targetLang,
                );
                const srcLang =
                    typeof detectedLang === "string" ? detectedLang : "auto";

                if (!isHovering) return;

                showTooltip(
                    buildTooltipHtml({
                        srcLang,
                        targetLang,
                        original: word,
                        translated,
                    }),
                    rect,
                    preferredPosition
                );
                attachTooltipHandlers();
                speak(word, srcLang);
            } catch (err) {
                console.error(LOG + " hover", err);
                showTooltip(
                    `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                    rect,
                    preferredPosition
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

    // ── Click handler ──────────────────────────────────────────────
    async function handleWordClick(wordSpan, e) {
        e.stopPropagation();
        e.stopImmediatePropagation();
        e.preventDefault();
        clearTimeout(hoverTimer);
        clickLocked = true;

        const word = wordSpan.textContent.trim();
        if (!word) return;

        if (pauseVideo()) clickWasPlaying = true;

        // Try sentence from buffer, fallback to visible cue
        let fullLine = buffer.extractSentence(word);
        if (!fullLine) {
            const cue = wordSpan.closest(".vjs-text-track-cue");
            if (cue) fullLine = cue.textContent.trim();
        }

        const wordRect = wordSpan.getBoundingClientRect();
        const container = wordSpan.closest(".vjs-text-track-display") || wordSpan.closest(".vjs-text-track-cue") || wordSpan.parentElement;
        const containerRect = container ? container.getBoundingClientRect() : wordRect;

        let isBottomLine = false;
        if (container) {
            const allSpans = container.querySelectorAll(`.${WORD_CLASS}`);
            if (allSpans.length > 0) {
                let minTop = Infinity;
                allSpans.forEach(s => {
                    const t = s.getBoundingClientRect().top;
                    if (t < minTop) minTop = t;
                });
                if (wordRect.top > minTop + 10) isBottomLine = true;
            }
        }
        const preferredPosition = isBottomLine ? "bottom" : "top";

        const rect = {
            left: wordRect.left,
            width: wordRect.width,
            top: containerRect.top,
            bottom: containerRect.bottom,
            right: wordRect.right,
            height: containerRect.height
        };

        try {
            const targetLang = await getTargetLang();
            const { translated: wordTranslated, detectedLang } =
                await cache.get(word, targetLang);
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";

            speak(word, srcLang);
            showLoading(rect, preferredPosition);

            let fullTranslated = null;
            const showFullLine = fullLine && fullLine !== word;
            if (showFullLine)
                fullTranslated = (await cache.get(fullLine, targetLang))
                    .translated;

            showTooltip(
                buildTooltipHtml({
                    srcLang,
                    targetLang,
                    original: word,
                    translated: wordTranslated,
                    fullLine: showFullLine ? fullLine : null,
                    fullTranslated,
                }),
                rect,
                preferredPosition
            );
            attachTooltipHandlers();
        } catch (err) {
            console.error(LOG + " click", err);
            showTooltip(
                `<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`,
                rect,
            );
        }
    }

    // ── Make subtitle cue div interactive ──────────────────────────
    function makeClickable(el) {
        if (el.dataset[PREFIX + "lmBound"]) return;
        if (el.classList.contains(WORD_CLASS)) return;
        if (!el.textContent.trim()) return;
        if (el.querySelector(`div:not(.${WORD_CLASS})`)) return;

        el.dataset[PREFIX + "lmBound"] = "1";
        splitIntoWordSpans(el, WORD_CLASS);
    }

    // ── Document-level event delegation via elementsFromPoint ──────

    document.addEventListener(
        "mousemove",
        (e) => {
            if (!document.querySelector(".vjs-text-track-display")) return;

            const wordSpan = findWordAtPoint(e.clientX, e.clientY, WORD_CLASS);

            if (wordSpan && wordSpan !== lastHoveredWord) {
                if (lastHoveredWord)
                    lastHoveredWord.classList.remove(`${PREFIX}lm-word-hover`);
                lastHoveredWord = wordSpan;
                wordSpan.classList.add(`${PREFIX}lm-word-hover`);
                handleWordEnter(wordSpan);
            } else if (!wordSpan && lastHoveredWord) {
                lastHoveredWord.classList.remove(`${PREFIX}lm-word-hover`);
                lastHoveredWord = null;
                handleWordLeave();
            }
        },
        true,
    );

    document.addEventListener(
        "click",
        (e) => {
            const wordSpan = findWordAtPoint(e.clientX, e.clientY, WORD_CLASS);
            if (wordSpan) handleWordClick(wordSpan, e);
        },
        true,
    );

    // Block video play/pause when clicking subtitle words
    for (const evt of ["mousedown", "mouseup", "pointerdown", "pointerup"]) {
        document.addEventListener(
            evt,
            (e) => {
                if (findWordAtPoint(e.clientX, e.clientY, WORD_CLASS)) {
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    e.preventDefault();
                }
            },
            true,
        );
    }

    // ── DOM observer ───────────────────────────────────────────────
    function processSubtitles() {
        document.querySelectorAll(".vjs-text-track-cue div").forEach((div) => {
            if (div.textContent.trim() && !div.querySelector("div")) {
                buffer.append(div.textContent);
                makeClickable(div);
            }
        });
    }

    function observeSubtitles() {
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;

                    if (
                        node.closest?.(".vjs-text-track-cue") ||
                        node.classList?.contains("vjs-text-track-cue")
                    ) {
                        const divs =
                            node.tagName === "DIV"
                                ? [node]
                                : node.querySelectorAll("div");
                        divs.forEach((div) => {
                            if (
                                div.textContent.trim() &&
                                !div.querySelector("div")
                            ) {
                                buffer.append(div.textContent);
                                makeClickable(div);
                            }
                        });
                    }
                }

                // Handle characterData changes (text updates within cues)
                if (m.type === "characterData") {
                    const cueDiv = m.target.parentElement?.closest?.(
                        ".vjs-text-track-cue div",
                    );
                    if (cueDiv && !cueDiv.querySelector("div")) {
                        cueDiv.dataset[PREFIX + "lmBound"] = "";
                        buffer.append(cueDiv.textContent);
                        makeClickable(cueDiv);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        processSubtitles();

        // Periodic re-process (cues can be replaced without mutation events)
        setInterval(processSubtitles, 500);
    }

    // ── Video Speed Control ────────────────────────────────────────
    function initVideoSpeedControl() {
        // UI for speed
        const speedOverlay = document.createElement("div");
        speedOverlay.style.position = "fixed";
        speedOverlay.style.top = "40px";
        speedOverlay.style.right = "40px";
        speedOverlay.style.background = "rgba(0, 0, 0, 0.8)";
        speedOverlay.style.color = "#fff";
        speedOverlay.style.padding = "10px 16px";
        speedOverlay.style.borderRadius = "8px";
        speedOverlay.style.fontFamily = "sans-serif";
        speedOverlay.style.fontSize = "16px";
        speedOverlay.style.fontWeight = "bold";
        speedOverlay.style.zIndex = "2147483647";
        speedOverlay.style.opacity = "0";
        speedOverlay.style.transition = "opacity 0.2s ease";
        speedOverlay.style.pointerEvents = "none";

        // Append to overlay parent or body
        document.body.appendChild(speedOverlay);

        let hideTimer = null;
        function showSpeed(speed) {
            const parent = QT.getOverlayParent ? QT.getOverlayParent() : document.body;
            if (speedOverlay.parentElement !== parent) {
                parent.appendChild(speedOverlay);
            }
            speedOverlay.textContent = `Prędkość: ${speed.toFixed(2)}x`;
            speedOverlay.style.opacity = "1";
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                speedOverlay.style.opacity = "0";
            }, 2000);
        }

        document.addEventListener("keydown", (e) => {
            // Ignore if typing in input
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

            if (e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}") {
                const video = document.querySelector("video");
                if (!video) return;

                let currentRate = video.playbackRate;
                if (e.key === "[" || e.key === "{") {
                    currentRate = Math.max(0.75, currentRate - 0.05);
                } else if (e.key === "]" || e.key === "}") {
                    currentRate = Math.min(1.0, currentRate + 0.05);
                }

                // round to 2 decimals
                currentRate = Math.round(currentRate * 100) / 100;
                video.playbackRate = currentRate;
                showSpeed(currentRate);
            }
        }, true);
    }

    function initAiExplainControl() {
        document.addEventListener("keydown", async (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
            if (e.key.toLowerCase() === "q") {
                const container = document.querySelector(".vjs-text-track-display");
                let text = "";
                if (container) text = container.textContent.trim();

                if (!text) return;

                pauseVideo();

                let minLeft = Infinity, minTop = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
                const wordSpans = container ? container.querySelectorAll(`.${WORD_CLASS}`) : [];
                wordSpans.forEach(span => {
                    const r = span.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return;
                    if (r.left < minLeft) minLeft = r.left;
                    if (r.top < minTop) minTop = r.top;
                    if (r.right > maxRight) maxRight = r.right;
                    if (r.bottom > maxBottom) maxBottom = r.bottom;
                });

                let rect;
                if (minTop !== Infinity) {
                    rect = {
                        left: minLeft, width: maxRight - minLeft, right: maxRight,
                        top: minTop, bottom: maxBottom, height: maxBottom - minTop
                    };
                } else {
                    const containerRect = container ? container.getBoundingClientRect() : { left: window.innerWidth / 2 - 100, top: window.innerHeight - 150, width: 200, height: 50, right: window.innerWidth / 2 + 100, bottom: window.innerHeight - 100 };
                    rect = containerRect;
                }

                showLoading(rect, "top");

                try {
                    const targetLang = await getTargetLang();
                    const result = await QT.geminiExplainSentence(text, targetLang);
                    const html = `
                        <div class="${PREFIX}header">
                            <span>✨ Wyjaśnienie AI (Całe zdanie)</span>
                        </div>
                        <div class="${PREFIX}body">
                            <div class="${PREFIX}row" style="padding-top:8px;">
                                <span class="${PREFIX}label">ZDS</span>
                                <span class="${PREFIX}text ${PREFIX}original" style="font-size:14px;">${escapeHtml(text)}</span>
                            </div>
                            <div class="${PREFIX}row">
                                <span class="${PREFIX}label">TŁU</span>
                                <span class="${PREFIX}text ${PREFIX}translated" style="font-size:14px;">${escapeHtml(result.translation)}</span>
                            </div>
                            <div class="${PREFIX}ai-result" style="display:block; margin-top:10px; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">
                                <div class="${PREFIX}ai-label">📖 Wyjaśnienie:</div>
                                <div class="${PREFIX}ai-text" style="color:#ddd; font-size:13px; line-height:1.4;">${escapeHtml(result.explanation)}</div>
                            </div>
                        </div>`;
                    showTooltip(html, rect, "top");
                } catch (err) {
                    showTooltip(`<div class="${PREFIX}error">⚠ ${escapeHtml(err.message)}</div>`, rect, "top");
                }
            }
        }, true);
    }

    // ── Init ───────────────────────────────────────────────────────
    function init() {
        observeSubtitles();
        initVideoSpeedControl();
        initAiExplainControl();
        hint.show(
            "Najedź na słowo w napisach = tłumaczenie · Kliknij = wymów + całe zdanie ✨ [ / ] = prędkość wideo",
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
