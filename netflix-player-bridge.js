/**
 * Lectoro – Netflix Main-World Player Bridge
 * Injected into the page's MAIN world to interface with Netflix's internal videoPlayer API,
 * intercept timed text manifests, and bridge player seek / track events to Lectoro.
 */
(() => {
    "use strict";

    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT = "__lectoro_netflix_timed_text_manifest_request";

    let latestTimedTextManifest = null;
    let latestTimedTextSignature = "";

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
            if (depth > 5 || value == null) return;
            if (typeof value === "string") {
                if (/^https:\/\//i.test(value)) urls.push(value);
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((item) => visit(item, depth + 1));
                return;
            }
            if (typeof value === "object") {
                Object.values(value).forEach((item) =>
                    visit(item, depth + 1),
                );
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
        return Array.isArray(tracks) ? tracks : null;
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
            movieId: String(payload.movieId || payload.videoId || ""),
            tracks: normalizedTracks,
        };
    }

    function findTimedTextPayload(data) {
        if (!data || typeof data !== "object") return null;

        const directCandidates = [
            data,
            data?.result,
            data?.result?.result,
            data?.value,
            data?.manifest,
        ];
        for (const candidate of directCandidates) {
            if (getTimedTextTracks(candidate)) return candidate;
        }

        const queue = [{ value: data, depth: 0 }];
        const visited = new WeakSet();
        let inspected = 0;

        while (queue.length > 0 && inspected < 500) {
            const { value, depth } = queue.shift();
            if (!value || typeof value !== "object" || visited.has(value))
                continue;
            visited.add(value);
            inspected += 1;

            if (getTimedTextTracks(value)) return value;
            if (depth >= 4) continue;

            for (const child of Object.values(value)) {
                if (child && typeof child === "object") {
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
        const signature = JSON.stringify(manifest);
        if (signature === latestTimedTextSignature) return;
        latestTimedTextManifest = manifest;
        latestTimedTextSignature = signature;
        window.dispatchEvent(
            new CustomEvent(MANIFEST_EVENT, { detail: manifest }),
        );
    }

    function tryExtractManifest(data) {
        try {
            const payload = findTimedTextPayload(data);
            const manifest = normalizeTimedTextManifest(payload);
            if (manifest) {
                queueMicrotask(() => publishTimedTextManifest(manifest));
            }
        } catch (_) {}
    }

    // ── 1. Intercept JSON.parse ──────────────────────────────────────────
    const nativeJsonParse = JSON.parse;
    JSON.parse = function lectoraNetflixJsonParse(...args) {
        const data = nativeJsonParse.apply(this, args);
        tryExtractManifest(data);
        return data;
    };

    // ── 2. Intercept window.fetch (clone response if manifest/timedtext) ──
    if (typeof window.fetch === "function") {
        const nativeFetch = window.fetch;
        window.fetch = async function lectoraNetflixFetch(...args) {
            const response = await nativeFetch.apply(this, args);
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
            return response;
        };
    }

    // ── 3. Intercept XMLHttpRequest ──────────────────────────────────────
    if (typeof window.XMLHttpRequest === "function") {
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function (...args) {
            this.addEventListener("load", () => {
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
            return originalSend.apply(this, args);
        };
    }

    // ── 4. Event Listeners for Seek & Track Navigation ────────────────────
    window.addEventListener(SEEK_EVENT, (event) => {
        const requestedMs = Number(event.detail?.targetMs);
        if (!Number.isFinite(requestedMs) || requestedMs < 0) return;

        try {
            const player = getNetflixPlayer();
            if (player?.seek) {
                const durationMs = Number(player.getDuration?.());
                const targetMs = Number.isFinite(durationMs)
                    ? Math.min(requestedMs, durationMs)
                    : requestedMs;
                player.seek(targetMs);
                player.play?.();
                return;
            }
        } catch (_) {}

        // Fallback: direct HTML video seek if player API not ready
        try {
            const video = document.querySelector("video");
            if (video) {
                video.currentTime = requestedMs / 1000;
                video.play?.().catch?.(() => {});
            }
        } catch (_) {}
    });

    window.addEventListener(ARTWORK_REQUEST_EVENT, () => {
        const artwork = Array.from(
            navigator.mediaSession?.metadata?.artwork || [],
        ).sort((a, b) => {
            const aSize = parseInt(a.sizes, 10) || 0;
            const bSize = parseInt(b.sizes, 10) || 0;
            return bSize - aSize;
        })[0];
        window.dispatchEvent(
            new CustomEvent(ARTWORK_RESPONSE_EVENT, {
                detail: { url: artwork?.src || "" },
            }),
        );
    });

    window.addEventListener(TRACK_REQUEST_EVENT, (event) => {
        let track = null;
        try {
            const player = getNetflixPlayer();
            track =
                primitiveTrackData(player?.getTimedTextTrack?.()) ||
                primitiveTrackData(player?.getTextTrack?.());
        } catch (_) {}
        window.dispatchEvent(
            new CustomEvent(TRACK_RESPONSE_EVENT, {
                detail: {
                    requestId: event.detail?.requestId || "",
                    track,
                },
            }),
        );
    });

    window.addEventListener(MANIFEST_REQUEST_EVENT, () => {
        if (latestTimedTextManifest) {
            window.dispatchEvent(
                new CustomEvent(MANIFEST_EVENT, {
                    detail: latestTimedTextManifest,
                }),
            );
        } else {
            // Attempt to read directly from player API if available
            try {
                const player = getNetflixPlayer();
                const tracks =
                    player?.getTimedTextTrackList?.() ||
                    player?.getTextTrackList?.();
                if (Array.isArray(tracks) && tracks.length > 0) {
                    const manifest = normalizeTimedTextManifest({
                        movieId: String(player.getMovieId?.() || ""),
                        timedtexttracks: tracks,
                    });
                    if (manifest) publishTimedTextManifest(manifest);
                }
            } catch (_) {}
        }
    });
})();
