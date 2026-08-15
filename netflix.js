(() => {
    "use strict";

    const HOST_RE = /(^|\.)netflix\.com$/i;
    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT =
        "__lectoro_netflix_timed_text_manifest_request";
    const HIDDEN_CLASS = "__qt_netflix-subtitles-hidden";
    const CAPTURING_CLASS = "__qt_netflix-capturing";

    let timedTextManifest = null;
    let cueIndex = [];
    let cueIndexKey = "";
    let cueIndexPromise = null;
    let trackRequestSequence = 0;
    const manifestWaiters = new Set();

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

    function sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) resolve(null);
                else resolve(response || null);
            });
        });
    }

    function acceptTimedTextManifest(event) {
        const manifest = event.detail;
        if (!Array.isArray(manifest?.tracks) || manifest.tracks.length === 0)
            return;
        timedTextManifest = manifest;
        cueIndex = [];
        cueIndexKey = "";
        cueIndexPromise = null;
        for (const resolve of manifestWaiters) resolve(manifest);
        manifestWaiters.clear();
    }

    function waitForTimedTextManifest(timeoutMs = 2000) {
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
            const timer = setTimeout(() => finish(null), 700);
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
                )
                    score += 300;
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
                else if (profile.includes("dfxp") || profile.includes("ttml"))
                    score += 300;
                else if (profile.includes("simple")) score += 200;
                return { download, score };
            })
            .sort((a, b) => b.score - a.score)[0]?.download;
    }

    function cleanCueText(rawText) {
        const holder = document.createElement("div");

        holder.innerHTML = String(rawText || "")
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/\n+/g, " ");

        return extractSubtitleText(holder);
    }

    function parseWebVttTimestamp(raw) {
        const parts = String(raw || "")
            .trim()
            .replace(",", ".")
            .split(":");
        if (parts.length < 2 || parts.length > 3) return null;
        const seconds = Number(parts.pop());
        const minutes = Number(parts.pop());
        const hours = parts.length ? Number(parts.pop()) : 0;
        if (![hours, minutes, seconds].every(Number.isFinite)) return null;
        return hours * 3600 + minutes * 60 + seconds;
    }

    function finalizeCues(rawCues) {
        const sorted = rawCues
            .filter(
                (cue) =>
                    Number.isFinite(cue.startTime) &&
                    cue.startTime >= 0 &&
                    cue.text,
            )
            .sort((a, b) => a.startTime - b.startTime);
        const merged = [];
        for (const cue of sorted) {
            const previous = merged[merged.length - 1];
            if (
                previous &&
                Math.abs(previous.startTime - cue.startTime) < 0.03
            ) {
                if (!previous.text.includes(cue.text))
                    previous.text += " " + cue.text;
                previous.endTime = Math.max(
                    previous.endTime || 0,
                    cue.endTime || 0,
                );
                continue;
            }
            merged.push({
                startTime: cue.startTime,
                endTime: Number.isFinite(cue.endTime) ? cue.endTime : null,
                text: cue.text,
            });
        }
        for (let index = 0; index < merged.length; index += 1) {
            if (
                !Number.isFinite(merged[index].endTime) ||
                merged[index].endTime <= merged[index].startTime
            ) {
                const nextStart = merged[index + 1]?.startTime;
                merged[index].endTime = Number.isFinite(nextStart)
                    ? Math.max(merged[index].startTime + 0.2, nextStart - 0.01)
                    : merged[index].startTime + 3;
            }
        }
        return merged;
    }

    function parseWebVtt(text) {
        const cues = [];
        const blocks = String(text || "")
            .replace(/^\uFEFF/, "")
            .split(/\r?\n\s*\r?\n/);
        for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            const timingIndex = lines.findIndex((line) => line.includes("-->"));
            if (timingIndex < 0) continue;
            const match = lines[timingIndex].match(
                /^\s*([^\s]+)\s+-->\s+([^\s]+)/,
            );
            if (!match) continue;
            const startTime = parseWebVttTimestamp(match[1]);
            const endTime = parseWebVttTimestamp(match[2]);
            const cueText = cleanCueText(
                lines.slice(timingIndex + 1).join("\n"),
            );
            if (startTime === null || !cueText) continue;
            cues.push({ startTime, endTime, text: cueText });
        }
        return finalizeCues(cues);
    }

    function numericXmlAttribute(element, localName, fallback) {
        const attribute = Array.from(element?.attributes || []).find(
            (item) => item.localName === localName,
        );
        const value = Number(attribute?.value);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function parseTtmlTime(raw, frameRate, tickRate) {
        const value = String(raw || "").trim();
        if (!value) return null;
        const offset = value.match(/^([\d.]+)(h|m|s|ms|f|t)$/i);
        if (offset) {
            const amount = Number(offset[1]);
            const unit = offset[2].toLowerCase();
            if (!Number.isFinite(amount)) return null;
            if (unit === "h") return amount * 3600;
            if (unit === "m") return amount * 60;
            if (unit === "s") return amount;
            if (unit === "ms") return amount / 1000;
            if (unit === "f") return amount / frameRate;
            if (unit === "t") return amount / tickRate;
        }
        const clock = value.match(
            /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+)|:(\d+))?$/,
        );
        if (!clock) return null;
        const fraction = clock[4]
            ? Number(`0.${clock[4]}`)
            : clock[5]
              ? Number(clock[5]) / frameRate
              : 0;
        return (
            Number(clock[1]) * 3600 +
            Number(clock[2]) * 60 +
            Number(clock[3]) +
            fraction
        );
    }

    function extractSubtitleText(node) {
        const parts = [];

        function walk(current) {
            if (current.nodeType === Node.TEXT_NODE) {
                const text = current.nodeValue || "";
                if (text) parts.push(text);
                return;
            }

            if (current.nodeType !== Node.ELEMENT_NODE) return;

            const tagName = current.localName?.toLowerCase();

            if (tagName === "br") {
                parts.push(" ");
                return;
            }

            const children = Array.from(current.childNodes);

            for (let index = 0; index < children.length; index += 1) {
                const beforeLength = parts.length;
                walk(children[index]);

                if (
                    index < children.length - 1 &&
                    parts.length > beforeLength
                ) {
                    const next = children[index + 1];

                    if (next?.nodeType === Node.ELEMENT_NODE) {
                        const left = parts[parts.length - 1] || "";
                        const right = next.textContent || "";

                        if (
                            left &&
                            right &&
                            !/\s$/.test(left) &&
                            !/^\s/.test(right) &&
                            /[\p{L}\p{N}]$/u.test(left) &&
                            /^[\p{L}\p{N}]/u.test(right)
                        ) {
                            parts.push(" ");
                        }
                    }
                }
            }
        }

        walk(node);

        return parts.join("").replace(/\s+/g, " ").trim();
    }

    function parseTtml(text) {
        const xml = new DOMParser().parseFromString(
            String(text || ""),
            "application/xml",
        );
        if (xml.querySelector("parsererror")) return [];
        const root = xml.documentElement;
        const frameRate = numericXmlAttribute(root, "frameRate", 30);
        const tickRate = numericXmlAttribute(root, "tickRate", 10_000_000);
        const cues = [];
        const paragraphs = Array.from(
            xml.getElementsByTagNameNS("*", "p"),
        ).filter((paragraph) => paragraph.hasAttribute("begin"));
        for (const paragraph of paragraphs) {
            const startTime = parseTtmlTime(
                paragraph.getAttribute("begin"),
                frameRate,
                tickRate,
            );
            let endTime = parseTtmlTime(
                paragraph.getAttribute("end"),
                frameRate,
                tickRate,
            );
            if (!Number.isFinite(endTime)) {
                const duration = parseTtmlTime(
                    paragraph.getAttribute("dur"),
                    frameRate,
                    tickRate,
                );
                if (Number.isFinite(startTime) && Number.isFinite(duration))
                    endTime = startTime + duration;
            }
            const textClone = paragraph.cloneNode(true);

            for (const lineBreak of Array.from(
                textClone.getElementsByTagNameNS("*", "br"),
            )) {
                lineBreak.replaceWith(xml.createTextNode(" "));
            }

            const cueText = extractSubtitleText(textClone);
            if (!Number.isFinite(startTime) || !cueText) continue;
            cues.push({ startTime, endTime, text: cueText });
        }
        return finalizeCues(cues);
    }

    function parseTimedText(text, profile, contentType) {
        const format = `${profile || ""} ${contentType || ""}`.toLowerCase();
        if (format.includes("webvtt") || /^\s*WEBVTT/i.test(text))
            return parseWebVtt(text);
        return parseTtml(text);
    }

    async function buildSubtitleIndex() {
        const manifest = await waitForTimedTextManifest();
        if (!manifest) return [];
        const activeTrack = await requestActiveTextTrack();
        const track = selectManifestTrack(manifest, activeTrack);
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
        const parsed = parseTimedText(
            response.text,
            download.profile,
            response.contentType,
        );
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

    async function getAdjacentSubtitleTime(currentTime, direction) {
        const cues = await ensureSubtitleIndex();
        if (!Array.isArray(cues) || cues.length === 0) return null;
        const time = Number(currentTime);
        if (!Number.isFinite(time)) return null;

        if (direction > 0) {
            const next = cues.find((cue) => cue.startTime > time + 0.08);
            return next?.startTime ?? null;
        }

        let previousIndex = -1;
        for (let index = cues.length - 1; index >= 0; index -= 1) {
            if (cues[index].startTime <= time + 0.08) {
                previousIndex = index;
                break;
            }
        }
        if (previousIndex < 0) return null;
        const currentCue = cues[previousIndex];
        const isInsideCurrentCue =
            time >= currentCue.startTime - 0.08 &&
            time <= currentCue.endTime + 0.15;
        const targetIndex = isInsideCurrentCue
            ? previousIndex - 1
            : previousIndex;
        return targetIndex >= 0 ? cues[targetIndex].startTime : null;
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

    window.addEventListener(MANIFEST_EVENT, acceptTimedTextManifest);
    window.dispatchEvent(new CustomEvent(MANIFEST_REQUEST_EVENT));

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
        captureRenderedLines,
        captureReviewImage,
        ensureSubtitleIndex,
        getAdjacentSubtitleTime,
    });
})();
