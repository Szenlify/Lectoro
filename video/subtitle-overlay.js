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
    const { cleanCardText } = SharedUtils;
    const SUB_WORD_CLASS = C.UI_CLASSES.SUB_WORD;
    const WORD_CLOUD_CLASS = C.UI_CLASSES.WORD_CLOUD;
    const WORD_HOVER_CLASS = `${PREFIX}word-hover`;
    const WORD_CLOUD_HIGHLIGHT_CLASS = `${PREFIX}word-cloud-highlight`;
    const AI_EXPLAIN_OVERLAY_CLASS = `${PREFIX}ai-explain-overlay`;
    const TTS_QUOTE_CLASS = `${PREFIX}tts-original-quote`;
    const SAVE_TOAST_ID = C.UI_IDS.SAVE_TOAST;

    const subCache = QT.createTranslateCache(300);
    const sentenceSubCache = QT.createTranslateCache(150);
    const wordCloudCache = subCache;
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
    let activeLines = [];
    let activeText = "";
    let activeWordSpans = [];
    let trackedVideo = null;
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
    let aiExplainTargetLang = "pl";
    let aiExplainLayout = null;
    let aiExplainSpeechToken = 0;
    let aiAutoAdvanceTimer = null;
    const aiSavedIndices = new Set();

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

    const SIMPLE_WORDS = new Set([
        "an",
        "oh",
        "uh",
        "ah",
        "a",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "can't",
        "could",
        "did",
        "do",
        "does",
        "for",
        "from",
        "had",
        "has",
        "have",
        "he",
        "her",
        "here",
        "his",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "me",
        "my",
        "not",
        "of",
        "on",
        "or",
        "our",
        "she",
        "should",
        "so",
        "some",
        "that",
        "the",
        "their",
        "them",
        "there",
        "they",
        "this",
        "to",
        "too",
        "us",
        "was",
        "we",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "will",
        "with",
        "won't",
        "would",
        "you",
        "your",
        "yours",
    ]);

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
                    } catch (_) {}
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

            layer.style.setProperty(
                "--lectoro-sub-bottom",
                `${baseBottomPx}px`,
            );
            box.style.marginBottom = `${baseBottomPx}px`;
        });
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
        } catch (_) {}
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

            for (const token of SharedPhraseDetector.tokenizeSubtitleLine(
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
            const targetLang = await QT.getTargetLang();
            const res = await subCache.get(text, targetLang);
            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;

            const srcLang =
                typeof res.detectedLang === "string"
                    ? res.detectedLang
                    : "auto";
            const html = QT.buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated: res.translated,
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
                wordCloudActive
            ) {
                if (isSubHovering && !subClickLocked) closeSubTooltip();
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
        "click",
        (e) => {
            const registry = getPlayerRegistry();
            const video = registry?.getVideo();
            if (!video?.isConnected) return;
            if (isOwnUI(e.target)) return;
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
        clearTimeout(aiAutoAdvanceTimer);
        aiAutoAdvanceTimer = null;
        aiExplainSpeechToken++;
        aiExplainQueue = [];
        aiExplainIndex = 0;
        aiExplainLayout = null;
        aiSavedIndices.clear();
        clearSubtitleVideoHighlights();
        QT.hideTooltip();
        removeAiShimmer();
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

    function normalizeLanguageCode(value, fallback = "") {
        const raw = String(value || "")
            .trim()
            .toLowerCase();
        if (!raw) return fallback;

        const codeCandidate = raw.replace(/_/g, "-").split("-")[0];
        if (/^[a-z]{2,3}$/.test(codeCandidate)) return codeCandidate;

        for (const [code, language] of Object.entries(C.SUPPORTED_LANGUAGES)) {
            const names = [language?.name, language?.native]
                .filter(Boolean)
                .map((name) => String(name).trim().toLowerCase());
            if (names.includes(raw)) return code;
        }
        return fallback;
    }

    function languageTag(code) {
        if (code && code !== "auto" && code !== "?") {
            return QT.langTag(code);
        }
        const playerLang =
            getPlayerRegistry()?.getCurrentLanguage?.() ||
            getPlayerRegistry()?.getTrackLanguage?.();
        if (playerLang && playerLang !== "auto") {
            return QT.langTag(playerLang);
        }
        return "EN";
    }

    async function detectSourceLanguage(text, targetLang, aiResult) {
        const fromAi = normalizeLanguageCode(aiResult?.detectedLang);
        if (fromAi) return fromAi;
        try {
            const detection = await QT.translate(text, targetLang);
            return normalizeLanguageCode(detection?.detectedLang, "auto");
        } catch (_) {
            return "auto";
        }
    }

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
        } catch (_) {}
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

    function wrapMatchedSpans(matchingSpans, cssClass) {
        if (!matchingSpans || matchingSpans.length === 0) return;

        // Group consecutive spans by parent container
        const groups = [];
        let currentGroup = [];
        let currentParent = null;

        for (const span of matchingSpans) {
            if (!span || !span.isConnected) continue;

            // If already wrapped in an existing ai-sub-wrap, update class
            const existingWrap = span.closest(`.${C.UI_CLASSES.AI_SUB_WRAP}`);
            if (existingWrap) {
                existingWrap.className = `${C.UI_CLASSES.AI_SUB_WRAP} ${cssClass}`;
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
                }
                continue;
            }

            const wrapper = document.createElement("span");
            wrapper.className = `${C.UI_CLASSES.AI_SUB_WRAP} ${cssClass}`;
            parent.insertBefore(wrapper, first);
            for (const node of nodesToWrap) {
                wrapper.appendChild(node);
            }
        }
    }

    function highlightSpansForTerm(spans, term, cssClass) {
        const range = findMatchingSpanRange(spans, term);
        if (!range) return;
        const matchingSpans = spans.slice(
            range.startIndex,
            range.startIndex + range.count,
        );
        wrapMatchedSpans(matchingSpans, cssClass);
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

        // 1. Highlight all upcoming & queued breakdown terms in soft violet
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
                    const icon = "✨";
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

        const formattedExplanation = QT.formatSpeechMarkup(
            item.explanation || "",
            aiExplainTargetLang,
            markupOptions,
        );
        const speechParts = [item.term, item.meaning, item.explanation]
            .filter(Boolean)
            .join(". ");

        const bodyHtml = `
            <div class="${PREFIX}body">
                <div class="${PREFIX}ai-term-card" data-type="${QT.escapeAttr(item.type || "")}">
                    <div class="${PREFIX}ai-term-header">
                        <div class="${PREFIX}ai-term-title-wrap">
                            <span class="${PREFIX}ai-term">${QT.escapeHtml(item.term)}</span>
                            <span class="${PREFIX}ai-badge">${QT.escapeHtml(item.badge || item.type)}</span>
                        </div>
                        <span class="${PREFIX}word-actions">
                            <button class="${PREFIX}speak" data-text="${QT.escapeAttr(speechParts)}" data-lang="${QT.escapeAttr(aiExplainTargetLang)}" data-source-lang="${QT.escapeAttr(aiExplainSourceLang)}" data-original-text="${QT.escapeAttr(item.term)}" title="Odtwórz wymowę i wyjaśnienie" aria-label="Odtwórz wymowę i wyjaśnienie">${SVG.SPEAKER}</button>
                        </span>
                    </div>
                    ${
                        item.meaning
                            ? `
                    <div class="${PREFIX}ai-term-meaning">
                        ${QT.escapeHtml(item.meaning)}
                    </div>`
                            : ""
                    }
                    ${
                        item.explanation
                            ? `
                    <div class="${PREFIX}ai-term-explanation">
                        ${formattedExplanation}
                    </div>`
                            : ""
                    }
                </div>
            </div>`;

        const isSaved = aiSavedIndices.has(index);
        const footerHtml = `
            <div class="${PREFIX}save-footer">
                <button class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn ${isSaved ? "saved" : ""}" ${isSaved ? "disabled" : ""} title="Save for review (Z)">
                    ${isSaved ? "<span>Saved!</span>" : `${SVG.SAVE} <span>Save</span><kbd class="${PREFIX}key-hint">Z</kbd>`}
                </button>
            </div>`;

        return (headerHtml ? headerHtml : "") + bodyHtml + footerHtml;
    }

    async function speakAiExplainItem(item, speechToken) {
        if (!aiTooltipActive || speechToken !== aiExplainSpeechToken || !item) return;

        const isCancelled = () =>
            !aiTooltipActive || speechToken !== aiExplainSpeechToken;

        try {
            if (item.type === "sentence") {
                const aiSpeechText = [item.meaning, item.explanation]
                    .filter(Boolean)
                    .join(". ");
                if (aiSpeechText) {
                    await QT.speak(aiSpeechText, aiExplainTargetLang, {
                        sourceLang: aiExplainSourceLang,
                        originalText: item.term,
                        isCancelled,
                    });
                }
            } else {
                if (item.term) {
                    await QT.speak(item.term, aiExplainSourceLang, {
                        sourceLang: aiExplainSourceLang,
                        originalText: item.term,
                        isCancelled,
                    });
                }
                if (isCancelled()) return;

                const explanationSpeech = [item.meaning, item.explanation]
                    .filter(Boolean)
                    .join(". ");
                if (explanationSpeech) {
                    await QT.speak(explanationSpeech, aiExplainTargetLang, {
                        sourceLang: aiExplainSourceLang,
                        originalText: item.term,
                        isCancelled,
                    });
                }
            }
        } catch (_) {
            // Speech cancellation or error is handled gracefully
        }
    }

    function showAiExplainItem(index) {
        if (!aiTooltipActive || !aiExplainQueue.length) return;
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
                    showAiExplainItem(targetIdx);
                }
            });
        });

        // Navigation stepper buttons
        copy.querySelector(`.${PREFIX}ai-prev-btn`)?.addEventListener(
            "click",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateAiExplain(-1);
            },
        );
        copy.querySelector(`.${PREFIX}ai-next-btn`)?.addEventListener(
            "click",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                navigateAiExplain(1);
            },
        );

        wireAiExplainSpeakButton(item);
        wireAiExplainSaveButton(item);

        if (aiTooltipActive) {
            speakAiExplainItem(item, speechToken);
        }
    }

    function navigateAiExplain(delta) {
        if (!aiTooltipActive || !aiExplainQueue.length) return false;
        const target = aiExplainIndex + delta;
        if (target < 0 || target >= aiExplainQueue.length) {
            return true;
        }
        showAiExplainItem(target);
        return true;
    }

    function nextAiExplainItem() {
        return navigateAiExplain(1);
    }

    function prevAiExplainItem() {
        return navigateAiExplain(-1);
    }

    function wireAiExplainSaveButton(
        firstArg,
        translation,
        explanation,
        sourceLang,
        targetLang,
    ) {
        const tooltipNode = translationOverlay || QT.getTooltipEl();
        const saveBtn = tooltipNode?.querySelector(
            `.${PREFIX}ai-explain-save-btn`,
        );
        if (!saveBtn) return;

        let item = null;
        if (firstArg && typeof firstArg === "object" && firstArg.type) {
            item = firstArg;
        } else {
            item = {
                type: "sentence",
                term: firstArg || "",
                originalText: firstArg || "",
                meaning: translation || "",
                explanation: explanation || "",
            };
            if (sourceLang) aiExplainSourceLang = sourceLang;
            if (targetLang) aiExplainTargetLang = targetLang;
        }

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
            saveBtn.innerHTML = `${SVG.SAVE_SENTENCE} <span>Saving…</span><kbd class="${PREFIX}key-hint">Z</kbd>`;

            try {
                const screenshot =
                    await getPlayerRegistry()?.captureVideoReviewScreenshot(
                        getPlayerRegistry().getVideo(),
                    );
                const currentItem = item || aiExplainQueue[aiExplainIndex] || {};

                const cleanedTerm =
                    cleanCardText(currentItem.term) || currentItem.term;
                const cleanedMeaning =
                    cleanCardText(currentItem.meaning || currentItem.translation) ||
                    currentItem.meaning ||
                    currentItem.translation ||
                    cleanedTerm;
                const cleanedExplanation = cleanCardText(currentItem.explanation);
                const contextSentence =
                    cleanCardText(currentItem.originalText) || "";

                await QT.saveWord({
                    original: cleanedTerm,
                    translated: cleanedMeaning,
                    srcLang: aiExplainSourceLang,
                    tgtLang: aiExplainTargetLang,
                    sentence: contextSentence,
                    sentenceTranslated: "",
                    aiSentence: cleanedExplanation || "",
                    aiSentenceTranslated: "",
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });

                aiSavedIndices.add(aiExplainIndex);
                saveBtn.innerHTML = `<span>Saved!</span>`;
                saveBtn.classList.remove("saving");
                saveBtn.classList.add("saved");
            } catch (error) {
                saveBtn.disabled = false;
                saveBtn.classList.remove("saving");
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE} <span>Could not save</span><kbd class="${PREFIX}key-hint">Z</kbd>`;
                saveBtn.title = error.message;
            }
        });

        if (aiExplainKeydownHandler) {
            window.removeEventListener(
                "keydown",
                aiExplainKeydownHandler,
                true,
            );
        }
        aiExplainKeydownHandler = (ev) => {
            const isTyping =
                ["INPUT", "TEXTAREA"].includes(ev.target?.tagName) ||
                ev.target?.isContentEditable;
            if (isTyping) return;

            if (ev.key === "z" || ev.key === "Z") {
                const currentSaveBtn = translationOverlay?.querySelector(
                    `.${PREFIX}ai-explain-save-btn`,
                );
                if (currentSaveBtn && document.contains(currentSaveBtn)) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    currentSaveBtn.click();
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
                    navigateAiExplain(1);
                }
                return;
            }

            if (ev.key === "ArrowLeft" || ev.key === "a" || ev.key === "A") {
                if (aiTooltipActive && aiExplainQueue.length > 1) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    navigateAiExplain(-1);
                }
                return;
            }
        };
        window.addEventListener("keydown", aiExplainKeydownHandler, true);
    }

    function wireAiExplainSpeakButton(item) {
        const speakBtn = translationOverlay?.querySelector(`.${PREFIX}speak`);
        if (!speakBtn) return;
        speakBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
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

    async function handleAIExplain(video) {
        const registry = getPlayerRegistry();
        const text = activeText || registry?.getCurrentText();
        if (!text) return;
        cleanupReading();

        if (eTranslateActive || wordCloudActive) {
            restoreOriginal();
        }

        aiTooltipActive = true;
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
            const context = getActiveSubtitleContext(video, text);
            const res = await QT.geminiExplainSentence(
                text,
                targetLang,
                context,
            );
            if (!aiTooltipActive) return;

            const sourceLang = await detectSourceLanguage(
                text,
                targetLang,
                res,
            );
            if (!aiTooltipActive) return;

            aiExplainSourceLang = sourceLang;
            aiExplainTargetLang = targetLang;
            aiSavedIndices.clear();

            const translation = res?.translation || "";
            const explanation =
                res?.explanation || (typeof res === "string" ? res : "");

            const sentenceItem = {
                type: "sentence",
                title: "sentence",
                term: text,
                meaning: translation,
                explanation: explanation,
                originalText: text,
                badge: "",
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
                    badge:
                        item.type === "idiom"
                            ? "Idiom"
                            : item.type === "phrasal_verb"
                              ? "Phrasal Verb"
                              : item.type === "slang"
                                ? "Slang"
                                : item.type === "vocabulary"
                                  ? "Słówko"
                                  : item.type || "Wyrażenie",
                }));
            }

            // Always start queue with full sentence translation, followed by breakdown items
            aiExplainQueue = [sentenceItem, ...breakdownItems];

            aiExplainIndex = 0;
            showAiExplainItem(0);
        } catch (err) {
            if (aiTooltipActive) {
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

    function shouldTranslateWord(rawText) {
        const text = (rawText || "").trim();
        if (!text) return false;
        if (/\d/.test(text)) return false;
        if (/^[\s.,!?;:"'()\[\]{}—–\-_/\\<>]+$/.test(text)) return false;

        // Multi-word phrases (phrasal verbs, idioms, collocations) should always be translated
        if (/\s/.test(text)) {
            const words = text.split(/\s+/).filter(Boolean);
            if (words.length >= 2) return true;
        }

        const cleanWord = text.replace(/[^\p{L}']/gu, "").toLowerCase();
        if (cleanWord.length <= 1) return false;
        if (SIMPLE_WORDS.has(cleanWord)) return false;

        const baseWord = cleanWord.replace(/(n't|'s|'ll|'d|'re|'ve|'m)$/, "");
        if (baseWord.length <= 1) return false;
        return !SIMPLE_WORDS.has(baseWord);
    }

    function removeWordClouds() {
        wordCloudEls.forEach(({ cloud }) => cloud.remove());
        wordCloudEls = [];
        document
            .querySelectorAll(`.${WORD_CLOUD_HIGHLIGHT_CLASS}`)
            .forEach((el) => {
                el.classList.remove(WORD_CLOUD_HIGHLIGHT_CLASS);
            });
        wordCloudActive = false;
    }

    function positionWordCloud(cloud, span) {
        if (!cloud?.isConnected || !span?.isConnected) return;
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
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

        for (const { cloud, span } of wordCloudEls) {
            positionWordCloud(cloud, span);
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
            span.classList.toggle(
                WORD_CLOUD_HIGHLIGHT_CLASS,
                shouldTranslateWord(span.textContent),
            );
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

        const translation = await (opts.translationTask ||
            createSubtitleTranslationTask(fullText, modeRevision));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        if (translation.limitReached) return;
        const { targetLang, translatedText: translatedFullText } = translation;
        if (!opts.skipSpeech && translatedFullText?.trim()) {
            QT.speak(translatedFullText, targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            }).catch(() => {});
        }

        const translatableSpans = wordSpans.filter((span) =>
            shouldTranslateWord(span.textContent),
        );
        const translations = await Promise.all(
            translatableSpans.map(async (span) => {
                const word = (span.dataset.clean || span.textContent)
                    .trim()
                    .replace(ANY_PUNCTUATION_RE, "")
                    .trim();
                if (!word || !shouldTranslateWord(word)) return null;
                try {
                    const result = await wordCloudCache.get(word, targetLang);
                    return result.translated;
                } catch {
                    return null;
                }
            }),
        );
        if (modeRevision !== subtitleModeRevision) return;

        const subFontSizePx =
            parseFloat(window.getComputedStyle(wordSpans[0]).fontSize) || 20;
        const cloudFontSize = Math.max(
            12,
            Math.min(18, Math.round(subFontSizePx * 0.55)),
        );

        translatableSpans.forEach((span, i) => {
            const translated = translations[i];
            if (!translated) return;
            let targetSpan = span;
            if (!targetSpan.isConnected) {
                const liveSpans = Array.from(
                    document.querySelectorAll(`.${SUB_WORD_CLASS}`),
                );
                const matched = liveSpans.find(
                    (s) => s.textContent.trim() === span.textContent.trim(),
                );
                if (matched) targetSpan = matched;
            }
            const rect = targetSpan.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            const cloud = document.createElement("div");
            cloud.className = WORD_CLOUD_CLASS;
            cloud.textContent = translated;
            cloud.style.fontSize = cloudFontSize + "px";
            cloud.style.animationDelay = i * 0.02 + "s";
            parent.appendChild(cloud);
            wordCloudEls.push({ cloud, span: targetSpan });
            positionWordCloud(cloud, targetSpan);
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

    async function createSubtitleTranslationTask(
        text,
        modeRevision,
        layout = null,
    ) {
        const targetLang = await QT.getTargetLang();
        if (modeRevision !== subtitleModeRevision) return null;

        const cleanText = String(text || "").trim();
        if (!cleanText) return null;

        // 1. Rewind Cache: avoid re-charging user quota if seeking backwards
        if (sentenceSubCache && sentenceSubCache.has(cleanText, targetLang)) {
            try {
                const cached = await sentenceSubCache.get(
                    cleanText,
                    targetLang,
                );
                if (cached && modeRevision === subtitleModeRevision) {
                    return {
                        targetLang,
                        translatedText: cached.translated || cleanText,
                        detectedLang: cached.detectedLang || "en",
                    };
                }
            } catch (_) {}
        }

        // 2. Check local quota before translation
        const quota = await SubscriptionService.consumeSubtitleQuota(
            cleanText.length,
        );
        if (!quota.allowed) {
            if (modeRevision !== subtitleModeRevision) return null;
            showSubtitleLimitOverlay(quota, layout);
            return {
                limitReached: true,
                targetLang,
                translatedText: cleanText,
                detectedLang: "en",
            };
        }

        try {
            const { translated, detectedLang } = await QT.translate(
                cleanText,
                targetLang,
            );
            if (modeRevision !== subtitleModeRevision) return null;
            const res = {
                targetLang,
                translatedText: translated || cleanText,
                detectedLang: detectedLang || "en",
            };
            if (sentenceSubCache && translated) {
                sentenceSubCache.set(cleanText, targetLang, {
                    translated,
                    detectedLang: res.detectedLang,
                });
            }
            return res;
        } catch (_) {
            if (modeRevision !== subtitleModeRevision) return null;
            return {
                targetLang,
                translatedText: cleanText,
                detectedLang: "en",
            };
        }
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

    // The sentence translation follows the subtitle typography at 60% of its font size.
    const TRANSLATION_FONT_RATIO = 0.5;
    const TRANSLATION_FONT_FALLBACK_PX = 15;

    function applyTranslationFontSize(
        overlay,
        layout,
        { fallbackPx = null } = {},
    ) {
        const sourceFontSize = getSubtitleSourceFontSize(layout);
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
        if (aiExplainKeydownHandler) {
            window.removeEventListener(
                "keydown",
                aiExplainKeydownHandler,
                true,
            );
            aiExplainKeydownHandler = null;
        }
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
        const bubbleGap = 16;

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
        const arrowInset = Math.min(24, bubbleWidth / 2);
        const arrowX = Math.max(
            arrowInset,
            Math.min(anchorCenter - left, bubbleWidth - arrowInset),
        );

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
        translationOverlay.style.setProperty(
            "--lectoro-bubble-arrow-x",
            `${arrowX}px`,
        );
    }

    function showSubLoading(layout = null) {
        return showSubtitleOverlayLoader(layout, {
            text: "✨ Translating…",
            ariaLabel: "Translating sentence...",
        });
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

    function applySentenceTranslation(html, layout = translationAnchorLayout) {
        const overlay = translationOverlay || createOverlay(layout);
        overlay.classList.remove(AI_EXPLAIN_OVERLAY_CLASS);
        overlay.classList.add(`${PREFIX}sentence-clean-overlay`);
        overlay.setAttribute("role", "status");
        overlay.setAttribute("aria-live", "polite");

        const effectiveLayout = layout || translationAnchorLayout;
        applyTranslationFontSize(overlay, effectiveLayout);

        const originalRect = effectiveLayout?.rect || getSubtitleRect();
        const originalWidth = originalRect?.width
            ? Math.round(originalRect.width)
            : 0;
        if (originalWidth > 0) {
            const maxSubWidth = Math.min(
                window.innerWidth - 32,
                Math.max(140, originalWidth),
            );
            overlay.style.setProperty(
                "--lectoro-sentence-max-width",
                `${maxSubWidth}px`,
            );
        } else {
            overlay.style.removeProperty("--lectoro-sentence-max-width");
        }
        overlay.style.removeProperty("--lectoro-sentence-width");

        const copy = document.createElement("div");
        copy.className = `${PREFIX}translation-copy ${PREFIX}sentence-clean-copy`;
        copy.setAttribute("dir", "auto");
        copy.innerHTML = html;
        revealOverlayContent(copy, layout, "Sentence translation");
    }

    function applyTranslation(
        translatedText,
        layout = translationAnchorLayout,
        sourceText = null,
        srcLang = null,
        tgtLang = null,
    ) {
        const sentence = String(translatedText || "").trim();
        const originalText = String(
            sourceText ||
                activeText ||
                getPlayerRegistry()?.getCurrentText() ||
                "",
        ).trim();

        const html = `
            <div class="${PREFIX}sentence-clean-wrap">
                <div class="${PREFIX}sentence-clean-text">${QT.escapeHtml(sentence)}</div>
                <div class="${PREFIX}sentence-clean-footer">
                    <button class="${PREFIX}ai-explain-save-btn ${PREFIX}sentence-clean-save-btn" title="Save sentence for review (Z)">
                        <span>${SVG.SAVE}</span>
                    </button>
                </div>
            </div>`;

        applySentenceTranslation(html, layout);
        wireAiExplainSaveButton(
            originalText || sentence,
            sentence,
            "",
            srcLang || "auto",
            tgtLang || "pl",
        );
        eTranslateActive = true;
    }

    /** Render `html` in the AI-explain overlay variant; returns the content node for wiring buttons. */
    function applyAiExplanation(
        html,
        layout = translationAnchorLayout,
        ariaLabel = "Sentence analysis",
    ) {
        const overlay = translationOverlay || createOverlay(layout);
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
                    Wykorzystano darmowy limit <strong>15 000 znaków / godzinę</strong>.<br>
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
        pauseIfPlaying(video);

        const layout = options.layout || captureSubtitleLayout();
        showSubLoading(layout);
        const translation = await (options.translationTask ||
            createSubtitleTranslationTask(text, modeRevision, layout));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        if (translation.limitReached) return;
        applyTranslation(
            translation.translatedText,
            layout,
            text,
            translation.detectedLang,
            translation.targetLang,
        );
        if (options.speakTranslated) {
            await QT.speak(translation.translatedText, translation.targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            });
        }
    }

    function restoreOriginal() {
        clearTimeout(quotaCountdownTimer);
        quotaCountdownTimer = null;
        subtitleModeRevision += 1;
        subtitleModeStarting = false;
        removeOverlay();
        removeWordClouds();
        globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(false);
        eTranslateActive = false;
        wordCloudActive = false;
        cleanupReading();
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
                ${
                    translated && translated !== text
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
        isAiTooltipActive: () => aiTooltipActive,
        navigateAiExplain,
        nextAiExplainItem,
        prevAiExplainItem,
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
        getSubtitleRect,
        syncCustomSubtitlePosition,
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
