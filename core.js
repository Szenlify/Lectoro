/**
 * Lectoro – Core Module
 * Shared UI tooltips, context screenshot capture, and subtitle helpers.
 * Delegates translation, TTS, word repository, and constants to SSOT shared services.
 *
 * Exposes: window.QT
 */
(() => {
    "use strict";

    const C = LectoroConstants;
    const { escapeHtml, escapeAttr, cleanTextForTTS, cleanCardText, pickBestVoice, ensureVoices } = SharedUtils;
    const { PREFIX, langTag, isOwnUI } = C;
    const ICON_ID = C.UI_IDS.ICON;
    const TOOLTIP_ID = C.UI_IDS.TOOLTIP;
    const SVG = C.SVG_ICONS;
    const MSG = C.MESSAGE_TYPES;

    const TOOLTIP_HIDE_MS = 180;
    const REVIEW_TOAST_MS = 4000;
    const SCREENSHOT_MAX_PX = 330;
    const SCREENSHOT_BG = "#12131c";

    // ── Internal State ─────────────────────────────────────────────
    let tooltipEl = null;
    let tooltipShowFrame = null;
    let tooltipHideTimer = null;
    let tooltipSpeechToken = 0;
    let activeTooltipSpeechButton = null;
    let tooltipSpeechTimer = null;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let screenshotContext = null;

    const cleanupHandlers = [];
    const dismissHandlers = [];

    // ── Review-due toast notification ──────────────────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (window === window.top && msg.type === MSG.REVIEW_DUE && msg.count > 0) {
            showReviewDueToast(msg.count);
        }
    });

    function showReviewDueToast(count) {
        const toastId = C.UI_IDS.REVIEW_TOAST;
        document.getElementById(toastId)?.remove();

        const toast = document.createElement("div");
        toast.id = toastId;
        toast.innerHTML = `<span style="margin-right:6px">🧠</span> ${count === 1 ? "Review due!" : `${count} reviews due!`}`;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add(C.UI_CLASSES.TOAST_VISIBLE);
            });
        });

        setTimeout(() => {
            toast.classList.remove(C.UI_CLASSES.TOAST_VISIBLE);
            setTimeout(() => toast.remove(), 400);
        }, REVIEW_TOAST_MS);
    }

    document.addEventListener("mousemove", (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    // ═══════════════════════════════════════════════════════════════
    //  UI – Overlay Parent & Tooltip
    // ═══════════════════════════════════════════════════════════════

    /**
     * Returns the best parent for overlay UI.
     * In fullscreen, the browser only renders children of the fullscreen element.
     */
    function getOverlayParent() {
        return (
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body
        );
    }

    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    function getTooltip() {
        if (!tooltipEl) {
            tooltipEl = document.createElement("div");
            tooltipEl.id = TOOLTIP_ID;
        }
        const parent = getOverlayParent();
        if (tooltipEl.parentElement !== parent) parent.appendChild(tooltipEl);
        return tooltipEl;
    }

    // `preferredPosition` is part of the public QT signature; the tooltip is always laid out above
    // the anchor and clamped into the viewport.
    function positionTooltip(rect, preferredPosition = "top") {
        if (!tooltipEl || !rect) return;

        const tip = getTooltip();
        const inFullscreen = isFullscreen();
        const gap = 10;

        tip.style.bottom = "auto";
        tip.style.right = "auto";
        tip.style.position = inFullscreen ? "fixed" : "absolute";
        // Reset before measuring so the tooltip's own size doesn't clamp the layout.
        tip.style.left = "0px";
        tip.style.top = "0px";

        const tipRect = tip.getBoundingClientRect();
        const scrollX = inFullscreen ? 0 : window.scrollX;
        const scrollY = inFullscreen ? 0 : window.scrollY;
        const viewportWidth = inFullscreen ? window.innerWidth : document.documentElement.clientWidth;
        const viewportHeight = inFullscreen ? window.innerHeight : document.documentElement.clientHeight;

        let left = rect.left + scrollX + (rect.width - tipRect.width) / 2;
        let top = rect.top + scrollY - tipRect.height - gap;

        const maxTop = scrollY + viewportHeight - tipRect.height - 4;
        const maxLeft = scrollX + viewportWidth - tipRect.width - 4;
        top = Math.max(scrollY + 4, Math.min(top, maxTop));
        left = Math.max(scrollX + 4, Math.min(left, maxLeft));

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
    }

    function showTooltip(html, rect, preferredPosition = "top", anchorOverride = null) {
        rememberScreenshotContext(rect, anchorOverride);
        const tip = getTooltip();
        clearTimeout(tooltipHideTimer);
        if (tooltipShowFrame !== null) cancelAnimationFrame(tooltipShowFrame);
        stopTooltipSpeech();
        tip.innerHTML = html;
        tip.querySelectorAll("button").forEach((button) => {
            button.type = "button";
        });
        tip.classList.remove("visible");

        positionTooltip(rect, preferredPosition);

        tooltipShowFrame = requestAnimationFrame(() => {
            tooltipShowFrame = null;
            if (tip.innerHTML) tip.classList.add("visible");
        });
    }

    function hideTooltip() {
        if (!tooltipEl) return;
        if (tooltipShowFrame !== null) {
            cancelAnimationFrame(tooltipShowFrame);
            tooltipShowFrame = null;
        }
        clearTimeout(tooltipHideTimer);
        stopTooltipSpeech();
        tooltipEl.classList.remove("visible");
        tooltipHideTimer = setTimeout(() => {
            if (tooltipEl) tooltipEl.innerHTML = "";
            tooltipHideTimer = null;
        }, TOOLTIP_HIDE_MS);
    }

    function showLoading(rect, preferredPosition = "top", anchorOverride = null) {
        showTooltip(
            `<div class="${PREFIX}loading"><div class="${PREFIX}spinner"></div></div>`,
            rect,
            preferredPosition,
            anchorOverride,
        );
    }

    function runHandlers(handlers) {
        handlers.forEach((fn) => {
            try { fn(); } catch (_) { }
        });
    }

    function hideAll() {
        hideTooltip();
        runHandlers(cleanupHandlers);
    }

    function addCleanup(fn) {
        cleanupHandlers.push(fn);
    }
    function addDismissHandler(fn) {
        dismissHandlers.push(fn);
    }
    function runDismiss() {
        runHandlers(dismissHandlers);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Context-aware Screenshot Capture
    // ═══════════════════════════════════════════════════════════════

    function rememberScreenshotContext(rect, anchorOverride = null) {
        if (!rect) return;
        const left = Number(rect.left);
        const top = Number(rect.top);
        const right = Number(rect.right);
        const bottom = Number(rect.bottom);
        if (![left, top, right, bottom].every(Number.isFinite)) return;

        let anchorElement = null;
        if (anchorOverride && anchorOverride.nodeType === Node.ELEMENT_NODE && !isOwnUI(anchorOverride)) {
            anchorElement = anchorOverride;
        } else if (
            anchorOverride &&
            anchorOverride.nodeType === Node.TEXT_NODE &&
            anchorOverride.parentElement &&
            !isOwnUI(anchorOverride.parentElement)
        ) {
            anchorElement = anchorOverride.parentElement;
        } else {
            const x = Math.max(0, Math.min(window.innerWidth - 1, (left + right) / 2));
            const y = Math.max(0, Math.min(window.innerHeight - 1, (top + bottom) / 2));
            anchorElement =
                document
                    .elementsFromPoint(x, y)
                    .find((element) => !isOwnUI(element)) || null;
        }

        screenshotContext = {
            rect: { left, top, right, bottom },
            anchorElement,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        };
    }

    function getMediaContextRoot(element) {
        return element?.closest?.(
            'article, [role="article"], shreddit-post, [data-testid="tweet"], [data-testid="post-container"], [data-pagelet^="FeedUnit"], [data-testid="post"], [data-testid="cellInnerDiv"], section, figure, .card, .post, .entry-content, .article-body, .feed-item, main'
        );
    }

    function distanceBetweenRects(a, b) {
        const dx = Math.max(a.left - b.right, b.left - a.right, 0);
        const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
        return { dist: Math.hypot(dx, dy), dx, dy };
    }

    function getSharedContainerBonus(anchorElement, media) {
        if (!anchorElement || !media) return 0;
        let ancestor = anchorElement;
        for (let depth = 0; ancestor && depth < 20; depth += 1) {
            if (ancestor === document.body || ancestor === document.documentElement) break;
            if (ancestor.contains?.(media)) return Math.max(0, 5_000 - depth * 150);
            ancestor = ancestor.parentElement;
        }
        return 0;
    }

    function getVisibleMediaCandidates() {
        if (!screenshotContext?.rect) return [];

        const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
        const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
        const storedRect = screenshotContext.rect;
        const scrollDeltaX = window.scrollX - (screenshotContext.scrollX || 0);
        const scrollDeltaY = window.scrollY - (screenshotContext.scrollY || 0);
        const anchorRect = {
            left: storedRect.left - scrollDeltaX,
            right: storedRect.right - scrollDeltaX,
            top: storedRect.top - scrollDeltaY,
            bottom: storedRect.bottom - scrollDeltaY,
        };
        const anchorRoot = getMediaContextRoot(screenshotContext.anchorElement);
        const anchorElement = screenshotContext.anchorElement;

        const mediaElements = Array.from(
            document.querySelectorAll(
                "img, picture img, figure img, video, canvas, [role='img'], [style*='background-image'], [data-testid='tweetPhoto'] img, shreddit-post img, faceplate-img"
            )
        );

        return mediaElements
            .filter((media) => !isOwnUI(media))
            .map((media) => {
                const rect = media.getBoundingClientRect();
                const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
                const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
                const visibleArea = visibleWidth * visibleHeight;
                const area = Math.max(1, rect.width * rect.height);
                return { media, rect, visibleArea, visibleRatio: visibleArea / area };
            })
            .filter(({ media, rect, visibleArea }) => {
                if (
                    rect.width < 32 ||
                    rect.height < 32 ||
                    (rect.width * rect.height < 1600 && visibleArea < 1600)
                ) {
                    return false;
                }

                const mediaLabel = `${media.className || ""} ${media.id || ""} ${media.getAttribute?.("alt") || ""}`.toLowerCase();
                const isDecorativeOrAd =
                    rect.width <= 64 &&
                    rect.height <= 64 &&
                    /\b(avatar|profile-pic|emoji|emoticon|icon|logo|badge|button|arrow|star|rating)\b/i.test(
                        mediaLabel
                    );
                if (isDecorativeOrAd) return false;

                const style = window.getComputedStyle(media);
                return (
                    style.display !== "none" &&
                    style.visibility !== "hidden" &&
                    Number(style.opacity || 1) > 0.05
                );
            })
            .map(({ media, rect, visibleRatio, visibleArea }) => {
                const { dist, dx, dy } = distanceBetweenRects(anchorRect, rect);
                const mediaRoot = getMediaContextRoot(media);
                const sharedBonus = getSharedContainerBonus(anchorElement, media);
                const isDirectShared = sharedBonus > 0 || (anchorRoot && mediaRoot && anchorRoot === mediaRoot);

                let score = dist + (1 - Math.min(1, visibleRatio)) * 250 - sharedBonus;
                if (anchorRoot && mediaRoot && anchorRoot === mediaRoot) score -= 50_000;
                if (anchorElement && media.contains(anchorElement)) score -= 60_000;
                if (anchorElement && anchorElement.parentElement?.contains(media)) score -= 80_000;

                return { media, rect, dist, dx, dy, isDirectShared, visibleArea, score };
            })
            .filter(({ dist, dx, dy, isDirectShared, visibleArea }) => {
                if (isDirectShared && dist <= 1600) return true;
                if (!isDirectShared && dist > 750) return false;
                if (!isDirectShared && dy > 600 && dx > 500) return false;
                if (visibleArea === 0 && dist > 300) return false;
                return true;
            })
            .sort((a, b) => a.score - b.score)
            .map(({ media }) => media);
    }

    /**
     * Renders `draw(ctx, width, height)` onto a canvas scaled to fit SCREENSHOT_MAX_PX
     * and returns a WebP data URL (JPEG when WebP encoding is unavailable).
     */
    function renderScaledDataUrl(sourceWidth, sourceHeight, draw) {
        if (!sourceWidth || !sourceHeight || sourceWidth <= 0 || sourceHeight <= 0) return null;
        const scale = Math.min(SCREENSHOT_MAX_PX / sourceWidth, SCREENSHOT_MAX_PX / sourceHeight, 1);
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = SCREENSHOT_BG;
        ctx.fillRect(0, 0, width, height);
        draw(ctx, width, height);

        const webpUrl = canvas.toDataURL("image/webp", 0.75);
        if (webpUrl && webpUrl.startsWith("data:image/webp")) {
            return webpUrl;
        }
        return canvas.toDataURL("image/jpeg", 0.80);
    }

    function drawMediaToDataUrl(media) {
        try {
            const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
            const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
            return renderScaledDataUrl(sourceWidth, sourceHeight, (ctx, width, height) => {
                ctx.drawImage(media, 0, 0, width, height);
            });
        } catch (_) {
            return null;
        }
    }

    function cropAndScaleCanvas(img, sx, sy, sw, sh) {
        return renderScaledDataUrl(sw, sh, (ctx, dw, dh) => {
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        });
    }

    async function captureVisibleTabCrop(rect) {
        if (!rect) return null;
        try {
            const response = await SharedUtils.sendRuntimeMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
            if (!response?.dataUrl) return null;
            const img = await loadImage(response.dataUrl);
            if (!img || !img.naturalWidth || !img.naturalHeight) return null;
            const dpr = window.devicePixelRatio || 1;

            const clientX = Math.max(0, rect.left);
            const clientY = Math.max(0, rect.top);
            const clientRight = Math.min(window.innerWidth, rect.right);
            const clientBottom = Math.min(window.innerHeight, rect.bottom);
            const clientWidth = clientRight - clientX;
            const clientHeight = clientBottom - clientY;

            if (clientWidth < 20 || clientHeight < 20) return null;

            const sx = Math.round(clientX * dpr);
            const sy = Math.round(clientY * dpr);
            const sw = Math.round(clientWidth * dpr);
            const sh = Math.round(clientHeight * dpr);

            if (sx + sw > img.naturalWidth || sy + sh > img.naturalHeight) {
                // Captured image and viewport disagree on DPR – derive the scale from actual sizes.
                const scaleX = img.naturalWidth / (window.innerWidth || 1);
                const scaleY = img.naturalHeight / (window.innerHeight || 1);
                return cropAndScaleCanvas(
                    img,
                    Math.round(clientX * scaleX),
                    Math.round(clientY * scaleY),
                    Math.round(clientWidth * scaleX),
                    Math.round(clientHeight * scaleY),
                );
            }

            return cropAndScaleCanvas(img, sx, sy, sw, sh);
        } catch (_) {
            return null;
        }
    }

    function extractImageSourceUrl(media) {
        if (!media || !(media instanceof Element)) return null;

        const imgChild = media instanceof HTMLImageElement ? media : media.querySelector?.("img, image");
        const target = imgChild || media;

        const candidates = [];
        if (target instanceof HTMLImageElement) {
            candidates.push(
                target.currentSrc,
                target.dataset?.src,
                target.dataset?.original,
                target.dataset?.lazySrc,
                target.dataset?.actualsrc,
                target.dataset?.fullSrc,
                target.getAttribute?.("data-src"),
                target.getAttribute?.("data-original"),
                target.getAttribute?.("data-lazy-src"),
                target.getAttribute?.("data-actualsrc"),
                target.getAttribute?.("data-full-src"),
                target.src,
                target.getAttribute?.("src"),
            );

            if (target.parentElement?.tagName === "PICTURE") {
                const sources = Array.from(target.parentElement.querySelectorAll("source"));
                for (const source of sources) {
                    if (source.srcset) candidates.push(source.srcset);
                }
            }

            if (target.srcset) {
                candidates.push(target.srcset);
            }
        } else {
            const style = window.getComputedStyle(target);
            const bg = style.backgroundImage;
            if (bg && bg !== "none" && bg.includes("url(")) {
                const match = bg.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
                if (match && match[1]) {
                    candidates.push(match[1]);
                }
            }
            if (target.getAttribute?.("src")) candidates.push(target.getAttribute("src"));
            if (target.dataset?.src) candidates.push(target.dataset.src);
        }

        for (let candidate of candidates) {
            if (!candidate || typeof candidate !== "string") continue;
            candidate = candidate.trim();
            if (!candidate) continue;

            if (candidate.includes(",") || /\s+\d+[wx]/.test(candidate)) {
                const parts = candidate.split(",").map((s) => s.trim()).filter(Boolean);
                const lastPart = parts[parts.length - 1] || parts[0];
                candidate = lastPart.split(/\s+/)[0];
            }

            if (/^data:image\/(svg|gif);base64,R0lGOD/i.test(candidate)) continue;
            if (candidate.startsWith("//")) {
                candidate = window.location.protocol + candidate;
            } else if (
                !candidate.startsWith("http://") &&
                !candidate.startsWith("https://") &&
                !candidate.startsWith("data:") &&
                !candidate.startsWith("blob:")
            ) {
                try {
                    candidate = new URL(candidate, document.baseURI).href;
                } catch (_) { }
            }
            if (/^(https?:|data:image\/|blob:)/i.test(candidate)) {
                return candidate;
            }
        }

        return target instanceof HTMLImageElement ? (target.currentSrc || target.src || null) : null;
    }

    function fetchBlobAsDataUrl(blobUrl) {
        return fetch(blobUrl)
            .then((r) => r.blob())
            .then(
                (blob) =>
                    new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => resolve(null);
                        reader.readAsDataURL(blob);
                    }),
            )
            .catch(() => null);
    }

    async function requestImageDataUrl(url) {
        if (!url) return null;
        try {
            const response = await SharedUtils.sendRuntimeMessage({ type: MSG.FETCH_CONTEXT_IMAGE, url });
            return response?.dataUrl || null;
        } catch (_) {
            return null;
        }
    }

    function loadImage(src) {
        return new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = src;
        });
    }

    /** Load an image from a data URL and rasterize it into a scaled screenshot. */
    async function drawFromDataUrl(dataUrl) {
        const image = dataUrl ? await loadImage(dataUrl) : null;
        return image ? drawMediaToDataUrl(image) : null;
    }

    async function captureMediaScreenshot(media) {
        if (!media || !(media instanceof Element)) return null;

        if (globalThis.LectoroNetflixAdapter?.isPage?.()) {
            const netflixImg =
                await globalThis.LectoroNetflixAdapter.captureReviewImage(media);
            if (netflixImg) return netflixImg;
        }

        if (media instanceof HTMLVideoElement) {
            if (media.readyState >= 2) {
                const frame = drawMediaToDataUrl(media);
                if (frame) return frame;
            }
            if (media.poster) {
                const drawn = await drawFromDataUrl(await requestImageDataUrl(media.poster));
                if (drawn) return drawn;
            }
            return captureVisibleTabCrop(media.getBoundingClientRect());
        }

        const directCapture = drawMediaToDataUrl(media);
        if (directCapture) return directCapture;

        const src = extractImageSourceUrl(media);
        if (src) {
            let drawn = null;
            if (src.startsWith("data:image/")) {
                drawn = await drawFromDataUrl(src);
            } else if (src.startsWith("blob:")) {
                drawn = await drawFromDataUrl(await fetchBlobAsDataUrl(src));
            } else if (/^https?:/i.test(src)) {
                drawn = await drawFromDataUrl(await requestImageDataUrl(src));
            }
            if (drawn) return drawn;
        }

        return captureVisibleTabCrop(media.getBoundingClientRect());
    }

    function captureVideoScreenshot(videoOverride = null) {
        if (!videoOverride || videoOverride.readyState < 2) return null;
        const screenshot = drawMediaToDataUrl(videoOverride);
        if (!screenshot) {
            console.warn("[Lectoro] Video screenshot capture failed.");
        }
        return screenshot;
    }

    async function captureContextScreenshot() {
        if (globalThis.LectoroNetflixAdapter?.isPage?.()) {
            const video = document.querySelector("video");
            const netflixImage =
                await globalThis.LectoroNetflixAdapter.captureReviewImage(video);
            if (netflixImage) return netflixImage;
        }
        const candidates = getVisibleMediaCandidates().slice(0, 3);
        for (const media of candidates) {
            try {
                const screenshot = await captureMediaScreenshot(media);
                if (screenshot) return screenshot;
            } catch (_) { }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Shared Tooltip HTML Builder & Handlers
    // ═══════════════════════════════════════════════════════════════

    function speakButtonHtml(text, lang, title, extraAttrs = "") {
        return `<button class="${PREFIX}speak" data-text="${escapeAttr(text)}" data-lang="${escapeAttr(lang)}" ${extraAttrs} title="${title}">${SVG.SPEAKER}</button>`;
    }

    function buildTooltipHtml({
        srcLang,
        targetLang,
        original,
        translated,
    }) {
        const P = PREFIX;
        const dataAttrs = `data-src="${escapeAttr(original)}" data-translated="${escapeAttr(translated)}" data-src-lang="${escapeAttr(srcLang)}" data-tgt-lang="${escapeAttr(targetLang)}"`;

        return `
            <div class="${P}header">
                <span>${langTag(srcLang)} → ${langTag(targetLang)}</span>
            </div>
            <div class="${P}body">
                <div class="${P}row">
                    <span class="${P}label">${langTag(srcLang)}</span>
                    <span class="${P}text ${P}original">${escapeHtml(original)}</span>
                    <span class="${P}word-actions">
                        ${speakButtonHtml(original, srcLang, "Play original")}
                        <button class="${P}img-search" data-word="${escapeAttr(original)}" title="Google Images">${SVG.IMAGE_SEARCH}</button>
                    </span>
                </div>
                <div class="${P}row">
                    <span class="${P}label">${langTag(targetLang)}</span>
                    <span class="${P}text ${P}translated">${escapeHtml(translated)}</span>
                    <span class="${P}word-actions">
                        ${speakButtonHtml(translated, targetLang, "Play translation")}
                    </span>
                </div>
            </div>
            <div class="${P}ai-result" id="${C.UI_IDS.AI_RESULT}" style="display:none;"></div>
            <div class="${P}save-footer">
                <button class="${P}save-word-btn ${P}save-footer-btn" ${dataAttrs} title="Save word">
                    ${SVG.SAVE} <span>Save</span>
                </button>
                <button class="${P}save-ai-btn ${P}save-footer-btn" ${dataAttrs} title="Generate AI sentence (Gemini)">
                    ${SVG.SAVE_AI} <span>AI Sentence</span>
                </button>
            </div>`;
    }

    function stopTooltipSpeech(cancelSpeech = true) {
        tooltipSpeechToken += 1;
        clearTimeout(tooltipSpeechTimer);
        tooltipSpeechTimer = null;

        if (activeTooltipSpeechButton) {
            activeTooltipSpeechButton.classList.remove("speaking");
            activeTooltipSpeechButton = null;
        }
        tooltipEl
            ?.querySelectorAll(`.${PREFIX}speak.speaking`)
            .forEach((btn) => btn.classList.remove("speaking"));

        if (cancelSpeech) SharedTtsService.cancel();
    }

    /** Attach one-shot end/error listeners to an <audio> element or SpeechSynthesisUtterance. */
    function onPlaybackDone(result, onDone) {
        if (result instanceof HTMLAudioElement) {
            result.addEventListener("ended", onDone, { once: true });
            result.addEventListener("error", onDone, { once: true });
        } else if (typeof result.addEventListener === "function") {
            result.addEventListener("end", onDone, { once: true });
            result.addEventListener("error", onDone, { once: true });
        } else {
            result.onend = onDone;
            result.onerror = onDone;
        }
    }

    function handleTooltipSpeakClick(btn) {
        if (activeTooltipSpeechButton === btn && btn.classList.contains("speaking")) {
            stopTooltipSpeech();
            return;
        }

        stopTooltipSpeech();
        const token = tooltipSpeechToken;
        activeTooltipSpeechButton = btn;
        btn.classList.add("speaking");

        const onDone = () => {
            if (token !== tooltipSpeechToken) return;
            stopTooltipSpeech(false);
        };

        SharedTtsService.speakBrowser(btn.dataset.text, btn.dataset.lang, {
            sourceLang: btn.dataset.sourceLang,
            originalText: btn.dataset.originalText,
            isCancelled: () => token !== tooltipSpeechToken,
        })
            .then((result) => {
                if (token !== tooltipSpeechToken) return;
                if (!result) {
                    onDone();
                    return;
                }
                onPlaybackDone(result, onDone);
                tooltipSpeechTimer = setTimeout(onDone, SharedTtsService.getSafetyTimeout(btn.dataset.text));
            })
            .catch(onDone);
    }

    async function buildSaveEntry(btn, screenshotPromise = null) {
        const screenshot = screenshotPromise
            ? await screenshotPromise
            : await captureContextScreenshot();
        return {
            original: cleanCardText(btn.dataset.src),
            translated: cleanCardText(btn.dataset.translated),
            srcLang: btn.dataset.srcLang,
            tgtLang: btn.dataset.tgtLang,
            sentence: "",
            sentenceTranslated: "",
            aiSentence: "",
            aiSentenceTranslated: "",
            screenshot: screenshot || "",
            timestamp: Date.now(),
            downloaded: false,
        };
    }

    async function handleSaveWordClick(saveWordBtn) {
        try {
            const entry = await buildSaveEntry(saveWordBtn);
            await QT.saveWord(entry);
            saveWordBtn.innerHTML = `${SVG.SAVE_CHECK} <span>Saved!</span>`;
            saveWordBtn.classList.add("saved");
        } catch (error) {
            saveWordBtn.innerHTML = `${SVG.SAVE} <span>Plan limit</span>`;
            saveWordBtn.title = error.message;
        }
    }

    async function handleSaveAiClick(saveAiBtn) {
        if (saveAiBtn.classList.contains("saved") || saveAiBtn.classList.contains("loading")) return;

        saveAiBtn.classList.add("loading");
        saveAiBtn.innerHTML = `<span class="ai-loader-label">✨ Generating…</span>`;
        const screenshotPromise = captureContextScreenshot();
        const aiResultEl = tooltipEl.querySelector(`#${C.UI_IDS.AI_RESULT}`);
        const idleLabel = `${SVG.SAVE_AI} <span>AI</span>`;

        try {
            const result = await QT.geminiGenerateSentence(
                saveAiBtn.dataset.src,
                saveAiBtn.dataset.translated,
                saveAiBtn.dataset.srcLang,
                saveAiBtn.dataset.tgtLang,
            );

            const cleanedSentence = cleanCardText(result.sentence) || result.sentence;
            const cleanedTranslation = cleanCardText(result.translation) || result.translation;

            if (aiResultEl) {
                aiResultEl.style.display = "block";
                aiResultEl.innerHTML = `
                    <div class="${PREFIX}ai-label">✨ AI sentence:</div>
                    <div class="${PREFIX}ai-text">${escapeHtml(cleanedSentence)}</div>
                    <div class="${PREFIX}ai-translation">${escapeHtml(cleanedTranslation)}</div>`;
            }

            const entry = await buildSaveEntry(saveAiBtn, screenshotPromise);
            entry.aiSentence = cleanedSentence;
            entry.aiSentenceTranslated = cleanedTranslation;
            entry.sentence = cleanedSentence;
            entry.sentenceTranslated = cleanedTranslation;
            await QT.saveWord(entry);

            saveAiBtn.innerHTML = `${SVG.SAVE_AI_CHECK} <span>Saved to Review!</span>`;
            saveAiBtn.classList.remove("loading");
            saveAiBtn.classList.add("saved");
        } catch (err) {
            console.error("[Lectoro] Gemini AI error:", err);
            saveAiBtn.classList.remove("loading");
            const limitReached = GeminiProxy.isLimitError(err);
            saveAiBtn.innerHTML = limitReached
                ? idleLabel
                : `${SVG.SAVE_AI} <span style="color:#f87171;">Error</span>`;

            if (aiResultEl) {
                aiResultEl.style.display = limitReached ? "none" : "block";
                aiResultEl.innerHTML = limitReached
                    ? ""
                    : `<div style="color:#f87171;font-size:11px;padding:6px 12px;">⚠ ${escapeHtml(err.message)}</div>`;
            }

            if (!limitReached) {
                setTimeout(() => {
                    saveAiBtn.innerHTML = idleLabel;
                }, 3000);
            }
        }
    }

    function attachTooltipHandlers() {
        if (!tooltipEl) return;

        tooltipEl.querySelectorAll(`.${PREFIX}speak`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                handleTooltipSpeakClick(btn);
            });
        });

        tooltipEl.querySelectorAll(`.${PREFIX}img-search`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const word = (btn.dataset.word || "").trim();
                if (!word) return;
                const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`${word} clipart`)}`;
                window.open(url, "_blank", "noopener,noreferrer");
            });
        });

        const saveWordBtn = tooltipEl.querySelector(`.${PREFIX}save-word-btn`);
        saveWordBtn?.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleSaveWordClick(saveWordBtn);
        });

        const saveAiBtn = tooltipEl.querySelector(`.${PREFIX}save-ai-btn`);
        saveAiBtn?.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleSaveAiClick(saveAiBtn);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle Helpers
    // ═══════════════════════════════════════════════════════════════

    function appendWordSpans(parent, text, wordClass, fontStyle) {
        const parts = text.match(/\S+|\s+/g) || [];
        for (const part of parts) {
            if (/\S/.test(part)) {
                const span = document.createElement("span");
                span.className = wordClass;
                span.textContent = part;
                if (fontStyle) span.style.fontStyle = fontStyle;
                parent.appendChild(span);
            } else {
                parent.appendChild(document.createTextNode(part));
            }
        }
    }

    function splitIntoWordSpans(el, wordClass) {
        if (!el || isOwnUI(el)) return;
        const text = el.textContent;
        if (!text || !text.trim()) return;

        const hasItalicChild = !!el.querySelector("i, em");
        const computedStyle = window.getComputedStyle(el).fontStyle;
        const originalFontStyle = hasItalicChild || computedStyle === "italic" ? "italic" : "";

        // Preserve <br> line breaks and child elements
        const childNodes = Array.from(el.childNodes);
        if (childNodes.some((n) => n.nodeName === "BR" || n.nodeType === Node.ELEMENT_NODE)) {
            el.innerHTML = "";
            for (const child of childNodes) {
                if (child.nodeName === "BR") {
                    el.appendChild(document.createElement("br"));
                } else if (child.nodeType === Node.TEXT_NODE) {
                    appendWordSpans(el, child.nodeValue, wordClass, originalFontStyle);
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    splitIntoWordSpans(child, wordClass);
                    el.appendChild(child);
                }
            }
        } else {
            el.textContent = "";
            appendWordSpans(el, text, wordClass, originalFontStyle);
        }
        if (originalFontStyle) el.style.fontStyle = originalFontStyle;
    }

    function createHint(className, getParent) {
        let el = null;
        let timer = null;
        const parentFn = getParent || getOverlayParent;

        return {
            show(msg, duration = 4000) {
                if (!el) {
                    el = document.createElement("div");
                    el.className = className || C.UI_CLASSES.SUB_HINT;
                    parentFn().appendChild(el);
                }
                const parent = parentFn();
                if (el.parentElement !== parent) parent.appendChild(el);

                el.textContent = msg;
                el.classList.add("visible");
                clearTimeout(timer);
                timer = setTimeout(() => el.classList.remove("visible"), duration);
            },
        };
    }

    const SUBTITLE_CONTAINER_SELECTOR =
        ".player-timedtext, .player-timedtext-text-container, .ytp-caption-window-container, .vjs-text-track-display, [data-uia='video-canvas']";

    function findWordAtPoint(x, y, wordClass) {
        if (!x && !y) return null;
        const els = document.elementsFromPoint(x, y);
        for (const el of els) {
            if (el.classList?.contains(wordClass)) return el;
            const closest = el.closest?.(`.${wordClass}`);
            if (closest) return closest;
        }

        // Instant Tokenization Fallback:
        // If cursor is over any subtitle cue that hasn't been tokenized yet, tokenize immediately!
        for (const el of els) {
            if (isOwnUI(el)) continue;
            const subContainer = el.closest?.(SUBTITLE_CONTAINER_SELECTOR);
            if (subContainer) {
                const target = el.tagName === "SPAN" || el.tagName === "DIV" ? el : el.querySelector?.("span, div");
                if (target && target.textContent?.trim() && !target.querySelector(`.${wordClass}`)) {
                    splitIntoWordSpans(target, wordClass);
                    const newlyFound = Array.from(document.elementsFromPoint(x, y)).find(
                        (n) => n.classList?.contains(wordClass)
                    );
                    if (newlyFound) return newlyFound;
                }
            }
        }

        return null;
    }

    // Player registry is injected after core.js; resolve it lazily at call time.
    function getVideo() {
        return globalThis.LectoroPlayerRegistry?.getVideo?.() ?? document.querySelector("video");
    }

    function pauseVideo(video = null) {
        if (globalThis.LectoroPlayerRegistry?.pauseVideo) {
            return globalThis.LectoroPlayerRegistry.pauseVideo(video);
        }
        const v = video || getVideo();
        if (v && !v.paused) {
            v.pause();
            return true;
        }
        return false;
    }

    function resumeVideo(video = null) {
        if (globalThis.LectoroPlayerRegistry?.playVideo) {
            globalThis.LectoroPlayerRegistry.playVideo(video);
            return;
        }
        const v = video || getVideo();
        if (v && v.paused) v.play();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Expose Global Namespace (Backward Compatible)
    // ═══════════════════════════════════════════════════════════════

    const QT = {
        PREFIX,
        ICON_ID,
        TOOLTIP_ID,
        SVG,

        escapeHtml,
        escapeAttr,
        cleanCardText,
        cleanTextForTTS,
        langTag,
        isOwnUI,

        getOverlayParent,
        showTooltip,
        positionTooltip,
        hideTooltip,
        hideAll,
        showLoading,
        getTooltipEl: () => tooltipEl,
        getMousePos: () => ({ x: lastMouseX, y: lastMouseY }),

        // Translation – delegates to SharedTranslatorService
        translate: (text, lang) => SharedTranslatorService.translate(text, lang),
        createTranslateCache: (size) => SharedTranslatorService.createTranslateCache(size),

        // TTS – delegates to SharedTtsService / SharedUtils
        speak: (text, lang, opts) => SharedTtsService.speakBrowser(text, lang, opts),
        pickBestVoice,
        ensureVoices: () => ensureVoices(),
        formatSpeechMarkup: (text, baseLang, opts) => SharedTtsService.formatSpeechMarkup(text, baseLang, opts),

        // Storage – delegates to SharedWordRepository and SharedTranslatorService
        getTargetLang: () => SharedTranslatorService.getTargetLang(),
        saveWord: (entry) => SharedWordRepository.saveWord(entry),

        // AI & Screenshots – delegates to SharedTranslatorService
        geminiGenerateSentence: (w, t, s, tgt) => SharedTranslatorService.generateSentence(w, t, s, tgt),
        geminiExplainSentence: (s, tgt, ctx = null) => SharedTranslatorService.explainSentence(s, tgt, ctx),
        geminiMovieTranslate: (t, tgt, ctx = null) => SharedTranslatorService.movieTranslate(t, tgt, ctx),
        captureVideoScreenshot,
        captureContextScreenshot,
        rememberScreenshotContext,

        buildTooltipHtml,
        attachTooltipHandlers,

        splitIntoWordSpans,
        createHint,
        findWordAtPoint,

        addCleanup,
        addDismissHandler,
        runDismiss,

        getVideo,
        pauseVideo,
        resumeVideo,
    };

    window.QT = QT;
})();
