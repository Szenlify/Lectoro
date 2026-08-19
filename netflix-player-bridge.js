/**
 * Lectoro – Netflix Main-World Player Bridge (High-Performance & Lightweight)
 * Injected into the page's MAIN world to interface with Netflix's internal videoPlayer API,
 * intercept timed text manifests with zero CPU overhead, and bridge player seek / track events.
 */
(() => {
    "use strict";

    const SEEK_EVENT = "__lectoro_netflix_seek";
    const PAUSE_EVENT = "__lectoro_netflix_pause";
    const PLAY_EVENT = "__lectoro_netflix_play";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT = "__lectoro_netflix_timed_text_manifest_request";

    let latestTimedTextManifest = null;
    let latestTimedTextSignature = "";
    let currentMovieId = "";
    let hasManifestForCurrentMovie = false;

    function isWatchPage() {
        return (
            typeof window !== "undefined" &&
            (/\/watch\/\d+/.test(window.location.pathname) ||
             !!document.querySelector(".watch-video, [data-uia='video-canvas'], .nf-player-container"))
        );
    }

    function checkMovieChange() {
        const match = window.location.pathname.match(/\/watch\/(\d+)/);
        const movieId = match ? match[1] : "";
        if (movieId && movieId !== currentMovieId) {
            currentMovieId = movieId;
            hasManifestForCurrentMovie = false;
            latestTimedTextManifest = null;
            latestTimedTextSignature = "";
        }
    }

    // Monitor SPA URL transitions on Netflix
    window.addEventListener("popstate", checkMovieChange, { passive: true });

    function getNetflixPlayer() {
        try {
            const videoPlayer =
                window.netflix?.appContext?.state?.playerApp?.getAPI?.()
                    ?.videoPlayer;
            const sessionIds = videoPlayer?.getAllPlayerSessionIds?.() || [];
            const sessionId =
                sessionIds.find((id) => String(id).includes("watch")) ||
                sessionIds[0];
            return sessionId
                ? videoPlayer.getVideoPlayerBySessionId(sessionId)
                : null;
        } catch (_) {
            return null;
        }
    }

    function primitiveTrackData(track) {
        if (!track || typeof track !== "object") return null;
        const result = {};
        const knownKeys = [
            "new_track_id",
            "trackId",
            "track_id",
            "id",
            "bcp47",
            "bcp47LanguageTag",
            "language",
            "languageCode",
            "displayName",
            "languageDescription",
            "description",
            "trackType",
            "rawTrackType",
            "isForcedNarrative",
        ];
        for (const key of knownKeys) {
            try {
                const value = track[key];
                if (
                    typeof value === "string" ||
                    typeof value === "number" ||
                    typeof value === "boolean"
                ) {
                    result[key] = value;
                }
            } catch (_) {}
        }
        for (const [key, value] of Object.entries(track)) {
            if (
                typeof value === "string" ||
                typeof value === "number" ||
                typeof value === "boolean"
            ) {
                result[key] = value;
            }
        }
        return result;
    }

    function collectDownloadUrls(downloadable) {
        const urls = [];
        const visit = (value, depth = 0) => {
            if (depth > 4 || value == null) return;
            if (typeof value === "string") {
                if (/^https:\/\//i.test(value)) urls.push(value);
                return;
            }
            if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) {
                    visit(value[i], depth + 1);
                }
                return;
            }
            if (typeof value === "object") {
                for (const child of Object.values(value)) {
                    visit(child, depth + 1);
                }
            }
        };
        visit(downloadable);
        return Array.from(new Set(urls));
    }

    function getTimedTextTracks(payload) {
        const tracks =
            payload?.timedtexttracks ||
            payload?.timedTextTracks ||
            payload?.textTracks ||
            payload?.tracks;
        return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
    }

    function normalizeDownloads(track) {
        const rawDownloads =
            track.ttDownloadables ||
            track.downloadables ||
            track.downloadUrls ||
            {};

        const entries = Array.isArray(rawDownloads)
            ? rawDownloads.map((download, index) => [
                  download?.contentProfile ||
                      download?.profile ||
                      download?.type ||
                      String(index),
                  download,
              ])
            : Object.entries(rawDownloads);

        return entries
            .map(([profile, downloadable]) => ({
                profile,
                urls: collectDownloadUrls(downloadable),
            }))
            .filter((download) => download.urls.length > 0);
    }

    function normalizeTimedTextManifest(payload) {
        if (!payload || typeof payload !== "object") return null;
        const tracks = getTimedTextTracks(payload);
        if (!Array.isArray(tracks) || tracks.length === 0) return null;

        const normalizedTracks = tracks
            .map((track) => {
                if (track.isNoneTrack) return null;
                const downloads = normalizeDownloads(track);
                if (downloads.length === 0) return null;
                return {
                    id:
                        track.new_track_id ??
                        track.trackId ??
                        track.track_id ??
                        track.id ??
                        "",
                    language: track.language || "",
                    bcp47: track.bcp47 || track.bcp47LanguageTag || "",
                    displayName:
                        track.displayName ||
                        track.languageDescription ||
                        track.language ||
                        "",
                    trackType: track.trackType || track.rawTrackType || "",
                    isForcedNarrative: !!track.isForcedNarrative,
                    downloads,
                };
            })
            .filter(Boolean);

        if (normalizedTracks.length === 0) return null;
        return {
            movieId: String(payload.movieId || payload.videoId || currentMovieId || ""),
            tracks: normalizedTracks,
        };
    }

    function findTimedTextPayload(data) {
        if (!data || typeof data !== "object") return null;

        // Fast-path direct candidate check
        if (getTimedTextTracks(data)) return data;
        if (data.result && getTimedTextTracks(data.result)) return data.result;
        if (data.result?.result && getTimedTextTracks(data.result.result))
            return data.result.result;
        if (data.value && getTimedTextTracks(data.value)) return data.value;
        if (data.manifest && getTimedTextTracks(data.manifest)) return data.manifest;

        // Quick check: if object is primitive container or empty, bypass search
        const keys = Object.keys(data);
        if (keys.length === 0 || keys.length > 80) return null;

        // Bounded shallow search (max depth 2, max 30 nodes)
        const queue = [{ value: data, depth: 0 }];
        const visited = new WeakSet();
        let inspected = 0;

        while (queue.length > 0 && inspected < 30) {
            const { value, depth } = queue.shift();
            if (!value || typeof value !== "object" || visited.has(value))
                continue;
            visited.add(value);
            inspected += 1;

            if (getTimedTextTracks(value)) return value;
            if (depth >= 2) continue;

            for (const child of Object.values(value)) {
                if (child && typeof child === "object" && !visited.has(child)) {
                    queue.push({ value: child, depth: depth + 1 });
                }
            }
        }
        return null;
    }

    function publishTimedTextManifest(manifest) {
        if (!manifest || !Array.isArray(manifest.tracks) || manifest.tracks.length === 0) {
            return;
        }
        const signature = `${manifest.movieId}:${manifest.tracks.length}:${manifest.tracks[0]?.id || ""}`;
        if (signature === latestTimedTextSignature) return;
        latestTimedTextManifest = manifest;
        latestTimedTextSignature = signature;
        hasManifestForCurrentMovie = true;
        if (manifest.movieId) currentMovieId = manifest.movieId;

        window.dispatchEvent(
            new CustomEvent(MANIFEST_EVENT, { detail: manifest }),
        );
    }

    function tryExtractManifest(data) {
        if (hasManifestForCurrentMovie && latestTimedTextManifest) return;
        try {
            const payload = findTimedTextPayload(data);
            if (!payload) return;
            const manifest = normalizeTimedTextManifest(payload);
            if (manifest) {
                publishTimedTextManifest(manifest);
            }
        } catch (_) {}
    }

    // ── 1. Intercept JSON.parse with Fast-Path Guard ─────────────────────
    const nativeJsonParse = JSON.parse;
    JSON.parse = function lectoraNetflixJsonParse(...args) {
        const data = nativeJsonParse.apply(this, args);
        if (!hasManifestForCurrentMovie && data && typeof data === "object") {
            tryExtractManifest(data);
        }
        return data;
    };

    // ── 2. Intercept window.fetch (clone response only when untracked) ────
    if (typeof window.fetch === "function") {
        const nativeFetch = window.fetch;
        window.fetch = async function lectoraNetflixFetch(...args) {
            const response = await nativeFetch.apply(this, args);
            if (!hasManifestForCurrentMovie) {
                try {
                    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
                    if (
                        url.includes("manifest") ||
                        url.includes("timedtext") ||
                        url.includes("cadmium") ||
                        url.includes("metadata")
                    ) {
                        response
                            .clone()
                            .json()
                            .then((data) => tryExtractManifest(data))
                            .catch(() => {});
                    }
                } catch (_) {}
            }
            return response;
        };
    }

    // ── 3. Intercept XMLHttpRequest ──────────────────────────────────────
    if (typeof window.XMLHttpRequest === "function") {
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args) {
            if (!hasManifestForCurrentMovie) {
                this.addEventListener("load", () => {
                    if (hasManifestForCurrentMovie) return;
                    try {
                        const responseText = this.responseText;
                        if (
                            responseText &&
                            (responseText.includes("timedtexttracks") ||
                                responseText.includes("timedTextTracks") ||
                                responseText.includes("ttDownloadables"))
                        ) {
                            const data = nativeJsonParse(responseText);
                            tryExtractManifest(data);
                        }
                    } catch (_) {}
                });
            }
            return originalSend.apply(this, args);
        };
    }

    // ── 4. Event Listeners for Seek, Playback & Track Navigation ─────────
    let lastBridgeSeekDispatchedTime = 0;
    let bridgePendingSeekTimer = null;
    let bridgePendingSeekMs = null;
    const MIN_BRIDGE_SEEK_GAP_MS = 200;

    function executeBridgeSeek(targetMs) {
        try {
            const player = getNetflixPlayer();
            if (player?.seek) {
                const durationMs = Number(player.getDuration?.());
                const finalMs = Number.isFinite(durationMs)
                    ? Math.min(targetMs, durationMs)
                    : targetMs;

                lastBridgeSeekDispatchedTime = Date.now();
                player.seek(finalMs);
                return true;
            }
        } catch (err) {
            console.warn("[Lectoro Bridge] Netflix seek execution failed:", err);
        }
        return false;
    }

    window.addEventListener(PAUSE_EVENT, () => {
        try {
            const player = getNetflixPlayer();
            if (player?.pause) {
                player.pause();
                return;
            }
        } catch (_) {}
        try {
            document.querySelector("video")?.pause();
        } catch (_) {}
    });

    window.addEventListener(PLAY_EVENT, () => {
        try {
            const player = getNetflixPlayer();
            if (player?.play) {
                player.play();
                return;
            }
        } catch (_) {}
        try {
            document.querySelector("video")?.play()?.catch?.(() => {});
        } catch (_) {}
    });

    window.addEventListener(SEEK_EVENT, (event) => {
        const requestedMs = Number(event.detail?.targetMs);
        if (!Number.isFinite(requestedMs) || requestedMs < 0) return;

        bridgePendingSeekMs = requestedMs;
        const now = Date.now();
        const elapsed = now - lastBridgeSeekDispatchedTime;

        if (elapsed < MIN_BRIDGE_SEEK_GAP_MS) {
            // Buffer rapid seek requests to protect Netflix Cadmium DRM pipeline from M7375 crash
            if (bridgePendingSeekTimer) clearTimeout(bridgePendingSeekTimer);
            bridgePendingSeekTimer = setTimeout(() => {
                bridgePendingSeekTimer = null;
                if (Number.isFinite(bridgePendingSeekMs)) {
                    const target = bridgePendingSeekMs;
                    bridgePendingSeekMs = null;
                    executeBridgeSeek(target);
                }
            }, MIN_BRIDGE_SEEK_GAP_MS - elapsed);
        } else {
            if (bridgePendingSeekTimer) {
                clearTimeout(bridgePendingSeekTimer);
                bridgePendingSeekTimer = null;
            }
            bridgePendingSeekMs = null;
            executeBridgeSeek(requestedMs);
        }
    });

    function findNetflixTitle() {
        try {
            const player = getNetflixPlayer();
            const title = player?.getVideoTitle?.() || player?.getMovieTitle?.();
            if (title && typeof title === "string" && title.trim()) {
                return title.trim();
            }
        } catch (_) {}

        try {
            const titleEl = document.querySelector(
                ".video-title, [data-uia='video-title'], .playable-title, .title-info, .title",
            );
            if (titleEl?.textContent?.trim()) {
                return titleEl.textContent.trim();
            }
        } catch (_) {}

        try {
            if (document.title && !document.title.toLowerCase().startsWith("netflix")) {
                return document.title.replace(/-?\s*netflix\s*$/i, "").trim();
            }
        } catch (_) {}

        return "";
    }

    function findNetflixArtworkUrl() {
        // 1. Try navigator.mediaSession.metadata.artwork
        try {
            const artworks = Array.from(
                navigator.mediaSession?.metadata?.artwork || [],
            );
            if (artworks.length > 0) {
                const sorted = artworks.sort((a, b) => {
                    const aSize = parseInt(a.sizes, 10) || 0;
                    const bSize = parseInt(b.sizes, 10) || 0;
                    return bSize - aSize;
                });
                const found = sorted.find(
                    (item) =>
                        typeof item?.src === "string" &&
                        /^https?:\/\//i.test(item.src),
                );
                if (found?.src) return found.src;
            }
        } catch (_) {}

        // 2. Try Netflix Falcor Cache (Redux / Models)
        try {
            const player = getNetflixPlayer();
            const movieId = String(
                player?.getMovieId?.() || currentMovieId || "",
            );
            const falcorCache =
                window.netflix?.falcorCache ||
                window.netflix?.appContext?.state?.model?.cache ||
                window.netflix?.appContext?.state?.playerApp?.getState?.()
                    ?.falcorCache;

            if (falcorCache && typeof falcorCache === "object") {
                const videos = falcorCache.videos || {};
                const videoData = movieId ? videos[movieId] : null;

                const candidates = [];
                const extractCandidates = (obj, depth = 0) => {
                    if (!obj || depth > 4) return;
                    if (typeof obj === "string") {
                        if (
                            /^https?:\/\/[^\s'"]+\.(jpe?g|png|webp|avif)/i.test(
                                obj,
                            ) ||
                            (obj.includes("nflx") && /^https?:\/\//i.test(obj))
                        ) {
                            candidates.push(obj);
                        }
                        return;
                    }
                    if (
                        typeof obj.url === "string" &&
                        /^https?:\/\//i.test(obj.url)
                    ) {
                        candidates.push(obj.url);
                    }
                    if (
                        typeof obj.value === "string" &&
                        /^https?:\/\//i.test(obj.value)
                    ) {
                        candidates.push(obj.value);
                    } else if (typeof obj.value === "object") {
                        extractCandidates(obj.value, depth + 1);
                    }
                    if (typeof obj === "object") {
                        for (const child of Object.values(obj)) {
                            extractCandidates(child, depth + 1);
                        }
                    }
                };

                if (videoData) {
                    extractCandidates(videoData.storyart);
                    extractCandidates(videoData.boxarts);
                    extractCandidates(videoData.heroImage);
                    extractCandidates(videoData.titleCard);
                    extractCandidates(videoData.art);
                    extractCandidates(videoData.interestingMoment);
                }

                if (candidates.length === 0) {
                    for (const v of Object.values(videos)) {
                        extractCandidates(v);
                        if (candidates.length >= 5) break;
                    }
                }

                if (candidates.length > 0) {
                    const preferred =
                        candidates.find(
                            (u) =>
                                u.includes("1280") ||
                                u.includes("720") ||
                                u.includes("storyart") ||
                                u.includes("hero"),
                        ) || candidates[0];
                    if (preferred) return preferred;
                }
            }
        } catch (_) {}

        // 3. Try DOM images on Netflix Watch page
        try {
            const domImgs = Array.from(
                document.querySelectorAll(
                    "img[src*='nflxso.net'], img[src*='nflximg.net'], img[src*='assets.nflxext.com'], img[src*='occ-'], .previewModal--boxart, .watch-video img, .nf-player-container img, [data-uia*='image'] img, .postplay-background img, .player-loading-background, .scrubber-preview-box img",
                ),
            );
            for (const img of domImgs) {
                const src = img.currentSrc || img.src;
                if (
                    src &&
                    /^https?:\/\//i.test(src) &&
                    !src.includes("data:image") &&
                    !src.includes("beacon")
                ) {
                    return src;
                }
                const bg =
                    img.style?.backgroundImage ||
                    window.getComputedStyle(img)?.backgroundImage;
                const bgMatch =
                    bg && bg.match(/url\(['"]?(https?:\/\/[^'"]+)['"]?\)/i);
                if (bgMatch && bgMatch[1]) {
                    return bgMatch[1];
                }
            }
        } catch (_) {}

        // 4. Try OpenGraph / Twitter meta tags
        try {
            const og =
                document.querySelector('meta[property="og:image"]')?.content ||
                document.querySelector('meta[name="twitter:image"]')?.content ||
                document.querySelector('link[rel="image_src"]')?.href;
            if (og && /^https?:\/\//i.test(og)) return og;
        } catch (_) {}

        return "";
    }

    window.addEventListener(ARTWORK_REQUEST_EVENT, () => {
        const url = findNetflixArtworkUrl();
        const title = findNetflixTitle();
        const movieId = String(
            currentMovieId || getNetflixPlayer()?.getMovieId?.() || "",
        );
        window.dispatchEvent(
            new CustomEvent(ARTWORK_RESPONSE_EVENT, {
                detail: { url, title, movieId },
            }),
        );
    });

    function isTrackOff(track) {
        if (!track) return true;
        if (track.isNoneTrack) return true;
        const trackType = String(track.trackType || track.rawTrackType || "").toUpperCase();
        if (trackType === "OFF" || trackType === "NONE") return true;
        const id = String(track.new_track_id ?? track.trackId ?? track.track_id ?? track.id ?? "").toLowerCase();
        if (!id || id === "none" || id === "off") return true;
        const bcp47 = String(track.bcp47 || track.bcp47LanguageTag || track.language || track.languageCode || "").toLowerCase();
        if (bcp47 === "none" || bcp47 === "off") return true;
        const displayName = String(track.displayName || track.languageDescription || "").toLowerCase();
        if (displayName === "off" || displayName === "wył." || displayName === "wyl.") return true;
        return false;
    }

    window.addEventListener(TRACK_REQUEST_EVENT, (event) => {
        let track = null;
        let isCcActive = false;
        if (isWatchPage()) {
            try {
                const player = getNetflixPlayer();
                const rawTrack =
                    player?.getTimedTextTrack?.() ||
                    player?.getTextTrack?.();
                if (rawTrack && !isTrackOff(rawTrack)) {
                    track = primitiveTrackData(rawTrack);
                    isCcActive = true;
                }
            } catch (_) {}
        }
        window.dispatchEvent(
            new CustomEvent(TRACK_RESPONSE_EVENT, {
                detail: {
                    requestId: event.detail?.requestId || "",
                    track,
                    isCcActive,
                },
            }),
        );
    });

    window.addEventListener(MANIFEST_REQUEST_EVENT, () => {
        if (!isWatchPage()) return;
        checkMovieChange();
        if (latestTimedTextManifest) {
            window.dispatchEvent(
                new CustomEvent(MANIFEST_EVENT, {
                    detail: latestTimedTextManifest,
                }),
            );
            return;
        }

        // Direct read from Player API if available
        try {
            const player = getNetflixPlayer();
            const tracks =
                player?.getTimedTextTrackList?.() ||
                player?.getTextTrackList?.();
            if (Array.isArray(tracks) && tracks.length > 0) {
                const manifest = normalizeTimedTextManifest({
                    movieId: String(player.getMovieId?.() || currentMovieId || ""),
                    timedtexttracks: tracks,
                });
                if (manifest) publishTimedTextManifest(manifest);
            }
        } catch (_) {}
    });
})();
