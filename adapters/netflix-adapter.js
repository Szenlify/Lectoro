/**
 * Lectoro – Netflix Player Caption Adapter & Controller (Single Source of Truth)
 * Unified DOM caption adapter (matching YouTube & LookMovie), subtitle indexing,
 * video seeking, eager pre-fetching, and fast review artwork for Netflix.
 */
(() => {
    "use strict";

    const HOST_RE = /(^|\.)netflix\.com$/i;
    const SEEK_EVENT = "__lectoro_netflix_seek";
    const PAUSE_EVENT = "__lectoro_netflix_pause";
    const PLAY_EVENT = "__lectoro_netflix_play";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT = "__lectoro_netflix_timed_text_manifest_request";
    const HIDDEN_CLASS = "__qt_netflix-subtitles-hidden";
    const NETFLIX_HIDE_CONTROLS_CLASS = "__qt_netflix-hide-controls";

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

    function pauseVideo(videoFallback = null) {
        window.dispatchEvent(new CustomEvent(PAUSE_EVENT));
        const video =
            videoFallback instanceof HTMLVideoElement
                ? videoFallback
                : document.querySelector("video");
        if (video && !video.paused) {
            try {
                video.pause();
            } catch (_) {}
        }
    }

    function playVideo(videoFallback = null) {
        window.dispatchEvent(new CustomEvent(PLAY_EVENT));
        const video =
            videoFallback instanceof HTMLVideoElement
                ? videoFallback
                : document.querySelector("video");
        if (video && video.paused) {
            try {
                video.play()?.catch?.(() => {});
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

    function isWatchPage() {
        return (
            isPage() &&
            typeof window !== "undefined" &&
            (/\/watch\/\d+/.test(window.location.pathname) ||
             !!document.querySelector(".watch-video, [data-uia='video-canvas'], .nf-player-container"))
        );
    }

    function isPreviewVideo(video) {
        if (!video) return false;
        if (!isWatchPage()) return true;
        if (
            video.closest?.(
                ".previewModal--player_container, .billboard-row, .bob-card, .jawBoneContainer, .titleCard, .slider-item, .hero-image-wrapper",
            )
        ) {
            return true;
        }
        return false;
    }

    function isCcActive(video = null) {
        if (!isWatchPage()) return false;
        if (isPreviewVideo(video)) return false;
        return true;
    }

    async function buildSubtitleIndex() {
        const manifest = await waitForTimedTextManifest();
        if (!manifest) return [];

        const activeTrack = await requestActiveTextTrack();
        const track = selectManifestTrack(manifest, activeTrack) || manifest.tracks?.[0];
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

    const NetflixAdapter = {
        id: "netflix",
        name: "Netflix",
        playerSelector: ".watch-video, [data-uia='video-canvas'], .nf-player-container",
        containerSelector: ".player-timedtext",
        cueSelector: ".player-timedtext-text-container span",
        leafOnly: true,
        documentFallback: true,
        isPage,
        isWatchPage,
        isPreview: (video) => isPreviewVideo(video),
        isCcActive: (video) => isCcActive(video),
        matchVideo: (video) =>
            isWatchPage() &&
            !isPreviewVideo(video) &&
            !!video?.closest?.(".watch-video, [data-uia='video-canvas'], .nf-player-container"),
        getContainer: (video) => {
            if (!isWatchPage() || isPreviewVideo(video)) return null;
            const player =
                video?.closest?.(".watch-video, [data-uia='video-canvas'], .nf-player-container") ||
                document;
            return player.querySelector(".player-timedtext");
        },
        getCueElements: (container) => {
            if (!isWatchPage() || !container || !container.isConnected) return [];
            const candidates = Array.from(
                container.querySelectorAll(".player-timedtext-text-container span"),
            );
            return (
                globalThis.LectoroBaseAdapter?.filterCueCandidates ||
                ((x) => x)
            )(candidates, {
                leafOnly: true,
                cueSelector: ".player-timedtext-text-container span",
            });
        },
        requestSeek,
        pauseVideo,
        playVideo,
        ensureControlsHidden,
        setOriginalSubtitlesHidden,
        captureReviewImage,
        ensureSubtitleIndex,
        getAdjacentSubtitleTime,
    };

    globalThis.LectoroNetflixAdapter = NetflixAdapter;
    globalThis.LectoroNetflix = NetflixAdapter;
})();
