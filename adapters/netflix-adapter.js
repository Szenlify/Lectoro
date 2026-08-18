/**
 * Lectoro – Netflix Player Caption Adapter & Controller (Single Source of Truth)
 * High-performance subtitle indexing, pooled DOM hitboxes, video seeking,
 * eager pre-fetching, and fast review artwork for Netflix.
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
    const NETFLIX_HIDE_CONTROLS_CLASS = "__qt_netflix-hide-controls";
    const PREFIX = "__qt_";

    let timedTextManifest = null;
    let cueIndex = [];
    let cueIndexKey = "";
    let cueIndexPromise = null;
    let trackRequestSequence = 0;
    const manifestWaiters = new Set();

    // Hitbox Layer & Object Pool (Zero DOM churn)
    let netflixSubtitleHitLayer = null;
    const hitboxPool = [];
    let activeHitboxCount = 0;

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

        // Eager background indexing (pre-warm subtitle timeline before user presses A/D)
        if (typeof requestIdleCallback === "function") {
            requestIdleCallback(() => ensureSubtitleIndex().catch(() => {}), {
                timeout: 1500,
            });
        } else {
            setTimeout(() => ensureSubtitleIndex().catch(() => {}), 100);
        }
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

    // ── High-Performance Hitbox Layer & Object Pool ──────────────────────

    function ensureHitboxLayer() {
        const parent =
            (typeof QT !== "undefined" && QT.getOverlayParent?.()) ||
            document.body ||
            document.documentElement;

        if (netflixSubtitleHitLayer?.isConnected) {
            if (netflixSubtitleHitLayer.parentElement !== parent) {
                parent.appendChild(netflixSubtitleHitLayer);
            }
            return netflixSubtitleHitLayer;
        }

        netflixSubtitleHitLayer = document.createElement("div");
        netflixSubtitleHitLayer.className = `${PREFIX}netflix-subtitle-hit-layer`;
        parent.appendChild(netflixSubtitleHitLayer);
        return netflixSubtitleHitLayer;
    }

    function clearSubtitleHitboxes() {
        for (let i = 0; i < activeHitboxCount; i++) {
            hitboxPool[i].style.display = "none";
            hitboxPool[i].classList.remove(`${PREFIX}word-hover`);
        }
        activeHitboxCount = 0;
    }

    function getPooledHitbox(index) {
        if (index < hitboxPool.length) {
            return hitboxPool[index];
        }
        const layer = ensureHitboxLayer();
        const hitbox = document.createElement("span");
        hitbox.className = `${PREFIX}sub-word ${PREFIX}netflix-hitbox`;
        hitbox.dataset[`${PREFIX}netflixHitbox`] = "1";
        layer.appendChild(hitbox);
        hitboxPool.push(hitbox);
        return hitbox;
    }

    /**
     * Efficiently refreshes hitboxes using Object Pooling and minimal layout thrashing.
     */
    function refreshSubtitleHitboxes(elements, activeHoverText = null) {
        if (!isPage()) return [];

        const sourceElements = (elements || []).filter(
            (el) => el?.textContent?.trim(),
        );

        if (sourceElements.length === 0) {
            clearSubtitleHitboxes();
            return [];
        }

        let assignedCount = 0;
        let matchedRehitbox = null;

        for (const element of sourceElements) {
            const walker = document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT,
            );
            let textNode;

            while ((textNode = walker.nextNode())) {
                const text = textNode.nodeValue || "";
                for (const match of text.matchAll(/\S+/g)) {
                    const start = match.index ?? 0;
                    const end = start + match[0].length;
                    const range = document.createRange();

                    try {
                        range.setStart(textNode, start);
                        range.setEnd(textNode, end);
                    } catch (_) {
                        range.detach?.();
                        continue;
                    }

                    const rect = Array.from(range.getClientRects()).find(
                        (r) => r.width > 0 && r.height > 0,
                    );
                    range.detach?.();
                    if (!rect) continue;

                    const hitbox = getPooledHitbox(assignedCount++);
                    const word = match[0];
                    hitbox.textContent = word;

                    hitbox.style.left = `${Math.round(rect.left)}px`;
                    hitbox.style.top = `${Math.round(rect.top)}px`;
                    hitbox.style.width = `${Math.round(rect.width)}px`;
                    hitbox.style.height = `${Math.round(rect.height)}px`;
                    hitbox.style.display = "block";

                    if (activeHoverText && word === activeHoverText && !matchedRehitbox) {
                        matchedRehitbox = hitbox;
                    }
                }
            }
        }

        // Hide unused spans in the pool
        for (let i = assignedCount; i < activeHitboxCount; i++) {
            hitboxPool[i].style.display = "none";
            hitboxPool[i].classList.remove(`${PREFIX}word-hover`);
        }
        activeHitboxCount = assignedCount;

        const activeList = hitboxPool.slice(0, activeHitboxCount);
        return {
            hitboxes: activeList,
            matchedRehitbox,
        };
    }

    function destroySubtitleHitLayer() {
        clearSubtitleHitboxes();
        netflixSubtitleHitLayer?.remove();
        netflixSubtitleHitLayer = null;
        hitboxPool.length = 0;
        activeHitboxCount = 0;
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
            }, 300);
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

    /**
     * Fast review image capture for Netflix.
     * DRM prevents video canvas capture (returns black frame), so we directly fetch high-res artwork.
     */
    async function captureReviewImage() {
        if (!isPage()) return null;
        return (await captureArtwork()) || "";
    }

    let netflixControlsTimer = null;
    let mouseMoveRaf = null;

    function ensureControlsHidden() {
        if (!isPage()) return;
        document.documentElement.classList.add(NETFLIX_HIDE_CONTROLS_CLASS);
        clearTimeout(netflixControlsTimer);
        netflixControlsTimer = setTimeout(() => {
            document.documentElement.classList.remove(NETFLIX_HIDE_CONTROLS_CLASS);
        }, 3000);
    }

    function initNetflixControlsManagement() {
        if (!isPage()) return;
        window.addEventListener(
            "mousemove",
            () => {
                if (mouseMoveRaf) return;
                mouseMoveRaf = requestAnimationFrame(() => {
                    mouseMoveRaf = null;
                    if (
                        document.documentElement.classList.contains(
                            NETFLIX_HIDE_CONTROLS_CLASS,
                        )
                    ) {
                        document.documentElement.classList.remove(
                            NETFLIX_HIDE_CONTROLS_CLASS,
                        );
                        clearTimeout(netflixControlsTimer);
                    }
                });
            },
            { passive: true },
        );
    }

    initNetflixControlsManagement();

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
        matchVideo() {
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
        ensureControlsHidden,
        setOriginalSubtitlesHidden,
        captureReviewImage,
        ensureSubtitleIndex,
        getAdjacentSubtitleTime,
        refreshSubtitleHitboxes,
        clearSubtitleHitboxes,
        destroySubtitleHitLayer,
        createWordCloudSourceLayer,
        captureRenderedLines,
    });

    globalThis.LectoroNetflixAdapter = NetflixAdapter;
    globalThis.LectoroNetflix = NetflixAdapter;
})();
