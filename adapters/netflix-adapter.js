/**
 * Lectoro – Netflix Player Caption Adapter & Controller (Single Source of Truth)
 * Unified DOM caption adapter (matching YouTube & HTML5 video players), subtitle indexing,
 * video seeking, eager pre-fetching, and fast review artwork for Netflix.
 */
(() => {
    "use strict";

    const HOST_RE = /(^|\.)netflix\.com$/i;
    const EVT = (typeof LectoroConstants !== "undefined" && LectoroConstants.EVENT_NAMES) || {};
    const UIC = (typeof LectoroConstants !== "undefined" && LectoroConstants.UI_CLASSES) || {};
    const SEEK_EVENT = EVT.NETFLIX_SEEK || "__lectoro_netflix_seek";
    const PAUSE_EVENT = EVT.NETFLIX_PAUSE || "__lectoro_netflix_pause";
    const PLAY_EVENT = EVT.NETFLIX_PLAY || "__lectoro_netflix_play";
    const ARTWORK_REQUEST_EVENT = EVT.NETFLIX_ARTWORK_REQUEST || "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = EVT.NETFLIX_ARTWORK_RESPONSE || "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = EVT.NETFLIX_TRACK_REQUEST || "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = EVT.NETFLIX_TRACK_RESPONSE || "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = EVT.NETFLIX_MANIFEST || "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT = EVT.NETFLIX_MANIFEST_REQUEST || "__lectoro_netflix_timed_text_manifest_request";
    const PLAYER_STATE_RESET_EVENT = EVT.NETFLIX_PLAYER_STATE_RESET || "__lectoro_netflix_player_state_reset";
    const HIDDEN_CLASS = UIC.NETFLIX_HIDDEN || "__qt_netflix-subtitles-hidden";
    const NETFLIX_HIDE_CONTROLS_CLASS = UIC.NETFLIX_HIDE_CONTROLS || "__qt_netflix-hide-controls";

    let timedTextManifest = null;
    let cueIndex = [];
    let cueIndexKey = "";
    let cueIndexPromise = null;
    let trackRequestSequence = 0;
    let manifestRevision = 0;
    let optimisticSeek = null;
    let activeTextTrackState = {
        playerReady: false,
        isCcActive: false,
        track: null,
        movieId: "",
    };
    let trackPollInFlight = false;
    const manifestWaiters = new Set();
    const OPTIMISTIC_SEEK_MAX_MS = 3000;
    const POST_SEEK_DOM_GRACE_MS = 450;

    function getWatchMovieId() {
        return window.location.pathname.match(/^\/watch\/(\d+)/)?.[1] || "";
    }

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
        const targetMs = Math.round(Math.max(0, targetSeconds) * 1000);

        // Netflix rebuilds .player-timedtext after a seek. Keep the indexed cue
        // available while that DOM is temporarily empty so Lectoro can render it
        // on the same frame as the keyboard action.
        optimisticSeek = {
            targetTime: targetMs / 1000,
            createdAt: performance.now(),
            expiresAt: performance.now() + OPTIMISTIC_SEEK_MAX_MS,
        };

        window.dispatchEvent(
            new CustomEvent(SEEK_EVENT, {
                detail: { targetMs },
            }),
        );
        // Note: On Netflix, NEVER touch video.currentTime directly!
        // Direct currentTime manipulation desyncs Widevine DRM MSE buffers and triggers Error M7375.
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

    function manifestKey(manifest) {
        return [
            manifest?.movieId || "",
            ...(manifest?.tracks || []).map((track) => [
                track.id,
                track.bcp47 || track.language,
                ...(track.downloads || []).flatMap((download) => [
                    download.profile,
                    ...(download.urls || []),
                ]),
            ].join("~")),
        ].join("|");
    }

    function resetSubtitleState(movieId = getWatchMovieId()) {
        timedTextManifest = null;
        cueIndex = [];
        cueIndexKey = "";
        cueIndexPromise = null;
        manifestRevision += 1;
        optimisticSeek = null;
        activeTextTrackState = {
            playerReady: false,
            isCcActive: false,
            track: null,
            movieId,
        };
        for (const resolve of manifestWaiters) resolve(null);
        manifestWaiters.clear();
    }

    function acceptTimedTextManifest(event) {
        const manifest = event.detail;
        const movieId = getWatchMovieId();
        if (
            !movieId ||
            String(manifest?.movieId) !== movieId ||
            !Array.isArray(manifest?.tracks) ||
            manifest.tracks.length === 0
        ) {
            return;
        }
        if (timedTextManifest && manifestKey(timedTextManifest) === manifestKey(manifest)) {
            ensureSubtitleIndex().catch(() => {});
            return;
        }
        timedTextManifest = manifest;
        cueIndex = [];
        cueIndexKey = "";
        cueIndexPromise = null;
        manifestRevision += 1;
        optimisticSeek = null;
        for (const resolve of manifestWaiters) resolve(manifest);
        manifestWaiters.clear();

        // Start downloading immediately. Waiting for an idle period caused the
        // first A/D navigation to stall for up to 1.5 seconds.
        ensureSubtitleIndex().catch(() => {});
    }

    function waitForTimedTextManifest(timeoutMs = 2500) {
        const movieId = getWatchMovieId();
        if (timedTextManifest && String(timedTextManifest.movieId) === movieId) {
            return Promise.resolve(timedTextManifest);
        }
        if (!movieId) return Promise.resolve(null);
        return new Promise((resolve) => {
            let timer;
            let retryTimer;
            const finish = (manifest) => {
                clearTimeout(timer);
                clearInterval(retryTimer);
                manifestWaiters.delete(finish);
                resolve(manifest || null);
            };
            timer = setTimeout(() => finish(null), timeoutMs);
            retryTimer = setInterval(
                () => window.dispatchEvent(new CustomEvent(MANIFEST_REQUEST_EVENT)),
                250,
            );
            manifestWaiters.add(finish);
            window.dispatchEvent(new CustomEvent(MANIFEST_REQUEST_EVENT));
        });
    }

    function requestActiveTextTrack(timeoutMs = 400) {
        const requestId = `${Date.now()}-${++trackRequestSequence}`;
        return new Promise((resolve) => {
            const finish = (state) => {
                clearTimeout(timer);
                window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
                resolve(
                    state || {
                        playerReady: false,
                        isCcActive: false,
                        track: null,
                        movieId: getWatchMovieId(),
                    },
                );
            };
            const onResponse = (event) => {
                if (event.detail?.requestId !== requestId) return;
                finish({
                    playerReady: !!event.detail.playerReady,
                    isCcActive: !!event.detail.isCcActive,
                    track: event.detail.track || null,
                    movieId: String(event.detail.movieId || ""),
                });
            };
            const timer = setTimeout(() => finish(null), timeoutMs);
            window.addEventListener(TRACK_RESPONSE_EVENT, onResponse);
            window.dispatchEvent(
                new CustomEvent(TRACK_REQUEST_EVENT, {
                    detail: { requestId },
                }),
            );
        });
    }

    async function waitForActiveTextTrack() {
        let state = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            state = await requestActiveTextTrack();
            if (state.movieId !== getWatchMovieId()) continue;
            if (state.playerReady && state.isCcActive && state.track) break;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
        activeTextTrackState = state || activeTextTrackState;
        return activeTextTrackState;
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

    function rankDownloads(track) {
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
            .sort((a, b) => b.score - a.score)
            .map(({ download }) => download);
    }

    function isWatchPage() {
        return isPage() && !!getWatchMovieId();
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
        return activeTextTrackState.playerReady
            ? activeTextTrackState.isCcActive
            : true;
    }

    async function buildSubtitleIndex() {
        const buildRevision = manifestRevision;
        const movieId = getWatchMovieId();
        if (!movieId) return [];

        const [manifest, trackState] = await Promise.all([
            waitForTimedTextManifest(),
            waitForActiveTextTrack(),
        ]);
        if (
            !manifest ||
            String(manifest.movieId) !== getWatchMovieId() ||
            buildRevision !== manifestRevision
        ) return [];

        // If the player is ready and reports captions as disabled, do not fetch
        // an arbitrary first language from the manifest.
        if (trackState.playerReady && !trackState.isCcActive) return [];

        const track = trackState.track
            ? selectManifestTrack(manifest, trackState.track)
            : manifest.tracks?.[0];
        if (!track) return [];

        const subtitleService = getSubtitleService();
        if (!subtitleService?.parseTimedText) return [];

        // A manifest can contain multiple profiles and CDN URLs. Try the best
        // WebVTT/TTML candidates in order instead of failing the entire index
        // when Netflix's first CDN URL is expired or temporarily unavailable.
        for (const download of rankDownloads(track)) {
            for (const url of download?.urls || []) {
                const nextKey = [
                    manifest.movieId,
                    track.id,
                    download.profile,
                    url,
                ].join("|");
                if (cueIndexKey === nextKey && cueIndex.length > 0) {
                    return cueIndex;
                }

                const response = await sendMessage({
                    type: "QT_FETCH_NETFLIX_TIMED_TEXT",
                    url,
                    movieId,
                });
                if (buildRevision !== manifestRevision) return [];
                if (!response?.text) continue;

                const parsed = subtitleService.parseTimedText(
                    response.text,
                    download.profile,
                    response.contentType,
                );
                if (buildRevision !== manifestRevision) return [];
                if (parsed.length === 0) continue;

                cueIndex = parsed;
                cueIndexKey = nextKey;
                return cueIndex;
            }
        }

        return [];
    }

    function ensureSubtitleIndex() {
        const movieId = getWatchMovieId();
        if (!movieId) return Promise.resolve([]);
        if (
            cueIndex.length > 0 &&
            cueIndexKey.startsWith(`${movieId}|`)
        ) {
            return Promise.resolve(cueIndex);
        }
        if (!cueIndexPromise) {
            const pending = Promise.resolve().then(buildSubtitleIndex).finally(() => {
                if (cueIndexPromise === pending) cueIndexPromise = null;
            });
            cueIndexPromise = pending;
        }
        return cueIndexPromise;
    }

    function trackStateKey(state) {
        if (!state?.playerReady) return "loading";
        if (!state.isCcActive || !state.track) return "off";
        const track = state.track;
        return [
            track.new_track_id ?? track.trackId ?? track.track_id ?? track.id ?? "",
            track.bcp47 ?? track.bcp47LanguageTag ?? track.language ?? track.languageCode ?? "",
            track.displayName ?? track.languageDescription ?? track.description ?? "",
        ].map(normalizedValue).join("|");
    }

    async function pollActiveTextTrack() {
        if (trackPollInFlight || cueIndexPromise || !isWatchPage()) return;
        if (!timedTextManifest) {
            ensureSubtitleIndex().catch(() => {});
            return;
        }
        trackPollInFlight = true;
        try {
            const nextState = await requestActiveTextTrack();
            if (nextState.movieId !== getWatchMovieId()) return;

            const previousKey = trackStateKey(activeTextTrackState);
            const nextKey = trackStateKey(nextState);
            activeTextTrackState = nextState;
            if (previousKey === nextKey) {
                if (
                    cueIndex.length === 0 &&
                    (!nextState.playerReady || nextState.isCcActive)
                ) {
                    ensureSubtitleIndex().catch(() => {});
                }
                return;
            }

            cueIndex = [];
            cueIndexKey = "";
            cueIndexPromise = null;
            manifestRevision += 1;
            optimisticSeek = null;
            if (nextState.playerReady && nextState.isCcActive) {
                ensureSubtitleIndex().catch(() => {});
            }
        } finally {
            trackPollInFlight = false;
        }
    }

    function findIndexedCueAt(time) {
        if (!Number.isFinite(time) || cueIndex.length === 0) return null;

        // Binary search for the last cue whose start is not after `time`.
        let low = 0;
        let high = cueIndex.length - 1;
        let matchIndex = -1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (cueIndex[middle].startTime <= time + 0.035) {
                matchIndex = middle;
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        if (matchIndex < 0) return null;

        const cue = cueIndex[matchIndex];
        const endTime = Number.isFinite(cue.endTime)
            ? cue.endTime
            : cue.startTime + 3;
        return time <= endTime + 0.05 ? cue : null;
    }

    function getCurrentCueLines(video = null) {
        // Outside the short post-seek window, Netflix's live DOM remains the
        // visual source. This prevents an indexed fallback from outliving an
        // actual cue or showing captions after the user disables the track.
        if (cueIndex.length === 0 || !optimisticSeek) return null;

        const now = performance.now();
        let lookupTime = Number(video?.currentTime ?? NaN);
        const closeToTarget =
            Number.isFinite(lookupTime) &&
            Math.abs(lookupTime - optimisticSeek.targetTime) < 0.45;
        const oldEnoughToConfirm = now - optimisticSeek.createdAt > 60;

        if (now >= optimisticSeek.expiresAt) {
            optimisticSeek = null;
            return null;
        }
        if (closeToTarget && oldEnoughToConfirm && !video?.seeking) {
            optimisticSeek.confirmed = true;
            optimisticSeek.confirmedAt ??= now;
        }
        if (
            optimisticSeek.confirmedAt &&
            now - optimisticSeek.confirmedAt >= POST_SEEK_DOM_GRACE_MS
        ) {
            optimisticSeek = null;
            return null;
        }
        if (!optimisticSeek.confirmed) {
            lookupTime = optimisticSeek.targetTime;
        }

        if (!Number.isFinite(lookupTime)) return [];
        const cue = findIndexedCueAt(lookupTime);
        if (!cue) return [];
        if (Array.isArray(cue.lines) && cue.lines.length > 0) {
            return cue.lines;
        }
        if (cue.text) {
            return cue.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        }
        return [];
    }

    function getCurrentSubtitleText(video = null) {
        const lines = getCurrentCueLines(video);
        return Array.isArray(lines) && lines.length > 0
            ? lines.join(" ")
            : "";
    }

    function getAllCues() {
        return cueIndex;
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

    let cachedNetflixArtworkDataUrl = "";
    let cachedNetflixMovieId = "";

    function resetArtworkCache() {
        cachedNetflixArtworkDataUrl = "";
        cachedNetflixMovieId = "";
    }

    window.addEventListener("popstate", resetArtworkCache, { passive: true });

    function resizeImageDataUrl(dataUrl, maxWidth = 480) {
        if (!dataUrl || typeof dataUrl !== "string") return Promise.resolve("");
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const srcWidth = img.naturalWidth || img.width;
                    const srcHeight = img.naturalHeight || img.height;
                    if (!srcWidth || !srcHeight) {
                        resolve(dataUrl);
                        return;
                    }
                    const scale = Math.min(maxWidth / srcWidth, 1);
                    const width = Math.max(1, Math.round(srcWidth * scale));
                    const height = Math.max(1, Math.round(srcHeight * scale));

                    const canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) {
                        resolve(dataUrl);
                        return;
                    }
                    ctx.drawImage(img, 0, 0, width, height);
                    const webp = canvas.toDataURL("image/webp", 0.80);
                    if (webp && webp.startsWith("data:image/webp")) {
                        resolve(webp);
                        return;
                    }
                    resolve(canvas.toDataURL("image/jpeg", 0.80));
                } catch (_) {
                    resolve(dataUrl);
                }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    function renderFallbackNetflixCard(title = "") {
        try {
            const width = 480;
            const height = 270;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return "";

            // Background gradient: dark sleek aesthetic
            const grad = ctx.createLinearGradient(0, 0, width, height);
            grad.addColorStop(0, "#1f1f1f");
            grad.addColorStop(0.5, "#141414");
            grad.addColorStop(1, "#0a0a0a");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);

            // Subtle red glow on left edge (Netflix red #E50914)
            const glow = ctx.createRadialGradient(40, 40, 10, 40, 40, 180);
            glow.addColorStop(0, "rgba(229, 9, 20, 0.25)");
            glow.addColorStop(1, "rgba(229, 9, 20, 0)");
            ctx.fillStyle = glow;
            ctx.fillRect(0, 0, width, height);

            // Netflix Badge
            ctx.fillStyle = "#E50914";
            ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("NETFLIX", 28, 42);

            // Title / Show name
            const displayTitle =
                title ||
                document.title.replace(/-?\s*netflix\s*$/i, "").trim() ||
                "Netflix Video";
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "bold 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

            // Word wrap title
            const words = displayTitle.split(/\s+/);
            let line = "";
            let y = 110;
            for (let n = 0; n < words.length; n++) {
                const testLine = line + words[n] + " ";
                const metrics = ctx.measureText(testLine);
                if (metrics.width > width - 56 && n > 0) {
                    ctx.fillText(line, 28, y);
                    line = words[n] + " ";
                    y += 28;
                    if (y > 170) break;
                } else {
                    line = testLine;
                }
            }
            ctx.fillText(line, 28, y);

            // Subtitle icon / Lectoro tag at bottom
            ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
            ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
            ctx.fillText("Lectoro Study Card", 28, height - 24);

            return (
                canvas.toDataURL("image/webp", 0.85) ||
                canvas.toDataURL("image/jpeg", 0.85) ||
                ""
            );
        } catch (_) {
            return "";
        }
    }

    function requestArtworkInfo(timeoutMs = 1500) {
        const pageArtwork =
            document.querySelector("video")?.poster ||
            document.querySelector('meta[property="og:image"]')?.content ||
            document.querySelector('meta[name="twitter:image"]')?.content;
        if (pageArtwork) {
            return Promise.resolve({ url: pageArtwork, title: "" });
        }

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                window.removeEventListener(
                    ARTWORK_RESPONSE_EVENT,
                    handleResponse,
                );
                resolve({ url: "", title: "", movieId: "" });
            }, timeoutMs);
            const handleResponse = (event) => {
                clearTimeout(timer);
                window.removeEventListener(
                    ARTWORK_RESPONSE_EVENT,
                    handleResponse,
                );
                resolve({
                    url: event.detail?.url || "",
                    title: event.detail?.title || "",
                    movieId: event.detail?.movieId || "",
                });
            };
            window.addEventListener(ARTWORK_RESPONSE_EVENT, handleResponse);
            window.dispatchEvent(new CustomEvent(ARTWORK_REQUEST_EVENT));
        });
    }

    async function captureArtwork() {
        if (cachedNetflixArtworkDataUrl) {
            return cachedNetflixArtworkDataUrl;
        }

        const info = await requestArtworkInfo(1500);
        const url = info?.url;
        const title = info?.title;

        if (url) {
            try {
                let dataUrl = "";
                if (/^data:image\//i.test(url)) {
                    dataUrl = url;
                } else {
                    const response = await sendMessage({
                        type: "QT_FETCH_CONTEXT_IMAGE",
                        url,
                    });
                    dataUrl = response?.dataUrl || "";
                }

                if (dataUrl) {
                    const resized = await resizeImageDataUrl(dataUrl);
                    if (resized) {
                        cachedNetflixArtworkDataUrl = resized;
                        return resized;
                    }
                    cachedNetflixArtworkDataUrl = dataUrl;
                    return dataUrl;
                }
            } catch (err) {
                console.warn("[Lectoro] Netflix artwork fetch failed:", err);
            }
        }

        // Fallback: high-res branded Netflix canvas card (guarantees image is never blank)
        const fallbackCard = renderFallbackNetflixCard(title);
        if (fallbackCard) {
            cachedNetflixArtworkDataUrl = fallbackCard;
            return fallbackCard;
        }
        return "";
    }

    async function captureVideoScene(videoFallback = null) {
        try {
            const response = await sendMessage({
                type: "QT_CAPTURE_VISIBLE_TAB",
            });
            const tabDataUrl = response?.dataUrl;
            if (!tabDataUrl || typeof tabDataUrl !== "string") {
                return null;
            }

            const video =
                videoFallback instanceof HTMLElement
                    ? videoFallback
                    : document.querySelector("video") ||
                      document.querySelector(
                          ".watch-video, [data-uia='video-canvas'], .nf-player-container, [data-uia='player']",
                      );

            const rect = video?.getBoundingClientRect
                ? video.getBoundingClientRect()
                : null;

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const fullWidth = img.naturalWidth || img.width;
                        const fullHeight = img.naturalHeight || img.height;
                        if (!fullWidth || !fullHeight) {
                            resolve(tabDataUrl);
                            return;
                        }

                        const winWidth = window.innerWidth || fullWidth;
                        const winHeight = window.innerHeight || fullHeight;
                        const scaleX = fullWidth / winWidth;
                        const scaleY = fullHeight / winHeight;

                        let cropX = 0;
                        let cropY = 0;
                        let cropW = fullWidth;
                        let cropH = fullHeight;

                        if (rect && rect.width > 50 && rect.height > 50) {
                            cropX = Math.max(0, Math.round(rect.left * scaleX));
                            cropY = Math.max(0, Math.round(rect.top * scaleY));
                            cropW = Math.min(
                                fullWidth - cropX,
                                Math.round(rect.width * scaleX),
                            );
                            cropH = Math.min(
                                fullHeight - cropY,
                                Math.round(rect.height * scaleY),
                            );
                        }

                        const MAX_WIDTH = 480;
                        const outScale = Math.min(MAX_WIDTH / cropW, 1);
                        const targetW = Math.max(1, Math.round(cropW * outScale));
                        const targetH = Math.max(1, Math.round(cropH * outScale));

                        const canvas = document.createElement("canvas");
                        canvas.width = targetW;
                        canvas.height = targetH;
                        const ctx = canvas.getContext("2d");
                        if (!ctx) {
                            resolve(tabDataUrl);
                            return;
                        }

                        ctx.drawImage(
                            img,
                            cropX,
                            cropY,
                            cropW,
                            cropH,
                            0,
                            0,
                            targetW,
                            targetH,
                        );
                        const sceneDataUrl =
                            canvas.toDataURL("image/webp", 0.82) ||
                            canvas.toDataURL("image/jpeg", 0.82);

                        resolve(sceneDataUrl || tabDataUrl);
                    } catch (err) {
                        console.warn("[Lectoro] Video scene crop error:", err);
                        resolve(tabDataUrl);
                    }
                };
                img.onerror = () => resolve(null);
                img.src = tabDataUrl;
            });
        } catch (err) {
            console.warn("[Lectoro] captureVideoScene failed:", err);
            return null;
        }
    }

    /**
     * Captures current review scene from the video on Netflix.
     * 1. First priority: Live visible video scene screenshot.
     * 2. Secondary fallback: High-res video artwork / Falcor / canvas card.
     */
    async function captureReviewImage(videoFallback = null) {
        if (!isPage()) return "";

        // 1. Primary: Capture current live video scene
        const sceneShot = await captureVideoScene(videoFallback);
        if (sceneShot) return sceneShot;

        // 2. Secondary fallback: High-res artwork / title card
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

    // Keep page, title and selected-caption state aligned across Netflix SPA routes.
    window.addEventListener(PLAYER_STATE_RESET_EVENT, (event) => {
        resetSubtitleState(String(event.detail?.movieId || ""));
        if (event.detail?.movieId) {
            setTimeout(
                () => ensureSubtitleIndex().catch(() => {}),
                0,
            );
        }
    });
    window.addEventListener(MANIFEST_EVENT, acceptTimedTextManifest);
    if (isPage()) setInterval(pollActiveTextTrack, 1000);
    if (isWatchPage()) {
        ensureSubtitleIndex().catch(() => {});
    }

    const NetflixAdapter = {
        id: "netflix",
        name: "Netflix",
        playerSelector: ".watch-video, [data-uia='video-canvas'], .nf-player-container",
        containerSelector: ".player-timedtext",
        cueSelector: ".player-timedtext-text-container",
        leafOnly: false,
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
                container.querySelectorAll(".player-timedtext-text-container"),
            );
            return (
                globalThis.LectoroBaseAdapter?.filterCueCandidates ||
                ((x) => x)
            )(candidates, {
                leafOnly: false,
                cueSelector: ".player-timedtext-text-container",
            });
        },
        requestSeek,
        pauseVideo,
        playVideo,
        ensureControlsHidden,
        setOriginalSubtitlesHidden,
        captureReviewImage,
        ensureSubtitleIndex,
        getAllCues,
        getCurrentCueLines,
        getCurrentSubtitleText,
        findIndexedCueAt,
        getAdjacentSubtitleTime,
    };

    globalThis.LectoroNetflixAdapter = NetflixAdapter;
    globalThis.LectoroNetflix = NetflixAdapter;
})();
