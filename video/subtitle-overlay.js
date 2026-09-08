/**
 * Lectoro – Universal Subtitle Engine & Overlay (Single Source of Truth)
 * Centralized responsive subtitle renderer, word-by-word tokenization, hover/click tooltips,
 * AI explanations, Word Cloud mode, in-place translations, and spaced-repetition review capture.
 */
(() => {
    "use strict";

    const C = LectoroConstants;
    const { PREFIX, isOwnUI } = C;
    const SVG = C.SVG_ICONS;
    const { cleanCardText, isRedundantSentence } = SharedUtils;
    const SUB_WORD_CLASS = C.UI_CLASSES.SUB_WORD;
    const WORD_CLOUD_CLASS = C.UI_CLASSES.WORD_CLOUD;
    const WORD_HOVER_CLASS = `${PREFIX}word-hover`;
    const WORD_CLOUD_HIGHLIGHT_CLASS = `${PREFIX}word-cloud-highlight`;
    const AI_EXPLAIN_OVERLAY_CLASS = `${PREFIX}ai-explain-overlay`;
    const TTS_QUOTE_CLASS = `${PREFIX}tts-original-quote`;
    const SAVE_TOAST_ID = C.UI_IDS.SAVE_TOAST;

    let quotaCountdownTimer = null;

    // Timing (ms)
    const TOOLTIP_CLOSE_DELAY_MS = 450;
    const HOVER_BRIDGE_DWELL_MS = 260;
    const HOVER_SWITCH_DELAY_MS = 200;
    const OVERLAY_REVEAL_MS = 260;
    const SPEED_OVERLAY_MS = 1400;
    const SAVE_TOAST_SAVING_MS = 2400;
    const SAVE_TOAST_SUCCESS_MS = 2800;
    const SAVE_TOAST_ERROR_MS = 2200;

    // Strips leading/trailing punctuation from a subtitle token before translation.
    const EDGE_PUNCTUATION_RE =
        /^[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}—–\-_/\\<>]+|[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}—–\-_/\\<>]+$/gu;
    const ANY_PUNCTUATION_RE =
        /[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}—–\-_/\\<>]/gu;

    // ── Universal Custom Subtitle Renderer State ─────────────────
    let customSubLayerEl = null;
    let customSubBoxEl = null;
    let currentSubPosition = C.DEFAULT_SUBTITLE_SETTINGS.POSITION;
    let currentSubBgOpacity = C.DEFAULT_SUBTITLE_SETTINGS.BG_OPACITY;
    let currentSubBottomPx = 0;
    let aiSubTranslationEl = null;
    let aiSubTranslationText = "";
    let subtitleTranslationLang = C.DEFAULT_READING_SETTINGS.targetLang;
    let activeLines = [];
    let activeText = "";
    let activeWordSpans = [];
    let trackedVideo = null;
    let activeAiVideo = null;
    let videoResizeObserver = null;
    let layoutRafId = null;
    const recentSubtitlesHistory = [];

    // ── Interaction State ─────────────────────────────────────────
    let subHoverTimer = null;
    let isSubHovering = false;
    let subWasPlaying = false;
    let subClickLocked = false;
    let lastHoveredSubWord = null;
    let subTooltipAnchor = null;
    let subCloseTimer = null;

    let aiTooltipActive = false;
    let aiExplainKeydownHandler = null;
    let aiExplainQueue = [];
    let aiExplainIndex = 0;
    let aiExplainSourceLang = "en";
    let aiExplainRequestId = 0;
    let aiExplainTargetLang = "pl";
    let aiExplainMode = "native";
    let aiExplainLayout = null;
    let aiExplainSpeechToken = 0;
    let aiAutoAdvanceTimer = null;
    let aiAutoAdvanceDisabled = false;
    const aiSavedIndices = new Set();
    const aiAiSavedIndices = new Set();

    let speedOverlayEl = null;
    let speedOverlayTimer = null;

    let eTranslateActive = false;
    let wordCloudActive = false;
    let wordCloudEls = [];
    let subtitleModeRevision = 0;
    let subtitleModeStarting = false;
    let subtitleResumeRevision = 0;
    let subtitleUiTrackingFrame = null;

    let translationOverlay = null;
    let translationAnchorLayout = null;

    let savingSentence = false;
    let saveToastEl = null;
    let saveToastHideTimer = null;
    let saveResumeTimer = null;
    let pausedForSave = false;
    let wasPlayingBeforeSave = false;

    function isNetflixPage() {
        return !!globalThis.LectoroPlayerRegistry?.isNetflixPage?.();
    }

    function getPlayerRegistry() {
        return globalThis.LectoroPlayerRegistry;
    }

    /** Pause `video` through the platform adapter when it is currently playing. */
    function pauseIfPlaying(video) {
        if (video && !video.paused) getPlayerRegistry()?.pauseVideo(video);
    }

    /** Clean token text of a rendered subtitle word span (punctuation-free). */
    function getSpanWord(span) {
        return (span.dataset.clean || span.textContent)
            .trim()
            .replace(EDGE_PUNCTUATION_RE, "")
            .trim();
    }

    function isSentenceOverlayOpen() {
        return (
            eTranslateActive ||
            wordCloudActive ||
            (translationOverlay?.isConnected ?? false)
        );
    }

    // ── Universal Custom Subtitle Layer (Single Source of Truth) ──

    function getPlatformName() {
        const hostname =
            (typeof window !== "undefined" && window.location?.hostname) || "";
        if (/(^|\.)youtube\.com$/i.test(hostname)) return "youtube";
        if (/(^|\.)netflix\.com$/i.test(hostname)) return "netflix";
        if (document.querySelector(".video-js")) return "videojs";
        if (/ted\.com$/i.test(hostname)) return "ted";
        const regType = getPlayerRegistry()?.type;
        if (regType) return regType;
        return "generic";
    }

    function findPlayerContainer(video) {
        if (!video) return null;

        // 1. YouTube player
        const yt = video.closest?.("#movie_player, .html5-video-player");
        if (yt) return yt;

        // 2. Netflix player
        const nf = video.closest?.(
            ".watch-video, [data-uia='video-canvas'], .nf-player-container",
        );
        if (nf) return nf;

        // 3. VideoJS / Plyr / JWPlayer / Generic HTML5
        const vjs = video.closest?.(
            ".video-js, .jwplayer, .plyr, .player-container",
        );
        if (vjs) return vjs;

        // 4. TED Talks (container holding #subtitles-container)
        const subCont = document.getElementById("subtitles-container");
        if (subCont && subCont.parentElement) {
            if (
                subCont.parentElement.contains(video) ||
                subCont.parentElement === video.parentElement
            ) {
                return subCont.parentElement;
            }
        }

        // 5. Check direct parent hierarchy for the tightest player wrapper (never main or body)
        let curr = video.parentElement;
        while (
            curr &&
            curr !== document.body &&
            curr !== document.documentElement &&
            curr.tagName !== "MAIN"
        ) {
            const style = window.getComputedStyle(curr);
            if (
                style.position === "relative" ||
                style.position === "absolute" ||
                curr.id === "subtitles-container" ||
                curr.querySelector?.("#subtitles-container")
            ) {
                const rect = curr.getBoundingClientRect();
                if (
                    rect.height > 0 &&
                    rect.height <= window.innerHeight * 1.2
                ) {
                    return curr;
                }
            }
            curr = curr.parentElement;
        }

        return video.parentElement || document.body;
    }

    function applySubtitleStyles(layer) {
        if (!layer) return;
        const opacity =
            typeof currentSubBgOpacity === "number" &&
                !isNaN(currentSubBgOpacity)
                ? Math.max(0, Math.min(100, currentSubBgOpacity))
                : 0;

        if (opacity <= 0) {
            layer.style.setProperty("--lectoro-sub-bg-color", "transparent");
            layer.style.setProperty("--lectoro-sub-bg-padding", "0 4px");
        } else {
            const alpha = (opacity / 100).toFixed(2);
            layer.style.setProperty(
                "--lectoro-sub-bg-color",
                `rgba(0, 0, 0, ${alpha})`,
            );
            layer.style.setProperty("--lectoro-sub-bg-padding", "3px 8px");
        }
    }

    function ensureCustomSubtitlesLayer() {
        const video = getPlayerRegistry()?.getVideo();
        const playerEl = findPlayerContainer(video);
        const parent =
            document.fullscreenElement || playerEl || QT.getOverlayParent();

        const platform = getPlatformName();

        if (customSubLayerEl && customSubLayerEl.isConnected) {
            customSubLayerEl.id = C.UI_IDS.CUSTOM_SUBTITLES_LAYER;
            customSubLayerEl.classList.add(C.UI_CLASSES.CUSTOM_SUBTITLES_LAYER);
            customSubLayerEl.setAttribute("data-platform", platform);
            applySubtitleStyles(customSubLayerEl);
            if (!customSubBoxEl) {
                customSubBoxEl = document.createElement("div");
                customSubBoxEl.style.setProperty(
                    "opacity",
                    activeLines.length > 0 ? "1" : "0",
                    "important",
                );
            }
            customSubBoxEl.classList.add(C.UI_CLASSES.CUSTOM_SUBTITLES_BOX);
            customSubBoxEl.setAttribute("data-platform", platform);
            if (customSubBoxEl.parentElement !== customSubLayerEl) {
                customSubLayerEl.appendChild(customSubBoxEl);
            }
            if (parent && customSubLayerEl.parentElement !== parent) {
                parent.appendChild(customSubLayerEl);
            }
            if (document.body) {
                document.body.setAttribute("data-lectoro-platform", platform);
            }
            if (customSubLayerEl) {
                customSubLayerEl.style.removeProperty("display");
            }
            return { layer: customSubLayerEl, box: customSubBoxEl };
        }

        customSubLayerEl = document.createElement("div");
        customSubLayerEl.id = C.UI_IDS.CUSTOM_SUBTITLES_LAYER;
        customSubLayerEl.className = C.UI_CLASSES.CUSTOM_SUBTITLES_LAYER;
        customSubLayerEl.setAttribute("data-platform", platform);
        applySubtitleStyles(customSubLayerEl);

        customSubBoxEl = document.createElement("div");
        customSubBoxEl.className = C.UI_CLASSES.CUSTOM_SUBTITLES_BOX;
        customSubBoxEl.setAttribute("data-platform", platform);
        customSubBoxEl.style.setProperty("opacity", "0", "important");
        customSubBoxEl.style.setProperty("pointer-events", "none", "important");

        if (document.body) {
            document.body.setAttribute("data-lectoro-platform", platform);
        }

        customSubLayerEl.appendChild(customSubBoxEl);
        parent.appendChild(customSubLayerEl);

        return { layer: customSubLayerEl, box: customSubBoxEl };
    }

    function syncCustomSubtitlePosition() {
        if (layoutRafId !== null) return;
        layoutRafId = requestAnimationFrame(() => {
            layoutRafId = null;
            const { layer, box } = ensureCustomSubtitlesLayer();
            const registry = getPlayerRegistry();
            const video = registry?.getVideo();

            if (
                !video ||
                !video.isConnected ||
                registry?.isPreviewOrThumbnailVideo?.(video)
            ) {
                layer.style.setProperty("display", "none", "important");
                return;
            }

            const playerEl = findPlayerContainer(video);
            const targetContainer = playerEl || video.parentElement;

            if (trackedVideo !== video) {
                if (videoResizeObserver && trackedVideo) {
                    try {
                        videoResizeObserver.unobserve(trackedVideo);
                    } catch (_) { }
                }
                trackedVideo = video;
                if (typeof ResizeObserver !== "undefined") {
                    if (!videoResizeObserver) {
                        videoResizeObserver = new ResizeObserver(() =>
                            syncCustomSubtitlePosition(),
                        );
                    }
                    videoResizeObserver.observe(video);
                    if (targetContainer && targetContainer !== video) {
                        videoResizeObserver.observe(targetContainer);
                    }
                }
            }

            // Ensure layer is attached inside targetContainer or fullscreen element
            const expectedParent =
                document.fullscreenElement || targetContainer || document.body;
            if (layer.parentElement !== expectedParent) {
                expectedParent.appendChild(layer);
            }

            // Ensure parent container is positioned so absolute layer stays locked inside
            if (
                expectedParent !== document.body &&
                expectedParent !== document.documentElement
            ) {
                const computedPos =
                    window.getComputedStyle(expectedParent).position;
                if (computedPos === "static") {
                    expectedParent.style.position = "relative";
                }
            }

            const videoRect = video.getBoundingClientRect();
            const playerRect = targetContainer
                ? targetContainer.getBoundingClientRect()
                : videoRect;
            const actualWidth =
                playerRect.width ||
                videoRect.width ||
                video.offsetWidth ||
                window.innerWidth;
            const actualHeight =
                playerRect.height ||
                videoRect.height ||
                video.offsetHeight ||
                window.innerHeight;

            if (actualWidth <= 0 || actualHeight <= 0) {
                layer.style.setProperty("display", "none", "important");
                return;
            }

            layer.style.setProperty("display", "flex", "important");
            layer.style.position = "absolute";
            layer.style.inset = "0px";
            layer.style.width = "100%";
            layer.style.height = "100%";
            layer.style.pointerEvents = "none";
            layer.style.overflow = "hidden";

            // Proportional uniform font sizing across all video platforms
            const fontSizePx = Math.max(
                20,
                Math.min(57, Math.round(actualWidth * 0.028 + 4)),
            );
            layer.style.setProperty(
                "--lectoro-sub-font-size",
                `${fontSizePx}px`,
            );

            applySubtitleStyles(layer);

            // Bottom offset inside video player
            const isNetflix = isNetflixPage();
            const posPercent =
                typeof currentSubPosition === "number" &&
                    !isNaN(currentSubPosition)
                    ? Math.max(0, Math.min(100, currentSubPosition))
                    : 14;

            const boxHeight = box.offsetHeight || 60;
            const maxBottomPx = Math.max(0, actualHeight - boxHeight - 12);
            let baseBottomPx;

            if (posPercent === 0) {
                baseBottomPx = 0;
            } else if (posPercent === 14) {
                baseBottomPx = isNetflix
                    ? Math.max(76, Math.round(actualHeight * 0.13))
                    : Math.max(18, Math.round(actualHeight * 0.138));
            } else {
                baseBottomPx = Math.min(
                    maxBottomPx,
                    Math.max(0, Math.round(actualHeight * (posPercent / 100))),
                );
            }

            currentSubBottomPx = baseBottomPx;
            layer.style.setProperty(
                "--lectoro-sub-bottom",
                `${baseBottomPx}px`,
            );
            box.style.marginBottom = `${baseBottomPx}px`;

            if (aiSubTranslationEl && aiSubTranslationText) {
                adjustSubtitlePositionForTranslation();
            }
        });
    }

    function adjustSubtitlePositionForTranslation() {
        if (!customSubBoxEl || !aiSubTranslationEl || !aiSubTranslationText) {
            if (customSubBoxEl) {
                customSubBoxEl.style.transform = "";
                customSubBoxEl.classList.remove(`${PREFIX}custom-sub-lifted`);
            }
            return;
        }

        const transHeight =
            aiSubTranslationEl.offsetHeight ||
            aiSubTranslationEl.getBoundingClientRect?.().height ||
            28;
        const gapPx = 6;
        const bottomSafetyPadding = 12;
        const requiredBottom = transHeight + gapPx + bottomSafetyPadding;

        if (currentSubBottomPx < requiredBottom) {
            const liftPx = Math.ceil(requiredBottom - currentSubBottomPx);
            customSubBoxEl.style.transform = `translateY(-${liftPx}px)`;
            customSubBoxEl.classList.add(`${PREFIX}custom-sub-lifted`);
        } else {
            customSubBoxEl.style.transform = "";
            customSubBoxEl.classList.remove(`${PREFIX}custom-sub-lifted`);
        }
    }

    function showSubtitleTranslationUnderOriginal(translationText, { loading = false } = {}) {
        if (!translationText) return;
        aiSubTranslationText = translationText;

        const { box } = ensureCustomSubtitlesLayer();
        if (!box) return;

        box.style.setProperty("opacity", "1", "important");
        box.style.setProperty("pointer-events", "auto", "important");

        if (!aiSubTranslationEl) {
            aiSubTranslationEl = document.createElement("div");
            aiSubTranslationEl.className = `${PREFIX}custom-sub-translation`;
            aiSubTranslationEl.setAttribute("dir", "auto");
        }

        const el = aiSubTranslationEl;
        const wasLoading = el.dataset.sentenceState === "loading";
        const previousRect = wasLoading ? el.getBoundingClientRect() : null;
        if (loading) {
            el.dataset.sentenceState = "loading";
            el.setAttribute("aria-label", "Translating");
            el.setAttribute("aria-busy", "true");
            el.textContent = "";
        } else if (wasLoading) {
            el.dataset.sentenceState = "expanding";
            const copy = document.createElement("span");
            copy.className = `${PREFIX}sentence-copy`;
            copy.textContent = translationText;
            el.replaceChildren(copy);
            const targetRect = el.getBoundingClientRect();
            const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            const finish = () => {
                if (el !== aiSubTranslationEl || !el.isConnected) return;
                el.dataset.sentenceState = "ready";
                el.removeAttribute("aria-label");
                el.setAttribute("aria-busy", "false");
                adjustSubtitlePositionForTranslation();
            };
            if (!reducedMotion && el.animate) {
                const growth = el.animate([
                    { width: `${previousRect.width}px`, height: `${previousRect.height}px` },
                    { width: `${targetRect.width}px`, height: `${targetRect.height}px` },
                ], { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
                growth.finished.then(finish, () => {});
            } else {
                finish();
            }
        } else if (el.textContent !== translationText) {
            el.textContent = translationText;
        }

        if (!aiSubTranslationEl._hasAiClickHandler) {
            aiSubTranslationEl._hasAiClickHandler = true;
            aiSubTranslationEl.addEventListener("click", (e) => {
                if (eTranslateActive) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (aiSubTranslationText) {
                        aiSubTranslationEl?.classList.add(`${PREFIX}speaking`);
                        QT.speak(aiSubTranslationText, subtitleTranslationLang, {
                            isCancelled: () => !eTranslateActive,
                        }).catch((error) => console.warn("[Lectoro] Subtitle speech failed:", error)).finally(() => {
                            aiSubTranslationEl?.classList.remove(`${PREFIX}speaking`);
                        });
                    }
                }
            });
        }

        if (aiSubTranslationEl.parentElement !== box) {
            box.appendChild(aiSubTranslationEl);
        }

        adjustSubtitlePositionForTranslation();
    }

    function removeSubtitleTranslationUnderOriginal() {
        aiSubTranslationText = "";
        try {
            document.body?.removeAttribute("data-lectoro-sub-translate-active");
        } catch (_) { }
        if (aiSubTranslationEl) {
            aiSubTranslationEl.remove();
            aiSubTranslationEl = null;
        }
        if (customSubBoxEl) {
            customSubBoxEl.style.transform = "";
            customSubBoxEl.classList.remove(`${PREFIX}custom-sub-lifted`);
            if (activeLines.length === 0) {
                customSubBoxEl.style.setProperty("opacity", "0", "important");
                customSubBoxEl.style.setProperty(
                    "pointer-events",
                    "none",
                    "important",
                );
            }
        }
    }

    let measureCanvas = null;
    let measureCtx = null;

    function measureTextWidth(text, fontSizePx) {
        if (!text) return 0;
        try {
            if (!measureCanvas && typeof document !== "undefined") {
                measureCanvas = document.createElement("canvas");
                measureCtx = measureCanvas.getContext("2d");
            }
            if (measureCtx) {
                measureCtx.font = `600 ${fontSizePx}px "Netflix Sans Variable", "Netflix Sans", "Helvetica Neue", "Segoe UI", Roboto, sans-serif`;
                return measureCtx.measureText(text).width;
            }
        } catch (_) { }
        return text.length * fontSizePx * 0.55;
    }

    /**
     * Consolidates 3-line subtitles into 2 lines if they can comfortably fit
     * within the available subtitle box width without overflowing/wrapping.
     */
    function consolidateLinesIfFit(lines, maxAvailableWidth, fontSizePx) {
        if (!Array.isArray(lines) || lines.length !== 3) {
            return lines;
        }

        // Available width for text inside line container with safety margin
        const maxWidth = Math.max(200, maxAvailableWidth - 48);

        const [l0, l1, l2] = lines;

        const comboA_line0 = `${l0} ${l1}`.trim();
        const comboA_line1 = l2.trim();

        const comboB_line0 = l0.trim();
        const comboB_line1 = `${l1} ${l2}`.trim();

        const wA0 = measureTextWidth(comboA_line0, fontSizePx);
        const wA1 = measureTextWidth(comboA_line1, fontSizePx);

        const wB0 = measureTextWidth(comboB_line0, fontSizePx);
        const wB1 = measureTextWidth(comboB_line1, fontSizePx);

        const fitsA = wA0 <= maxWidth && wA1 <= maxWidth;
        const fitsB = wB0 <= maxWidth && wB1 <= maxWidth;

        // Check if l1 or l2 starts with a dialogue speaker dash (e.g. "- Yes", "— No", "– Sure")
        const isL1SpeakerChange = /^[-–—]\s*\S/.test(l1);
        const isL2SpeakerChange = /^[-–—]\s*\S/.test(l2);

        if (fitsA && fitsB) {
            if (isL1SpeakerChange) {
                return [comboB_line0, comboB_line1];
            }
            if (isL2SpeakerChange) {
                return [comboA_line0, comboA_line1];
            }
            // Choose the combination with more balanced line widths
            const diffA = Math.abs(wA0 - wA1);
            const diffB = Math.abs(wB0 - wB1);
            return diffA <= diffB
                ? [comboA_line0, comboA_line1]
                : [comboB_line0, comboB_line1];
        }

        if (fitsB && !isL2SpeakerChange) {
            return [comboB_line0, comboB_line1];
        }

        if (fitsA && !isL1SpeakerChange) {
            return [comboA_line0, comboA_line1];
        }

        return lines;
    }

    function renderCustomSubtitles(lines = []) {
        const { layer, box } = ensureCustomSubtitlesLayer();
        const registry = getPlayerRegistry();
        const video = registry?.getVideo();
        if (
            video &&
            (registry?.isPreviewOrThumbnailVideo?.(video) ||
                (typeof registry?.isCcActive === "function" &&
                    !registry.isCcActive(video)))
        ) {
            lines = [];
        }

        const rawCleanLines = (Array.isArray(lines) ? lines : [lines])
            .map((l) => (typeof l === "string" ? cleanCardText(l) : ""))
            .filter(Boolean);

        if (rawCleanLines.length === 0) {
            activeLines = [];
            activeText = "";
            activeWordSpans = [];
            box.innerHTML = "";
            box.style.setProperty("opacity", "0", "important");
            box.style.setProperty("pointer-events", "none", "important");
            if (isSentenceOverlayOpen()) {
                restoreOriginal();
            }
            if (isSubHovering || subClickLocked) {
                closeSubTooltip({ resumeVideo: false });
            }
            return;
        }

        let displayLines = rawCleanLines;
        if (displayLines.length === 3) {
            const playerEl = findPlayerContainer(video);
            const actualWidth =
                playerEl?.offsetWidth || window.innerWidth || 1280;
            const fontSizePx = Math.max(
                20,
                Math.min(54, Math.round(actualWidth * 0.026 + 4)),
            );
            const maxBoxWidth = actualWidth * 0.92;
            displayLines = consolidateLinesIfFit(
                displayLines,
                maxBoxWidth,
                fontSizePx,
            );
        }
        const newText = displayLines.join(" ").replace(/\s+/g, " ").trim();

        if (newText === activeText && activeLines.length > 0) {
            if (displayLines.length === activeLines.length) {
                // Layout and text are identical: avoid unnecessary DOM re-rendering / flicker
                if (box.children.length === activeLines.length) {
                    syncCustomSubtitlePosition();
                    return;
                }
            } else if (
                displayLines.length < activeLines.length &&
                isNetflixPage()
            ) {
                // If a temporary partial DOM mutation arrives with fewer lines, preserve
                // the richer multi-line layout already rendered for this exact text.
                displayLines = activeLines;
                if (box.children.length === activeLines.length) {
                    syncCustomSubtitlePosition();
                    return;
                }
            }
            // If displayLines.length > activeLines.length, an upgraded multi-line
            // layout arrived (e.g. multi-line DOM replacing a 1-line seek fallback).
            // Proceed and render the richer displayLines!
        }

        if (newText !== activeText) {
            if (isSentenceOverlayOpen()) {
                restoreOriginal();
            }
            if (isSubHovering || subClickLocked) {
                closeSubTooltip({ resumeVideo: false });
            }
        }

        activeLines = displayLines;
        activeText = newText;
        if (
            newText &&
            (!recentSubtitlesHistory.length ||
                recentSubtitlesHistory[recentSubtitlesHistory.length - 1] !==
                newText)
        ) {
            recentSubtitlesHistory.push(newText);
            if (recentSubtitlesHistory.length > 10) {
                recentSubtitlesHistory.shift();
            }
        }
        activeWordSpans = [];
        box.innerHTML = "";

        for (const lineText of displayLines) {
            const lineEl = document.createElement("div");
            lineEl.className = `${PREFIX}custom-sub-line`;
            lineEl.setAttribute("dir", "auto");

            for (const token of (globalThis.DictionaryTokenizer?.tokenize || SharedPhraseDetector.tokenizeSubtitleLine)(
                lineText,
            )) {
                if (token.type === "word") {
                    const span = document.createElement("span");
                    span.className = token.isPhrase
                        ? `${SUB_WORD_CLASS} ${PREFIX}sub-phrase`
                        : SUB_WORD_CLASS;
                    span.textContent = token.text;
                    if (token.clean) {
                        span.dataset.clean = token.clean;
                    }
                    if (token.isPhrase) {
                        span.dataset.isPhrase = "true";
                        span.title = "Phrase: " + token.clean;
                    }
                    lineEl.appendChild(span);
                    activeWordSpans.push(span);
                } else {
                    lineEl.appendChild(document.createTextNode(token.text));
                }
            }
            box.appendChild(lineEl);
        }

        if (!aiTooltipActive && eTranslateActive && aiSubTranslationText) {
            showSubtitleTranslationUnderOriginal(aiSubTranslationText, {
                loading: aiSubTranslationEl?.dataset.sentenceState === "loading",
            });
        }

        box.style.setProperty("opacity", "1", "important");
        box.style.setProperty("pointer-events", "auto", "important");
        syncCustomSubtitlePosition();
        if (aiTooltipActive) {
            updateSubtitleVideoHighlights();
        }
    }

    // Geometry event listeners
    window.addEventListener("resize", syncCustomSubtitlePosition, {
        passive: true,
    });
    window.addEventListener("scroll", syncCustomSubtitlePosition, {
        passive: true,
    });
    document.addEventListener("fullscreenchange", () =>
        setTimeout(syncCustomSubtitlePosition, 50),
    );
    document.addEventListener("webkitfullscreenchange", () =>
        setTimeout(syncCustomSubtitlePosition, 50),
    );
    document.addEventListener(
        "play",
        (e) => {
            if (e.target instanceof HTMLVideoElement) {
                if (isSubHovering || subClickLocked) {
                    closeSubTooltip({ resumeVideo: false });
                }
            }
        },
        true,
    );

    // Subtitle visual preferences from storage (Single Source of Truth)
    const subPosKey = C.STORAGE_KEYS.SUBTITLE_POSITION;
    const subBgKey = C.STORAGE_KEYS.SUBTITLE_BG_OPACITY;

    chrome.storage.local.get(
        {
            [subPosKey]: C.DEFAULT_SUBTITLE_SETTINGS.POSITION,
            [subBgKey]: C.DEFAULT_SUBTITLE_SETTINGS.BG_OPACITY,
        },
        (data) => {
            if (data && typeof data[subPosKey] === "number") {
                currentSubPosition = data[subPosKey];
            }
            if (data && typeof data[subBgKey] === "number") {
                currentSubBgOpacity = data[subBgKey];
            }
            if (customSubLayerEl) {
                applySubtitleStyles(customSubLayerEl);
                syncCustomSubtitlePosition();
            }
        },
    );

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        let shouldSync = false;
        if (
            changes[subPosKey] &&
            typeof changes[subPosKey].newValue === "number"
        ) {
            currentSubPosition = changes[subPosKey].newValue;
            shouldSync = true;
        }
        if (
            changes[subBgKey] &&
            typeof changes[subBgKey].newValue === "number"
        ) {
            currentSubBgOpacity = changes[subBgKey].newValue;
            if (customSubLayerEl) {
                applySubtitleStyles(customSubLayerEl);
            }
            shouldSync = true;
        }
        if (shouldSync) {
            syncCustomSubtitlePosition();
        }
    });

    // Connect to PlayerRegistry subtitle changes (Single Source of Truth)
    getPlayerRegistry().onSubtitleChange((payload) => {
        if (Array.isArray(payload)) {
            renderCustomSubtitles(LectoroBaseAdapter.extractCueLines(payload));
        } else if (payload && Array.isArray(payload.lines)) {
            renderCustomSubtitles(payload.lines);
        } else if (payload && typeof payload.fullText === "string") {
            const lines = payload.fullText
                ? payload.fullText
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .filter(Boolean)
                : [];
            renderCustomSubtitles(lines);
        }
    });

    // ── Word Tooltip (Hover & Click) ──────────────────────────────

    function closeSubTooltip(options = {}) {
        if (!isSubHovering && !subClickLocked) return;
        const shouldResumeVideo =
            options.resumeVideo !== undefined
                ? options.resumeVideo
                : subWasPlaying;

        isSubHovering = false;
        subWasPlaying = false;
        subClickLocked = false;
        QT.hoverClickActive = false;

        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subHoverTimer = null;
        subCloseTimer = null;
        subTooltipAnchor = null;

        if (lastHoveredSubWord) {
            lastHoveredSubWord.classList.remove(WORD_HOVER_CLASS);
            lastHoveredSubWord = null;
        }

        QT.hideTooltip();

        if (shouldResumeVideo) {
            const video = getPlayerRegistry()?.getVideo();
            if (video && video.paused) {
                getPlayerRegistry()?.playVideo(video);
            }
        }
    }

    QT.addDismissHandler(closeSubTooltip);

    function scheduleCloseSubTooltip() {
        if (subCloseTimer !== null) return;
        subCloseTimer = setTimeout(() => {
            subCloseTimer = null;
            const tooltip = QT.getTooltipEl();
            if (
                tooltip?.matches(":hover") ||
                tooltip?.contains(document.activeElement)
            )
                return;
            if (subClickLocked) return;
            const { x, y } = QT.getMousePos();
            const wordUnderMouse = QT.findWordAtPoint(x, y, SUB_WORD_CLASS);
            if (wordUnderMouse) return;
            closeSubTooltip();
        }, TOOLTIP_CLOSE_DELAY_MS);
    }

    /** Mark `wordSpan` as the hovered token (clearing the previous one). */
    function setHoveredWord(wordSpan) {
        if (lastHoveredSubWord && lastHoveredSubWord !== wordSpan) {
            lastHoveredSubWord.classList.remove(WORD_HOVER_CLASS);
        }
        lastHoveredSubWord = wordSpan;
        wordSpan.classList.add(WORD_HOVER_CLASS);
    }

    /** Translate `text` and render the standard word tooltip anchored to `wordSpan`. */
    async function showWordTooltip(
        wordSpan,
        text,
        rect,
        { speak = false } = {},
    ) {
        const placement = "top";
        QT.showLoading(rect, placement);
        ensureSubtitleUiTracking();

        try {
            const { targetLang, learningLang: srcLang } = await SharedTranslatorService.getReadingSettings();
            const [translated] = await SharedTranslatorService.lookupWords([text], targetLang, srcLang);
            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;
            if (!translated) {
                QT.showTooltip(`<div class="${PREFIX}body">No dictionary entry yet.</div>`, rect, placement);
                return;
            }
            const html = QT.buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated,
            });
            QT.showTooltip(html, rect, placement);
            QT.attachTooltipHandlers();
            if (speak) QT.speak(text, srcLang);
        } catch (err) {
            if (isSubHovering && (speak || lastHoveredSubWord === wordSpan)) {
                QT.showTooltip(
                    `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                    rect,
                    placement,
                );
            }
        }
    }

    async function triggerWordHover(wordSpan) {
        if (!wordSpan || !wordSpan.isConnected) return;
        if (subClickLocked) return;

        setHoveredWord(wordSpan);

        const video = getPlayerRegistry()?.getVideo();
        if (!isSubHovering) {
            subWasPlaying = video ? !video.paused : false;
        }

        isSubHovering = true;
        subTooltipAnchor = wordSpan;
        pauseIfPlaying(video);

        const text = getSpanWord(wordSpan);
        if (!text) return;

        await showWordTooltip(wordSpan, text, wordSpan.getBoundingClientRect());
    }

    document.addEventListener(
        "mousemove",
        (e) => {
            const registry = getPlayerRegistry();
            const activeVideo = registry?.getVideo();
            if (!activeVideo?.isConnected) {
                if (isSubHovering && !subClickLocked) closeSubTooltip();
                return;
            }
            if (
                (typeof isReading !== "undefined" && isReading) ||
                eTranslateActive ||
                wordCloudActive ||
                aiTooltipActive
            ) {
                if (isSubHovering && !subClickLocked) closeSubTooltip();
                if (aiTooltipActive) {
                    // Synchronize hover state between subtitle highlighted word and ribbon pill
                    const targetWrap =
                        e.target?.closest?.(
                            `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                        ) ||
                        document
                            .elementFromPoint(e.clientX, e.clientY)
                            ?.closest?.(
                                `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                            );
                    const hoveredIdx =
                        targetWrap && targetWrap.dataset.aiIndex !== undefined
                            ? parseInt(targetWrap.dataset.aiIndex, 10)
                            : -1;
                    const ribbon = document.querySelector(
                        `.${PREFIX}ai-queue-ribbon`,
                    );
                    if (ribbon) {
                        const pills = ribbon.querySelectorAll(
                            `.${PREFIX}ai-queue-pill`,
                        );
                        pills.forEach((pill) => {
                            const pIdx = parseInt(pill.dataset.index, 10);
                            if (
                                hoveredIdx !== -1 &&
                                pIdx === hoveredIdx &&
                                !pill.classList.contains("active")
                            ) {
                                pill.classList.add(`${PREFIX}pill-highlight`);
                            } else {
                                pill.classList.remove(`${PREFIX}pill-highlight`);
                            }
                        });
                    }
                }
                return;
            }

            if (subClickLocked) return;

            const tooltip = QT.getTooltipEl();
            const isInsideTooltip =
                tooltip &&
                (tooltip.contains(e.target) || tooltip.matches(":hover"));

            if (isInsideTooltip) {
                clearTimeout(subHoverTimer);
                clearTimeout(subCloseTimer);
                subHoverTimer = null;
                subCloseTimer = null;
                return;
            }

            const wordSpan = isOwnUI(e.target)
                ? null
                : QT.findWordAtPoint(e.clientX, e.clientY, SUB_WORD_CLASS);

            // Safe bridge zone: if tooltip is open and user is moving towards it (e.g. crossing upper lines)
            if (
                wordSpan &&
                isSubHovering &&
                subTooltipAnchor &&
                wordSpan !== subTooltipAnchor &&
                tooltip?.classList.contains("visible")
            ) {
                const tooltipRect = tooltip.getBoundingClientRect();
                const anchorRect = subTooltipAnchor.getBoundingClientRect();
                const minX = Math.min(tooltipRect.left, anchorRect.left) - 40;
                const maxX = Math.max(tooltipRect.right, anchorRect.right) + 40;
                const minY = Math.min(tooltipRect.top, anchorRect.top) - 15;
                const maxY =
                    Math.max(tooltipRect.bottom, anchorRect.bottom) + 15;

                const inBridgeZone =
                    e.clientX >= minX &&
                    e.clientX <= maxX &&
                    e.clientY >= minY &&
                    e.clientY <= maxY;
                if (inBridgeZone) {
                    clearTimeout(subCloseTimer);
                    subCloseTimer = null;
                    if (subHoverTimer) return; // Keep dwelling
                    subHoverTimer = setTimeout(() => {
                        subHoverTimer = null;
                        triggerWordHover(wordSpan);
                    }, HOVER_BRIDGE_DWELL_MS);
                    return;
                }
            }

            if (wordSpan && wordSpan !== lastHoveredSubWord) {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
                clearTimeout(subHoverTimer);

                const hoverDelay = isSubHovering ? HOVER_SWITCH_DELAY_MS : 0;
                subHoverTimer = setTimeout(() => {
                    subHoverTimer = null;
                    triggerWordHover(wordSpan);
                }, hoverDelay);
            } else if (!wordSpan) {
                clearTimeout(subHoverTimer);
                subHoverTimer = null;
                if (isSubHovering) scheduleCloseSubTooltip();
            } else {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
            }
        },
        true,
    );

    document.documentElement.addEventListener("mouseleave", () => {
        if (isSubHovering && !subClickLocked) closeSubTooltip();
    });

    async function handleSubWordClick(wordSpan) {
        cleanupReading();
        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subCloseTimer = null;
        const wasAlreadyHovering = isSubHovering;
        subClickLocked = true;
        QT.hoverClickActive = true;
        isSubHovering = true;
        subTooltipAnchor = wordSpan;
        setHoveredWord(wordSpan);

        const video = getPlayerRegistry()?.getVideo();
        if (!wasAlreadyHovering) subWasPlaying = video ? !video.paused : false;
        pauseIfPlaying(video);

        const text = getSpanWord(wordSpan);
        if (!text) {
            closeSubTooltip();
            return;
        }

        await showWordTooltip(
            wordSpan,
            text,
            wordSpan.getBoundingClientRect(),
            { speak: true },
        );
    }

    document.addEventListener(
        "pointerdown",
        (e) => {
            if (!aiTooltipActive) return;
            const targetWrap =
                e.target?.closest?.(
                    `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                ) ||
                document
                    .elementFromPoint(e.clientX, e.clientY)
                    ?.closest?.(
                        `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                    );
            if (targetWrap) {
                // Prevent video player controls/canvas from pausing or seeking
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true,
    );

    document.addEventListener(
        "click",
        (e) => {
            const registry = getPlayerRegistry();
            const video = registry?.getVideo();
            if (!video?.isConnected) return;
            if (isOwnUI(e.target)) return;

            if (aiTooltipActive) {
                // In Enter mode: clicking a highlighted subtitle word navigates to it in the AI queue
                const targetWrap =
                    e.target?.closest?.(
                        `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                    ) ||
                    document
                        .elementFromPoint(e.clientX, e.clientY)
                        ?.closest?.(
                            `.${C.UI_CLASSES.AI_SUB_WRAP}, [data-ai-index]`,
                        );
                if (targetWrap && targetWrap.dataset.aiIndex !== undefined) {
                    const targetIdx = parseInt(targetWrap.dataset.aiIndex, 10);
                    if (
                        !isNaN(targetIdx) &&
                        targetIdx >= 0 &&
                        targetIdx < aiExplainQueue.length
                    ) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation?.();
                        showAiExplainItem(targetIdx, { manual: true });
                        return;
                    }
                }

                // Fallback: match clicked subtitle word against breakdown items in queue
                const wordSpan =
                    QT.findWordAtPoint(
                        e.clientX,
                        e.clientY,
                        SUB_WORD_CLASS,
                    ) ||
                    document
                        .elementFromPoint(e.clientX, e.clientY)
                        ?.closest?.(`.${SUB_WORD_CLASS}`);
                if (wordSpan) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation?.();
                    const cleanWord = normalizeWordForMatching(
                        wordSpan.dataset?.clean || wordSpan.textContent,
                    );
                    const foundIdx = aiExplainQueue.findIndex((item) => {
                        if (!item?.term || item.type === "sentence") return false;
                        const termWords = String(item.term)
                            .split(/\s+/)
                            .map(normalizeWordForMatching)
                            .filter(Boolean);
                        return (
                            termWords.includes(cleanWord) ||
                            normalizeWordForMatching(item.term) === cleanWord
                        );
                    });
                    if (foundIdx !== -1) {
                        showAiExplainItem(foundIdx, { manual: true });
                    }
                    return;
                }
                return;
            }

            const wordSpan = QT.findWordAtPoint(
                e.clientX,
                e.clientY,
                SUB_WORD_CLASS,
            );
            if (wordSpan) {
                e.preventDefault();
                e.stopPropagation();
                handleSubWordClick(wordSpan);
            }
        },
        true,
    );

    // ── AI Explanations ──────────────────────────────────────────

    function showSubtitleOverlayLoader(
        layout,
        {
            text = "✨ Translating…",
            ariaLabel = "Translating sentence...",
        } = {},
    ) {
        const overlay = createOverlay(layout);
        overlay.classList.add(AI_EXPLAIN_OVERLAY_CLASS);
        overlay.dataset.state = "ai-loading";
        overlay.setAttribute("aria-label", ariaLabel);
        overlay.innerHTML = `<span class="ai-loader-label">${text}</span>`;
        positionOverlay(layout);
        return overlay;
    }

    function showAiShimmer(layout) {
        return showSubtitleOverlayLoader(layout, {
            text: "✨ Analyzing…",
            ariaLabel: "Sentence analysis in progress",
        });
    }

    function removeAiShimmer() {
        if (translationOverlay?.classList.contains(AI_EXPLAIN_OVERLAY_CLASS)) {
            removeOverlay();
        }
    }
    QT.addCleanup(removeAiShimmer);

    function closeAiTooltip(options = {}) {
        aiExplainRequestId++;
        if (aiExplainKeydownHandler) {
            window.removeEventListener(
                "keydown",
                aiExplainKeydownHandler,
                true,
            );
            aiExplainKeydownHandler = null;
        }
        if (!aiTooltipActive) return;
        aiTooltipActive = false;
        try {
            document.body?.removeAttribute("data-lectoro-ai-active");
        } catch (_) { }
        clearTimeout(aiAutoAdvanceTimer);
        aiAutoAdvanceTimer = null;
        aiAutoAdvanceDisabled = false;
        aiExplainSpeechToken++;
        aiExplainQueue = [];
        aiExplainIndex = 0;
        aiExplainLayout = null;
        aiSavedIndices.clear();
        aiAiSavedIndices.clear();
        activeAiVideo = null;
        clearSubtitleVideoHighlights();
        QT.hideTooltip();
        removeAiShimmer();
        removeSubtitleTranslationUnderOriginal();
        cleanupReading();
        SharedTtsService.cancel();

        const shouldResume =
            options.resumeVideo !== undefined ? options.resumeVideo : true;
        if (shouldResume) {
            const video = getPlayerRegistry()?.getVideo();
            if (video) {
                resumeVideoAfterSubtitleClose(video);
            }
        }
    }
    QT.addDismissHandler(closeAiTooltip);

    const normalizeLanguageCode = SharedUtils.normalizeLanguageCode;

    function clearSubtitleVideoHighlights() {
        try {
            const wrappers = document.querySelectorAll(
                `.${C.UI_CLASSES.AI_SUB_WRAP}`,
            );
            wrappers.forEach((wrap) => {
                const parent = wrap.parentNode;
                if (parent) {
                    while (wrap.firstChild) {
                        parent.insertBefore(wrap.firstChild, wrap);
                    }
                    parent.removeChild(wrap);
                }
            });
            const highlighted = document.querySelectorAll(
                `.${C.UI_CLASSES.AI_SUB_ACTIVE}, .${C.UI_CLASSES.AI_SUB_UPCOMING}, .${C.UI_CLASSES.AI_SUB_QUEUED}`,
            );
            highlighted.forEach((el) => {
                el.classList.remove(
                    C.UI_CLASSES.AI_SUB_ACTIVE,
                    C.UI_CLASSES.AI_SUB_UPCOMING,
                    C.UI_CLASSES.AI_SUB_QUEUED,
                );
            });
            const ribbonPills = document.querySelectorAll(
                `.${PREFIX}pill-highlight`,
            );
            ribbonPills.forEach((p) =>
                p.classList.remove(`${PREFIX}pill-highlight`),
            );
        } catch (_) { }
    }

    function normalizeWordForMatching(w) {
        return String(w || "")
            .toLowerCase()
            .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
            .trim();
    }

    function findMatchingSpanRange(spans, term) {
        if (!term || !spans || !spans.length) return null;
        const cleanTerm = normalizeWordForMatching(term);
        if (!cleanTerm) return null;

        const termWords = String(term)
            .split(/\s+/)
            .map(normalizeWordForMatching)
            .filter(Boolean);
        if (!termWords.length) return null;

        // 1. Direct match: check if a single span already contains the entire phrase/term
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            const sw = normalizeWordForMatching(
                span.dataset?.clean || span.textContent,
            );
            if (
                sw === cleanTerm ||
                (sw.length >= cleanTerm.length && sw.includes(cleanTerm))
            ) {
                return { startIndex: i, count: 1 };
            }
        }

        const spanWords = spans.map((s) =>
            normalizeWordForMatching(s.dataset?.clean || s.textContent),
        );

        // 2. Sliding window for multi-word phrase across consecutive spans
        const stemmer = globalThis.SharedPhraseDetector?.stemVerb;
        for (let i = 0; i <= spanWords.length - termWords.length; i++) {
            let match = true;
            for (let j = 0; j < termWords.length; j++) {
                const sw = spanWords[i + j];
                const tw = termWords[j];
                if (!sw || !tw) {
                    match = false;
                    break;
                }
                if (sw === tw) continue;
                // Stem / prefix comparison for verb inflections and plurals
                const swStem = stemmer ? stemmer(sw) : sw;
                const twStem = stemmer ? stemmer(tw) : tw;
                if (
                    swStem &&
                    twStem &&
                    (swStem === twStem ||
                        swStem.startsWith(twStem) ||
                        twStem.startsWith(swStem))
                ) {
                    continue;
                }
                match = false;
                break;
            }
            if (match) {
                return { startIndex: i, count: termWords.length };
            }
        }

        // 3. Fallback: single word or token substring match
        for (let i = 0; i < spans.length; i++) {
            const sw = spanWords[i];
            if (
                sw &&
                (termWords.includes(sw) ||
                    (sw.length > 3 && cleanTerm.includes(sw)))
            ) {
                return { startIndex: i, count: 1 };
            }
        }

        return null;
    }

    function wrapMatchedSpans(matchingSpans, cssClass, aiIndex, wrapperClass = C.UI_CLASSES.AI_SUB_WRAP) {
        const wrappers = [];
        if (!matchingSpans || matchingSpans.length === 0) return wrappers;

        // Group consecutive spans by parent container
        const groups = [];
        let currentGroup = [];
        let currentParent = null;

        for (const span of matchingSpans) {
            if (!span || !span.isConnected) continue;

            // If already wrapped in an existing ai-sub-wrap, update class and ai-index
            const existingWrap = span.closest(`.${wrapperClass}`);
            if (existingWrap) {
                existingWrap.className = `${wrapperClass} ${cssClass}`;
                if (!wrappers.includes(existingWrap)) wrappers.push(existingWrap);
                if (aiIndex !== undefined) {
                    existingWrap.dataset.aiIndex = String(aiIndex);
                }
                continue;
            }

            const parent = span.parentNode;
            if (parent !== currentParent) {
                if (currentGroup.length > 0) {
                    groups.push({ parent: currentParent, spans: currentGroup });
                }
                currentGroup = [span];
                currentParent = parent;
            } else {
                currentGroup.push(span);
            }
        }
        if (currentGroup.length > 0) {
            groups.push({ parent: currentParent, spans: currentGroup });
        }

        for (const { parent, spans } of groups) {
            if (!parent || !spans.length) continue;
            const first = spans[0];
            const last = spans[spans.length - 1];

            // Collect all DOM nodes from first to last (including spaces between spans)
            const nodesToWrap = [];
            let curr = first;
            while (curr) {
                nodesToWrap.push(curr);
                if (curr === last) break;
                curr = curr.nextSibling;
            }

            if (!nodesToWrap.includes(last)) {
                // Sibling traversal fallback: add class to individual spans
                for (const s of spans) {
                    s.classList.add(cssClass);
                    if (aiIndex !== undefined) {
                        s.dataset.aiIndex = String(aiIndex);
                    }
                }
                continue;
            }

            const wrapper = document.createElement("span");
            wrapper.className = `${wrapperClass} ${cssClass}`;
            if (aiIndex !== undefined) {
                wrapper.dataset.aiIndex = String(aiIndex);
            }
            parent.insertBefore(wrapper, first);
            for (const node of nodesToWrap) {
                wrapper.appendChild(node);
            }
            wrappers.push(wrapper);
        }
        return wrappers;
    }

    function highlightSpansForTerm(spans, term, cssClass, aiIndex) {
        const range = findMatchingSpanRange(spans, term);
        if (!range) return;
        const matchingSpans = spans.slice(
            range.startIndex,
            range.startIndex + range.count,
        );
        wrapMatchedSpans(matchingSpans, cssClass, aiIndex);
    }

    function updateSubtitleVideoHighlights() {
        clearSubtitleVideoHighlights();
        if (!aiTooltipActive || !aiExplainQueue.length) return;

        let spans =
            activeWordSpans && activeWordSpans.length > 0
                ? activeWordSpans.filter((s) => s && s.isConnected)
                : [];

        if (!spans.length && customSubBoxEl?.isConnected) {
            spans = Array.from(
                customSubBoxEl.querySelectorAll(`.${SUB_WORD_CLASS}`),
            );
        }

        if (!spans.length) {
            const registryElements =
                getPlayerRegistry()?.getSubtitleElements?.() || [];
            for (const el of registryElements) {
                const words = el.querySelectorAll
                    ? el.querySelectorAll(`.${SUB_WORD_CLASS}`)
                    : [];
                if (words.length > 0) {
                    spans.push(...words);
                } else if (el) {
                    spans.push(el);
                }
            }
        }

        if (!spans.length) return;

        const currentItem = aiExplainQueue[aiExplainIndex];
        const isSentenceTranslation = currentItem?.type === "sentence";

        // 1. Highlight all upcoming & queued breakdown terms in soft violet with their queue index
        for (let i = 0; i < aiExplainQueue.length; i++) {
            if (i === aiExplainIndex) continue;
            const queuedItem = aiExplainQueue[i];
            // Do not highlight full sentence as a queued term in the subtitle
            if (queuedItem?.type === "sentence") continue;
            if (queuedItem?.term) {
                highlightSpansForTerm(
                    spans,
                    queuedItem.term,
                    C.UI_CLASSES.AI_SUB_QUEUED,
                    i,
                );
            }
        }

        // 2. Highlight currently discussed term (active neon cyan/gradient)
        // When translating the full sentence, do not highlight the entire sentence in cyan.
        // Only upcoming breakdown items are highlighted in soft violet.
        if (!isSentenceTranslation && currentItem?.term) {
            highlightSpansForTerm(
                spans,
                currentItem.term,
                C.UI_CLASSES.AI_SUB_ACTIVE,
                aiExplainIndex,
            );
        }
    }

    function renderAiExplainContent(index) {
        if (!aiExplainQueue.length) return "";
        const item = aiExplainQueue[index];
        if (!item) return "";

        const markupOptions = {
            sourceLang: aiExplainSourceLang,
            originalText: item.term || item.originalText,
            quoteClass: TTS_QUOTE_CLASS,
        };

        const totalItems = aiExplainQueue.length;
        const hasMultiple = totalItems > 1;

        let headerHtml = "";
        if (hasMultiple) {
            const ribbonItemsHtml = aiExplainQueue
                .map((qItem, idx) => {
                    const isActive = idx === index;
                    const isQueued = idx !== index;
                    const icon = qItem.type === "sentence" ? "💬" : "✨";
                    const classes = [
                        `${PREFIX}ai-queue-pill`,
                        isActive ? "active" : "",
                        isQueued ? C.UI_CLASSES.AI_PILL_UPCOMING : "",
                    ]
                        .filter(Boolean)
                        .join(" ");

                    return `<button type="button" class="${classes}" data-index="${idx}" role="tab" aria-selected="${isActive}" title="${QT.escapeAttr(qItem.title)}">
                        <span class="${PREFIX}pill-icon">${icon}</span>
                        <span>${QT.escapeHtml(qItem.title)}</span>
                    </button>`;
                })
                .join("");

            headerHtml = `
                <div class="${PREFIX}header">
                    <div class="${PREFIX}ai-queue-ribbon" role="tablist" aria-label="Breakdown items">
                        ${ribbonItemsHtml}
                    </div>
                    <div class="${PREFIX}ai-nav-group">
                        <button type="button" class="${PREFIX}ai-nav-btn ${PREFIX}ai-prev-btn" data-action="prev" ${index === 0 ? "disabled" : ""} title="Poprzednie (← / A)">
                            ◀
                        </button>
                        <span class="${PREFIX}ai-step-counter">${index + 1}/${totalItems}</span>
                        <button type="button" class="${PREFIX}ai-nav-btn ${PREFIX}ai-next-btn" data-action="next" ${index >= totalItems - 1 ? "disabled" : ""} title="Następne (→ / D)">
                            ▶
                        </button>
                    </div>
                </div>`;
        }

        const isSentenceStage = item.type === "sentence";
        const explanationLang =
            aiExplainMode === "simple_target"
                ? aiExplainSourceLang
                : aiExplainTargetLang;
        const formattedExplanation =
            !isSentenceStage && item.explanation
                ? QT.formatSpeechMarkup(
                    item.explanation,
                    explanationLang,
                    markupOptions,
                )
                : "";

        const speakLang =
            aiExplainMode === "simple_target"
                ? aiExplainSourceLang
                : aiExplainTargetLang;

        const speechText = isSentenceStage
            ? item.meaning || ""
            : [item.term, item.meaning, item.explanation]
                .filter(Boolean)
                .join(". ");

        const bodyHtml = `
            <div class="${PREFIX}body">
                <div class="${PREFIX}ai-term-card" data-type="${QT.escapeAttr(item.type || "")}">
                    ${isSentenceStage
                ? `
                    <div class="${PREFIX}ai-term-title-wrap ${PREFIX}ai-sentence-wrap">
                        <div class="${PREFIX}ai-term-meaning">
                            ${QT.escapeHtml(item.meaning || "")}
                        </div>
                        <span class="${PREFIX}word-actions">
                            <button class="${PREFIX}speak" data-text="${QT.escapeAttr(speechText)}" data-lang="${QT.escapeAttr(speakLang)}" data-source-lang="${QT.escapeAttr(aiExplainSourceLang)}" data-original-text="${QT.escapeAttr(item.term)}" title="Odtwórz wymowę" aria-label="Odtwórz wymowę">${SVG.SPEAKER}</button>
                        </span>
                    </div>`
                : `
                    <div class="${PREFIX}ai-term-header">
                        ${item.badge ? `<span class="${PREFIX}ai-badge">${QT.escapeHtml(item.badge)}</span>` : ""}
                        <div class="${PREFIX}ai-term-title-wrap">
                            ${!isSentenceStage ? `<span class="${PREFIX}ai-term">${QT.escapeHtml(item.term)}</span>` : ""}
                            <span class="${PREFIX}word-actions">
                                <button class="${PREFIX}speak" data-text="${QT.escapeAttr(speechText)}" data-lang="${QT.escapeAttr(speakLang)}" data-source-lang="${QT.escapeAttr(aiExplainSourceLang)}" data-original-text="${QT.escapeAttr(item.term)}" title="Odtwórz wymowę" aria-label="Odtwórz wymowę">${SVG.SPEAKER}</button>
                            </span>
                        </div>
                    </div>
                    ${item.meaning
                    ? `
                    <div class="${PREFIX}ai-term-meaning">
                        ${QT.escapeHtml(item.meaning)}
                    </div>`
                    : ""
                }
                    ${formattedExplanation
                    ? `
                    <div class="${PREFIX}ai-term-explanation">
                        ${formattedExplanation}
                    </div>`
                    : ""
                }`
            }
                </div>
            </div>`;

        const isSaved = aiSavedIndices.has(index);
        const isAiSaved = aiAiSavedIndices.has(index);
        const dataAttrs = `data-src="${QT.escapeAttr(item.term || item.originalText || "")}" data-translated="${QT.escapeAttr(item.meaning || item.translation || "")}" data-src-lang="${QT.escapeAttr(aiExplainSourceLang || "")}" data-tgt-lang="${QT.escapeAttr(aiExplainTargetLang || "")}"`;

        const footerHtml = QT.buildSaveFooterHtml(dataAttrs, {
            saveLabel: "Save",
            saveTitle: "Save for review (Z)",
            saveKeyHint: "Z",
            isSaved,
            showAi: true,
            aiLabel: "AI Sentence",
            aiTitle: "Generate smart AI sentence (Gemini)",
            isAiSaved,
        });

        return (headerHtml ? headerHtml : "") + bodyHtml + footerHtml;
    }

    function speakUntilFinished(text, lang, opts = {}) {
        return new Promise(async (resolve) => {
            if (!text || opts?.isCancelled?.()) {
                resolve();
                return;
            }
            try {
                const utteranceOrAudio = await QT.speak(text, lang, opts);
                if (!utteranceOrAudio || opts?.isCancelled?.()) {
                    resolve();
                    return;
                }

                let finished = false;
                const finish = () => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(safetyTimer);
                    resolve();
                };

                const safetyTimeout =
                    typeof SharedTtsService?.getSafetyTimeout === "function"
                        ? SharedTtsService.getSafetyTimeout(text)
                        : 8000;
                const safetyTimer = setTimeout(
                    finish,
                    Math.min(30000, safetyTimeout),
                );

                if (utteranceOrAudio instanceof HTMLAudioElement) {
                    utteranceOrAudio.addEventListener("ended", finish, {
                        once: true,
                    });
                    utteranceOrAudio.addEventListener("error", finish, {
                        once: true,
                    });
                } else if (
                    typeof utteranceOrAudio.addEventListener === "function"
                ) {
                    utteranceOrAudio.addEventListener("end", finish, {
                        once: true,
                    });
                    utteranceOrAudio.addEventListener("error", finish, {
                        once: true,
                    });
                } else {
                    const prevEnd = utteranceOrAudio.onend;
                    const prevErr = utteranceOrAudio.onerror;
                    utteranceOrAudio.onend = (...args) => {
                        try {
                            prevEnd?.(...args);
                        } finally {
                            finish();
                        }
                    };
                    utteranceOrAudio.onerror = (...args) => {
                        try {
                            prevErr?.(...args);
                        } finally {
                            finish();
                        }
                    };
                }
            } catch (_) {
                resolve();
            }
        });
    }

    async function speakAiExplainItem(item, speechToken) {
        if (!aiTooltipActive || speechToken !== aiExplainSpeechToken || !item) return;

        const isCancelled = () =>
            !aiTooltipActive || speechToken !== aiExplainSpeechToken;

        const speakBtn = translationOverlay?.querySelector(`.${PREFIX}speak`);
        if (speakBtn) {
            speakBtn.classList.add("speaking");
            speakBtn.setAttribute(
                "aria-label",
                "Odtwarzanie tłumaczenia",
            );
        }

        try {
            if (item.type === "sentence") {
                const sentenceLang =
                    aiExplainMode === "simple_target"
                        ? aiExplainSourceLang
                        : aiExplainTargetLang;

                if (item.meaning) {
                    await speakUntilFinished(item.meaning, sentenceLang, {
                        sourceLang: aiExplainSourceLang,
                        originalText: item.term,
                        isCancelled,
                    });
                }
            } else {
                if (item.term) {
                    await speakUntilFinished(item.term, aiExplainSourceLang, {
                        sourceLang: aiExplainSourceLang,
                        originalText: item.term,
                        isCancelled,
                    });
                }
                if (isCancelled()) return;

                const detailLang =
                    aiExplainMode === "simple_target"
                        ? aiExplainSourceLang
                        : aiExplainTargetLang;

                const explanationSpeech = [item.meaning, item.explanation]
                    .filter(Boolean)
                    .join(". ");
                if (explanationSpeech) {
                    await speakUntilFinished(
                        explanationSpeech,
                        detailLang,
                        {
                            sourceLang: aiExplainSourceLang,
                            originalText: item.term,
                            isCancelled,
                        },
                    );
                }
            }

            if (isCancelled()) return;

            // Sequential advance: only advance if not manually disabled by user interaction!
            if (!aiAutoAdvanceDisabled && aiExplainIndex + 1 < aiExplainQueue.length) {
                clearTimeout(aiAutoAdvanceTimer);
                aiAutoAdvanceTimer = setTimeout(() => {
                    if (isCancelled() || aiAutoAdvanceDisabled) return;
                    showAiExplainItem(aiExplainIndex + 1);
                }, 500);
            }
        } catch (_) {
            // Speech cancellation or error is handled gracefully
        } finally {
            if (speakBtn && speakBtn.isConnected && !aiAutoAdvanceTimer) {
                speakBtn.classList.remove("speaking");
                speakBtn.setAttribute(
                    "aria-label",
                    "Odtwórz wymowę",
                );
            }
        }
    }

    function ensureAiExplainKeydownListener() {
        if (aiExplainKeydownHandler) return;
        aiExplainKeydownHandler = (ev) => {
            const isTyping =
                ["INPUT", "TEXTAREA"].includes(ev.target?.tagName) ||
                ev.target?.isContentEditable;
            if (isTyping) return;

            if (ev.key === "w" || ev.key === "W") {
                if (aiTooltipActive) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    replayCurrentAiExplainTts();
                }
                return;
            }

            if (ev.key === "z" || ev.key === "Z") {
                if (aiTooltipActive) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    saveCurrentAiExplainItem();
                }
                return;
            }

            if (ev.key === "Escape") {
                ev.preventDefault();
                ev.stopPropagation();
                ev.stopImmediatePropagation();
                closeAiTooltip({ resumeVideo: true });
                return;
            }

            if (ev.key === "ArrowRight" || ev.key === "d" || ev.key === "D") {
                if (aiTooltipActive && aiExplainQueue.length > 1) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    navigateAiExplain(1, { manual: true });
                }
                return;
            }

            if (ev.key === "ArrowLeft" || ev.key === "a" || ev.key === "A") {
                if (aiTooltipActive && aiExplainQueue.length > 1) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    navigateAiExplain(-1, { manual: true });
                }
                return;
            }
        };
        window.addEventListener("keydown", aiExplainKeydownHandler, true);
    }

    function showAiExplainItem(index, { manual = false } = {}) {
        if (!aiTooltipActive || !aiExplainQueue.length) return;
        if (manual) {
            aiAutoAdvanceDisabled = true;
        }
        const clampedIndex = Math.max(
            0,
            Math.min(aiExplainQueue.length - 1, index),
        );
        aiExplainIndex = clampedIndex;
        const item = aiExplainQueue[clampedIndex];

        clearTimeout(aiAutoAdvanceTimer);
        aiAutoAdvanceTimer = null;
        const speechToken = ++aiExplainSpeechToken;
        SharedTtsService.cancel();

        ensureAiExplainKeydownListener();

        removeSubtitleTranslationUnderOriginal();

        // 1. Highlight active and upcoming terms on the film subtitle!
        updateSubtitleVideoHighlights();

        // 2. Render and reveal AI card
        const html = renderAiExplainContent(clampedIndex);
        const copy = applyAiExplanation(html, aiExplainLayout);

        // Ribbon pills click navigation
        copy.querySelectorAll(`.${PREFIX}ai-queue-pill`).forEach((pill) => {
            pill.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const targetIdx = parseInt(pill.dataset.index, 10);
                if (!isNaN(targetIdx) && targetIdx !== aiExplainIndex) {
                    showAiExplainItem(targetIdx, { manual: true });
                }
            });
        });

        // Navigation stepper buttons
        copy.querySelector(`.${PREFIX}ai-prev-btn`)?.addEventListener(
            "click",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateAiExplain(-1, { manual: true });
            },
        );
        copy.querySelector(`.${PREFIX}ai-next-btn`)?.addEventListener(
            "click",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateAiExplain(1, { manual: true });
            },
        );

        wireAiExplainSpeakButton(item);
        wireAiExplainSaveButton(item);

        if (aiTooltipActive) {
            speakAiExplainItem(item, speechToken);
        }
    }

    function navigateAiExplain(delta, { manual = false } = {}) {
        if (!aiTooltipActive || !aiExplainQueue.length) return false;
        const target = aiExplainIndex + delta;
        if (target < 0 || target >= aiExplainQueue.length) {
            return true;
        }
        showAiExplainItem(target, { manual });
        return true;
    }

    function nextAiExplainItem(options = { manual: true }) {
        return navigateAiExplain(1, options);
    }

    function prevAiExplainItem(options = { manual: true }) {
        return navigateAiExplain(-1, options);
    }

    function replayCurrentAiExplainTts() {
        if (!aiTooltipActive || !aiExplainQueue.length) return false;
        const item = aiExplainQueue[aiExplainIndex];
        if (!item) return false;

        clearTimeout(aiAutoAdvanceTimer);
        aiAutoAdvanceTimer = null;
        aiAutoAdvanceDisabled = true;

        SharedTtsService.cancel();
        const speechToken = ++aiExplainSpeechToken;
        speakAiExplainItem(item, speechToken);
        return true;
    }

    function saveCurrentAiExplainItem() {
        if (!aiTooltipActive) return false;
        const currentSaveBtn = translationOverlay?.querySelector(
            `.${PREFIX}save-word-btn, .${PREFIX}ai-explain-save-btn`,
        );
        if (currentSaveBtn && document.contains(currentSaveBtn)) {
            currentSaveBtn.click();
            return true;
        }
        return false;
    }

    function wireAiSentenceSaveButton(saveAiBtn, tooltipNode, item) {
        if (!saveAiBtn) return;
        const currentItem = item || aiExplainQueue[aiExplainIndex] || {};

        if (aiAiSavedIndices.has(aiExplainIndex)) {
            saveAiBtn.innerHTML = `${SVG.SAVE_AI_CHECK} <span>Saved to Review!</span>`;
            saveAiBtn.classList.add("saved");
            saveAiBtn.disabled = true;
        }

        saveAiBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (
                saveAiBtn.classList.contains("saved") ||
                saveAiBtn.classList.contains("loading")
            ) {
                return;
            }

            saveAiBtn.classList.add("loading");
            saveAiBtn.disabled = true;
            saveAiBtn.innerHTML = `<span class="ai-loader-label">✨ Generating…</span>`;

            try {
                const targetVideo =
                    activeAiVideo ||
                    trackedVideo ||
                    getPlayerRegistry()?.getVideo();
                const screenshot =
                    await getPlayerRegistry()?.captureVideoReviewScreenshot(
                        targetVideo,
                    );

                const cleanedTerm =
                    cleanCardText(currentItem.term) || currentItem.term;
                let cleanedMeaning =
                    cleanCardText(currentItem.meaning || currentItem.translation) ||
                    currentItem.meaning ||
                    currentItem.translation ||
                    cleanedTerm;

                const targetNativeLang =
                    aiExplainTargetLang || (await QT.getTargetLang?.()) || "pl";

                const result = await QT.geminiGenerateSentence(
                    cleanedTerm,
                    cleanedMeaning,
                    aiExplainSourceLang,
                    targetNativeLang,
                );

                const rawGenSentence =
                    cleanCardText(result?.sentence) || result?.sentence || "";
                const isRedundantGen = typeof isRedundantSentence === "function"
                    ? isRedundantSentence(rawGenSentence, cleanedTerm)
                    : rawGenSentence.trim().toLowerCase() === cleanedTerm.trim().toLowerCase();
                const genSentence = isRedundantGen ? "" : rawGenSentence;
                const genTranslation = isRedundantGen
                    ? ""
                    : cleanCardText(result?.translation) || result?.translation || "";

                await QT.saveWord({
                    original: cleanedTerm,
                    translated: cleanedMeaning,
                    srcLang: aiExplainSourceLang,
                    tgtLang: targetNativeLang,
                    sentence: genSentence,
                    sentenceTranslated: genTranslation,
                    aiSentence: genSentence,
                    aiSentenceTranslated: genTranslation,
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });

                aiAiSavedIndices.add(aiExplainIndex);
                saveAiBtn.classList.remove("loading");
                saveAiBtn.classList.add("saved");
                saveAiBtn.innerHTML = `${SVG.SAVE_AI_CHECK} <span>Saved to Review!</span>`;

                const termCard = tooltipNode?.querySelector(`.${PREFIX}ai-term-card`);
                if (termCard && genSentence) {
                    let aiResultWrap = termCard.querySelector(`.${PREFIX}ai-gen-result`);
                    if (!aiResultWrap) {
                        aiResultWrap = document.createElement("div");
                        aiResultWrap.className = `${PREFIX}ai-gen-result`;
                        aiResultWrap.style.cssText =
                            "margin-top:10px;padding:8px 12px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.25);border-radius:8px;font-size:12px;";
                        termCard.appendChild(aiResultWrap);
                    }
                    aiResultWrap.innerHTML = `<div style="color:#c084fc;font-weight:600;margin-bottom:3px;">✨ AI Sentence:</div><div style="color:#fff;margin-bottom:2px;">${QT.escapeHtml(genSentence)}</div><div style="color:rgba(255,255,255,0.7);font-size:11px;">${QT.escapeHtml(genTranslation)}</div>`;
                }
            } catch (err) {
                console.error("[Lectoro] Video card AI sentence error:", err);
                saveAiBtn.classList.remove("loading");
                saveAiBtn.disabled = false;
                saveAiBtn.innerHTML = `${SVG.SAVE_AI} <span style="color:#f87171;">Error</span>`;
                setTimeout(() => {
                    if (!saveAiBtn.classList.contains("saved")) {
                        saveAiBtn.innerHTML = `${SVG.SAVE_AI} <span>AI Sentence</span>`;
                    }
                }, 3000);
            }
        });
    }

    function wireAiExplainSaveButton(item) {
        const tooltipNode = translationOverlay || QT.getTooltipEl();
        const saveAiBtn = tooltipNode?.querySelector(`.${PREFIX}save-ai-btn`);
        if (saveAiBtn) {
            wireAiSentenceSaveButton(saveAiBtn, tooltipNode, item);
        }

        const saveBtn = tooltipNode?.querySelector(
            `.${PREFIX}save-word-btn, .${PREFIX}ai-explain-save-btn`,
        );
        if (!saveBtn) return;

        if (!saveBtn.querySelector(`.${PREFIX}key-hint`)) {
            const hintNode = document.createElement("kbd");
            hintNode.className = `${PREFIX}key-hint`;
            hintNode.textContent = "Z";
            saveBtn.appendChild(hintNode);
        }

        if (aiSavedIndices.has(aiExplainIndex)) {
            saveBtn.innerHTML = `<span>Saved!</span>`;
            saveBtn.classList.add("saved");
            saveBtn.disabled = true;
        }

        saveBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (
                saveBtn.classList.contains("saved") ||
                saveBtn.classList.contains("saving")
            ) {
                return;
            }

            saveBtn.classList.add("saving");
            saveBtn.disabled = true;
            saveBtn.innerHTML = `${SVG.SAVE} <span>Saving…</span><kbd class="${PREFIX}key-hint">Z</kbd>`;

            try {
                const targetVideo =
                    activeAiVideo ||
                    trackedVideo ||
                    getPlayerRegistry()?.getVideo();
                const screenshot =
                    await getPlayerRegistry()?.captureVideoReviewScreenshot(
                        targetVideo,
                    );
                const currentItem = item || aiExplainQueue[aiExplainIndex] || {};

                const cleanedTerm =
                    cleanCardText(currentItem.term) || currentItem.term;
                let cleanedMeaning =
                    cleanCardText(currentItem.meaning || currentItem.translation) ||
                    currentItem.meaning ||
                    currentItem.translation ||
                    cleanedTerm;
                const cleanedExplanation = cleanCardText(currentItem.explanation);
                const isSentenceCard = currentItem.type === "sentence";
                const rawContextSentence = isSentenceCard
                    ? ""
                    : cleanCardText(currentItem.originalText) || "";
                const isRedundant = typeof isRedundantSentence === "function"
                    ? isRedundantSentence(rawContextSentence, cleanedTerm)
                    : rawContextSentence.trim().toLowerCase() === cleanedTerm.trim().toLowerCase();
                const contextSentence = isRedundant ? "" : rawContextSentence;
                const rawSentenceTr =
                    currentItem.sentenceTranslated ||
                    aiExplainQueue.find((q) => q.sentenceTranslated)?.sentenceTranslated ||
                    aiExplainQueue.find((q) => q.type === "sentence")?.meaning ||
                    "";
                let contextSentenceTranslated = (isSentenceCard || isRedundant)
                    ? ""
                    : cleanCardText(rawSentenceTr) || "";

                // In AI mode (especially simple_target mode where definitions are in the target language,
                // or if meaning is missing/untranslated), ensure flashcard translation is in the user's native language!
                const targetNativeLang =
                    aiExplainTargetLang || (await QT.getTargetLang?.()) || "pl";
                let aiDefinition = "";

                if (aiExplainMode === "simple_target") {
                    // In simple_target mode, currentItem.meaning is a simplified target-language definition (e.g. English).
                    // Preserve that simple definition in aiSentence for learning,
                    // but translate the term and context sentence to the native language for the flashcard!
                    aiDefinition =
                        cleanedMeaning !== cleanedTerm ? cleanedMeaning : "";
                    try {
                        const trTerm = await QT.translate(
                            cleanedTerm,
                            targetNativeLang,
                        );
                        if (trTerm?.translated) {
                            cleanedMeaning =
                                cleanCardText(trTerm.translated) ||
                                trTerm.translated;
                        }
                    } catch (_) { }

                    if (contextSentence) {
                        try {
                            const trSent = await QT.translate(
                                contextSentence,
                                targetNativeLang,
                            );
                            if (trSent?.translated) {
                                contextSentenceTranslated =
                                    cleanCardText(trSent.translated) ||
                                    trSent.translated;
                            }
                        } catch (_) { }
                    }
                } else if (
                    !cleanedMeaning ||
                    cleanedMeaning.toLowerCase() === cleanedTerm.toLowerCase()
                ) {
                    try {
                        const trTerm = await QT.translate(
                            cleanedTerm,
                            targetNativeLang,
                        );
                        if (trTerm?.translated) {
                            cleanedMeaning =
                                cleanCardText(trTerm.translated) ||
                                trTerm.translated;
                        }
                    } catch (_) { }
                }

                const resolvedAiSentence = [aiDefinition, cleanedExplanation]
                    .filter(Boolean)
                    .join(" — ");

                await QT.saveWord({
                    original: cleanedTerm,
                    translated: cleanedMeaning,
                    srcLang: aiExplainSourceLang,
                    tgtLang: targetNativeLang,
                    sentence: contextSentence,
                    sentenceTranslated: contextSentenceTranslated,
                    aiSentence: resolvedAiSentence || cleanedExplanation || "",
                    aiSentenceTranslated: contextSentenceTranslated,
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });

                aiSavedIndices.add(aiExplainIndex);
                saveBtn.innerHTML = `${SVG.SAVE_CHECK} <span>Saved!</span>`;
                saveBtn.classList.remove("saving");
                saveBtn.classList.add("saved");
            } catch (error) {
                saveBtn.disabled = false;
                saveBtn.classList.remove("saving");
                saveBtn.innerHTML = `${SVG.SAVE} <span>Could not save</span><kbd class="${PREFIX}key-hint">Z</kbd>`;
                saveBtn.title = error.message;
            }
        });

        ensureAiExplainKeydownListener();
    }

    function wireAiExplainSpeakButton(item) {
        const speakBtn = translationOverlay?.querySelector(`.${PREFIX}speak`);
        if (!speakBtn) return;
        speakBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (speakBtn.classList.contains("speaking")) {
                clearTimeout(aiAutoAdvanceTimer);
                aiAutoAdvanceTimer = null;
                aiExplainSpeechToken++;
                SharedTtsService.cancel();
                speakBtn.classList.remove("speaking");
                speakBtn.setAttribute(
                    "aria-label",
                    "Play translation and explanation",
                );
                return;
            }
            clearTimeout(aiAutoAdvanceTimer);
            aiAutoAdvanceTimer = null;
            const currentToken = ++aiExplainSpeechToken;
            SharedTtsService.cancel();
            speakBtn.classList.add("speaking");
            speakBtn.setAttribute(
                "aria-label",
                "Playing translation and explanation",
            );
            try {
                if (item) {
                    await speakAiExplainItem(item, currentToken);
                } else {
                    await QT.speak(
                        speakBtn.dataset.text || "",
                        speakBtn.dataset.lang || "pl",
                        {
                            sourceLang: speakBtn.dataset.sourceLang,
                            originalText: speakBtn.dataset.originalText,
                            isCancelled: () =>
                                !aiTooltipActive || currentToken !== aiExplainSpeechToken,
                        },
                    );
                }
            } catch (_) {
                // Keep panel interactive
            } finally {
                if (speakBtn.isConnected) {
                    speakBtn.classList.remove("speaking");
                    speakBtn.setAttribute(
                        "aria-label",
                        "Play translation and explanation",
                    );
                }
            }
        });
    }

    function getActiveSubtitleContext(video = null, currentText = "") {
        const targetVideo = video || getPlayerRegistry()?.getVideo();
        const targetText = String(
            currentText ||
            activeText ||
            getPlayerRegistry()?.getCurrentText() ||
            "",
        ).trim();
        const registry = getPlayerRegistry();

        let context = { before: [], current: targetText, after: [] };

        if (typeof registry?.getSubtitleContext === "function") {
            context = registry.getSubtitleContext(targetVideo, targetText, {
                maxBefore: 2,
                maxAfter: 2,
            });
        }

        if (
            (!context.before || context.before.length === 0) &&
            recentSubtitlesHistory.length > 0
        ) {
            const hist = recentSubtitlesHistory.filter(
                (t) => t && t !== targetText,
            );
            if (hist.length > 0) {
                context.before = hist.slice(-2);
            }
        }

        return context;
    }

    function resolveAiBadge(
        badgeCandidate,
        type,
        isSimpleTargetMode,
        targetLangCode,
    ) {
        if (typeof badgeCandidate === "string" && badgeCandidate.trim()) {
            return badgeCandidate.trim();
        }
        const lang = isSimpleTargetMode
            ? aiExplainSourceLang
            : (targetLangCode || "pl").toLowerCase().slice(0, 2);
        const normType = String(type || "").toLowerCase().trim();

        const BADGE_MAP = {
            pl: {
                sentence: "Zdanie",
                idiom: "Idiom",
                phrasal_verb: "Czasownik złożony",
                slang: "Slang",
                vocabulary: "Słówko",
                word: "Słówko",
                expression: "Wyrażenie",
                collocation: "Kolokacja",
            },
            en: {
                sentence: "Sentence",
                idiom: "Idiom",
                phrasal_verb: "Phrasal Verb",
                slang: "Slang",
                vocabulary: "Word",
                word: "Word",
                expression: "Expression",
                collocation: "Collocation",
            },
            es: {
                sentence: "Oración",
                idiom: "Modismo",
                phrasal_verb: "Verbo frasal",
                slang: "Slang",
                vocabulary: "Palabra",
                word: "Palabra",
                expression: "Expresión",
                collocation: "Colocación",
            },
            de: {
                sentence: "Satz",
                idiom: "Redewendung",
                phrasal_verb: "Phrasal Verb",
                slang: "Slang",
                vocabulary: "Wort",
                word: "Wort",
                expression: "Ausdruck",
                collocation: "Kollokation",
            },
            fr: {
                sentence: "Phrase",
                idiom: "Idiome",
                phrasal_verb: "Verbe à particule",
                slang: "Argot",
                vocabulary: "Mot",
                word: "Mot",
                expression: "Expression",
                collocation: "Collocation",
            },
            it: {
                sentence: "Frase",
                idiom: "Modo di dire",
                phrasal_verb: "Verbo frasale",
                slang: "Slang",
                vocabulary: "Parola",
                word: "Parola",
                expression: "Espressione",
                collocation: "Collocazione",
            },
            uk: {
                sentence: "Речення",
                idiom: "Ідіома",
                phrasal_verb: "Фразове дієслово",
                slang: "Сленг",
                vocabulary: "Слово",
                word: "Слово",
                expression: "Вираз",
                collocation: "Колокація",
            },
            ru: {
                sentence: "Предложение",
                idiom: "Идиома",
                phrasal_verb: "Фразовый глагол",
                slang: "Сленг",
                vocabulary: "Слово",
                word: "Слово",
                expression: "Выражение",
                collocation: "Коллокация",
            },
            pt: {
                sentence: "Frase",
                idiom: "Expressão idiomática",
                phrasal_verb: "Phrasal Verb",
                slang: "Gíria",
                vocabulary: "Palavra",
                word: "Palavra",
                expression: "Expressão",
                collocation: "Colocação",
            },
            zh: {
                sentence: "句子",
                idiom: "成语/习语",
                phrasal_verb: "短语动词",
                slang: "俚语",
                vocabulary: "生词",
                word: "生词",
                expression: "短语",
                collocation: "搭配",
            },
            ja: {
                sentence: "文",
                idiom: "慣用句",
                phrasal_verb: "句動詞",
                slang: "スラング",
                vocabulary: "単語",
                word: "単語",
                expression: "表現",
                collocation: "連語",
            },
            ko: {
                sentence: "문장",
                idiom: "관용구",
                phrasal_verb: "구동사",
                slang: "속어",
                vocabulary: "단어",
                word: "단어",
                expression: "표현",
                collocation: "연어",
            },
        };

        const dict = BADGE_MAP[lang] || BADGE_MAP.en;
        return (
            dict[normType] ||
            dict.expression ||
            (isSimpleTargetMode ? "Word" : "Wyrażenie")
        );
    }

    async function handleAIExplain(video) {
        const registry = getPlayerRegistry();
        const text = activeText || registry?.getCurrentText();
        if (!text) return;
        const requestId = ++aiExplainRequestId;
        const isCurrent = () => aiTooltipActive && requestId === aiExplainRequestId;
        activeAiVideo = video || trackedVideo || registry?.getVideo?.() || null;
        cleanupReading();
        closeSubTooltip({ resumeVideo: false });

        if (eTranslateActive || wordCloudActive) {
            restoreOriginal();
        }

        aiTooltipActive = true;
        removeSubtitleTranslationUnderOriginal();
        try {
            document.body?.setAttribute("data-lectoro-ai-active", "true");
        } catch (_) { }
        pauseIfPlaying(video);
        QT.hideTooltip();

        const layout = captureSubtitleLayout();
        const rect = layout?.rect ||
            getSubtitleRect() || {
            left: window.innerWidth / 2 - 100,
            top: window.innerHeight - 150,
            width: 200,
            height: 50,
        };
        aiExplainLayout = layout || { rect };

        showAiShimmer(aiExplainLayout);
        try {
            const targetLang = await QT.getTargetLang();
            const aiExplanationLanguage =
                (await QT.getAiExplanationLanguage?.()) || "native";
            if (!isCurrent()) return;
            aiExplainMode = aiExplanationLanguage;
            const context = getActiveSubtitleContext(video, text);
            const knownSourceLang = await SharedTranslatorService.getLearningLang();
            if (!isCurrent()) return;
            const res = await QT.geminiExplainSentence(
                text,
                targetLang,
                context,
                { aiExplanationLanguage, sourceLang: knownSourceLang },
            );
            if (!isCurrent()) return;

            const sourceLang = knownSourceLang;
            if (!isCurrent()) return;

            aiExplainSourceLang = sourceLang;
            aiExplainTargetLang = aiExplanationLanguage === "simple_target" ? sourceLang : targetLang;
            aiSavedIndices.clear();
            aiAiSavedIndices.clear();

            const rawTranslation =
                res?.translation || res?.simple_sentence || "";
            let translation = typeof rawTranslation === "string"
                ? rawTranslation.trim()
                : String(rawTranslation || "").trim();

            // Keep every clause and intentional repetition in the subtitle.
            translation = translation.replace(/\s+/g, " ").trim();
            const explanation =
                res?.explanation || (typeof res === "string" ? res : "");

            const isSimpleTarget = aiExplainMode === "simple_target";
            const sentenceBadge = resolveAiBadge(
                res?.badge,
                "sentence",
                isSimpleTarget,
                aiExplainTargetLang,
            );
            const sentenceItem = {
                type: "sentence",
                title: sentenceBadge || (isSimpleTarget ? "Sentence" : "Zdanie"),
                term: text,
                meaning: translation,
                explanation: explanation,
                originalText: text,
                sentenceTranslated: translation,
                badge: sentenceBadge,
            };

            let breakdownItems = [];
            if (Array.isArray(res?.items) && res.items.length > 0) {
                breakdownItems = res.items.map((item) => ({
                    type: item.type || "idiom",
                    title: item.term,
                    term: item.term,
                    meaning: item.meaning || "",
                    explanation: item.explanation || "",
                    originalText: text,
                    sentenceTranslated: translation,
                    badge: resolveAiBadge(
                        item.badge,
                        item.type,
                        isSimpleTarget,
                        aiExplainTargetLang,
                    ),
                }));
            }

            // In Enter mode, the full sentence translation is ALWAYS the first stage (1/N)
            // in the queue, followed by subsequent breakdown items (idioms, phrasal verbs, words),
            // regardless of whether native or simple language mode is selected.
            if (breakdownItems.length > 0) {
                aiExplainQueue = [sentenceItem, ...breakdownItems];
            } else {
                aiExplainQueue = [sentenceItem];
            }

            aiAutoAdvanceDisabled = false;
            aiExplainIndex = 0;
            showAiExplainItem(0);
        } catch (err) {
            if (isCurrent()) {
                if (GeminiProxy.isLimitError(err)) {
                    closeAiTooltip();
                } else {
                    applyAiExplanation(
                        `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                        aiExplainLayout,
                    );
                }
            }
        }
    }

    function getSpeedOverlayParent(video) {
        if (document.fullscreenElement) return document.fullscreenElement;
        if (document.webkitFullscreenElement)
            return document.webkitFullscreenElement;

        const targetVideo = video || getPlayerRegistry()?.getVideo();
        const playerEl = findPlayerContainer(targetVideo);
        if (
            playerEl &&
            playerEl !== document.body &&
            playerEl !== document.documentElement
        ) {
            const rect = playerEl.getBoundingClientRect?.();
            if (rect && rect.height > 40 && rect.width > 40) {
                return playerEl;
            }
        }

        return QT.getOverlayParent();
    }

    function getSpeedOverlayEl(video) {
        const parent = getSpeedOverlayParent(video);

        if (!speedOverlayEl) {
            speedOverlayEl = document.createElement("div");
            speedOverlayEl.id = C.UI_IDS.SPEED_OVERLAY;
            parent.appendChild(speedOverlayEl);
        } else if (speedOverlayEl.parentElement !== parent) {
            parent.appendChild(speedOverlayEl);
        }

        const isFixed =
            parent === document.body || parent === document.documentElement;
        speedOverlayEl.classList.toggle(`${PREFIX}speed-fixed`, isFixed);

        if (!isFixed) {
            const computedPos = window.getComputedStyle(parent).position;
            if (computedPos === "static") {
                parent.style.position = "relative";
            }
        }

        return speedOverlayEl;
    }

    function showSpeedOverlay(speed, video) {
        const el = getSpeedOverlayEl(video);
        const formattedSpeed = `${Number(speed).toFixed(2)}x`;

        let valSpan = el.querySelector(`.${PREFIX}speed-value`);
        if (!valSpan) {
            el.innerHTML = `
                <span class="${PREFIX}speed-icon">${SVG.SPEED}</span>
                <span class="${PREFIX}speed-value">${formattedSpeed}</span>
            `;
        } else {
            valSpan.textContent = formattedSpeed;
        }

        clearTimeout(speedOverlayTimer);
        el.classList.remove("bump");
        void el.offsetWidth;
        el.classList.add("visible", "bump");

        speedOverlayTimer = setTimeout(() => {
            el.classList.remove("visible", "bump");
        }, SPEED_OVERLAY_MS);
    }

    // ── Word Cloud & Sentence Overlay ──────────────────────────────

    function removeWordClouds() {
        wordCloudEls.forEach(({ cloud, wrappers = [] }) => {
            cloud.remove();
            for (const wrapper of wrappers) {
                const parent = wrapper.parentNode;
                if (!parent) continue;
                while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
                wrapper.remove();
            }
        });
        wordCloudEls = [];
        document
            .querySelectorAll(`.${WORD_CLOUD_HIGHLIGHT_CLASS}`)
            .forEach((el) => {
                el.classList.remove(WORD_CLOUD_HIGHLIGHT_CLASS);
            });
        wordCloudActive = false;
    }

    function positionWordCloud(cloud, span, members = [span]) {
        if (!cloud?.isConnected || !span?.isConnected) return;
        const rects = members.filter((member) => member?.isConnected)
            .map((member) => member.getBoundingClientRect())
            .filter((rect) => rect.width > 0 || rect.height > 0);
        if (!rects.length) return;
        const rect = {
            left: Math.min(...rects.map((r) => r.left)),
            right: Math.max(...rects.map((r) => r.right)),
            top: Math.min(...rects.map((r) => r.top)),
            bottom: Math.max(...rects.map((r) => r.bottom)),
        };
        rect.width = rect.right - rect.left;
        const cloudRect = cloud.getBoundingClientRect();
        let left = rect.left + (rect.width - cloudRect.width) / 2;
        let top = rect.top - cloudRect.height + 12;
        left = Math.max(
            4,
            Math.min(left, window.innerWidth - cloudRect.width - 4),
        );
        if (top < 4) top = rect.bottom + 6;
        cloud.style.left = left + "px";
        cloud.style.top = top + "px";
    }

    function ensureSubtitleUiTracking() {
        if (subtitleUiTrackingFrame !== null) return;
        subtitleUiTrackingFrame = requestAnimationFrame(trackSubtitleUi);
    }

    function trackSubtitleUi() {
        subtitleUiTrackingFrame = null;
        if (translationOverlay?.isConnected) positionOverlay();

        for (const { cloud, span, members } of wordCloudEls) {
            positionWordCloud(cloud, span, members);
        }

        if (isSubHovering && subTooltipAnchor) {
            if (subTooltipAnchor.isConnected) {
                QT.positionTooltip(
                    subTooltipAnchor.getBoundingClientRect(),
                    "top",
                );
            } else {
                const { x, y } = QT.getMousePos();
                const replacementSpan = isOwnUI(document.elementFromPoint(x, y))
                    ? null
                    : QT.findWordAtPoint(x, y, SUB_WORD_CLASS);
                if (replacementSpan) {
                    subTooltipAnchor = replacementSpan;
                    lastHoveredSubWord = replacementSpan;
                    replacementSpan.classList.add(WORD_HOVER_CLASS);
                    QT.positionTooltip(
                        replacementSpan.getBoundingClientRect(),
                        "top",
                    );
                } else {
                    scheduleCloseSubTooltip();
                }
            }
        }

        if (
            translationOverlay?.isConnected ||
            wordCloudEls.length > 0 ||
            isSubHovering ||
            aiTooltipActive
        ) {
            subtitleUiTrackingFrame = requestAnimationFrame(trackSubtitleUi);
        }
    }

    async function showWordClouds(video, opts = { skipSpeech: false }) {
        const modeRevision = opts.revision ?? subtitleModeRevision;
        if (modeRevision !== subtitleModeRevision) return;

        const wordCloudWasPlaying = video ? !video.paused : false;
        wordCloudActive = true;
        pauseIfPlaying(video);

        const spans =
            activeWordSpans.length > 0
                ? activeWordSpans
                : opts.sourceElements ||
                getPlayerRegistry()?.getSubtitleElements() ||
                [];

        if (spans.length === 0) return;
        const fullText =
            opts.sourceText ||
            activeText ||
            getPlayerRegistry()?.getCurrentText() ||
            "";
        if (!fullText) return;

        const parent = QT.getOverlayParent();
        const wordSpans = [];

        for (const span of spans) {
            if (!span || !span.textContent?.trim()) continue;
            wordSpans.push(span);
            span.classList.remove(WORD_CLOUD_HIGHLIGHT_CLASS);
        }

        if (wordSpans.length === 0) {
            removeWordClouds();
            if (!opts.keepOriginalHidden) {
                globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(
                    false,
                );
            }
            if (wordCloudWasPlaying) resumeVideoAfterSubtitleClose(video);
            return;
        }

        const { targetLang, learningLang } = await SharedTranslatorService.getReadingSettings();
        if (modeRevision !== subtitleModeRevision) return;

        const translations = await SharedTranslatorService.lookupWords(
            wordSpans.map((span) => span.textContent.trim()),
            targetLang,
            learningLang,
            { wordByWord: true },
        );
        if (modeRevision !== subtitleModeRevision) return;

        const subFontSizePx =
            parseFloat(window.getComputedStyle(wordSpans[0]).fontSize) || 20;
        const cloudFontSize = Math.max(
            12,
            Math.min(18, Math.round(subFontSizePx * 0.55)),
        );

        wordSpans.forEach((span, i) => {
            const { translated, length = 1 } = translations[i] || {};
            if (typeof translated !== "string" || !translated.trim()) return;
            let members = wordSpans.slice(i, i + length);
            if (members.some((member) => !member.isConnected)) {
                const liveSpans = Array.from(
                    document.querySelectorAll(`.${SUB_WORD_CLASS}`),
                );
                const start = liveSpans.findIndex(
                    (candidate, index) => members.every((member, offset) =>
                        liveSpans[index + offset]?.textContent.trim() === member.textContent.trim()),
                );
                if (start < 0) return;
                members = liveSpans.slice(start, start + length);
            }
            const targetSpan = members[0];
            const rect = targetSpan.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            const wrappers = length > 1
                ? wrapMatchedSpans(members, WORD_CLOUD_HIGHLIGHT_CLASS, undefined, `${PREFIX}word-cloud-phrase`)
                : [];
            if (length === 1) targetSpan.classList.add(WORD_CLOUD_HIGHLIGHT_CLASS);
            const cloud = document.createElement("div");
            cloud.className = WORD_CLOUD_CLASS;
            cloud.textContent = translated;
            cloud.style.fontSize = cloudFontSize + "px";
            cloud.style.animationDelay = i * 0.02 + "s";
            parent.appendChild(cloud);
            wordCloudEls.push({ cloud, span: targetSpan, members, wrappers });
            positionWordCloud(cloud, targetSpan, members);
        });
        ensureSubtitleUiTracking();
    }

    function captureSubtitleLayout(elements = null) {
        const els =
            elements ||
            activeWordSpans ||
            getPlayerRegistry()?.getSubtitleElements() ||
            [];
        if (els.length === 0 && !customSubBoxEl) return null;
        const rect = getSubtitleRect(els);
        if (!rect) return null;
        const refEl = els[0] || customSubBoxEl;
        const cs = window.getComputedStyle(refEl);
        const lineTexts =
            activeLines.length > 0
                ? activeLines
                : els.map((el) => el.textContent.trim()).filter(Boolean);
        return {
            rect,
            fontSize: cs.fontSize,
            fontFamily: cs.fontFamily,
            fontStyle: cs.fontStyle,
            fontWeight: cs.fontWeight,
            lineHeight: cs.lineHeight,
            letterSpacing: cs.letterSpacing,
            wordSpacing: cs.wordSpacing,
            textAlign: cs.textAlign,
            lineTexts,
            lineLengths: lineTexts.map((line) => line.length || 1),
            lineWidths: [],
        };
    }

    function captureSubtitleSnapshot() {
        const elements =
            activeWordSpans.length > 0
                ? activeWordSpans
                : getPlayerRegistry()?.getSubtitleElements() || [];
        const text = activeText || getPlayerRegistry()?.getCurrentText() || "";
        return {
            elements,
            text,
            layout: captureSubtitleLayout(elements),
        };
    }

    function createSubtitleTranslationTask(text, modeRevision, layout = null) {
        return globalThis.LectoroReadingModes.translate(text, modeRevision, layout);
    }

    function getSubtitleRect(elements = null) {
        if (
            customSubBoxEl &&
            customSubBoxEl.isConnected &&
            activeLines.length > 0
        ) {
            const r = customSubBoxEl.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                return {
                    top: r.top,
                    bottom: r.bottom,
                    left: r.left,
                    right: r.right,
                    width: r.width,
                    height: r.height,
                };
            }
        }
        const els =
            elements ||
            activeWordSpans ||
            getPlayerRegistry()?.getSubtitleElements() ||
            [];
        if (els.length > 0) {
            let top = Infinity,
                bottom = -Infinity,
                left = Infinity,
                right = -Infinity;
            const maxRealisticSubtitleHeight = Math.min(
                180,
                window.innerHeight * 0.4,
            );
            for (const el of els) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                if (r.height > maxRealisticSubtitleHeight) continue;
                top = Math.min(top, r.top);
                bottom = Math.max(bottom, r.bottom);
                left = Math.min(left, r.left);
                right = Math.max(right, r.right);
            }
            if (
                top !== Infinity &&
                bottom - top <= maxRealisticSubtitleHeight
            ) {
                return {
                    top,
                    bottom,
                    left,
                    right,
                    width: right - left,
                    height: bottom - top,
                };
            }
        }
        const video = getPlayerRegistry()?.getVideo();
        if (video && video.isConnected) {
            const vr = video.getBoundingClientRect();
            return {
                left: vr.left + vr.width * 0.1,
                right: vr.right - vr.width * 0.1,
                top: vr.bottom - 90,
                bottom: vr.bottom - 30,
                width: vr.width * 0.8,
                height: 60,
            };
        }
        return null;
    }

    /**
     * Font size (px) the sentence translation should be scaled from: the captured layout's
     * subtitle font, else the live rendered subtitle, else the layer's CSS variable.
     */
    function getSubtitleSourceFontSize(layout) {
        const subtitleReference =
            activeWordSpans.find((span) => span.isConnected) ||
            customSubBoxEl?.querySelector(`.${PREFIX}custom-sub-line`) ||
            customSubBoxEl ||
            getPlayerRegistry()?.getSubtitleElements?.()?.[0];
        const liveFontSize = subtitleReference
            ? window.getComputedStyle(subtitleReference).fontSize
            : customSubLayerEl?.style?.getPropertyValue(
                "--lectoro-sub-font-size",
            ) || "";
        const sourceFontSize = Number.parseFloat(
            layout?.fontSize || liveFontSize,
        );
        return Number.isFinite(sourceFontSize) && sourceFontSize > 0
            ? sourceFontSize
            : null;
    }

    // The sentence translation follows the subtitle typography at 50% of its font size.
    const TRANSLATION_FONT_RATIO = 0.5;
    const TRANSLATION_FONT_FALLBACK_PX = 15;

    function applyTranslationFontSize(
        overlay,
        layout,
        { fallbackPx = null } = {},
    ) {
        if (!overlay) return;
        const sourceFontSize = getSubtitleSourceFontSize(layout);
        const effectiveSource =
            sourceFontSize ||
            (fallbackPx ? fallbackPx / TRANSLATION_FONT_RATIO : 24);

        overlay.style.setProperty(
            "--lectoro-sub-source-size",
            `${effectiveSource}px`,
        );

        if (sourceFontSize) {
            const translationFontSize =
                Math.round(sourceFontSize * TRANSLATION_FONT_RATIO * 100) / 100;
            overlay.style.setProperty(
                "--lectoro-translation-font-size",
                `${translationFontSize}px`,
            );
        } else if (fallbackPx !== null) {
            overlay.style.setProperty(
                "--lectoro-translation-font-size",
                `${fallbackPx}px`,
            );
        }

        // Enter AI explanation proportional font sizes (scaled percentage-wise to subtitle text, slightly more compact)
        const termSize =
            Math.round(Math.max(13, Math.min(30, effectiveSource * 0.58)) * 10) / 10;
        const meaningSize =
            Math.round(Math.max(12, Math.min(26, effectiveSource * 0.48)) * 10) / 10;
        const explanationSize =
            Math.round(Math.max(11, Math.min(20, effectiveSource * 0.40)) * 10) / 10;
        const metaSize =
            Math.round(Math.max(9, Math.min(15, effectiveSource * 0.30)) * 10) / 10;
        const sentenceTermSize =
            Math.round(Math.max(13, Math.min(26, effectiveSource * 0.40)) * 10) / 10;
        const sentenceMeaningSize = meaningSize;
        const badgeSize =
            Math.round(Math.max(7.5, Math.min(10.5, effectiveSource * 0.28)) * 10) / 10;

        overlay.style.setProperty("--lectoro-ai-term-font-size", `${termSize}px`);
        overlay.style.setProperty(
            "--lectoro-ai-meaning-font-size",
            `${meaningSize}px`,
        );
        overlay.style.setProperty(
            "--lectoro-ai-explanation-font-size",
            `${explanationSize}px`,
        );
        overlay.style.setProperty("--lectoro-ai-badge-font-size", `${badgeSize}px`);
        overlay.style.setProperty("--lectoro-ai-meta-font-size", `${metaSize}px`);
        overlay.style.setProperty(
            "--lectoro-ai-sentence-term-font-size",
            `${sentenceTermSize}px`,
        );
        overlay.style.setProperty(
            "--lectoro-ai-sentence-meaning-font-size",
            `${sentenceMeaningSize}px`,
        );
    }

    function createOverlay(layout = null) {
        removeOverlay();
        translationAnchorLayout = layout;
        translationOverlay = document.createElement("div");
        translationOverlay.id = C.UI_IDS.SENTENCE_TRANSLATION;
        translationOverlay.className = `${PREFIX}sub-overlay`;
        translationOverlay.setAttribute("role", "status");
        translationOverlay.setAttribute("aria-live", "polite");
        translationOverlay.setAttribute("aria-atomic", "true");

        // Keep clicks inside the interactive bubble away from page/player
        // click-away handlers. Button handlers still run before bubbling here.
        ["pointerdown", "mousedown", "mouseup", "click", "dblclick"].forEach(
            (eventName) => {
                translationOverlay.addEventListener(eventName, (event) => {
                    event.stopPropagation();
                });
            },
        );

        applyTranslationFontSize(translationOverlay, layout, {
            fallbackPx: TRANSLATION_FONT_FALLBACK_PX,
        });
        translationOverlay.style.setProperty("bottom", "auto", "important");
        translationOverlay.style.setProperty("right", "auto", "important");
        translationOverlay.style.setProperty("height", "auto", "important");
        translationOverlay.style.setProperty(
            "max-height",
            "min(560px, calc(100vh - 48px))",
            "important",
        );

        const parent = QT.getOverlayParent();
        parent.appendChild(translationOverlay);
        ensureSubtitleUiTracking();
        return translationOverlay;
    }

    function removeOverlay() {
        if (translationOverlay) {
            translationOverlay.remove();
            translationOverlay = null;
        }
        translationAnchorLayout = null;
    }

    function positionOverlay(layout = translationAnchorLayout) {
        if (!translationOverlay) return;

        // 1. Prioritize currently active highlighted term/phrase for ideal positioning!
        let anchorRect = null;
        const activeHighlight =
            document.querySelector(`.${C.UI_CLASSES.AI_SUB_ACTIVE}`) ||
            document.querySelector(
                `.${C.UI_CLASSES.AI_SUB_WRAP}.${C.UI_CLASSES.AI_SUB_ACTIVE}`,
            );
        if (activeHighlight && activeHighlight.isConnected) {
            const r = activeHighlight.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                anchorRect = r;
            }
        }

        // 2. Fallback: general subtitle bounds or layout rect
        const rect = anchorRect || getSubtitleRect() || layout?.rect;
        if (!rect) return;

        const viewportWidth = Math.max(1, window.innerWidth);
        const viewportHeight = Math.max(1, window.innerHeight);
        const maxAllowedHeight = Math.min(
            560,
            Math.max(100, viewportHeight - 48),
        );
        const bubbleRect = translationOverlay.getBoundingClientRect();
        const bubbleWidth =
            bubbleRect.width || Math.min(420, viewportWidth - 24);
        const bubbleHeight = Math.min(
            bubbleRect.height || 64,
            maxAllowedHeight,
        );
        const anchorCenter = rect.left + rect.width / 2;
        const edgeGap = 12;
        const bubbleGap = wordCloudActive ? 48 : 16;

        const left = Math.max(
            edgeGap,
            Math.min(
                anchorCenter - bubbleWidth / 2,
                viewportWidth - bubbleWidth - edgeGap,
            ),
        );
        const aboveTop = rect.top - bubbleHeight - bubbleGap;
        const placeBelow = aboveTop < edgeGap;
        const top = placeBelow
            ? Math.min(
                rect.bottom + bubbleGap,
                viewportHeight - bubbleHeight - edgeGap,
            )
            : aboveTop;
        translationOverlay.classList.toggle(
            `${PREFIX}bubble-below`,
            placeBelow,
        );
        translationOverlay.style.setProperty("left", `${left}px`, "important");
        translationOverlay.style.setProperty(
            "top",
            `${Math.max(edgeGap, top)}px`,
            "important",
        );
        translationOverlay.style.setProperty("bottom", "auto", "important");
        translationOverlay.style.setProperty("right", "auto", "important");
    }

    function revealOverlayContent(
        content,
        layout = translationAnchorLayout,
        ariaLabel = "Ready",
    ) {
        const overlay = translationOverlay || createOverlay(layout);

        // Measure the final content before the user can see it. Both sentence
        // translation and Enter analysis grow from their loading-state size
        // to the measured target through this exact same transition.
        const maxAllowedHeight = Math.min(
            560,
            Math.max(100, window.innerHeight - 48),
        );
        const loadingRect = overlay.getBoundingClientRect();
        const loadingClampedHeight = Math.min(
            loadingRect.height || 48,
            maxAllowedHeight,
        );
        overlay.classList.remove(`${PREFIX}translation-reveal`);
        overlay.dataset.state = "measuring";
        overlay.replaceChildren(content);

        const targetRect = overlay.getBoundingClientRect();
        const targetClampedHeight = Math.min(
            targetRect.height || 64,
            maxAllowedHeight,
        );
        const resolvedTargetWidth = Math.ceil(targetRect.width);

        overlay.style.setProperty(
            "width",
            `${loadingRect.width}px`,
            "important",
        );
        overlay.style.setProperty(
            "height",
            `${loadingClampedHeight}px`,
            "important",
        );
        overlay.dataset.state = "expanding";
        overlay.setAttribute("aria-label", ariaLabel);
        positionOverlay(layout);

        requestAnimationFrame(() => {
            if (overlay !== translationOverlay || !overlay.isConnected) return;
            overlay.style.setProperty(
                "width",
                `${resolvedTargetWidth}px`,
                "important",
            );
            overlay.style.setProperty(
                "height",
                `${targetClampedHeight}px`,
                "important",
            );

            setTimeout(() => {
                if (overlay !== translationOverlay || !overlay.isConnected)
                    return;
                overlay.dataset.state = "ready";
                overlay.style.removeProperty("width");
                overlay.style.removeProperty("height");
                overlay.style.setProperty("height", "auto", "important");
                overlay.classList.add(`${PREFIX}translation-reveal`);
                positionOverlay(layout);
            }, OVERLAY_REVEAL_MS);
        });
        return overlay;
    }

    /** Render `html` in the AI-explain overlay variant; returns the content node for wiring buttons. */
    function applyAiExplanation(
        html,
        layout = translationAnchorLayout,
        ariaLabel = "Sentence analysis",
    ) {
        const overlay = translationOverlay || createOverlay(layout);
        applyTranslationFontSize(overlay, layout, {
            fallbackPx: TRANSLATION_FONT_FALLBACK_PX,
        });
        overlay.classList.add(AI_EXPLAIN_OVERLAY_CLASS);
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-live", "off");
        const copy = document.createElement("div");
        copy.className = `${PREFIX}translation-copy ${PREFIX}ai-explain-copy`;
        copy.setAttribute("dir", "auto");
        copy.innerHTML = html;
        revealOverlayContent(copy, layout, ariaLabel);
        return copy;
    }

    function showReadingError(error, layout = translationAnchorLayout) {
        const rateLimited = error?.code === "RATE_LIMITED" || error?.status === 429;
        const message = rateLimited
            ? "Translation service is busy. Please try again shortly."
            : error?.runtimeError
                ? "Extension connection lost. Refresh this video page and try again."
                : "Could not translate subtitles. Please try again.";
        console.warn("[Lectoro] Subtitle translation failed:", error);
        const copy = applyAiExplanation(`
            <div class="${PREFIX}header">Translation unavailable</div>
            <div class="${PREFIX}body"><div class="${PREFIX}ai-text">${QT.escapeHtml(message)}</div></div>
            <div class="${PREFIX}save-footer"><button type="button" class="${PREFIX}save-word-btn">Try again</button></div>
        `, layout, "Translation unavailable");
        eTranslateActive = true;
        copy.querySelector(`.${PREFIX}save-word-btn`)?.addEventListener("click", () => {
            const video = getPlayerRegistry()?.getVideo();
            restoreOriginal();
            void globalThis.LectoroReadingModes.start(video);
        });
    }

    function showSubtitleLimitOverlay(quota, layout = translationAnchorLayout) {
        clearTimeout(quotaCountdownTimer);
        const resetAt =
            quota?.resetAt || Date.now() + (quota?.resetInMs || 3600000);

        function formatRemaining(ms) {
            const totalSec = Math.max(0, Math.ceil(ms / 1000));
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            return `${mins}m ${secs < 10 ? "0" : ""}${secs}s`;
        }

        const initialRemaining = formatRemaining(resetAt - Date.now());

        const html = `
            <div class="${PREFIX}header">
                <span>🔒 Limit darmowych napisów</span>
            </div>
            <div class="${PREFIX}body">
                <div style="padding: 8px 4px; font-size: 13px; line-height: 1.5; color: #f1f5f9;">
                    Wykorzystano darmowy limit <strong>${QT.escapeHtml(Number(quota.limit).toLocaleString("pl-PL"))} znaków / godzinę</strong>.<br>
                    <span style="color: #94a3b8; font-size: 12px;">Nowa pula darmowych napisów za: <strong style="color: #38bdf8;" class="${PREFIX}countdown-text">${initialRemaining}</strong></span>
                </div>
            </div>
            <div class="${PREFIX}save-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px;">
                <button type="button" class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn ${PREFIX}trial-cta-btn" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border: none; font-weight: 600; cursor: pointer; padding: 6px 14px; border-radius: 6px;">
                    Wypróbuj 3 dni za darmo →
                </button>
            </div>`;

        const effectiveLayout =
            layout || translationAnchorLayout || captureSubtitleLayout();
        const copy = applyAiExplanation(html, effectiveLayout, "Limit napisów");

        const ctaBtn = copy.querySelector(`.${PREFIX}trial-cta-btn`);
        ctaBtn?.addEventListener("click", () => {
            SubscriptionService.startCheckout("basic").catch(() => {
                SubscriptionService.openPlans();
            });
        });

        const countdownEl = copy.querySelector(`.${PREFIX}countdown-text`);
        function tick() {
            const rem = resetAt - Date.now();
            if (rem <= 0) {
                if (countdownEl) countdownEl.textContent = "odnowiono!";
                return;
            }
            if (countdownEl) countdownEl.textContent = formatRemaining(rem);
            quotaCountdownTimer = setTimeout(tick, 1000);
        }
        quotaCountdownTimer = setTimeout(tick, 1000);
        eTranslateActive = true;
    }

    async function doSentenceTranslation(
        video,
        sourceText = null,
        options = {},
    ) {
        const modeRevision = options.revision ?? subtitleModeRevision;
        if (modeRevision !== subtitleModeRevision) return;
        const text =
            sourceText || activeText || getPlayerRegistry()?.getCurrentText();
        if (!text) return;

        eTranslateActive = true;
        try {
            document.body?.setAttribute(
                "data-lectoro-sub-translate-active",
                "true",
            );
        } catch (_) { }
        pauseIfPlaying(video);

        const layout = options.layout || captureSubtitleLayout();
        showAiShimmer(layout);
        let translation;
        try {
            translation = await (options.translationTask ||
                createSubtitleTranslationTask(text, modeRevision, layout));
        } catch (error) {
            if (modeRevision === subtitleModeRevision) {
                removeAiShimmer();
            }
            throw error;
        }
        if (modeRevision !== subtitleModeRevision) return;
        if (!translation || translation.limitReached) {
            if (!translation?.limitReached) removeAiShimmer();
            return;
        }

        subtitleTranslationLang = translation.targetLang;
        applyAiExplanation(
            `<div class="${PREFIX}body"><div class="${PREFIX}ai-text">${QT.escapeHtml(translation.translatedText)}</div></div>`,
            layout,
            "Subtitle translation",
        );

        if (options.speakTranslated) {
            translationOverlay?.classList.add(`${PREFIX}speaking`);
            try {
                await QT.speak(translation.translatedText, translation.targetLang, {
                    isCancelled: () => modeRevision !== subtitleModeRevision,
                });
            } catch (error) {
                console.warn("[Lectoro] Subtitle speech failed:", error);
            } finally {
                if (modeRevision === subtitleModeRevision) translationOverlay?.classList.remove(`${PREFIX}speaking`);
            }
        }
    }

    function restoreOriginal() {
        clearTimeout(quotaCountdownTimer);
        quotaCountdownTimer = null;
        subtitleModeRevision += 1;
        subtitleModeStarting = false;
        try {
            document.body?.removeAttribute("data-lectoro-sub-translate-active");
        } catch (_) { }
        removeOverlay();
        removeWordClouds();
        globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(false);
        eTranslateActive = false;
        wordCloudActive = false;
        cleanupReading();
        removeSubtitleTranslationUnderOriginal();
        SharedTtsService.cancel();

        if (customSubBoxEl && activeLines.length > 0) {
            customSubBoxEl.style.setProperty("opacity", "1", "important");
            customSubBoxEl.style.setProperty(
                "pointer-events",
                "auto",
                "important",
            );
        }
    }

    QT.addDismissHandler(() => {
        if (isSentenceOverlayOpen()) restoreOriginal();
    });

    // Auto-dismiss overlays and tooltips when video resumes playing or seeks
    function handleVideoPlaybackStarted(e) {
        if (e.target?.tagName !== "VIDEO") return;
        if (isSentenceOverlayOpen()) {
            restoreOriginal();
        }
        if (isSubHovering || subClickLocked) {
            closeSubTooltip({ resumeVideo: false });
        }
        if (aiTooltipActive) {
            closeAiTooltip({ resumeVideo: false });
        }
    }

    for (const eventName of ["play", "playing", "seeked"]) {
        document.addEventListener(eventName, handleVideoPlaybackStarted, true);
    }

    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape") {
                if (isSentenceOverlayOpen()) {
                    restoreOriginal();
                }
                if (isSubHovering || subClickLocked) {
                    closeSubTooltip({ resumeVideo: false });
                }
            }
        },
        true,
    );

    function resumeVideoAfterSubtitleClose(preferredVideo) {
        const resumeRevision = ++subtitleResumeRevision;
        const tryResume = () => {
            if (resumeRevision !== subtitleResumeRevision) return;
            const video = preferredVideo?.isConnected
                ? preferredVideo
                : getPlayerRegistry()?.getVideo();
            if (!video || video.ended || !video.paused) return;
            getPlayerRegistry()?.playVideo(video);
        };

        tryResume();
        requestAnimationFrame(tryResume);
        setTimeout(tryResume, 120);
        setTimeout(tryResume, 400);
    }

    // ── Save Sentence to Review ("Z") ─────────────────────────────

    function flashCapture() {
        const parent = QT.getOverlayParent();
        const flash = document.createElement("div");
        flash.className = `${PREFIX}capture_flash`;
        parent.appendChild(flash);
        requestAnimationFrame(() => {
            flash.style.opacity = "0.35";
            setTimeout(() => (flash.style.opacity = "0"), 90);
        });
        setTimeout(() => flash.remove(), 500);
    }

    function getSaveToastEl() {
        const parent = QT.getOverlayParent();
        if (!saveToastEl) {
            saveToastEl = document.createElement("div");
            saveToastEl.id = SAVE_TOAST_ID;
            saveToastEl.title = "Click to close and resume playback";
            saveToastEl.addEventListener("click", dismissSaveToastNow);
            parent.appendChild(saveToastEl);
        } else if (saveToastEl.parentElement !== parent) {
            parent.appendChild(saveToastEl);
        }
        return saveToastEl;
    }

    function hideSaveToast() {
        clearTimeout(saveToastHideTimer);
        if (saveToastEl) saveToastEl.classList.remove("visible");
    }

    function showSaveToast(
        state,
        {
            text = "",
            translated = "",
            thumb = "",
            duration = SAVE_TOAST_SAVING_MS,
        } = {},
    ) {
        const el = getSaveToastEl();
        clearTimeout(saveToastHideTimer);
        el.className = `${PREFIX}${state}`;

        let iconHtml;
        let title;
        let bodyHtml;
        let thumbHtml = "";
        const textHtml = `<div class="${PREFIX}save_toast_text">${QT.escapeHtml(text)}</div>`;

        if (state === "saving") {
            iconHtml = `<span class="ai-loader-label ${PREFIX}save_toast_sparkle">✨</span>`;
            title = `<span class="ai-loader-label">Saving sentence…</span>`;
            bodyHtml = textHtml;
        } else if (state === "success") {
            iconHtml = `<div class="${PREFIX}check_pop">${SVG.SAVE_SENTENCE_CHECK}</div>`;
            title = "✔ Saved for review";
            bodyHtml = `
                ${textHtml}
                ${translated && translated !== text
                    ? `<div class="${PREFIX}save_toast_sub">${QT.escapeHtml(translated)}</div>`
                    : ""
                }
            `;
            if (thumb)
                thumbHtml = `<img class="${PREFIX}save_toast_thumb" src="${QT.escapeAttr(thumb)}" alt="" />`;
        } else {
            iconHtml = `<div class="${PREFIX}error_mark">!</div>`;
            title = "⚠ Could not save";
            bodyHtml = textHtml;
        }

        el.innerHTML = `
            <div class="${PREFIX}save_toast_icon">${iconHtml}</div>
            <div class="${PREFIX}save_toast_body">
                <div class="${PREFIX}save_toast_title">${title}</div>
                ${bodyHtml}
            </div>
            ${thumbHtml}
            <div class="${PREFIX}save_toast_bar" style="animation-duration:${duration}ms"></div>
        `;

        requestAnimationFrame(() => el.classList.add("visible"));
        saveToastHideTimer = setTimeout(hideSaveToast, duration);
    }

    function resumeAfterSave() {
        pausedForSave = false;
        if (wasPlayingBeforeSave) {
            const video = getPlayerRegistry()?.getVideo();
            if (video && video.paused) getPlayerRegistry()?.playVideo(video);
        }
    }

    function dismissSaveToastNow() {
        clearTimeout(saveResumeTimer);
        hideSaveToast();
        if (pausedForSave) resumeAfterSave();
    }

    async function saveCurrentSentenceToReview() {
        if (savingSentence) return;
        const registry = getPlayerRegistry();
        const text = activeText || registry?.getCurrentText();
        if (!text) {
            QT.createHint(C.UI_CLASSES.SUB_HINT).show(
                "No subtitles to save",
                2000,
            );
            return;
        }

        savingSentence = true;
        clearTimeout(saveResumeTimer);

        const video = registry.getVideo();
        if (!pausedForSave) {
            wasPlayingBeforeSave = !!(video && !video.paused);
            if (wasPlayingBeforeSave) registry?.pauseVideo(video);
            pausedForSave = true;
        }

        const cleanedText = cleanCardText(text) || text;

        const screenshot = await registry.captureVideoReviewScreenshot(video);
        flashCapture();
        showSaveToast("saving", { text: cleanedText });

        try {
            const targetLang = await QT.getTargetLang();
            const { translated, detectedLang } = await QT.translate(
                cleanedText,
                targetLang,
            );
            const srcLang =
                typeof detectedLang === "string" ? detectedLang : "auto";
            const cleanedTranslated =
                cleanCardText(translated) || translated || cleanedText;

            await QT.saveWord({
                original: cleanedText,
                translated: cleanedTranslated,
                srcLang,
                tgtLang: targetLang,
                sentence: "",
                sentenceTranslated: "",
                aiSentence: "",
                aiSentenceTranslated: "",
                screenshot,
                url: window.location.href,
                timestamp: Date.now(),
                downloaded: false,
            });

            showSaveToast("success", {
                text: cleanedText,
                translated: cleanedTranslated,
                thumb: screenshot,
                duration: SAVE_TOAST_SUCCESS_MS,
            });
            saveResumeTimer = setTimeout(
                resumeAfterSave,
                SAVE_TOAST_SUCCESS_MS,
            );
        } catch (err) {
            console.error("[Lectoro] saveCurrentSentence error:", err);
            showSaveToast("error", {
                text: "Could not save sentence",
                duration: SAVE_TOAST_ERROR_MS,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, SAVE_TOAST_ERROR_MS);
        } finally {
            savingSentence = false;
        }
    }

    const SubtitleOverlay = {
        renderCustomSubtitles,
        getCustomSubtitleElements: () => activeWordSpans,
        getActiveLines: () => activeLines,
        getActiveText: () => activeText,
        getActiveSubtitleContext,
        closeSubTooltip,
        handleAIExplain,
        closeAiTooltip,
        saveCurrentAiExplainItem,
        isAiTooltipActive: () => aiTooltipActive,
        navigateAiExplain,
        nextAiExplainItem,
        prevAiExplainItem,
        replayCurrentAiExplainTts,
        resolveAiBadge,
        isSubtitleUiOpen: () =>
            eTranslateActive ||
            wordCloudActive ||
            subtitleModeStarting ||
            (!aiTooltipActive && (translationOverlay?.isConnected ?? false)),
        showWordClouds,
        removeWordClouds,
        doSentenceTranslation,
        restoreOriginal,
        resumeVideoAfterSubtitleClose,
        saveCurrentSentenceToReview,
        showSpeedOverlay,
        captureSubtitleSnapshot,
        createSubtitleTranslationTask,
        showSubtitleLimitOverlay,
        showReadingError,
        getSubtitleRect,
        syncCustomSubtitlePosition,
        showSubtitleTranslationUnderOriginal,
        removeSubtitleTranslationUnderOriginal,
        adjustSubtitlePositionForTranslation,
        getAiSubTranslationElement: () => aiSubTranslationEl,
        getCurrentSubBottomPx: () => currentSubBottomPx,
        get subtitleModeRevision() {
            return subtitleModeRevision;
        },
        nextSubtitleModeRevision() {
            subtitleModeStarting = true;
            subtitleResumeRevision += 1;
            return ++subtitleModeRevision;
        },
        resetSubtitleModeStarting() {
            subtitleModeStarting = false;
        },
    };

    globalThis.LectoroSubtitleOverlay = SubtitleOverlay;
})();
