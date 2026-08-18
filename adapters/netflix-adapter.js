/**
 * Lectoro – Netflix Player Caption Adapter & Controller (Single Source of Truth)
 * Coordinates timed text downloads, cue indexing, DOM subtitle hit layers,
 * video seeking, and review screenshot capturing for Netflix.
 */
(() => {
    "use strict";

    const HOST_RE = /(^|\.)netflix\.com$/i;
    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT = "__lectoro_netflix_timed_text_manifest_request";
    const HIDDEN_CLASS = "__qt_netflix-subtitles-hidden";
    const CAPTURING_CLASS = "__qt_netflix-capturing";

    let timedTextManifest = null;
    let cueIndex = [];
    let cueIndexKey = "";
    let cueIndexPromise = null;
    let trackRequestSequence = 0;
    const manifestWaiters = new Set();

    function getSubtitleService() {
        return (
            globalThis.SharedSubtitleService ||
            globalThis.LectoroSubtitleService
        );
    }

    function isPage() {
        return HOST_RE.test(window.location.hostname);
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            if (!chrome?.runtime?.sendMessage) {
                resolve(null);
                return;
            }
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(response || null);
            });
        });
    }

    function requestSeek(targetSeconds, videoFallback = null) {
        if (!Number.isFinite(targetSeconds)) return;
        const targetMs = Math.max(0, targetSeconds) * 1000;

        window.dispatchEvent(
            new CustomEvent(SEEK_EVENT, {
                detail: { targetMs },
            }),
        );

        // Fallback directly on video element if available
        const video =
            videoFallback instanceof HTMLVideoElement
                ? videoFallback
                : document.querySelector("video");
        if (video && Math.abs(video.currentTime - targetSeconds) > 0.5) {
            try {
                video.currentTime = Math.max(0, targetSeconds);
                if (video.paused) video.play?.().catch?.(() => {});
            } catch (_) {}
        }
    }

    function setOriginalSubtitlesHidden(hidden) {
        document.documentElement.classList.toggle(HIDDEN_CLASS, !!hidden);
    }

    function acceptTimedTextManifest(event) {
        const manifest = event.detail;
        if (!Array.isArray(manifest?.tracks) || manifest.tracks.length === 0) {
            return;
        }
        timedTextManifest = manifest;
        cueIndex = [];
        cueIndexKey = "";
        cueIndexPromise = null;
        for (const resolve of manifestWaiters) resolve(manifest);
        manifestWaiters.clear();
    }

    function waitForTimedTextManifest(timeoutMs = 2500) {
        if (timedTextManifest) return Promise.resolve(timedTextManifest);
        return new Promise((resolve) => {
            const finish = (manifest) => {
                clearTimeout(timer);
                manifestWaiters.delete(finish);
                resolve(manifest || null);
            };
            const timer = setTimeout(() => finish(null), timeoutMs);
            manifestWaiters.add(finish);
            window.dispatchEvent(new CustomEvent(MANIFEST_REQUEST_EVENT));
        });
    }

    function requestActiveTextTrack() {
        const requestId = `${Date.now()}-${++trackRequestSequence}`;
        return new Promise((resolve) => {
            const finish = (track) => {
                clearTimeout(timer);
                window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
                resolve(track || null);
            };
            const onResponse = (event) => {
                if (event.detail?.requestId !== requestId) return;
                finish(event.detail?.track);
            };
            const timer = setTimeout(() => finish(null), 800);
            window.addEventListener(TRACK_RESPONSE_EVENT, onResponse);
            window.dispatchEvent(
                new CustomEvent(TRACK_REQUEST_EVENT, {
                    detail: { requestId },
                }),
            );
        });
    }

    function normalizedValue(value) {
        return String(value ?? "")
            .trim()
            .toLowerCase();
    }

    function selectManifestTrack(manifest, activeTrack) {
        if (!manifest?.tracks || manifest.tracks.length === 0) return null;

        const active = activeTrack || {};
        const activeId = normalizedValue(
            active.new_track_id ??
                active.trackId ??
                active.track_id ??
                active.id,
        );
        const activeLanguage = normalizedValue(
            active.bcp47 ??
                active.bcp47LanguageTag ??
                active.language ??
                active.languageCode,
        );
        const activeName = normalizedValue(
            active.displayName ??
                active.languageDescription ??
                active.description,
        );

        return manifest.tracks
            .map((track, order) => {
                let score = -order;
                const trackId = normalizedValue(track.id);
                const trackLanguage = normalizedValue(
                    track.bcp47 || track.language,
                );
                const trackName = normalizedValue(track.displayName);

                if (activeId && trackId === activeId) score += 1000;
                if (
                    activeLanguage &&
                    (trackLanguage === activeLanguage ||
                        trackLanguage.startsWith(activeLanguage + "-") ||
                        activeLanguage.startsWith(trackLanguage + "-"))
                ) {
                    score += 300;
                }
                if (activeName && trackName === activeName) score += 200;
                if (!track.isForcedNarrative) score += 20;

                return { track, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.track;
    }

    function selectDownload(track) {
        return (track?.downloads || [])
            .map((download, order) => {
                const profile = normalizedValue(download.profile);
                let score = -order;
                if (profile.includes("webvtt")) score += 400;
                else if (profile.includes("dfxp") || profile.includes("ttml")) {
                    score += 300;
                } else if (profile.includes("simple")) {
                    score += 200;
                }
                return { download, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.download;
    }

    async function buildSubtitleIndex() {
        const manifest = await waitForTimedTextManifest();
        if (!manifest) return [];

        const activeTrack = await requestActiveTextTrack();
        const track = selectManifestTrack(manifest, activeTrack);
        if (!track) return [];

        const download = selectDownload(track);
        const url = download?.urls?.[0];
        if (!url) return [];

        const nextKey = [
            manifest.movieId,
            track.id,
            download.profile,
            url,
        ].join("|");
        if (cueIndexKey === nextKey && cueIndex.length > 0) return cueIndex;

        const response = await sendMessage({
            type: "QT_FETCH_NETFLIX_TIMED_TEXT",
            url,
        });
        if (!response?.text) return [];

        const subtitleService = getSubtitleService();
        const parsed = subtitleService
            ? subtitleService.parseTimedText(
                  response.text,
                  download.profile,
                  response.contentType,
              )
            : [];

        if (parsed.length === 0) return [];
        cueIndex = parsed;
        cueIndexKey = nextKey;
        return cueIndex;
    }

    function ensureSubtitleIndex() {
        if (!cueIndexPromise) {
            cueIndexPromise = buildSubtitleIndex().finally(() => {
                cueIndexPromise = null;
            });
        }
        return cueIndexPromise;
    }

    /**
     * Finds target seek time for A (previous) or D (next) key navigation.
     * Safely handles both HTMLVideoElement instances and numeric timestamps.
     */
    async function getAdjacentSubtitleTime(videoOrTime, direction) {
        const cues = await ensureSubtitleIndex();
        if (!Array.isArray(cues) || cues.length === 0) return null;

        const subtitleService = getSubtitleService();
        if (subtitleService?.findAdjacentCueTime) {
            return subtitleService.findAdjacentCueTime(
                cues,
                videoOrTime,
                direction,
            );
        }

        const currentTime =
            typeof videoOrTime === "number"
                ? videoOrTime
                : Number(videoOrTime?.currentTime ?? NaN);
        if (!Number.isFinite(currentTime)) return null;

        if (direction > 0) {
            const next = cues.find((cue) => cue.startTime > currentTime + 0.08);
            return next?.startTime ?? null;
        }

        let previousIndex = -1;
        for (let index = cues.length - 1; index >= 0; index -= 1) {
            if (cues[index].startTime <= currentTime + 0.08) {
                previousIndex = index;
                break;
            }
        }
        if (previousIndex < 0) return null;

        const currentCue = cues[previousIndex];
        const isInsideCurrentCue =
            currentTime >= currentCue.startTime - 0.08 &&
            currentTime <= (currentCue.endTime || currentCue.startTime + 3) + 0.15;
        const targetIndex = isInsideCurrentCue
            ? previousIndex - 1
            : previousIndex;

        return targetIndex >= 0 ? cues[targetIndex].startTime : 0;
    }

    function captureRenderedLines(elements) {
        const tokens = [];
        let order = 0;

        for (const element of elements || []) {
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
            );
            let node;
            while ((node = walker.nextNode())) {
                const text = node.nodeValue || "";
                for (const match of text.matchAll(/\S+/g)) {
                    const range = document.createRange();
                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + match[0].length);
                    const rect = Array.from(range.getClientRects()).find(
                        (item) => item.width > 0 && item.height > 0,
                    );
                    range.detach?.();
                    if (!rect) continue;
                    tokens.push({
                        text: match[0],
                        top: rect.top,
                        bottom: rect.bottom,
                        left: rect.left,
                        right: rect.right,
                        order: order++,
                    });
                }
            }
        }

        if (tokens.length === 0) {
            return (elements || [])
                .map((element) => element.textContent.trim())
                .filter(Boolean)
                .map((text) => ({ text, width: 0 }));
        }

        const rows = [];
        for (const token of tokens) {
            const center = (token.top + token.bottom) / 2;
            let row = rows.find(
                (candidate) =>
                    Math.abs(candidate.center - center) <=
                    Math.max(2, (token.bottom - token.top) * 0.25),
            );
            if (!row) {
                row = {
                    center,
                    top: token.top,
                    bottom: token.bottom,
                    left: token.left,
                    right: token.right,
                    tokens: [],
                };
                rows.push(row);
            }
            row.tokens.push(token);
            row.top = Math.min(row.top, token.top);
            row.bottom = Math.max(row.bottom, token.bottom);
            row.left = Math.min(row.left, token.left);
            row.right = Math.max(row.right, token.right);
        }

        return rows
            .sort((left, right) => left.top - right.top)
            .map((row) => ({
                text: row.tokens
                    .sort((left, right) => left.order - right.order)
                    .map((token) => token.text)
                    .join(" "),
                width: row.right - row.left,
            }));
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
        const renderedLines = captureRenderedLines([source]);
        const layer = document.createElement("div");
        layer.className = prefix + "word-cloud-source-layer";
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

        const lineElements = renderedLines.map((line) => {
            const lineElement = document.createElement("div");
            lineElement.className = prefix + "word-cloud-source-line";
            lineElement.textContent = line.text;
            layer.appendChild(lineElement);
            return lineElement;
        });
        parent.appendChild(layer);

        for (const lineElement of lineElements) {
            splitIntoWordSpans(lineElement, prefix + "wc-word");
        }
        return layer;
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

    // Attach manifest listener
    window.addEventListener(MANIFEST_EVENT, acceptTimedTextManifest);
    window.dispatchEvent(new CustomEvent(MANIFEST_REQUEST_EVENT));

    const NetflixAdapter = Object.freeze({
        id: "netflix",
        name: "Netflix",
        playerSelector: ".watch-video, [data-uia='video-canvas']",
        containerSelector: ".player-timedtext",
        cueSelector: ".player-timedtext-text-container span",
        leafOnly: true,
        documentFallback: true,

        isPage,
        matchVideo(video) {
            return isPage();
        },
        getContainer(video) {
            const player = video?.closest?.(this.playerSelector) || document;
            return player.querySelector(this.containerSelector);
        },
        getCueElements(container) {
            if (!container || !container.isConnected) return [];
            const candidates = Array.from(
                container.querySelectorAll(this.cueSelector),
            );
            return (
                globalThis.LectoroBaseAdapter?.filterCueCandidates ||
                ((x) => x)
            )(candidates, {
                leafOnly: true,
                cueSelector: this.cueSelector,
            });
        },
        requestSeek,
        setOriginalSubtitlesHidden,
        captureReviewImage,
        ensureSubtitleIndex,
        getAdjacentSubtitleTime,
        createWordCloudSourceLayer,
        captureRenderedLines,
    });

    globalThis.LectoroNetflixAdapter = NetflixAdapter;
    globalThis.LectoroNetflix = NetflixAdapter;
})();
