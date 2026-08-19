/**
 * Quick Translator – Core Module
 * Shared UI tooltips, context screenshot capture, and subtitle helpers.
 * Delegates translation, TTS, word repository, and constants to SSOT shared services.
 *
 * Exposes: window.QT
 */
(() => {
    "use strict";

    const C = typeof LectoroConstants !== "undefined"
        ? LectoroConstants
        : {
              PREFIX: "__qt_",
              UI_IDS: { ICON: "__qt_icon", TOOLTIP: "__qt_tooltip", REVIEW_TOAST: "__qt_review_toast" },
              SVG_ICONS: {},
              langTag: (c) => c?.toUpperCase() || "?",
              isOwnUI: () => false,
          };

    const {
        escapeHtml,
        escapeAttr,
        cleanTextForTTS,
        cleanCardText,
        pickBestVoice,
        ensureVoices,
    } =
        typeof SharedUtils !== "undefined"
            ? SharedUtils
            : {
                  escapeHtml: (s) => String(s || ""),
                  escapeAttr: (s) => String(s || ""),
                  cleanTextForTTS: (s) => String(s || "").replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").replace(/[.,\s]+$/, "").trim(),
                  cleanCardText: (s) => String(s || "").replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").replace(/[.,\s]+$/, "").trim(),
                  pickBestVoice: () => null,
                  ensureVoices: () => Promise.resolve([]),
              };

    const PREFIX = C.PREFIX || "__qt_";
    const ICON_ID = C.UI_IDS?.ICON || `${PREFIX}icon`;
    const TOOLTIP_ID = C.UI_IDS?.TOOLTIP || `${PREFIX}tooltip`;
    const SVG = C.SVG_ICONS || {};
    const langTag = C.langTag || ((c) => c?.toUpperCase() || "?");
    const isOwnUI = C.isOwnUI || ((target) => !!target?.closest?.(`#${ICON_ID}, #${TOOLTIP_ID}`));

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
    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
            if (
                window === window.top &&
                msg.type === (C.MESSAGE_TYPES?.REVIEW_DUE || "QT_REVIEW_DUE") &&
                msg.count > 0
            ) {
                showReviewDueToast(msg.count);
            }
        });
    }

    function showReviewDueToast(count) {
        const toastId = C.UI_IDS?.REVIEW_TOAST || `${PREFIX}review_toast`;
        const existing = document.getElementById(toastId);
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.id = toastId;
        toast.innerHTML = `<span style="margin-right:6px">🧠</span> ${count === 1 ? "Pojawiła się powtórka!" : `Pojawiły się ${count} powtórki!`}`;
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add(`${PREFIX}toast_visible`);
            });
        });

        setTimeout(() => {
            toast.classList.remove(`${PREFIX}toast_visible`);
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    document.addEventListener("mousemove", (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    /** Strip [bracketed] content (e.g. [Applause], [Music]) */
    function stripBrackets(text) {
        return String(text || "")
            .replace(/\[.*?\]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

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

    function getTooltip() {
        if (tooltipEl) {
            const parent = getOverlayParent();
            if (tooltipEl.parentElement !== parent) {
                parent.appendChild(tooltipEl);
            }
            return tooltipEl;
        }
        tooltipEl = document.createElement("div");
        tooltipEl.id = TOOLTIP_ID;
        getOverlayParent().appendChild(tooltipEl);
        return tooltipEl;
    }

    function positionTooltip(rect, preferredPosition = "top") {
        if (!tooltipEl || !rect) return;

        const tip = tooltipEl;
        const parent = getOverlayParent();
        if (tip.parentElement !== parent) parent.appendChild(tip);

        const inFullscreen = !!(
            document.fullscreenElement || document.webkitFullscreenElement
        );
        const gap = 10;

        if (inFullscreen) {
            tip.style.position = "fixed";
            tip.style.left = "0px";
            tip.style.top = "0px";

            const tipRect = tip.getBoundingClientRect();
            let left = rect.left + (rect.width - tipRect.width) / 2;
            let top = rect.top - tipRect.height - gap;

            top = Math.max(4, Math.min(top, window.innerHeight - tipRect.height - 4));
            left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));

            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        } else {
            tip.style.position = "absolute";
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;

            tip.style.left = "0px";
            tip.style.top = "0px";

            const tipRect = tip.getBoundingClientRect();
            let left = rect.left + scrollX + (rect.width - tipRect.width) / 2;
            let top = rect.top + scrollY - tipRect.height - gap;

            const maxTop = scrollY + document.documentElement.clientHeight - tipRect.height - 4;
            const maxLeft = scrollX + document.documentElement.clientWidth - tipRect.width - 4;

            top = Math.max(scrollY + 4, Math.min(top, maxTop));
            left = Math.max(scrollX + 4, Math.min(left, maxLeft));

            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        }
    }

    function showTooltip(html, rect, preferredPosition = "top") {
        rememberScreenshotContext(rect);
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
        }, 180);
    }

    function showLoading(rect, preferredPosition = "top") {
        showTooltip(
            `<div class="${PREFIX}loading"><div class="${PREFIX}spinner"></div></div>`,
            rect,
            preferredPosition,
        );
    }

    function hideAll() {
        hideTooltip();
        cleanupHandlers.forEach((fn) => {
            try { fn(); } catch (_) {}
        });
    }

    function addCleanup(fn) {
        cleanupHandlers.push(fn);
    }
    function addDismissHandler(fn) {
        dismissHandlers.push(fn);
    }
    function runDismiss() {
        dismissHandlers.forEach((fn) => {
            try { fn(); } catch (_) {}
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Context-aware Screenshot Capture
    // ═══════════════════════════════════════════════════════════════

    function rememberScreenshotContext(rect) {
        if (!rect) return;
        const left = Number(rect.left);
        const top = Number(rect.top);
        const right = Number(rect.right);
        const bottom = Number(rect.bottom);
        if (![left, top, right, bottom].every(Number.isFinite)) return;

        const x = Math.max(0, Math.min(window.innerWidth - 1, (left + right) / 2));
        const y = Math.max(0, Math.min(window.innerHeight - 1, (top + bottom) / 2));
        const anchorElement = document
            .elementsFromPoint(x, y)
            .find((element) => !isOwnUI(element));

        screenshotContext = {
            rect: { left, top, right, bottom },
            anchorElement: anchorElement || null,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        };
    }

    function getMediaContextRoot(element) {
        return element?.closest?.(
            'article, [role="article"], shreddit-post, [data-testid="post-container"]',
        );
    }

    function distanceBetweenRects(a, b) {
        const dx = Math.max(a.left - b.right, b.left - a.right, 0);
        const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
        return Math.hypot(dx, dy);
    }

    function getSharedContainerBonus(anchorElement, media) {
        let ancestor = anchorElement;
        for (let depth = 0; ancestor && depth < 14; depth += 1) {
            if (ancestor === document.body || ancestor === document.documentElement) break;
            if (ancestor.contains?.(media)) return 2_000 - depth * 120;
            ancestor = ancestor.parentElement;
        }
        return 0;
    }

    function getVisibleMediaCandidates() {
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const storedRect = screenshotContext?.rect;
        const scrollDeltaX = window.scrollX - (screenshotContext?.scrollX || 0);
        const scrollDeltaY = window.scrollY - (screenshotContext?.scrollY || 0);
        const anchorRect = storedRect
            ? {
                  left: storedRect.left - scrollDeltaX,
                  right: storedRect.right - scrollDeltaX,
                  top: storedRect.top - scrollDeltaY,
                  bottom: storedRect.bottom - scrollDeltaY,
              }
            : {
                  left: viewportWidth / 2,
                  right: viewportWidth / 2,
                  top: viewportHeight / 2,
                  bottom: viewportHeight / 2,
              };
        const anchorRoot = getMediaContextRoot(screenshotContext?.anchorElement);

        return Array.from(document.querySelectorAll("img, video, canvas"))
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
                const mediaLabel = `${media.className || ""} ${media.getAttribute?.("alt") || ""}`.toLowerCase();
                const isSmallDecorativeImage =
                    media instanceof HTMLImageElement &&
                    rect.width <= 200 &&
                    rect.height <= 200 &&
                    /avatar|profile|emoji|icon|logo|badge|reaction/.test(mediaLabel);
                if (
                    rect.width < 64 ||
                    rect.height < 64 ||
                    rect.width * rect.height < 10_000 ||
                    visibleArea < 4_000 ||
                    isSmallDecorativeImage
                ) {
                    return false;
                }
                const style = window.getComputedStyle(media);
                return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05;
            })
            .map(({ media, rect, visibleRatio }) => {
                let score = distanceBetweenRects(anchorRect, rect) + (1 - Math.min(1, visibleRatio)) * 250;
                const mediaRoot = getMediaContextRoot(media);
                if (anchorRoot && mediaRoot === anchorRoot) score -= 100_000;
                const anchorElement = screenshotContext?.anchorElement;
                score -= getSharedContainerBonus(anchorElement, media);
                if (anchorElement && media.contains(anchorElement)) score -= 200_000;
                return { media, score };
            })
            .sort((a, b) => a.score - b.score)
            .map(({ media }) => media);
    }

    function drawMediaToDataUrl(media) {
        try {
            const sourceWidth = media.videoWidth || media.naturalWidth || media.width;
            const sourceHeight = media.videoHeight || media.naturalHeight || media.height;
            if (!sourceWidth || !sourceHeight) return null;

            const MAX = 480;
            const scale = Math.min(MAX / sourceWidth, MAX / sourceHeight, 1);
            const width = Math.max(1, Math.round(sourceWidth * scale));
            const height = Math.max(1, Math.round(sourceHeight * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.fillStyle = "#12131c";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(media, 0, 0, width, height);

            const webpUrl = canvas.toDataURL("image/webp", 0.75);
            if (webpUrl && webpUrl.startsWith("data:image/webp")) {
                return webpUrl;
            }
            return canvas.toDataURL("image/jpeg", 0.80);
        } catch (_) {
            return null;
        }
    }

    function requestImageDataUrl(url) {
        if (!url || !chrome?.runtime?.sendMessage) return Promise.resolve(null);
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { type: C.MESSAGE_TYPES?.FETCH_CONTEXT_IMAGE || "QT_FETCH_CONTEXT_IMAGE", url },
                (response) => {
                    if (chrome.runtime.lastError || !response?.dataUrl) {
                        resolve(null);
                        return;
                    }
                    resolve(response.dataUrl);
                },
            );
        });
    }

    function loadImage(src) {
        return new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = src;
        });
    }

    async function captureMediaScreenshot(media) {
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
                const posterData = await requestImageDataUrl(media.poster);
                const posterImage = posterData ? await loadImage(posterData) : null;
                return posterImage ? drawMediaToDataUrl(posterImage) : null;
            }
            return null;
        }

        const directCapture = drawMediaToDataUrl(media);
        if (directCapture) return directCapture;
        if (!(media instanceof HTMLImageElement)) return null;

        const src = media.currentSrc || media.src;
        if (!/^https?:/i.test(src)) return null;
        const imageData = await requestImageDataUrl(src);
        const fetchedImage = imageData ? await loadImage(imageData) : null;
        return fetchedImage ? drawMediaToDataUrl(fetchedImage) : null;
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
            } catch (_) {}
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Shared Tooltip HTML Builder & Handlers
    // ═══════════════════════════════════════════════════════════════

    function buildTooltipHtml({
        srcLang,
        targetLang,
        original,
        translated,
        fullLine = null,
        fullTranslated = null,
        speakFullLine = false,
    }) {
        const P = PREFIX;
        const cleanFullLine = fullLine ? stripBrackets(fullLine) : "";
        const cleanFullTranslated = fullTranslated ? stripBrackets(fullTranslated) : "";

        let fullLineHtml = "";
        if (fullLine && fullTranslated && cleanFullLine) {
            const speakOrig = speakFullLine
                ? `<button class="${P}speak" data-text="${escapeAttr(cleanFullLine)}" data-lang="${escapeAttr(srcLang)}" title="Odczytaj zdanie">${SVG.SPEAKER || "🔊"}</button>`
                : "";
            const speakTrans = speakFullLine
                ? `<button class="${P}speak" data-text="${escapeAttr(cleanFullTranslated)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj tłumaczenie zdania">${SVG.SPEAKER || "🔊"}</button>`
                : "";

            fullLineHtml = `
                <div class="${P}row" style="margin-top:6px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">
                    <span class="${P}label">ALL</span>
                    <span class="${P}text ${P}original" style="font-size:12px;">${escapeHtml(cleanFullLine)}</span>
                    ${speakOrig}
                </div>
                <div class="${P}row">
                    <span class="${P}label"></span>
                    <span class="${P}text ${P}translated" style="font-size:12px;">${escapeHtml(cleanFullTranslated)}</span>
                    ${speakTrans}
                </div>`;
        }

        const dataAttrs = `data-src="${escapeAttr(original)}" data-translated="${escapeAttr(translated)}" data-src-lang="${escapeAttr(srcLang)}" data-tgt-lang="${escapeAttr(targetLang)}" data-sentence="${escapeAttr(cleanFullLine)}" data-sentence-translated="${escapeAttr(cleanFullTranslated)}"`;

        return `
            <div class="${P}header">
                <span>${langTag(srcLang)} → ${langTag(targetLang)}</span>
            </div>
            <div class="${P}body">
                <div class="${P}row">
                    <span class="${P}label">${langTag(srcLang)}</span>
                    <span class="${P}text ${P}original">${escapeHtml(original)}</span>
                    <span class="${P}word-actions">
                        <button class="${P}speak" data-text="${escapeAttr(original)}" data-lang="${escapeAttr(srcLang)}" title="Odczytaj oryginał">${SVG.SPEAKER || "🔊"}</button>
                        <button class="${P}img-search" data-word="${escapeAttr(original)}" title="Szukaj obrazu w Google (nowa karta)">${SVG.IMAGE_SEARCH || "🔍"}</button>
                    </span>
                </div>
                <div class="${P}row">
                    <span class="${P}label">${langTag(targetLang)}</span>
                    <span class="${P}text ${P}translated">${escapeHtml(translated)}</span>
                    <span class="${P}word-actions">
                        <button class="${P}speak" data-text="${escapeAttr(translated)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj tłumaczenie">${SVG.SPEAKER || "🔊"}</button>
                        <button class="${P}img-search" data-word="${escapeAttr(translated)}" title="Szukaj obrazu w Google (nowa karta)">${SVG.IMAGE_SEARCH || "🔍"}</button>
                    </span>
                </div>
                ${fullLineHtml}
            </div>
            <div class="${P}ai-result" id="${P}ai-result" style="display:none;"></div>
            <div class="${P}save-footer">
                <button class="${P}save-word-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz samo słowo">
                    ${SVG.SAVE || "💾"} <span>Słowo</span>
                </button>
                <button class="${P}save-sentence-footer-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz z aktualnym zdaniem" ${!cleanFullLine ? 'disabled style="opacity:0.35;cursor:default;"' : ""}>
                    ${SVG.SAVE_SENTENCE || "📄"} <span>Zdanie</span>
                </button>
                <button class="${P}save-ai-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz z mądrym zdaniem AI (Gemini)">
                    ${SVG.SAVE_AI || "✨"} <span>AI</span>
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

        if (cancelSpeech) {
            if (typeof SharedTtsService !== "undefined") {
                SharedTtsService.cancel();
            } else {
                window.speechSynthesis?.cancel();
            }
        }
    }

    function attachTooltipHandlers() {
        if (!tooltipEl) return;

        // TTS buttons
        tooltipEl.querySelectorAll(`.${PREFIX}speak`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
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

                const speakFn = typeof SharedTtsService !== "undefined"
                    ? SharedTtsService.speakBrowser
                    : (text, lang, opts) => QT.speak(text, lang, opts);

                speakFn(btn.dataset.text, btn.dataset.lang, {
                    isCancelled: () => token !== tooltipSpeechToken,
                })
                    .then((result) => {
                        if (token !== tooltipSpeechToken) return;
                        if (!result) {
                            onDone();
                            return;
                        }
                        if (result instanceof HTMLAudioElement) {
                            result.addEventListener("ended", onDone, { once: true });
                            result.addEventListener("error", onDone, { once: true });
                        } else {
                            result.addEventListener?.("end", onDone, { once: true });
                            result.addEventListener?.("error", onDone, { once: true });
                            if (!result.addEventListener) {
                                result.onend = onDone;
                                result.onerror = onDone;
                            }
                        }
                        const timeout = typeof SharedTtsService !== "undefined"
                            ? SharedTtsService.getSafetyTimeout(btn.dataset.text)
                            : 12000;
                        tooltipSpeechTimer = setTimeout(onDone, timeout);
                    })
                    .catch(onDone);
            });
        });

        // Google Images Search buttons
        tooltipEl.querySelectorAll(`.${PREFIX}img-search`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const word = ("meaning " + (btn.dataset.word || "")).trim();
                if (!word) return;
                const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(word)}`;
                window.open(url, "_blank", "noopener,noreferrer");
            });
        });

        async function buildSaveEntry(btn, screenshotPromise = null) {
            const clean =
                typeof cleanCardText === "function"
                    ? cleanCardText
                    : (typeof SharedUtils !== "undefined" && typeof SharedUtils.cleanCardText === "function"
                        ? SharedUtils.cleanCardText
                        : (s) => String(s || "").replace(/^[,\s:;>«»<\\/|~*#—–-]+/, "").replace(/[.,\s]+$/, "").trim());
            const screenshot = screenshotPromise
                ? await screenshotPromise
                : await captureContextScreenshot();
            return {
                original: clean(btn.dataset.src),
                translated: clean(btn.dataset.translated),
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

        // Save Word Only
        const saveWordBtn = tooltipEl.querySelector(`.${PREFIX}save-word-btn`);
        if (saveWordBtn) {
            saveWordBtn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                try {
                    const entry = await buildSaveEntry(saveWordBtn);
                    await QT.saveWord(entry);
                    saveWordBtn.innerHTML = `${SVG.SAVE_CHECK || "✓"} <span>Zapisano!</span>`;
                    saveWordBtn.classList.add("saved");
                } catch (error) {
                    saveWordBtn.innerHTML = `${SVG.SAVE || "💾"} <span>Limit planu</span>`;
                    saveWordBtn.title = error.message;
                }
            });
        }

        // Save Sentence
        const saveSentenceBtn = tooltipEl.querySelector(`.${PREFIX}save-sentence-footer-btn`);
        if (saveSentenceBtn && !saveSentenceBtn.disabled) {
            saveSentenceBtn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const clean = typeof cleanCardText === "function" ? cleanCardText : (s) => String(s || "").trim();
                try {
                    const entry = await buildSaveEntry(saveSentenceBtn);
                    entry.sentence = clean(saveSentenceBtn.dataset.sentence || "");
                    entry.sentenceTranslated = clean(saveSentenceBtn.dataset.sentenceTranslated || "");
                    await QT.saveWord(entry);
                    saveSentenceBtn.innerHTML = `${SVG.SAVE_SENTENCE_CHECK || "✓"} <span>Zapisano!</span>`;
                    saveSentenceBtn.classList.add("saved");
                } catch (error) {
                    saveSentenceBtn.innerHTML = `${SVG.SAVE_SENTENCE || "📄"} <span>Limit planu</span>`;
                    saveSentenceBtn.title = error.message;
                }
            });
        }

        // Save AI Sentence
        const saveAiBtn = tooltipEl.querySelector(`.${PREFIX}save-ai-btn`);
        if (saveAiBtn) {
            saveAiBtn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                if (saveAiBtn.classList.contains("saved") || saveAiBtn.classList.contains("loading")) return;

                saveAiBtn.classList.add("loading");
                saveAiBtn.innerHTML = `<span class="${PREFIX}spinner-small"></span> <span>Generuję…</span>`;
                const screenshotPromise = captureContextScreenshot();
                const aiResultEl = tooltipEl.querySelector(`#${PREFIX}ai-result`);
                const clean = typeof cleanCardText === "function" ? cleanCardText : (s) => String(s || "").trim();

                try {
                    const result = await QT.geminiGenerateSentence(
                        saveAiBtn.dataset.src,
                        saveAiBtn.dataset.translated,
                        saveAiBtn.dataset.srcLang,
                        saveAiBtn.dataset.tgtLang,
                    );

                    const cleanedSentence = clean(result.sentence) || result.sentence;
                    const cleanedTranslation = clean(result.translation) || result.translation;

                    if (aiResultEl) {
                        aiResultEl.style.display = "block";
                        aiResultEl.innerHTML = `
                            <div class="${PREFIX}ai-label">✨ AI zdanie:</div>
                            <div class="${PREFIX}ai-text">${escapeHtml(cleanedSentence)}</div>
                            <div class="${PREFIX}ai-translation">${escapeHtml(cleanedTranslation)}</div>`;
                    }

                    const entry = await buildSaveEntry(saveAiBtn, screenshotPromise);
                    entry.aiSentence = cleanedSentence;
                    entry.aiSentenceTranslated = cleanedTranslation;
                    entry.sentence = cleanedSentence;
                    entry.sentenceTranslated = cleanedTranslation;
                    await QT.saveWord(entry);

                    saveAiBtn.innerHTML = `${SVG.SAVE_AI_CHECK || "✓"} <span>Zapisano!</span>`;
                    saveAiBtn.classList.remove("loading");
                    saveAiBtn.classList.add("saved");
                } catch (err) {
                    console.error("[Lectoro] Gemini AI error:", err);
                    saveAiBtn.classList.remove("loading");
                    const limitReached =
                        typeof GeminiProxy !== "undefined" && GeminiProxy.isLimitError?.(err);
                    saveAiBtn.innerHTML = limitReached
                        ? `${SVG.SAVE_AI || "✨"} <span>AI</span>`
                        : `${SVG.SAVE_AI || "✨"} <span style="color:#f87171;">Błąd</span>`;

                    if (aiResultEl) {
                        aiResultEl.style.display = limitReached ? "none" : "block";
                        aiResultEl.innerHTML = limitReached
                            ? ""
                            : `<div style="color:#f87171;font-size:11px;padding:6px 12px;">⚠ ${escapeHtml(err.message)}</div>`;
                    }

                    if (!limitReached) {
                        setTimeout(() => {
                            saveAiBtn.innerHTML = `${SVG.SAVE_AI || "✨"} <span>AI</span>`;
                        }, 3000);
                    }
                }
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle Helpers
    // ═══════════════════════════════════════════════════════════════

    function createSubtitleBuffer(maxSize = 3000, keepSize = 2000) {
        let buffer = "";
        let lastSegment = "";

        return {
            append(text) {
                const trimmed = (text || "").trim();
                if (!trimmed || trimmed === lastSegment) return;
                if (buffer.endsWith(trimmed)) return;

                let overlap = 0;
                const maxOvl = Math.min(trimmed.length, buffer.length);
                for (let i = 1; i <= maxOvl; i++) {
                    if (buffer.endsWith(trimmed.substring(0, i))) overlap = i;
                }

                const newPart = trimmed.substring(overlap);
                if (newPart) {
                    buffer += (buffer && !buffer.endsWith(" ") ? " " : "") + newPart;
                }
                lastSegment = trimmed;

                if (buffer.length > maxSize) {
                    buffer = buffer.substring(buffer.length - keepSize);
                }
            },
            extractSentence(word) {
                const idx = buffer.lastIndexOf(word);
                if (idx === -1) return null;

                const enders = /[.!?…]/;
                let start = 0;
                for (let i = idx - 1; i >= 0; i--) {
                    if (enders.test(buffer[i])) {
                        start = i + 1;
                        break;
                    }
                }
                let end = buffer.length;
                for (let i = idx + word.length; i < buffer.length; i++) {
                    if (enders.test(buffer[i])) {
                        end = i + 1;
                        break;
                    }
                }

                const sentence = buffer.substring(start, end).trim();
                return sentence.length > word.length + 2 ? sentence : null;
            },
            clear() {
                buffer = "";
                lastSegment = "";
            },
            get text() {
                return buffer;
            },
        };
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
                    const parts = child.nodeValue.match(/\S+|\s+/g) || [];
                    for (const part of parts) {
                        if (/\S/.test(part)) {
                            const span = document.createElement("span");
                            span.className = wordClass;
                            span.textContent = part;
                            if (originalFontStyle) span.style.fontStyle = originalFontStyle;
                            el.appendChild(span);
                        } else {
                            el.appendChild(document.createTextNode(part));
                        }
                    }
                } else if (child.nodeType === Node.ELEMENT_NODE) {
                    splitIntoWordSpans(child, wordClass);
                    el.appendChild(child);
                }
            }
            if (originalFontStyle) el.style.fontStyle = originalFontStyle;
            return;
        }

        el.textContent = "";
        const parts = text.match(/\S+|\s+/g) || [];
        for (const part of parts) {
            if (/\S/.test(part)) {
                const span = document.createElement("span");
                span.className = wordClass;
                span.textContent = part;
                if (originalFontStyle) span.style.fontStyle = originalFontStyle;
                el.appendChild(span);
            } else {
                el.appendChild(document.createTextNode(part));
            }
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
                    el.className = className;
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
            const subContainer = el.closest?.(
                ".player-timedtext, .player-timedtext-text-container, .ytp-caption-window-container, .vjs-text-track-display, [data-uia='video-canvas']"
            );
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

    function getVideo() {
        return document.querySelector("video");
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

    window.QT = {
        PREFIX,
        ICON_ID,
        TOOLTIP_ID,
        SVG,

        escapeHtml,
        escapeAttr,
        stripBrackets,
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
        translate: (text, lang) =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.translate(text, lang)
                : Promise.reject(new Error("Translator unavailable")),
        createTranslateCache: (size) =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.createTranslateCache(size)
                : new Map(),

        // TTS – delegates to SharedTtsService
        speak: (text, lang, opts) =>
            typeof SharedTtsService !== "undefined"
                ? SharedTtsService.speakBrowser(text, lang, opts)
                : window.speechSynthesis?.speak(new SpeechSynthesisUtterance(text)),
        pickBestVoice,
        ensureVoices: () =>
            typeof SharedTtsService !== "undefined" && SharedTtsService.ensureVoices
                ? SharedTtsService.ensureVoices()
                : (typeof SharedUtils !== "undefined" && SharedUtils.ensureVoices
                      ? SharedUtils.ensureVoices()
                      : Promise.resolve([])),

        // Storage – delegates to SharedWordRepository and SharedTranslatorService
        getTargetLang: () =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.getTargetLang()
                : Promise.resolve("pl"),
        saveWord: (entry) =>
            typeof SharedWordRepository !== "undefined"
                ? SharedWordRepository.saveWord(entry)
                : Promise.reject(new Error("WordRepository unavailable")),

        // AI & Screenshots – delegates to SharedTranslatorService
        geminiGenerateSentence: (w, t, s, tgt) =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.generateSentence(w, t, s, tgt)
                : Promise.reject(new Error("TranslatorService unavailable")),
        geminiExplainSentence: (s, tgt) =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.explainSentence(s, tgt)
                : Promise.reject(new Error("TranslatorService unavailable")),
        geminiMovieTranslate: (t, tgt) =>
            typeof SharedTranslatorService !== "undefined"
                ? SharedTranslatorService.movieTranslate(t, tgt)
                : Promise.reject(new Error("TranslatorService unavailable")),
        captureVideoScreenshot,
        captureContextScreenshot,

        buildTooltipHtml,
        attachTooltipHandlers,

        createSubtitleBuffer,
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
})();
