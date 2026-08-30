/**
 * Lectoro – YouTube Main-World Player Bridge (High-Performance & Lightweight)
 * Injected into YouTube's MAIN world to interface with YouTube's HTML5 player,
 * intercept timed text network responses, and bridge player seek / caption events.
 */
(() => {
    "use strict";

    const TIMED_TEXT_EVENT = "__lectoro_youtube_timed_text";
    const TRACKS_EVENT = "__lectoro_youtube_tracks_available";
    const TRACK_REQUEST_EVENT = "__lectoro_youtube_track_request";
    const TRACK_RESPONSE_EVENT = "__lectoro_youtube_track_response";
    const FETCH_REQUEST_EVENT = "__lectoro_youtube_fetch_request";
    const FETCH_RESPONSE_EVENT = "__lectoro_youtube_fetch_response";
    const SEEK_EVENT = "__lectoro_youtube_seek";
    const PAUSE_EVENT = "__lectoro_youtube_pause";
    const PLAY_EVENT = "__lectoro_youtube_play";
    const NAV_EVENT = "__lectoro_youtube_navigation";

    let currentVideoId = "";

    function getYouTubePlayer() {
        return (
            document.getElementById("movie_player") ||
            document.querySelector(".html5-video-player")
        );
    }

    function getCurrentVideoId() {
        try {
            const player = getYouTubePlayer();
            const playerVideoId = player?.getVideoData?.()?.video_id;
            if (playerVideoId) return playerVideoId;
        } catch (_) {}

        try {
            const params = new URLSearchParams(window.location.search);
            const v = params.get("v");
            if (v) return v;
        } catch (_) {}

        const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (shortsMatch) return shortsMatch[1];

        const embedMatch = window.location.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        if (embedMatch) return embedMatch[1];

        try {
            return (
                window.ytInitialPlayerResponse?.videoDetails?.videoId ||
                window.ytplayer?.config?.args?.raw_player_response?.videoDetails?.videoId ||
                ""
            );
        } catch (_) {
            return "";
        }
    }

    function extractCaptionTracks() {
        const player = getYouTubePlayer();
        let tracks = [];

        // 1. From Player getPlayerResponse()
        try {
            const playerResponse = player?.getPlayerResponse?.();
            const captionTracks =
                playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (Array.isArray(captionTracks) && captionTracks.length > 0) {
                tracks = captionTracks;
            }
        } catch (_) {}

        // 2. From window.ytInitialPlayerResponse
        if (tracks.length === 0) {
            try {
                const initResponse = window.ytInitialPlayerResponse;
                const captionTracks =
                    initResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
                if (Array.isArray(captionTracks) && captionTracks.length > 0) {
                    tracks = captionTracks;
                }
            } catch (_) {}
        }

        // 3. From window.ytplayer.config
        if (tracks.length === 0) {
            try {
                const configTracks =
                    window.ytplayer?.config?.args?.raw_player_response?.captions
                        ?.playerCaptionsTracklistRenderer?.captionTracks;
                if (Array.isArray(configTracks) && configTracks.length > 0) {
                    tracks = configTracks;
                }
            } catch (_) {}
        }

        // 4. From Player getOption('captions', 'tracklist')
        if (tracks.length === 0) {
            try {
                const optTracks = player?.getOption?.("captions", "tracklist");
                if (Array.isArray(optTracks) && optTracks.length > 0) {
                    const videoId = getCurrentVideoId();
                    tracks = optTracks.map((t) => ({
                        baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${t.languageCode || "en"}${t.vssId ? `&vss_id=${encodeURIComponent(t.vssId)}` : ""}`,
                        languageCode: t.languageCode || "en",
                        name: { simpleText: t.languageName || t.displayName || t.languageCode || "English" },
                        kind: t.kind || (t.vssId?.startsWith("a.") ? "asr" : ""),
                        vssId: t.vssId || "",
                        isTranslatable: true,
                    }));
                }
            } catch (_) {}
        }

        // Normalize track objects
        return tracks.map((t) => {
            const name =
                typeof t.name === "string"
                    ? t.name
                    : t.name?.simpleText ||
                      t.name?.runs?.[0]?.text ||
                      t.languageCode ||
                      "";
            const videoId = getCurrentVideoId();
            let baseUrl = t.baseUrl || "";
            if (!baseUrl && t.languageCode && videoId) {
                baseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${t.languageCode}${t.vssId ? `&vss_id=${encodeURIComponent(t.vssId)}` : ""}`;
            }

            return {
                baseUrl,
                languageCode: t.languageCode || "",
                name,
                kind: t.kind || (t.vssId?.startsWith("a.") ? "asr" : ""),
                vssId: t.vssId || "",
                isTranslatable: !!t.isTranslatable,
            };
        });
    }

    function getActiveTrack() {
        const player = getYouTubePlayer();
        try {
            const track = player?.getOption?.("captions", "track");
            if (track && typeof track === "object" && track.languageCode) {
                return {
                    languageCode: track.languageCode,
                    name: track.languageName || track.displayName || "",
                    kind: track.kind || "",
                    vssId: track.vssId || "",
                };
            }
        } catch (_) {}
        return null;
    }

    function isYouTubeShorts() {
        return (
            window.location.pathname.includes("/shorts/") ||
            !!document.querySelector("ytd-shorts, ytd-reel-video-renderer")
        );
    }

    function isCaptionsButtonActive() {
        const player = getYouTubePlayer();
        const btn =
            player?.querySelector?.(".ytp-subtitles-button") ||
            document.querySelector(".ytp-subtitles-button");
        if (!btn) return null;
        return (
            btn.getAttribute("aria-pressed") === "true" ||
            btn.classList.contains("ytp-button-active")
        );
    }

    function isCcEnabled() {
        if (isYouTubeShorts()) return true;
        const btnActive = isCaptionsButtonActive();
        if (btnActive !== null) {
            return btnActive;
        }
        // If button is not in DOM yet, fallback to player method if available, otherwise default to false
        const player = getYouTubePlayer();
        try {
            if (typeof player?.isSubtitlesOn === "function") {
                return !!player.isSubtitlesOn();
            }
        } catch (_) {}
        return false;
    }

    function notifyTracksAvailable() {
        const videoId = getCurrentVideoId();
        const tracks = extractCaptionTracks();
        const activeTrack = getActiveTrack();
        const isCcActive = isCcEnabled();
        const isShorts = isYouTubeShorts();

        window.dispatchEvent(
            new CustomEvent(TRACKS_EVENT, {
                detail: { videoId, tracks, activeTrack, isCcActive, isShorts },
            }),
        );
    }

    function checkVideoChange() {
        const newId = getCurrentVideoId();
        if (newId && newId !== currentVideoId) {
            currentVideoId = newId;
            window.dispatchEvent(
                new CustomEvent(NAV_EVENT, {
                    detail: { videoId: newId },
                }),
            );
            setTimeout(notifyTracksAvailable, 100);
            setTimeout(notifyTracksAvailable, 600);
        }
    }

    // Observe CC button toggles and shortcut key 'c'
    let ccBtnObserver = null;
    function observeCcButton() {
        const player = getYouTubePlayer();
        const btn =
            player?.querySelector?.(".ytp-subtitles-button") ||
            document.querySelector(".ytp-subtitles-button");
        if (btn && (!ccBtnObserver || !ccBtnObserver._target || ccBtnObserver._target !== btn)) {
            ccBtnObserver?.disconnect?.();
            ccBtnObserver = new MutationObserver(() => {
                notifyTracksAvailable();
            });
            ccBtnObserver._target = btn;
            ccBtnObserver.observe(btn, {
                attributes: true,
                attributeFilter: ["aria-pressed", "class"],
            });
        }
    }

    document.addEventListener("click", (e) => {
        if (e.target?.closest?.(".ytp-subtitles-button")) {
            setTimeout(notifyTracksAvailable, 50);
            setTimeout(notifyTracksAvailable, 250);
        }
    }, true);

    document.addEventListener("keydown", (e) => {
        const tag = e.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
        if (e.key === "c" || e.key === "C") {
            setTimeout(notifyTracksAvailable, 50);
            setTimeout(notifyTracksAvailable, 250);
        }
    }, true);

    // ── Intercept timedtext Network Requests ──────────────────────

    // Intercept fetch
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);
            try {
                const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";
                if (requestUrl.includes("/api/timedtext")) {
                    const clone = response.clone();
                    clone.text().then((text) => {
                        if (text) {
                            window.dispatchEvent(
                                new CustomEvent(TIMED_TEXT_EVENT, {
                                    detail: {
                                        url: requestUrl,
                                        text,
                                        videoId: getCurrentVideoId(),
                                    },
                                }),
                            );
                        }
                    }).catch(() => {});
                }
            } catch (_) {}
            return response;
        };
    }

    // Intercept XMLHttpRequest
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__lectoro_url = typeof url === "string" ? url : "";
        return originalXhrOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
        if (this.__lectoro_url && this.__lectoro_url.includes("/api/timedtext")) {
            this.addEventListener("load", () => {
                try {
                    const text = this.responseText;
                    if (text) {
                        window.dispatchEvent(
                            new CustomEvent(TIMED_TEXT_EVENT, {
                                detail: {
                                    url: this.__lectoro_url,
                                    text,
                                    videoId: getCurrentVideoId(),
                                },
                            }),
                        );
                    }
                } catch (_) {}
            });
        }
        return originalXhrSend.apply(this, args);
    };

    // ── Event Handlers from Content Script ────────────────────────

    window.addEventListener(TRACK_REQUEST_EVENT, (event) => {
        const requestId = event?.detail?.requestId;
        const videoId = getCurrentVideoId();
        const tracks = extractCaptionTracks();
        const activeTrack = getActiveTrack();
        const isCcActive = isCcEnabled();
        const isShorts = isYouTubeShorts();

        window.dispatchEvent(
            new CustomEvent(TRACK_RESPONSE_EVENT, {
                detail: { requestId, videoId, tracks, activeTrack, isCcActive, isShorts },
            }),
        );
    });

    window.addEventListener(FETCH_REQUEST_EVENT, async (event) => {
        const { requestId, url } = event?.detail || {};
        if (!requestId || !url) return;

        try {
            const res = await fetch(url, { credentials: "include" });
            const text = await res.text();
            window.dispatchEvent(
                new CustomEvent(FETCH_RESPONSE_EVENT, {
                    detail: { requestId, text, ok: res.ok },
                }),
            );
        } catch (error) {
            window.dispatchEvent(
                new CustomEvent(FETCH_RESPONSE_EVENT, {
                    detail: { requestId, text: "", ok: false, error: String(error) },
                }),
            );
        }
    });

    window.addEventListener(SEEK_EVENT, (event) => {
        const targetSeconds = Number(event?.detail?.targetSeconds);
        if (!Number.isFinite(targetSeconds)) return;
        const player = getYouTubePlayer();
        if (typeof player?.seekTo === "function") {
            player.seekTo(targetSeconds, true);
        }
    });

    window.addEventListener(PAUSE_EVENT, () => {
        const player = getYouTubePlayer();
        if (typeof player?.pauseVideo === "function") {
            player.pauseVideo();
        }
    });

    window.addEventListener(PLAY_EVENT, () => {
        const player = getYouTubePlayer();
        if (typeof player?.playVideo === "function") {
            player.playVideo();
        }
    });

    // ── YouTube SPA Navigation Observers ──────────────────────────

    function onYouTubeNavigation() {
        checkVideoChange();
        setTimeout(observeCcButton, 400);
    }

    window.addEventListener("yt-navigate-finish", onYouTubeNavigation, { passive: true });
    window.addEventListener("yt-page-data-updated", onYouTubeNavigation, { passive: true });
    window.addEventListener("spfdone", onYouTubeNavigation, { passive: true });
    window.addEventListener("popstate", onYouTubeNavigation, { passive: true });

    // Initial check
    currentVideoId = getCurrentVideoId();
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            setTimeout(() => {
                observeCcButton();
                notifyTracksAvailable();
            }, 300);
        });
    } else {
        setTimeout(() => {
            observeCcButton();
            notifyTracksAvailable();
        }, 100);
    }
})();
