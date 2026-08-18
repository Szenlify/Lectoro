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
    let aiShimmerEl = null;
    let aiExplainKeydownHandler = null;

    let reelsMode = false;
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
        "an", "and", "are", "as", "at", "be", "but", "by", "can", "can't", "could",
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

    function ensureCustomSubtitlesLayer() {
        if (customSubLayerEl && customSubLayerEl.isConnected) {
            return { layer: customSubLayerEl, box: customSubBoxEl };
        }

        const parent = (typeof QT !== "undefined" && QT.getOverlayParent)
            ? QT.getOverlayParent()
            : (document.fullscreenElement || document.body);

        customSubLayerEl = document.createElement("div");
        customSubLayerEl.id = `${PREFIX}custom_subtitles_layer`;
        customSubLayerEl.className = `${PREFIX}custom-subtitles-layer`;

        customSubBoxEl = document.createElement("div");
        customSubBoxEl.className = `${PREFIX}custom-subtitles-box`;
        customSubBoxEl.style.opacity = "0";

        customSubLayerEl.appendChild(customSubBoxEl);
        parent.appendChild(customSubLayerEl);

        return { layer: customSubLayerEl, box: customSubBoxEl };
    }

    let lineTimestamps = new Map();
    let lineEvaporateTimer = null;

    function isYouTubePage() {
        return /(^|\.)youtube\.com$/i.test(window.location.hostname) || getPlayerRegistry()?.type === "youtube";
    }

    function syncCustomSubtitlePosition() {
        if (layoutRafId !== null) return;
        layoutRafId = requestAnimationFrame(() => {
            layoutRafId = null;
            const { layer, box } = ensureCustomSubtitlesLayer();
            const video = getPlayerRegistry()?.getVideo();

            if (!video || !video.isConnected) {
                layer.style.display = "none";
                return;
            }

            if (trackedVideo !== video) {
                if (videoResizeObserver && trackedVideo) {
                    try { videoResizeObserver.unobserve(trackedVideo); } catch (_) {}
                }
                trackedVideo = video;
                if (typeof ResizeObserver !== "undefined") {
                    if (!videoResizeObserver) {
                        videoResizeObserver = new ResizeObserver(() => syncCustomSubtitlePosition());
                    }
                    videoResizeObserver.observe(video);
                }
            }

            const videoRect = video.getBoundingClientRect();
            if (videoRect.width === 0 || videoRect.height === 0) {
                layer.style.display = "none";
                return;
            }

            // Find video player container (Netflix .watch-video, YouTube #movie_player, etc.)
            const playerEl = video.closest(".watch-video, [data-uia='video-canvas'], .nf-player-container, #movie_player, .html5-video-player, .video-js") || video.parentElement;
            const playerRect = playerEl ? playerEl.getBoundingClientRect() : videoRect;

            // Clamped visible viewport bounds (never overflowing screen or going off bottom)
            const top = Math.max(0, Math.max(videoRect.top, playerRect.top));
            const bottom = Math.min(window.innerHeight, Math.min(videoRect.bottom, playerRect.bottom));
            const left = Math.max(0, Math.max(videoRect.left, playerRect.left));
            const right = Math.min(window.innerWidth, Math.min(videoRect.right, playerRect.right));
            const visibleWidth = Math.max(100, right - left);
            const visibleHeight = Math.max(100, bottom - top);

            if (visibleWidth <= 0 || visibleHeight <= 0 || bottom <= 0 || top >= window.innerHeight) {
                layer.style.display = "none";
                return;
            }

            // Ensure attached to current fullscreen / overlay root
            const expectedParent = (typeof QT !== "undefined" && QT.getOverlayParent)
                ? QT.getOverlayParent()
                : (document.fullscreenElement || document.body);
            if (layer.parentElement !== expectedParent) {
                expectedParent.appendChild(layer);
            }

            layer.style.display = "flex";
            layer.style.position = "fixed";
            layer.style.left = `${Math.round(left)}px`;
            layer.style.top = `${Math.round(top)}px`;
            layer.style.width = `${Math.round(visibleWidth)}px`;
            layer.style.height = `${Math.round(visibleHeight)}px`;

            // Responsive font sizing based on visible video width
            const fontSizePx = Math.max(16, Math.min(36, Math.round(visibleWidth * 0.024)));
            layer.style.setProperty("--lectoro-sub-font-size", `${fontSizePx}px`);

            // Responsive bottom offset:
            // Netflix needs ~11%-14% (min 78px) so subtitles are clearly above bottom controls and letterboxing.
            // YouTube needs ~8%-10% (min 48px).
            // Reels mode needs ~24% (min 120px).
            const isNetflix = isNetflixPage();
            const baseBottomPx = isNetflix
                ? Math.max(78, Math.round(visibleHeight * 0.12))
                : Math.max(48, Math.round(visibleHeight * 0.08));
            const reelsBottomPx = Math.max(120, Math.round(visibleHeight * 0.24));

            layer.style.setProperty(
                "--lectoro-sub-bottom",
                reelsMode ? `${reelsBottomPx}px` : `${baseBottomPx}px`
            );

            if (reelsMode) {
                layer.classList.add(`${PREFIX}reels-active`);
            } else {
                layer.classList.remove(`${PREFIX}reels-active`);
            }
        });
    }

    function renderCustomSubtitles(lines = []) {
        const { layer, box } = ensureCustomSubtitlesLayer();
        const rawCleanLines = (Array.isArray(lines) ? lines : [lines])
            .map((l) => (typeof l === "string" ? l.trim() : ""))
            .filter(Boolean);

        clearTimeout(lineEvaporateTimer);
        lineEvaporateTimer = null;

        if (rawCleanLines.length === 0) {
            activeLines = [];
            activeText = "";
            activeWordSpans = [];
            lineTimestamps.clear();
            box.innerHTML = "";
            box.style.opacity = "0";
            box.style.pointerEvents = "none";
            if (isSubHovering && !subClickLocked) {
                closeSubTooltip();
            }
            return;
        }

        const now = Date.now();

        // Update timestamps for new lines
        for (const line of rawCleanLines) {
            if (!lineTimestamps.has(line)) {
                lineTimestamps.set(line, now);
            }
        }

        // Clean up timestamps for lines that are no longer present
        for (const key of Array.from(lineTimestamps.keys())) {
            if (!rawCleanLines.includes(key)) {
                lineTimestamps.delete(key);
            }
        }

        let displayLines = [...rawCleanLines];

        // YouTube auto-generated / rolling speech mode:
        // When multiple lines are present, older lines evaporate after 1.0s of presence
        if (isYouTubePage() && rawCleanLines.length > 1) {
            const latestLine = rawCleanLines[rawCleanLines.length - 1];
            let nextEvaporateIn = Infinity;

            displayLines = rawCleanLines.filter((line, index) => {
                // Keep the latest active line always
                if (index === rawCleanLines.length - 1) return true;

                const firstSeen = lineTimestamps.get(line) || now;
                const age = now - firstSeen;
                const EVAPORATE_MS = 1000; // 1 second evaporation for older lines

                if (age >= EVAPORATE_MS) {
                    return false; // Evaporated!
                }

                // Schedule re-render for when this line expires
                const remaining = EVAPORATE_MS - age;
                if (remaining < nextEvaporateIn) {
                    nextEvaporateIn = remaining;
                }
                return true;
            });

            // If all older lines evaporated, keep only latest
            if (displayLines.length === 0) {
                displayLines = [latestLine];
            }

            if (Number.isFinite(nextEvaporateIn) && nextEvaporateIn > 0 && nextEvaporateIn < 5000) {
                lineEvaporateTimer = setTimeout(() => {
                    renderCustomSubtitles(rawCleanLines);
                }, nextEvaporateIn + 10);
            }
        }

        const newText = displayLines.join(" ");
        if (newText === activeText && box.children.length === displayLines.length) {
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

        box.style.opacity = "1";
        box.style.pointerEvents = "auto";
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
            if (tooltip?.matches(":hover")) return;
            if (subClickLocked) return;
            const { x, y } = (typeof QT !== "undefined" && QT.getMousePos)
                ? QT.getMousePos()
                : { x: 0, y: 0 };
            const wordUnderMouse = QT.findWordAtPoint(x, y, PREFIX + "sub-word");
            if (wordUnderMouse) return;
            closeSubTooltip();
        }, 350);
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
            if (tooltip && tooltip.contains(e.target)) {
                clearTimeout(subHoverTimer);
                clearTimeout(subCloseTimer);
                subHoverTimer = null;
                subCloseTimer = null;
                return;
            }

            const wordSpan = isOwnUI(e.target)
                ? null
                : QT.findWordAtPoint(e.clientX, e.clientY, PREFIX + "sub-word");

            if (wordSpan && wordSpan !== lastHoveredSubWord) {
                clearTimeout(subCloseTimer);
                subCloseTimer = null;
                if (lastHoveredSubWord) {
                    lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                }
                lastHoveredSubWord = wordSpan;
                wordSpan.classList.add(`${PREFIX}word-hover`);

                clearTimeout(subHoverTimer);
                const video = registry.getVideo();
                if (!isSubHovering) {
                    subWasPlaying = video ? !video.paused : false;
                }

                isSubHovering = true;
                subTooltipAnchor = wordSpan;

                if (video && !video.paused) {
                    registry?.pauseVideo(video);
                }

                subHoverTimer = setTimeout(async () => {
                    if (lastHoveredSubWord !== wordSpan) return;
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
                }, 0);
            } else if (!wordSpan) {
                clearTimeout(subHoverTimer);
                if (lastHoveredSubWord) {
                    lastHoveredSubWord.classList.remove(`${PREFIX}word-hover`);
                    lastHoveredSubWord = null;
                }
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

        const sentence = activeText || registry?.getCurrentText() || text;
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

            const showFullLine = sentence && sentence !== text;
            let fullTranslated = null;
            if (showFullLine) {
                fullTranslated = (await subCache.get(sentence, targetLang)).translated;
            }

            if (!isSubHovering || lastHoveredSubWord !== wordSpan) return;

            const html = QT.buildTooltipHtml({
                srcLang,
                targetLang,
                original: text,
                translated: wordRes.translated,
                fullLine: showFullLine ? sentence : null,
                fullTranslated,
                speakFullLine: true,
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

    // ── AI Explanations & Reels Mode ──────────────────────────────

    function showAiShimmer(rect) {
        removeAiShimmer();
        const parent = QT.getOverlayParent();
        aiShimmerEl = document.createElement("div");
        aiShimmerEl.className = `${PREFIX}ai-loader`;
        aiShimmerEl.innerHTML = `<span class="${PREFIX}ai-loader-label">Analizuje...</span>`;
        parent.appendChild(aiShimmerEl);
        positionAiShimmer(rect);
        ensureSubtitleUiTracking();
    }

    function positionAiShimmer(rect) {
        if (!aiShimmerEl || !rect) return;
        const loaderRect = aiShimmerEl.getBoundingClientRect();
        let left = rect.left + (rect.width - loaderRect.width) / 2;
        left = Math.max(4, Math.min(left, window.innerWidth - loaderRect.width - 4));
        aiShimmerEl.style.left = left + "px";
        aiShimmerEl.style.top = rect.top - loaderRect.height - 10 + "px";
    }

    function removeAiShimmer() {
        if (aiShimmerEl) {
            aiShimmerEl.remove();
            aiShimmerEl = null;
        }
    }
    if (typeof QT !== "undefined" && QT.addCleanup) QT.addCleanup(removeAiShimmer);

    function closeAiTooltip() {
        if (aiExplainKeydownHandler) {
            window.removeEventListener("keydown", aiExplainKeydownHandler);
            aiExplainKeydownHandler = null;
        }
        if (!aiTooltipActive) return;
        aiTooltipActive = false;
        QT.hideTooltip();
        removeAiShimmer();
        if (aiWasPlaying) {
            aiWasPlaying = false;
            const video = getPlayerRegistry()?.getVideo();
            if (video && video.paused) getPlayerRegistry()?.playVideo(video);
        }
    }
    if (typeof QT !== "undefined" && QT.addDismissHandler) QT.addDismissHandler(closeAiTooltip);

    function wireAiExplainSaveButton(text, translation, explanation, targetLang) {
        const tooltipNode = document.getElementById(PREFIX + "tooltip");
        const saveBtn = tooltipNode?.querySelector(`.${PREFIX}ai-explain-save-btn`);
        if (!saveBtn) return;

        if (!saveBtn.querySelector(`.${PREFIX}key-hint`)) {
            const hintNode = document.createElement("kbd");
            hintNode.className = `${PREFIX}key-hint`;
            hintNode.textContent = "PageDown";
            saveBtn.appendChild(hintNode);
        }

        saveBtn.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            if (saveBtn.classList.contains("saved")) return;
            const screenshot = await getPlayerRegistry()?.captureVideoReviewScreenshot(
                getPlayerRegistry().getVideo(),
            );
            try {
                await QT.saveWord({
                    original: text,
                    translated: translation || text,
                    srcLang: "en",
                    tgtLang: targetLang,
                    sentence: "",
                    sentenceTranslated: "",
                    aiSentence: explanation || "",
                    aiSentenceTranslated: "",
                    screenshot,
                    url: window.location.href,
                    timestamp: Date.now(),
                    downloaded: false,
                });
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE_CHECK} <span>Zapisano!</span>`;
                saveBtn.classList.add("saved");
            } catch (error) {
                saveBtn.innerHTML = `${SVG.SAVE_SENTENCE} <span>Limit planu</span>`;
                saveBtn.title = error.message;
            }
        });

        if (aiExplainKeydownHandler) {
            window.removeEventListener("keydown", aiExplainKeydownHandler);
        }
        aiExplainKeydownHandler = (ev) => {
            const isTyping =
                ["INPUT", "TEXTAREA"].includes(ev.target?.tagName) ||
                ev.target?.isContentEditable;
            if (isTyping) return;

            if (ev.key === "PageDown") {
                if (document.contains(saveBtn)) {
                    ev.preventDefault();
                    saveBtn.click();
                } else {
                    window.removeEventListener("keydown", aiExplainKeydownHandler);
                    aiExplainKeydownHandler = null;
                }
            }
        };
        window.addEventListener("keydown", aiExplainKeydownHandler);
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

        const rect = getSubtitleRect() || {
            left: window.innerWidth / 2 - 100,
            top: window.innerHeight - 150,
            width: 200,
            height: 50,
        };

        showAiShimmer(rect);
        try {
            const targetLang = await QT.getTargetLang();
            const res = await QT.geminiExplainSentence(text, targetLang);
            if (!aiTooltipActive) return;
            removeAiShimmer();

            const translation = res.translation || "";
            const explanation = res.explanation || res;
            const aiSpeechText = [translation, explanation]
                .filter(Boolean)
                .join(". ");

            const html = `
                <div class="${PREFIX}header"><span>✨ AI Wyjaśnia</span></div>
                <div class="${PREFIX}body">
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">EN</span>
                        <span class="${PREFIX}text ${PREFIX}original">${QT.escapeHtml(text)}</span>
                    </div>
                    <div class="${PREFIX}row">
                        <span class="${PREFIX}label">PL</span>
                        <span class="${PREFIX}text ${PREFIX}translated">${QT.escapeHtml(translation)}</span>
                        <button class="${PREFIX}speak" data-text="${QT.escapeAttr(aiSpeechText)}" data-lang="pl" title="Odczytaj tłumaczenie i wyjaśnienie">${SVG.SPEAKER}</button>
                    </div>
                    <div class="${PREFIX}ai-result" style="margin-top:10px;">
                        <div class="${PREFIX}ai-label">Wyjaśnienie:</div>
                        <div class="${PREFIX}ai-text">${QT.escapeHtml(explanation)}</div>
                    </div>
                </div>
                <div class="${PREFIX}save-footer">
                    <button class="${PREFIX}ai-explain-save-btn ${PREFIX}save-footer-btn" title="Zapisz zdanie razem ze zdjęciem do powtórek">
                        ${SVG.SAVE_SENTENCE} <span>Zapisz do powtórek</span>
                    </button>
                </div>`;
            QT.showTooltip(html, rect, "top");
            QT.attachTooltipHandlers();
            wireAiExplainSaveButton(text, translation, explanation, targetLang);

            if (aiTooltipActive) {
                await QT.speak(aiSpeechText, "pl", {
                    isCancelled: () => !aiTooltipActive,
                });
            }
        } catch (err) {
            removeAiShimmer();
            if (aiTooltipActive) {
                const limitReached = typeof GeminiProxy !== "undefined" && GeminiProxy.isLimitError?.(err);
                if (limitReached) {
                    closeAiTooltip();
                } else {
                    QT.showTooltip(
                        `<div class="${PREFIX}error">⚠ ${QT.escapeHtml(err.message)}</div>`,
                        rect,
                        "top",
                    );
                }
            }
        }
    }

    function setReelsMode(on) {
        reelsMode = on;
        if (on) {
            document.body.classList.add(`${PREFIX}reels-active`);
            if (customSubLayerEl) customSubLayerEl.classList.add(`${PREFIX}reels-active`);
            QT.createHint("").show("Reels ON 🎬", 2500);
        } else {
            document.body.classList.remove(`${PREFIX}reels-active`);
            if (customSubLayerEl) customSubLayerEl.classList.remove(`${PREFIX}reels-active`);
            QT.createHint("").show("Reels OFF", 2000);
        }
        syncCustomSubtitlePosition();
    }

    function showSpeedOverlay(speed) {
        if (!speedOverlayEl) {
            speedOverlayEl = document.createElement("div");
            speedOverlayEl.style.cssText =
                "position:fixed; top:40px; right:40px; background:rgba(0,0,0,0.8); color:#fff; padding:10px 16px; border-radius:8px; font-family:sans-serif; font-size:16px; font-weight:bold; z-index:2147483647; opacity:0; transition:opacity 0.2s ease; pointer-events:none;";
            document.body.appendChild(speedOverlayEl);
        }
        speedOverlayEl.textContent = `Prędkość: ${speed.toFixed(2)}x`;
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
        let top = rect.top - cloudRect.height - 6;
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

        if (aiTooltipActive) {
            const rect = getSubtitleRect();
            if (rect) {
                positionAiShimmer(rect);
                if (QT.getTooltipEl()?.classList.contains("visible")) {
                    QT.positionTooltip(rect, "top");
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
            }).catch(() => {});
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
            const { translated } = await QT.translate(text, targetLang);
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: translated || text };
        } catch (_) {
            if (modeRevision !== subtitleModeRevision) return null;
            return { targetLang, translatedText: text };
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
        translationOverlay.className = PREFIX + "sub-overlay";
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

        translationOverlay.style.setProperty(
            "font-size",
            "var(--lectoro-sub-font-size, 20px)",
            "important",
        );
        translationOverlay.style.position = "fixed";
        translationOverlay.style.left = rect.left + "px";
        translationOverlay.style.width = rect.width + "px";
        translationOverlay.style.padding = "8px";
        const overlayH = translationOverlay.offsetHeight || 40;
        translationOverlay.style.top = `${Math.max(10, rect.top - overlayH - 14)}px`;
    }

    function showSubLoading(layout = null) {
        const overlay = createOverlay(layout);
        overlay.innerHTML = `<div class="${PREFIX}shimmer-bar"><div class="${PREFIX}shimmer-line"></div><div class="${PREFIX}shimmer-line ${PREFIX}shimmer-short"></div></div>`;
        positionOverlay();
    }

    function applyTranslation(translatedText, layout = translationAnchorLayout) {
        const lineLengths = layout?.lineLengths || (activeLines.length > 0 ? activeLines.map((l) => l.length) : [1]);
        const overlay = translationOverlay || createOverlay(layout);
        const words = translatedText.split(/\s+/).filter(Boolean);
        if (lineLengths.length <= 1) {
            const line = document.createElement("div");
            line.className = PREFIX + "sub-overlay-line";
            line.textContent = words.join(" ");
            overlay.replaceChildren(line);
        } else {
            const totalOrigLen = lineLengths.reduce((a, b) => a + b, 0);
            const totalWords = words.length;
            let wordIdx = 0;
            const lines = [];
            lineLengths.forEach((lineLength, i) => {
                if (i === lineLengths.length - 1) {
                    lines.push(words.slice(wordIdx).join(" "));
                } else {
                    const remainingLines = lineLengths.length - i;
                    const remainingWords = totalWords - wordIdx;
                    const proportionalShare = Math.round(
                        (lineLength / totalOrigLen) * totalWords,
                    );
                    const share = Math.max(
                        1,
                        Math.min(proportionalShare, remainingWords - (remainingLines - 1)),
                    );
                    lines.push(words.slice(wordIdx, wordIdx + share).join(" "));
                    wordIdx += share;
                }
            });
            overlay.replaceChildren(
                ...lines.map((text) => {
                    const line = document.createElement("div");
                    line.className = PREFIX + "sub-overlay-line";
                    line.textContent = text;
                    return line;
                }),
            );
        }
        positionOverlay(layout);
        eTranslateActive = true;
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
        applyTranslation(translation.translatedText, layout);
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
            } catch (_) {}
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
            saveToastEl.title = "Kliknij, aby zamknąć i wznowić odtwarzanie";
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
            title = "Zapisywanie zdania…";
            bodyHtml = `<div class="__qt_save_toast_text">${QT.escapeHtml(text)}</div>`;
        } else if (state === "success") {
            iconHtml = `<div class="__qt_check_pop">${SVG.SAVE_SENTENCE_CHECK}</div>`;
            title = "✔ Zapisano do powtórek";
            bodyHtml = `
                <div class="__qt_save_toast_text">${QT.escapeHtml(text)}</div>
                ${
                    translated && translated !== text
                        ? `<div class="__qt_save_toast_sub">${QT.escapeHtml(translated)}</div>`
                        : ""
                }
            `;
            if (thumb) thumbHtml = `<img class="__qt_save_toast_thumb" src="${thumb}" alt="" />`;
        } else {
            iconHtml = `<div class="__qt_error_mark">!</div>`;
            title = "⚠ Nie udało się zapisać";
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
            QT.createHint("__qt_yt-sub-hint").show("Brak napisów do zapisania", 2000);
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

        const screenshot = await registry.captureVideoReviewScreenshot(video);
        flashCapture();
        showSaveToast("saving", { text });

        try {
            const targetLang = await QT.getTargetLang();
            const { translated, detectedLang } = await QT.translate(text, targetLang);
            const srcLang = typeof detectedLang === "string" ? detectedLang : "auto";

            await QT.saveWord({
                original: text,
                translated: translated || text,
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
                text,
                translated: translated || text,
                thumb: screenshot,
                duration,
            });
            saveResumeTimer = setTimeout(resumeAfterSave, duration);
        } catch (err) {
            console.error("[Lectoro] saveCurrentSentence error:", err);
            const duration = 2200;
            showSaveToast("error", {
                text: "Nie udało się zapisać zdania",
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
            (translationOverlay?.isConnected ?? false),
        showWordClouds,
        removeWordClouds,
        doSentenceTranslation,
        restoreOriginal,
        resumeVideoAfterSubtitleClose,
        saveCurrentSentenceToReview,
        setReelsMode,
        isReelsMode: () => reelsMode,
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
