(() => {
    "use strict";

    const HOST_RE = /(^|\.)netflix\.com$/i;
    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const HIDDEN_CLASS = "__qt_netflix-subtitles-hidden";
    const CAPTURING_CLASS = "__qt_netflix-capturing";

    function isPage() {
        return HOST_RE.test(window.location.hostname);
    }

    function requestSeek(targetSeconds) {
        if (!Number.isFinite(targetSeconds)) return;
        window.dispatchEvent(
            new CustomEvent(SEEK_EVENT, {
                detail: { targetMs: Math.max(0, targetSeconds) * 1000 },
            }),
        );
    }

    function setOriginalSubtitlesHidden(hidden) {
        document.documentElement.classList.toggle(HIDDEN_CLASS, !!hidden);
    }

    function createWordCloudSourceLayer({
        source,
        parent,
        prefix,
        splitIntoWordSpans,
    }) {
        const rect = source.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        const cs = window.getComputedStyle(source);
        const layer = document.createElement("div");
        layer.className = prefix + "word-cloud-source-layer";
        layer.textContent = source.textContent;
        Object.assign(layer.style, {
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            minHeight: rect.height + "px",
            color: cs.color,
            backgroundColor: cs.backgroundColor,
            fontFamily: cs.fontFamily,
            fontSize: cs.fontSize,
            fontStyle: cs.fontStyle,
            fontWeight: cs.fontWeight,
            letterSpacing: cs.letterSpacing,
            lineHeight: cs.lineHeight,
            paddingTop: cs.paddingTop,
            paddingRight: cs.paddingRight,
            paddingBottom: cs.paddingBottom,
            paddingLeft: cs.paddingLeft,
            textAlign: cs.textAlign,
            textShadow: cs.textShadow,
            wordSpacing: cs.wordSpacing,
            whiteSpace: cs.whiteSpace,
        });
        parent.appendChild(layer);
        splitIntoWordSpans(layer, prefix + "wc-word");
        return layer;
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(response || null);
            });
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

    function isMostlyBlack(canvas) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return true;
        const sampleX = Math.floor(canvas.width * 0.1);
        const sampleY = Math.floor(canvas.height * 0.08);
        const sampleWidth = Math.max(1, Math.floor(canvas.width * 0.8));
        const sampleHeight = Math.max(1, Math.floor(canvas.height * 0.7));
        const data = ctx.getImageData(
            sampleX,
            sampleY,
            sampleWidth,
            sampleHeight,
        ).data;
        const pixelCount = sampleWidth * sampleHeight;
        const stride = Math.max(1, Math.floor(pixelCount / 5000));
        let sampled = 0;
        let nearlyBlack = 0;
        for (let pixel = 0; pixel < pixelCount; pixel += stride) {
            const offset = pixel * 4;
            const brightness =
                data[offset] * 0.2126 +
                data[offset + 1] * 0.7152 +
                data[offset + 2] * 0.0722;
            sampled += 1;
            if (brightness < 10) nearlyBlack += 1;
        }
        return sampled === 0 || nearlyBlack / sampled > 0.985;
    }

    async function cropVisibleTabToVideo(dataUrl, video) {
        const image = await loadImage(dataUrl);
        if (!image || !video?.isConnected) return null;

        const rect = video.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(window.innerWidth, rect.right);
        const bottom = Math.min(window.innerHeight, rect.bottom);
        if (right <= left || bottom <= top) return null;

        const scaleX = image.naturalWidth / window.innerWidth;
        const scaleY = image.naturalHeight / window.innerHeight;
        const sourceWidth = (right - left) * scaleX;
        const sourceHeight = (bottom - top) * scaleY;
        const maxWidth = 640;
        const outputScale = Math.min(1, maxWidth / sourceWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
        canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(
            image,
            left * scaleX,
            top * scaleY,
            sourceWidth,
            sourceHeight,
            0,
            0,
            canvas.width,
            canvas.height,
        );
        if (isMostlyBlack(canvas)) return null;
        return canvas.toDataURL("image/jpeg", 0.86);
    }

    function requestArtworkUrl() {
        const pageArtwork =
            document.querySelector("video")?.poster ||
            document.querySelector('meta[property="og:image"]')?.content ||
            document.querySelector('meta[name="twitter:image"]')?.content;
        if (pageArtwork) return Promise.resolve(pageArtwork);

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                window.removeEventListener(
                    ARTWORK_RESPONSE_EVENT,
                    handleResponse,
                );
                resolve(null);
            }, 500);
            const handleResponse = (event) => {
                clearTimeout(timer);
                window.removeEventListener(
                    ARTWORK_RESPONSE_EVENT,
                    handleResponse,
                );
                resolve(event.detail?.url || null);
            };
            window.addEventListener(ARTWORK_RESPONSE_EVENT, handleResponse);
            window.dispatchEvent(new CustomEvent(ARTWORK_REQUEST_EVENT));
        });
    }

    async function captureArtwork() {
        const url = await requestArtworkUrl();
        if (!url) return null;
        if (/^data:image\//i.test(url)) return url;
        const response = await sendMessage({
            type: "QT_FETCH_CONTEXT_IMAGE",
            url,
        });
        return response?.dataUrl || null;
    }

    async function captureReviewImage(video) {
        if (!isPage()) return null;
        document.documentElement.classList.add(CAPTURING_CLASS);
        try {
            await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            const response = await sendMessage({
                type: "QT_CAPTURE_VISIBLE_TAB",
            });
            const cropped = response?.dataUrl
                ? await cropVisibleTabToVideo(response.dataUrl, video)
                : null;
            return cropped || (await captureArtwork());
        } finally {
            document.documentElement.classList.remove(CAPTURING_CLASS);
        }
    }

    globalThis.LectoroNetflix = Object.freeze({
        captionAdapter: Object.freeze({
            id: "netflix",
            playerSelector: ".watch-video, [data-uia='video-canvas']",
            containerSelector: ".player-timedtext",
            cueSelector: ".player-timedtext-text-container span",
            leafOnly: true,
            documentFallback: true,
        }),
        isPage,
        requestSeek,
        setOriginalSubtitlesHidden,
        createWordCloudSourceLayer,
        captureReviewImage,
    });
})();
