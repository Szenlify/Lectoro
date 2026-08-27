/**
 * Lectoro – Universal Subtitle Engine & Overlay (Single Source of Truth)
 * Centralized responsive subtitle renderer, word-by-word tokenization, hover/click tooltips,
 * AI explanations, Word Cloud mode, in-place translations, and spaced-repetition review capture.
 */
(() => {
    "use strict";

    const PREFIX = "__qt_";
    const subCache = typeof QT !== "undefined" && QT.createTranslateCache
        ? QT.createTranslateCache(300)
        : new Map();

    const SVG = typeof QT !== "undefined" && QT.SVG ? QT.SVG : {
        SPEAKER: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
        SAVE_SENTENCE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        SAVE_SENTENCE_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#4ecdc4" stroke="#4ecdc4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    };

    // ── Universal Custom Subtitle Renderer State ─────────────────
    let customSubLayerEl = null;
    let customSubBoxEl = null;
    let activeLines = [];
    let activeText = "";
    let activeWordSpans = [];
    let trackedVideo = null;
    let videoResizeObserver = null;
    let layoutRafId = null;

    // ── Interaction State ─────────────────────────────────────────
    let subHoverTimer = null;
    let isSubHovering = false;
    let subWasPlaying = false;
    let subClickLocked = false;
    let lastHoveredSubWord = null;
    let subTooltipAnchor = null;
    let subCloseTimer = null;

    let aiTooltipActive = false;
    let aiWasPlaying = false;
    let aiExplainKeydownHandler = null;

    let speedOverlayEl = null;
    let speedOverlayTimer = null;

    let eTranslateActive = false;
    let eOriginalContents = [];
    let eWasPlaying = false;
    let wordCloudActive = false;
    let wordCloudEls = [];
    let wordCloudSourceLayers = [];
    let wordCloudWasPlaying = false;
    let subtitleModeRevision = 0;
    let subtitleModeStarting = false;
    let subtitleResumeRevision = 0;
    let subtitleUiTrackingFrame = null;
    const wordCloudCache = subCache;

    let translationOverlay = null;
    let translationAnchorLayout = null;

    let savingSentence = false;
    let saveToastEl = null;
    let saveToastHideTimer = null;
    let saveResumeTimer = null;
    let pausedForSave = false;
    let wasPlayingBeforeSave = false;

    const SIMPLE_WORDS = new Set([
        "an", "oh", "uh", "ah", "a", "and", "are", "as", "at", "be", "but", "by", "can", "can't", "could",
        "did", "do", "does", "for", "from", "had", "has", "have", "he", "her",
        "here", "his", "if", "in", "into", "is", "it", "its", "me", "my", "not",
        "of", "on", "or", "our", "she", "should", "so", "some", "that", "the",
        "their", "them", "there", "they", "this", "to", "too", "us", "was",
        "we", "were", "what", "when", "where", "which", "who", "why", "will",
        "with", "won't", "would", "you", "your", "yours",
    ]);

    function isOwnUI(target) {
        if (globalThis.LectoroBaseAdapter?.isOwnUI) {
            return globalThis.LectoroBaseAdapter.isOwnUI(target);
        }
        return false;
    }

    function isNetflixPage() {
        return !!globalThis.LectoroPlayerRegistry?.isNetflixPage?.();
    }

    function getPlayerRegistry() {
        return globalThis.LectoroPlayerRegistry;
    }

    // ── Universal Custom Subtitle Layer (Single Source of Truth) ──

    function getPlatformName() {
        const hostname = (typeof window !== "undefined" && window.location?.hostname) || "";
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
        const nf = video.closest?.(".watch-video, [data-uia='video-canvas'], .nf-player-container");
        if (nf) return nf;

        // 3. VideoJS / Plyr / JWPlayer / Generic HTML5
        const vjs = video.closest?.(".video-js, .jwplayer, .plyr, .player-container");
        if (vjs) return vjs;

        // 4. TED Talks (container holding #subtitles-container)
        const subCont = document.getElementById("subtitles-container");
        if (subCont && subCont.parentElement) {
            if (subCont.parentElement.contains(video) || subCont.parentElement === video.parentElement) {
                return subCont.parentElement;
            }
        }

        // 5. Check direct parent hierarchy for the tightest player wrapper (never main or body)
        let curr = video.parentElement;
        while (curr && curr !== document.body && curr !== document.documentElement && curr.tagName !== "MAIN") {
            const style = window.getComputedStyle(curr);
            if (style.position === "relative" || style.position === "absolute" || curr.id === "subtitles-container" || curr.querySelector?.("#subtitles-container")) {
                const rect = curr.getBoundingClientRect();
                if (rect.height > 0 && rect.height <= window.innerHeight * 1.2) {
                    return curr;
                }
            }
            curr = curr.parentElement;
        }

        return video.parentElement || document.body;
    }

    function ensureCustomSubtitlesLayer() {
        const video = getPlayerRegistry()?.getVideo();
        const playerEl = findPlayerContainer(video);
        const parent = document.fullscreenElement || playerEl || (typeof QT !== "undefined" && QT.getOverlayParent ? QT.getOverlayParent() : document.body);

        const platform = getPlatformName();

        if (customSubLayerEl && customSubLayerEl.isConnected) {
            customSubLayerEl.id = `${PREFIX}custom_subtitles_layer`;
            customSubLayerEl.classList.add(`${PREFIX}custom-subtitles-layer`);
            customSubLayerEl.setAttribute("data-platform", platform);
            if (!customSubBoxEl) {
                customSubBoxEl = document.createElement("div");
                customSubBoxEl.style.setProperty(
                    "opacity",
                    activeLines.length > 0 ? "1" : "0",
                    "important",
                );
            }
            customSubBoxEl.classList.add(`${PREFIX}custom-subtitles-box`);
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
        customSubLayerEl.id = `${PREFIX}custom_subtitles_layer`;
        customSubLayerEl.className = `${PREFIX}custom-subtitles-layer`;
        customSubLayerEl.setAttribute("data-platform", platform);

        customSubBoxEl = document.createElement("div");
        customSubBoxEl.className = `${PREFIX}custom-subtitles-box`;
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

    function isYouTubePage() {
        return /(^|\.)youtube\.com$/i.test(window.location.hostname) || getPlayerRegistry()?.type === "youtube";
    }

    function syncCustomSubtitlePosition() {
        if (layoutRafId !== null) return;
        layoutRafId = requestAnimationFrame(() => {
            layoutRafId = null;
            const { layer, box } = ensureCustomSubtitlesLayer();
            const registry = getPlayerRegistry();
            const video = registry?.getVideo();

            if (!video || !video.isConnected || registry?.isPreviewOrThumbnailVideo?.(video)) {
                layer.style.setProperty("display", "none", "important");
                return;
            }

            const playerEl = findPlayerContainer(video);
            const targetContainer = playerEl || video.parentElement;

            if (trackedVideo !== video) {
                if (videoResizeObserver && trackedVideo) {
                    try { videoResizeObserver.unobserve(trackedVideo); } catch (_) { }
                }
                trackedVideo = video;
                if (typeof ResizeObserver !== "undefined") {
                    if (!videoResizeObserver) {
                        videoResizeObserver = new ResizeObserver(() => syncCustomSubtitlePosition());
                    }
                    videoResizeObserver.observe(video);
                    if (targetContainer && targetContainer !== video) {
                        videoResizeObserver.observe(targetContainer);
                    }
                }
            }

            // Ensure layer is attached inside targetContainer or fullscreen element
            const expectedParent = document.fullscreenElement || targetContainer || document.body;
            if (layer.parentElement !== expectedParent) {
                expectedParent.appendChild(layer);
            }

            // Ensure parent container is positioned so absolute layer stays locked inside
            if (expectedParent !== document.body && expectedParent !== document.documentElement) {
                const computedPos = window.getComputedStyle(expectedParent).position;
                if (computedPos === "static") {
                    expectedParent.style.position = "relative";
                }
            }

            const videoRect = video.getBoundingClientRect();
            const playerRect = targetContainer ? targetContainer.getBoundingClientRect() : videoRect;
            const actualWidth = playerRect.width || videoRect.width || video.offsetWidth || window.innerWidth;
            const actualHeight = playerRect.height || videoRect.height || video.offsetHeight || window.innerHeight;

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
            const fontSizePx = Math.max(20, Math.min(54, Math.round(actualWidth * 0.026 + 4)));
            layer.style.setProperty("--lectoro-sub-font-size", `${fontSizePx}px`);

            // Bottom offset inside video player
            const isNetflix = isNetflixPage();
            const baseBottomPx = isNetflix
                ? Math.max(76, Math.round(actualHeight * 0.13))
                : Math.max(18, Math.round(actualHeight * 0.138));

            layer.style.setProperty("--lectoro-sub-bottom", `${baseBottomPx}px`);
            box.style.marginBottom = `${baseBottomPx}px`;
        });
    }

    function renderCustomSubtitles(lines = []) {
        const { layer, box } = ensureCustomSubtitlesLayer();
        const registry = getPlayerRegistry();
        const video = registry?.getVideo();
        if (video && registry?.isPreviewOrThumbnailVideo?.(video)) {
            lines = [];
        }

        const clean = (typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function")
            ? (t) => SharedUtils.cleanCardText(t)
            : (t) => String(t || "").replace(/\[[^\]]*\]/g, " ").replace(/[♪♫♬♩♭♮♯]/g, " ").replace(/\s+/g, " ").trim();

        const rawCleanLines = (Array.isArray(lines) ? lines : [lines])
            .map((l) => (typeof l === "string" ? clean(l) : ""))
            .filter(Boolean);

        if (rawCleanLines.length === 0) {
            activeLines = [];
            activeText = "";
            activeWordSpans = [];
            box.innerHTML = "";
            box.style.setProperty("opacity", "0", "important");
            box.style.setProperty("pointer-events", "none", "important");
            if (isSubHovering && !subClickLocked) {
                closeSubTooltip();
            }
            return;
        }

        let displayLines = rawCleanLines;
        const newText = displayLines.join(" ").replace(/\s+/g, " ").trim();

        // Netflix may rebuild the same cue first as one DOM line and then as
        // two lines (or the reverse). Preserve the first accepted layout for
        // as long as the normalized cue text itself has not changed.
        if (isNetflixPage() && newText === activeText && activeLines.length > 0) {
            displayLines = activeLines;
            if (box.children.length === activeLines.length) {
                syncCustomSubtitlePosition();
                return;
            }
        } else if (
            newText === activeText &&
            box.children.length === displayLines.length
        ) {
            syncCustomSubtitlePosition();
            return;
        }

        activeLines = displayLines;
        activeText = newText;
        activeWordSpans = [];
        box.innerHTML = "";

        for (const lineText of displayLines) {
            const lineEl = document.createElement("div");
            lineEl.className = `${PREFIX}custom-sub-line`;
            lineEl.setAttribute("dir", "auto");

            const parts = lineText.match(/\S+|\s+/g) || [];
            for (const part of parts) {
                if (/\S/.test(part)) {
                    const span = document.createElement("span");
                    span.className = `${PREFIX}sub-word`;
                    span.textContent = part;
                    lineEl.appendChild(span);
                    activeWordSpans.push(span);
                } else {
                    lineEl.appendChild(document.createTextNode(part));
                }
            }
            box.appendChild(lineEl);
        }

        box.style.setProperty("opacity", "1", "important");
        box.style.setProperty("pointer-events", "auto", "important");
        syncCustomSubtitlePosition();
    }

    // Geometry event listeners
    window.addEventListener("resize", syncCustomSubtitlePosition, { passive: true });
    window.addEventListener("scroll", syncCustomSubtitlePosition, { passive: true });
    document.addEventListener("fullscreenchange", () => setTimeout(syncCustomSubtitlePosition, 50));
    document.addEventListener("webkitfullscreenchange", () => setTimeout(syncCustomSubtitlePosition, 50));

    // Connect to PlayerRegistry subtitle changes (Single Source of Truth)
    if (globalThis.LectoroPlayerRegistry) {
        globalThis.LectoroPlayerRegistry.onSubtitleChange((payload) => {
            if (Array.isArray(payload)) {
                const lines = globalThis.LectoroBaseAdapter?.extractCueLines?.(payload) || [];
                renderCustomSubtitles(lines);
            } else if (payload && Array.isArray(payload.lines)) {
                renderCustomSubtitles(payload.lines);
            } else if (payload && typeof payload.fullText === "string") {
                renderCustomSubtitles(payload.fullText ? [payload.fullText] : []);
            }
        });
    }

    function makeSubtitlesInteractive(els = getPlayerRegistry()?.getSubtitleElements() || []) {
        if (Array.isArray(els) && els.length > 0) {
            const lines = globalThis.LectoroBaseAdapter?.extractCueLines?.(els) || [];
            if (lines.length > 0) {
                renderCustomSubtitles(lines);
            }
        }
    }

    // ── Word Tooltip (Hover & Click) ──────────────────────────────

    function closeSubTooltip() {
        if (!isSubHovering) return;
        const shouldResumeVideo = subWasPlaying;

        isSubHovering = false;
        subWasPlaying = false;
        subClickLocked = false;
        if (typeof QT !== "undefined") QT.hoverClickActive = false;

        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subHoverTimer = null;
        subCloseTimer = null;
        subTooltipAnchor = null;

        if (lastHoveredSubWord) {
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
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

    if (typeof QT !== "undefined" && QT.addDismissHandler) {
        QT.addDismissHandler(closeSubTooltip);
    }

    function scheduleCloseSubTooltip() {
        if (subCloseTimer !== null) return;
        subCloseTimer = setTimeout(() => {
            subCloseTimer = null;
            const tooltip = QT.getTooltipEl();
            if (tooltip?.matches(":hover") || tooltip?.contains(document.activeElement)) return;
            if (subClickLocked) return;
            const { x, y } = (typeof QT !== "undefined" && QT.getMousePos)
                ? QT.getMousePos()
                : { x: 0, y: 0 };
            const wordUnderMouse = QT.findWordAtPoint(x, y, PREFIX + "sub-word");
            if (wordUnderMouse) return;
            closeSubTooltip();
        }, 450);
    }

    async function triggerWordHover(wordSpan) {
        if (!wordSpan || !wordSpan.isConnected) return;
        if (subClickLocked) return;

        if (lastHoveredSubWord && lastHoveredSubWord !== wordSpan) {
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
        }
        lastHoveredSubWord = wordSpan;
        wordSpan.classList.add(`${PREFIX}word-hover`);

        const registry = getPlayerRegistry();
        const video = registry?.getVideo();
        if (!isSubHovering) {
            subWasPlaying = video ? !video.paused : false;
        }

        isSubHovering = true;
        subTooltipAnchor = wordSpan;

        if (video && !video.paused) {
            registry?.pauseVideo(video);
        }

        const text = wordSpan.textContent.trim();
        if (!text) return;

        const rect = wordSpan.getBoundingClientRect();
        const subtitleTooltipPlacement = "top";

        QT.showLoading(rect, subtitleTooltipPlacement);
        ensureSubtitleUiTracking();

        try {
            const targetLang = await QT.getTargetLang();
            const res = await subCache.get(text, targetLang);
            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;

            const html = QT.buildTooltipHtml({
                srcLang: res.detectedLang,
                targetLang,
                original: text,
                translated: res.translated,
            });

            QT.showTooltip(html, rect, subtitleTooltipPlacement);
            QT.attachTooltipHandlers();
        } catch (err) {
            if (isSubHovering && lastHoveredSubWord === wordSpan) {
                QT.showTooltip(
                    `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                    rect,
                    subtitleTooltipPlacement,
                );
            }
        }
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
            const isInsideTooltip = tooltip && (tooltip.contains(e.target) || tooltip.matches(":hover"));

            if (isInsideTooltip) {
                clearTimeout(subHoverTimer);
                clearTimeout(subCloseTimer);
                subHoverTimer = null;
                subCloseTimer = null;
                return;
            }

            const wordSpan = isOwnUI(e.target)
                ? null
                : QT.findWordAtPoint(e.clientX, e.clientY, PREFIX + "sub-word");

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
                const maxY = Math.max(tooltipRect.bottom, anchorRect.bottom) + 15;

                const inBridgeZone = (e.clientX >= minX && e.clientX <= maxX && e.clientY >= minY && e.clientY <= maxY);
                if (inBridgeZone) {
                    clearTimeout(subCloseTimer);
                    subCloseTimer = null;
                    if (subHoverTimer) return; // Keep dwelling
                    subHoverTimer = setTimeout(() => {
                        subHoverTimer = null;
                        triggerWordHover(wordSpan);
                    }, 260);
                    return;
                }
            }

            if (wordSpan && wordSpan !== lastHoveredSubWord) {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
                clearTimeout(subHoverTimer);

                const hoverDelay = isSubHovering ? 200 : 0;
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
        if (typeof cleanupReading === "function") cleanupReading();
        clearTimeout(subHoverTimer);
        clearTimeout(subCloseTimer);
        subCloseTimer = null;
        const wasAlreadyHovering = isSubHovering;
        subClickLocked = true;
        QT.hoverClickActive = true;
        isSubHovering = true;
        subTooltipAnchor = wordSpan;

        if (lastHoveredSubWord && lastHoveredSubWord !== wordSpan) {
            lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
        }
        lastHoveredSubWord = wordSpan;
        wordSpan.classList.add(`${PREFIX}word-hover`);

        const registry = getPlayerRegistry();
        const video = registry?.getVideo();
        if (!wasAlreadyHovering) subWasPlaying = video ? !video.paused : false;
        if (video && !video.paused) registry?.pauseVideo(video);

        const text = wordSpan.textContent.trim();
        if (!text) {
            closeSubTooltip();
            return;
        }

        const rect = wordSpan.getBoundingClientRect();
        const subtitleTooltipPlacement = "top";
        QT.showLoading(rect, subtitleTooltipPlacement);
        ensureSubtitleUiTracking();

        try {
            const targetLang = await QT.getTargetLang();
            const wordRes = await subCache.get(text, targetLang);
            const srcLang =
                typeof wordRes.detectedLang === "string"
                    ? wordRes.detectedLang
                    : "auto";

            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;

            const html = QT.buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated: wordRes.translated,
            });
            QT.showTooltip(html, rect, subtitleTooltipPlacement);
            QT.attachTooltipHandlers();
            QT.speak(text, srcLang);
        } catch (err) {
            if (isSubHovering) {
                QT.showTooltip(
                    `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                    rect,
                    subtitleTooltipPlacement,
                );
            }
        }
    }

    document.addEventListener(
        "click",
        (e) => {
            const registry = getPlayerRegistry();
            const video = registry?.getVideo();
            if (!video?.isConnected) return;
            if (isOwnUI(e.target)) return;
            const wordSpan = QT.findWordAtPoint(e.clientX, e.clientY, PREFIX + "sub-word");
            if (wordSpan) {
                e.preventDefault();
                e.stopPropagation();
                handleSubWordClick(wordSpan);
            }
        },
        true,
    );

    // ── AI Explanations ──────────────────────────────────────────

    function showAiShimmer(layout) {
        const overlay = createOverlay(layout);
        overlay.classList.add(`${PREFIX}ai-explain-overlay`);
        overlay.dataset.state = "ai-loading";
        overlay.setAttribute("aria-label", "Analiza zdania w toku");
        overlay.innerHTML = `<span class="ai-loader-label">✨ Analizuje…</span>`;
        positionOverlay(layout);
    }

    function removeAiShimmer() {
        if (translationOverlay?.classList.contains(`${PREFIX}ai-explain-overlay`)) {
            removeOverlay();
        }
    }
    if (typeof QT !== "undefined" && QT.addCleanup) QT.addCleanup(removeAiShimmer);

    function closeAiTooltip(options = {}) {
        if (aiExplainKeydownHandler) {
            window.removeEventListener("keydown", aiExplainKeydownHandler, true);
            aiExplainKeydownHandler = null;
        }
        if (!aiTooltipActive) return;
        aiTooltipActive = false;
        QT.hideTooltip();
        removeAiShimmer();
        if (typeof cleanupReading === "function") cleanupReading();
        if (typeof SharedTtsService !== "undefined") {
            SharedTtsService.cancel();
        } else if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        const shouldResume = options.resumeVideo !== undefined ? options.resumeVideo : true;
        aiWasPlaying = false;
        if (shouldResume) {
            const video = getPlayerRegistry()?.getVideo();
            if (video) {
                resumeVideoAfterSubtitleClose(video);
            }
        }
    }
    if (typeof QT !== "undefined" && QT.addDismissHandler) QT.addDismissHandler(closeAiTooltip);

    function normalizeLanguageCode(value, fallback = "") {
        const raw = String(value || "").trim().toLowerCase();
        if (!raw) return fallback;

        const codeCandidate = raw.replace(/_/g, "-").split("-")[0];
        if (/^[a-z]{2,3}$/.test(codeCandidate)) return codeCandidate;

        const languages = globalThis.LectoroConstants?.SUPPORTED_LANGUAGES || {};
        for (const [code, language] of Object.entries(languages)) {
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
        const playerLang = getPlayerRegistry()?.getCurrentLanguage?.() || getPlayerRegistry()?.getTrackLanguage?.();
        if (playerLang && playerLang !== "auto") {
            return QT.langTag(playerLang);
        }
        return "EN";
    }

    function languageName(code) {
        return globalThis.LectoroConstants?.getLanguageName?.(code) || languageTag(code);
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

    function wireAiExplainSaveButton(
        text,
        translation,
        explanation,
        sourceLang,
        targetLang,
    ) {
        const tooltipNode = translationOverlay || document.getElementById(PREFIX + "tooltip");
        const saveBtn = tooltipNode?.querySelector(`.${PREFIX}ai-explain-save-btn`);
        if (!saveBtn) return;

        if (!saveBtn.querySelector(`.${PREFIX}key-hint`)) {
            const hintNode = document.createElement("kbd");
            hintNode.className = `${PREFIX}key-hint`;
            hintNode.textContent = "Z";
            saveBtn.appendChild(hintNode);
        }

        saveBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (saveBtn.classList.contains("saved") || saveBtn.classList.contains("saving")) {
                return;
            }

            saveBtn.classList.add("saving");
            saveBtn.disabled = true;
            saveBtn.innerHTML = `${SVG.SAVE_SENTENCE} <span>Saving…</span><kbd class="${PREFIX}key-hint">Z</kbd>`;

            try {
                const screenshot = await getPlayerRegistry()?.captureVideoReviewScreenshot(
                    getPlayerRegistry().getVideo(),
                );
                const clean = typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                    ? SharedUtils.cleanCardText
                    : (s) => String(s || "").trim();
                const cleanedText = clean(text) || text;
                const cleanedTranslation = clean(translation) || translation || cleanedText;
                const cleanedExplanation = clean(explanation);

                await QT.saveWord({
                    original: cleanedText,
                    translated: cleanedTranslation,
                    srcLang: sourceLang,
                    tgtLang: targetLang,
                    sentence: "",
                    sentenceTranslated: "",
                    aiSentence: cleanedExplanation || "",
                    aiSentenceTranslated: "",
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE_CHECK} <span>Saved!</span>`;
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
            window.removeEventListener("keydown", aiExplainKeydownHandler, true);
        }
        aiExplainKeydownHandler = (ev) => {
            const isTyping =
                ["INPUT", "TEXTAREA"].includes(ev.target?.tagName) ||
                ev.target?.isContentEditable;
            if (isTyping) return;

            if (ev.key === "z" || ev.key === "Z") {
                if (document.contains(saveBtn)) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    saveBtn.click();
                } else {
                    window.removeEventListener("keydown", aiExplainKeydownHandler, true);
                    aiExplainKeydownHandler = null;
                }
            }
        };
        // Capture before video-hotkeys.js so Z activates this AI-result button
        // instead of the global "save current subtitle" action.
        window.addEventListener("keydown", aiExplainKeydownHandler, true);
    }

    function wireAiExplainSpeakButton() {
        const speakBtn = translationOverlay?.querySelector(`.${PREFIX}speak`);
        if (!speakBtn) return;
        speakBtn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            speakBtn.classList.add("speaking");
            speakBtn.setAttribute("aria-label", "Playing translation and explanation");
            try {
                await QT.speak(speakBtn.dataset.text || "", speakBtn.dataset.lang || "pl");
            } catch (_) {
                // The panel stays interactive even when browser TTS is unavailable.
            } finally {
                if (speakBtn.isConnected) {
                    speakBtn.classList.remove("speaking");
                    speakBtn.setAttribute("aria-label", "Play translation and explanation");
                }
            }
        });
    }

    async function handleAIExplain(video) {
        const registry = getPlayerRegistry();
        const text = activeText || registry?.getCurrentText();
        if (!text) return;
        if (typeof cleanupReading === "function") cleanupReading();

        if (eTranslateActive || wordCloudActive) {
            restoreOriginal();
        }

        aiTooltipActive = true;
        aiWasPlaying = !video.paused;
        if (aiWasPlaying) registry?.pauseVideo(video);
        QT.hideTooltip();

        const layout = captureSubtitleLayout();
        const rect = layout?.rect || getSubtitleRect() || {
            left: window.innerWidth / 2 - 100,
            top: window.innerHeight - 150,
            width: 200,
            height: 50,
        };
        const aiLayout = layout || { rect };

        showAiShimmer(aiLayout);
        try {
            const targetLang = await QT.getTargetLang();
            const res = await QT.geminiExplainSentence(text, targetLang);
            if (!aiTooltipActive) return;

            const sourceLang = await detectSourceLanguage(text, targetLang, res);
            if (!aiTooltipActive) return;
            const translation = res.translation || "";
            const explanation = res.explanation || res;
            const sourceTag = languageTag(sourceLang);
            const targetTag = languageTag(targetLang);
            const aiSpeechText = [translation, explanation]
                .filter(Boolean)
                .join(". ");

            const html = `
                <div class="${PREFIX}header">
                    <span>${QT.escapeHtml(sourceTag)} → ${QT.escapeHtml(targetTag)}</span>
                </div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label" title="Source language: ${QT.escapeAttr(languageName(sourceLang))}">${QT.escapeHtml(sourceTag)}</span>
                        <span class="${PREFIX}text ${PREFIX}original">${QT.escapeHtml(text)}</span>
                    </div>
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label" title="Translation language: ${QT.escapeAttr(languageName(targetLang))}">${QT.escapeHtml(targetTag)}</span>
                        <span class="${PREFIX}text ${PREFIX}translated">${QT.escapeHtml(translation)}</span>
                        <span class="${PREFIX}word-actions">
                            <button class="${PREFIX}speak" data-text="${QT.escapeAttr(aiSpeechText)}" data-lang="${QT.escapeAttr(targetLang)}" title="Play translation and explanation" aria-label="Play translation and explanation">${SVG.SPEAKER}</button>
                        </span>
                    </div>
                    <div class="${PREFIX}ai-result">
                        <div class="${PREFIX}ai-label">✨ AI Explanation:</div>
                        <div class="${PREFIX}ai-text">${QT.escapeHtml(explanation)}</div>
                    </div>
                </div>
                <div class="${PREFIX}save-footer">
                    <button class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn" title="Save sentence for review">
                        ${SVG.SAVE || "💾"} <span>Save</span>
                    </button>
                </div>`;
            applyAiExplanation(html, aiLayout);
            wireAiExplainSpeakButton();
            wireAiExplainSaveButton(
                text,
                translation,
                explanation,
                sourceLang,
                targetLang,
            );

            if (aiTooltipActive) {
                await QT.speak(aiSpeechText, targetLang, {
                    isCancelled: () => !aiTooltipActive,
                });
            }
        } catch (err) {
            if (aiTooltipActive) {
                const limitReached = typeof GeminiProxy !== "undefined" && GeminiProxy.isLimitError?.(err);
                if (limitReached) {
                    closeAiTooltip();
                } else {
                    applyAiExplanation(
                        `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                        aiLayout,
                    );
                }
            }
        }
    }


    function showSpeedOverlay(speed) {
        if (!speedOverlayEl) {
            speedOverlayEl = document.createElement("div");
            speedOverlayEl.style.cssText =
                "position:fixed; top:40px; right:40px; background:rgba(0,0,0,0.8); color:#fff; padding:10px 16px; border-radius:8px; font-family:sans-serif; font-size:16px; font-weight:bold; z-index:2147483647; opacity:0; transition:opacity 0.2s ease; pointer-events:none;";
            document.body.appendChild(speedOverlayEl);
        }
        speedOverlayEl.textContent = `Speed: ${speed.toFixed(2)}x`;
        speedOverlayEl.style.opacity = "1";
        clearTimeout(speedOverlayTimer);
        speedOverlayTimer = setTimeout(
            () => (speedOverlayEl.style.opacity = "0"),
            2000,
        );
    }

    // ── Word Cloud & Sentence Overlay ──────────────────────────────

    function shouldTranslateWord(rawText) {
        const text = (rawText || "").trim();
        if (!text) return false;
        if (/\d/.test(text)) return false;
        if (/^[\s.,!?;:"'()\[\]{}—–\-_/\\<>]+$/.test(text)) return false;

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
        wordCloudSourceLayers.forEach(({ layer }) => layer.remove());
        wordCloudSourceLayers = [];
        document
            .querySelectorAll("." + PREFIX + "word-cloud-highlight")
            .forEach((el) => {
                el.classList.remove(PREFIX + "word-cloud-highlight");
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
        left = Math.max(4, Math.min(left, window.innerWidth - cloudRect.width - 4));
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
                QT.positionTooltip(subTooltipAnchor.getBoundingClientRect(), "top");
            } else {
                const { x, y } = (typeof QT !== "undefined" && QT.getMousePos)
                    ? QT.getMousePos()
                    : { x: 0, y: 0 };
                const replacementSpan = isOwnUI(document.elementFromPoint(x, y))
                    ? null
                    : QT.findWordAtPoint(x, y, PREFIX + "sub-word");
                if (replacementSpan) {
                    subTooltipAnchor = replacementSpan;
                    lastHoveredSubWord = replacementSpan;
                    replacementSpan.classList.add(`${PREFIX}word-hover`);
                    QT.positionTooltip(replacementSpan.getBoundingClientRect(), "top");
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

        wordCloudWasPlaying = video ? !video.paused : false;
        wordCloudActive = true;
        if (video && !video.paused) {
            getPlayerRegistry()?.pauseVideo(video);
        }

        const spans = activeWordSpans.length > 0
            ? activeWordSpans
            : (opts.sourceElements || getPlayerRegistry()?.getSubtitleElements() || []);

        if (spans.length === 0) return;
        const fullText = opts.sourceText || activeText || getPlayerRegistry()?.getCurrentText() || "";
        if (!fullText) return;

        const parent = QT.getOverlayParent();
        const wordSpans = [];

        for (const span of spans) {
            if (!span || !span.textContent?.trim()) continue;
            wordSpans.push(span);
            if (shouldTranslateWord(span.textContent)) {
                span.classList.add(PREFIX + "word-cloud-highlight");
            } else {
                span.classList.remove(PREFIX + "word-cloud-highlight");
            }
        }

        if (wordSpans.length === 0) {
            removeWordClouds();
            if (!opts.keepOriginalHidden) {
                globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(false);
            }
            if (wordCloudWasPlaying) resumeVideoAfterSubtitleClose(video);
            return;
        }

        const translation = await (opts.translationTask ||
            createSubtitleTranslationTask(fullText, modeRevision));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        const { targetLang, translatedText: translatedFullText } = translation;
        if (!opts.skipSpeech && translatedFullText?.trim()) {
            QT.speak(translatedFullText, targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            }).catch(() => { });
        }

        const translatableSpans = wordSpans.filter((span) =>
            shouldTranslateWord(span.textContent),
        );
        const translations = await Promise.all(
            translatableSpans.map(async (span) => {
                const word = span.textContent
                    .trim()
                    .replace(/[.,!?;:"\u201C\u201D\u2018\u2019'()\[\]{}—–\-_/\\<>]/gu, "")
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
        const cloudFontSize = Math.max(12, Math.min(18, Math.round(subFontSizePx * 0.55)));

        translatableSpans.forEach((span, i) => {
            const translated = translations[i];
            if (!translated) return;
            let targetSpan = span;
            if (!targetSpan.isConnected) {
                const liveSpans = Array.from(document.querySelectorAll(`.${PREFIX}sub-word`));
                const matched = liveSpans.find((s) => s.textContent.trim() === span.textContent.trim());
                if (matched) targetSpan = matched;
            }
            const rect = targetSpan.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            const cloud = document.createElement("div");
            cloud.className = PREFIX + "word-cloud";
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
        const els = elements || activeWordSpans || getPlayerRegistry()?.getSubtitleElements() || [];
        if (els.length === 0 && !customSubBoxEl) return null;
        const rect = getSubtitleRect(els);
        if (!rect) return null;
        const refEl = els[0] || customSubBoxEl;
        const cs = window.getComputedStyle(refEl);
        const lineTexts = activeLines.length > 0
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
        const elements = activeWordSpans.length > 0 ? activeWordSpans : getPlayerRegistry()?.getSubtitleElements() || [];
        const text = activeText || getPlayerRegistry()?.getCurrentText() || "";
        return {
            elements,
            text,
            layout: captureSubtitleLayout(elements),
        };
    }

    async function createSubtitleTranslationTask(text, modeRevision) {
        const targetLang = await QT.getTargetLang();
        if (modeRevision !== subtitleModeRevision) return null;
        try {
            const { translated, detectedLang } = await QT.translate(text, targetLang);
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: translated || text, detectedLang: detectedLang || "en" };
        } catch (_) {
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: text, detectedLang: "en" };
        }
    }

    function getSubtitleRect(elements = null) {
        if (customSubBoxEl && customSubBoxEl.isConnected && activeLines.length > 0) {
            const r = customSubBoxEl.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
                return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
            }
        }
        const els = elements || activeWordSpans || getPlayerRegistry()?.getSubtitleElements() || [];
        if (els.length > 0) {
            let top = Infinity,
                bottom = -Infinity,
                left = Infinity,
                right = -Infinity;
            for (const el of els) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                top = Math.min(top, r.top);
                bottom = Math.max(bottom, r.bottom);
                left = Math.min(left, r.left);
                right = Math.max(right, r.right);
            }
            if (top !== Infinity) {
                return { top, bottom, left, right, width: right - left, height: bottom - top };
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

    function createOverlay(layout = null) {
        removeOverlay();
        translationAnchorLayout = layout;
        translationOverlay = document.createElement("div");
        translationOverlay.id = `${PREFIX}sentence_translation`;
        translationOverlay.className = PREFIX + "sub-overlay";
        translationOverlay.setAttribute("role", "status");
        translationOverlay.setAttribute("aria-live", "polite");
        translationOverlay.setAttribute("aria-atomic", "true");

        // Keep clicks inside the interactive bubble away from page/player
        // click-away handlers. Button handlers still run before bubbling here.
        ["pointerdown", "mousedown", "mouseup", "click", "dblclick"].forEach((eventName) => {
            translationOverlay.addEventListener(eventName, (event) => {
                event.stopPropagation();
            });
        });

        // The sentence translation follows the subtitle typography, but is
        // intentionally one visual step smaller so it reads as supporting UI.
        const subtitleReference = activeWordSpans.find((span) => span.isConnected) ||
            customSubBoxEl?.querySelector(`.${PREFIX}custom-sub-line`);
        const liveFontSize = subtitleReference
            ? window.getComputedStyle(subtitleReference).fontSize
            : "";
        const sourceFontSize = Number.parseFloat(layout?.fontSize || liveFontSize);
        const translationFontSize = Number.isFinite(sourceFontSize)
            ? Math.round(sourceFontSize * 0.8 * 100) / 100
            : 20;
        translationOverlay.style.setProperty(
            "--lectoro-translation-font-size",
            `${translationFontSize}px`,
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
        const rect = getSubtitleRect() || layout?.rect;
        if (!rect) return;

        const viewportWidth = Math.max(1, window.innerWidth);
        const viewportHeight = Math.max(1, window.innerHeight);
        const bubbleRect = translationOverlay.getBoundingClientRect();
        const bubbleWidth = bubbleRect.width || Math.min(420, viewportWidth - 24);
        const bubbleHeight = bubbleRect.height || 64;
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

        translationOverlay.classList.toggle(`${PREFIX}bubble-below`, placeBelow);
        translationOverlay.style.setProperty("left", `${left}px`, "important");
        translationOverlay.style.setProperty(
            "top",
            `${Math.max(edgeGap, top)}px`,
            "important",
        );
        translationOverlay.style.setProperty(
            "--lectoro-bubble-arrow-x",
            `${arrowX}px`,
        );
    }

    function showSubLoading(layout = null) {
        const overlay = createOverlay(layout);
        overlay.dataset.state = "loading";
        overlay.setAttribute("aria-label", "Translating sentence...");
        overlay.innerHTML = `<span class="${PREFIX}translation-spinner" aria-hidden="true"></span>`;
        positionOverlay(layout);
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
        const loadingRect = overlay.getBoundingClientRect();
        overlay.classList.remove(`${PREFIX}translation-reveal`);
        overlay.dataset.state = "measuring";
        overlay.replaceChildren(content);
        const targetRect = overlay.getBoundingClientRect();

        overlay.style.setProperty("width", `${loadingRect.width}px`, "important");
        overlay.style.setProperty("height", `${loadingRect.height}px`, "important");
        overlay.dataset.state = "expanding";
        overlay.setAttribute("aria-label", ariaLabel);
        positionOverlay(layout);

        requestAnimationFrame(() => {
            if (overlay !== translationOverlay || !overlay.isConnected) return;
            overlay.style.setProperty("width", `${targetRect.width}px`, "important");
            overlay.style.setProperty("height", `${targetRect.height}px`, "important");

            setTimeout(() => {
                if (overlay !== translationOverlay || !overlay.isConnected) return;
                overlay.dataset.state = "ready";
                overlay.style.removeProperty("width");
                overlay.style.removeProperty("height");
                overlay.classList.add(`${PREFIX}translation-reveal`);
                positionOverlay(layout);
            }, 260);
        });
        return overlay;
    }

    function applyTranslation(translatedText, layout = translationAnchorLayout, sourceText = null, srcLang = null, tgtLang = null) {
        const sentence = String(translatedText || "").trim();
        const originalText = String(sourceText || activeText || getPlayerRegistry()?.getCurrentText() || "").trim();
        const sourceTag = languageTag(srcLang || "auto");
        const targetTag = languageTag(tgtLang || "pl");

        const html = `
            <div class="${PREFIX}header">
                <span>${QT.escapeHtml(sourceTag)} → ${QT.escapeHtml(targetTag)}</span>
            </div>
            <div class="${PREFIX}body">
                ${originalText ? `
                <div class="${PREFIX}row">
                    <span class="${PREFIX}label" title="Source language">${QT.escapeHtml(sourceTag)}</span>
                    <span class="${PREFIX}text ${PREFIX}original">${QT.escapeHtml(originalText)}</span>
                </div>` : ""}
                <div class="${PREFIX}row">
                    <span class="${PREFIX}label" title="Translation language">${QT.escapeHtml(targetTag)}</span>
                    <span class="${PREFIX}text ${PREFIX}translated">${QT.escapeHtml(sentence)}</span>
                    <span class="${PREFIX}word-actions">
                        <button class="${PREFIX}speak" data-text="${QT.escapeAttr(sentence)}" data-lang="${QT.escapeAttr(tgtLang || "pl")}" title="Play translation">${SVG.SPEAKER}</button>
                    </span>
                </div>
            </div>
            <div class="${PREFIX}save-footer">
                <button class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn" title="Save sentence for review">
                    ${SVG.SAVE || "💾"} <span>Save</span>
                </button>
            </div>`;

        applyAiExplanation(html, layout);
        wireAiExplainSpeakButton();
        wireAiExplainSaveButton(
            originalText || sentence,
            sentence,
            "",
            srcLang || "auto",
            tgtLang || "pl"
        );
        eTranslateActive = true;
    }

    function applyAiExplanation(html, layout = translationAnchorLayout) {
        const overlay = translationOverlay || createOverlay(layout);
        overlay.classList.add(`${PREFIX}ai-explain-overlay`);
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-live", "off");
        const copy = document.createElement("div");
        copy.className = `${PREFIX}translation-copy ${PREFIX}ai-explain-copy`;
        copy.setAttribute("dir", "auto");
        copy.innerHTML = html;
        revealOverlayContent(copy, layout, "Sentence analysis");
    }

    async function doSentenceTranslation(video, sourceText = null, options = {}) {
        const modeRevision = options.revision ?? subtitleModeRevision;
        if (modeRevision !== subtitleModeRevision) return;
        const text = sourceText || activeText || getPlayerRegistry()?.getCurrentText();
        if (!text) return;

        eWasPlaying = video ? !video.paused : false;
        eTranslateActive = true;
        if (video && !video.paused) {
            getPlayerRegistry()?.pauseVideo(video);
        }

        const layout = options.layout || captureSubtitleLayout();
        showSubLoading(layout);
        const translation = await (options.translationTask ||
            createSubtitleTranslationTask(text, modeRevision));
        if (!translation || modeRevision !== subtitleModeRevision) return;
        applyTranslation(translation.translatedText, layout, text, translation.detectedLang, translation.targetLang);
        if (options.speakTranslated) {
            await QT.speak(translation.translatedText, translation.targetLang, {
                isCancelled: () => modeRevision !== subtitleModeRevision,
            });
        }
    }

    function restoreOriginal() {
        subtitleModeRevision += 1;
        subtitleModeStarting = false;
        removeOverlay();
        removeWordClouds();
        globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(false);
        for (const item of eOriginalContents) {
            if (item.el && item.html !== undefined) item.el.innerHTML = item.html;
        }
        eOriginalContents = [];
        eTranslateActive = false;
        wordCloudActive = false;
        if (typeof isReading !== "undefined" && isReading && typeof cleanupReading === "function") {
            cleanupReading();
        } else {
            try {
                window.speechSynthesis?.cancel();
            } catch (_) { }
        }
    }

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
        flash.className = "__qt_capture_flash";
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
            saveToastEl.id = "__qt_save_toast";
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
        { text = "", translated = "", thumb = "", duration = 2400 } = {},
    ) {
        const el = getSaveToastEl();
        clearTimeout(saveToastHideTimer);
        el.className = `__qt_${state}`;

        let iconHtml;
        let title;
        let bodyHtml;
        let thumbHtml = "";

        if (state === "saving") {
            iconHtml = `<div class="__qt_spinner"></div>`;
            title = "Saving sentence…";
            bodyHtml = `<div class="__qt_save_toast_text">${QT.escapeHtml(text)}</div>`;
        } else if (state === "success") {
            iconHtml = `<div class="__qt_check_pop">${SVG.SAVE_SENTENCE_CHECK}</div>`;
            title = "✔ Saved for review";
            bodyHtml = `
                <div class="__qt_save_toast_text">${QT.escapeHtml(text)}</div>
                ${translated && translated !== text
                    ? `<div class="__qt_save_toast_sub">${QT.escapeHtml(translated)}</div>`
                    : ""
                }
            `;
            if (thumb) thumbHtml = `<img class="__qt_save_toast_thumb" src="${thumb}" alt="" />`;
        } else {
            iconHtml = `<div class="__qt_error_mark">!</div>`;
            title = "⚠ Could not save";
            bodyHtml = `<div class="__qt_save_toast_text">${QT.escapeHtml(text)}</div>`;
        }

        el.innerHTML = `
            <div class="__qt_save_toast_icon">${iconHtml}</div>
            <div class="__qt_save_toast_body">
                <div class="__qt_save_toast_title">${title}</div>
                ${bodyHtml}
            </div>
            ${thumbHtml}
            <div class="__qt_save_toast_bar" style="animation-duration:${duration}ms"></div>
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
            QT.createHint("__qt_yt-sub-hint").show("No subtitles to save", 2000);
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

        const clean =
            typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                ? SharedUtils.cleanCardText
                : (s) => String(s || "").trim();
        const cleanedText = clean(text) || text;

        const screenshot = await registry.captureVideoReviewScreenshot(video);
        flashCapture();
        showSaveToast("saving", { text: cleanedText });

        try {
            const targetLang = await QT.getTargetLang();
            const { translated, detectedLang } = await QT.translate(cleanedText, targetLang);
            const srcLang = typeof detectedLang === "string" ? detectedLang : "auto";
            const cleanedTranslated = clean(translated) || translated || cleanedText;

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

            const duration = 2800;
            showSaveToast("success", {
                text: cleanedText,
                translated: cleanedTranslated,
                thumb: screenshot,
                duration,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, duration);
        } catch (err) {
            console.error("[Lectoro] saveCurrentSentence error:", err);
            const duration = 2200;
            showSaveToast("error", {
                text: "Could not save sentence",
                duration,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, duration);
        } finally {
            savingSentence = false;
        }
    }

    const SubtitleOverlay = {
        renderCustomSubtitles,
        getCustomSubtitleElements: () => activeWordSpans,
        getActiveLines: () => activeLines,
        getActiveText: () => activeText,
        makeSubtitlesInteractive,
        closeSubTooltip,
        handleAIExplain,
        closeAiTooltip,
        isAiTooltipActive: () => aiTooltipActive,
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
