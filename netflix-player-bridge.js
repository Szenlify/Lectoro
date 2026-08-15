(() => {
    "use strict";

    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";
    const TRACK_REQUEST_EVENT = "__lectoro_netflix_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_netflix_track_response";
    const MANIFEST_EVENT = "__lectoro_netflix_timed_text_manifest";
    const MANIFEST_REQUEST_EVENT =
        "__lectoro_netflix_timed_text_manifest_request";

    let latestTimedTextManifest = null;
    let latestTimedTextSignature = "";

    function getNetflixPlayer() {
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
        const tracks = payload?.timedtexttracks || payload?.textTracks;
        return Array.isArray(tracks) ? tracks : null;
    }

    function normalizeDownloads(track) {
        const rawDownloads = track.ttDownloadables || track.downloadables || {};
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
        const directCandidates = [
            data,
            data?.result,
            data?.result?.result,
            data?.value,
        ];
        for (const candidate of directCandidates) {
            if (getTimedTextTracks(candidate)) return candidate;
        }

        // Netflix has used both `timedtexttracks` and `textTracks`, and the
        // manifest can be wrapped by an additional response object. Keep this
        // search bounded because JSON.parse is also used for unrelated data.
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
        const signature = JSON.stringify(manifest);
        if (signature === latestTimedTextSignature) return;
        latestTimedTextManifest = manifest;
        latestTimedTextSignature = signature;
        window.dispatchEvent(
            new CustomEvent(MANIFEST_EVENT, { detail: manifest }),
        );
    }

    const nativeJsonParse = JSON.parse;
    JSON.parse = function lectoraNetflixJsonParse(...args) {
        const data = nativeJsonParse.apply(this, args);
        try {
            const payload = findTimedTextPayload(data);
            const manifest = normalizeTimedTextManifest(payload);
            if (manifest) queueMicrotask(() => publishTimedTextManifest(manifest));
        } catch (_) {}
        return data;
    };

    window.addEventListener(SEEK_EVENT, (event) => {
        const requestedMs = Number(event.detail?.targetMs);
        if (!Number.isFinite(requestedMs) || requestedMs < 0) return;

        try {
            const player = getNetflixPlayer();
            if (!player?.seek) return;

            const durationMs = Number(player.getDuration?.());
            const targetMs = Number.isFinite(durationMs)
                ? Math.min(requestedMs, durationMs)
                : requestedMs;
            player.seek(targetMs);
            player.play?.();
        } catch (_) {
            // Netflix's private player API can be unavailable while an episode
            // is loading. A later key press will retry with the active session.
        }
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
            track = primitiveTrackData(getNetflixPlayer()?.getTextTrack?.());
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
        }
    });
})();
