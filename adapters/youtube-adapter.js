/**
 * Lectoro – YouTube Player Caption Adapter & Controller (Single Source of Truth)
 * Dual-source engine: direct timedtext API extraction (with full sentence reconstruction
 * for dynamic/ASR subtitles), sub-frame playback sync, A/D timeline sentence seeking,
 * and high-fidelity DOM observer fallback with uniform Lectoro subtitle styling.
 */
(() => {
    "use strict";

    const HOST_RE = /(^|\.)youtube\.com$/i;
    const EVT = (typeof LectoroConstants !== "undefined" && LectoroConstants.EVENT_NAMES) || {};
    const TIMED_TEXT_EVENT = EVT.YOUTUBE_TIMED_TEXT || "__lectoro_youtube_timed_text";
    const TRACKS_EVENT = EVT.YOUTUBE_TRACKS_AVAILABLE || "__lectoro_youtube_tracks_available";
    const TRACK_REQUEST_EVENT = EVT.YOUTUBE_TRACK_REQUEST || "__lectoro_youtube_track_request";
    const TRACK_RESPONSE_EVENT = EVT.YOUTUBE_TRACK_RESPONSE || "__lectoro_youtube_track_response";
    const FETCH_REQUEST_EVENT = EVT.YOUTUBE_FETCH_REQUEST || "__lectoro_youtube_fetch_request";
    const FETCH_RESPONSE_EVENT = EVT.YOUTUBE_FETCH_RESPONSE || "__lectoro_youtube_fetch_response";
    const SEEK_EVENT = EVT.YOUTUBE_SEEK || "__lectoro_youtube_seek";
    const PAUSE_EVENT = EVT.YOUTUBE_PAUSE || "__lectoro_youtube_pause";
    const PLAY_EVENT = EVT.YOUTUBE_PLAY || "__lectoro_youtube_play";
    const NAV_EVENT = EVT.YOUTUBE_NAVIGATION || "__lectoro_youtube_navigation";

    let cueIndex = [];
    let currentVideoId = "";
    let currentDisplayedText = "";
    let availableTracks = [];
    let activeTrack = null;
    let isFetchingTrack = false;
    let playbackRafId = null;
    let boundVideo = null;
    let trackRequestSeq = 0;
    let isCcActive = false;

    function getSubtitleService() {
        return (
            globalThis.SharedSubtitleService ||
            globalThis.LectoroSubtitleService
        );
    }

    function isPage() {
        return HOST_RE.test(window.location.hostname);
    }

    function isShortsPage(video = null) {
        if (typeof window !== "undefined" && window.location.pathname.includes("/shorts/")) {
            return true;
        }
        if (video && video.closest?.("ytd-shorts, ytd-reel-video-renderer, #shorts-player")) {
            return true;
        }
        return !!document.querySelector("ytd-shorts, ytd-reel-video-renderer");
    }

    function isPreviewVideo(video) {
        if (!video) return false;
        if (isShortsPage(video)) return false;
        if (
            video.closest?.(
                "ytd-thumbnail, ytd-video-preview, ytd-inline-preview-renderer, #inline-preview-player, ytd-rich-grid-row #preview, ytd-rich-item-renderer #preview, ytd-compact-video-renderer #preview",
            )
        ) {
            return true;
        }
        if (
            typeof window !== "undefined" &&
            !window.location.pathname.startsWith("/watch") &&
            !window.location.pathname.startsWith("/shorts") &&
            !window.location.pathname.startsWith("/embed") &&
            !video.closest?.("#movie_player")
        ) {
            return true;
        }
        return false;
    }

    function checkIsCcActive(video = null) {
        if (isShortsPage(video)) return true;
        if (isPreviewVideo(video)) return false;
        const player =
            video?.closest?.("#movie_player, .html5-video-player") ||
            document.getElementById("movie_player") ||
            document;
        const ccBtn = player.querySelector?.(".ytp-subtitles-button");
        if (ccBtn) {
            const active = (
                ccBtn.getAttribute("aria-pressed") === "true" ||
                ccBtn.classList.contains("ytp-button-active")
            );
            isCcActive = active;
            return active;
        }
        return isCcActive;
    }

    function getVideoIdFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const v = params.get("v");
            if (v) return v;
        } catch (_) {}

        const shortsMatch = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (shortsMatch) return shortsMatch[1];

        const embedMatch = window.location.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        if (embedMatch) return embedMatch[1];

        return "";
    }

    // ── Cue Indexing & Binary Search ──────────────────────────────

    function setCueIndex(cues, videoId = "") {
        if (!Array.isArray(cues) || cues.length === 0) return;
        cueIndex = cues;
        if (videoId) currentVideoId = videoId;
        currentDisplayedText = "";

        const video = boundVideo || document.querySelector("video");
        if (video) syncActiveCue(video);
    }

    function findActiveCue(currentTime) {
        if (!cueIndex || cueIndex.length === 0) return null;

        let low = 0;
        let high = cueIndex.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const cue = cueIndex[mid];

            if (currentTime >= cue.startTime && currentTime <= cue.endTime) {
                return cue;
            }
            if (currentTime < cue.startTime) {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        // Neighborhood tolerance check (±0.05s) to prevent sub-frame flickering without bleeding into gaps
        const start = Math.max(0, high - 1);
        const end = Math.min(cueIndex.length - 1, low + 1);
        for (let i = start; i <= end; i++) {
            const cue = cueIndex[i];
            if (currentTime >= cue.startTime - 0.05 && currentTime <= cue.endTime + 0.05) {
                return cue;
            }
        }

        return null;
    }

    function getDomSubtitleText() {
        const container = document.querySelector(".ytp-caption-window-container");
        if (!container) return "";
        const cleanFn = (t) => {
            const service = getSubtitleService();
            if (service && service.cleanCueText) return service.cleanCueText(t);
            return String(t || "")
                .replace(/(?:^|\s)(?:>>+|<<+|»+|«+|››+)(?:\s|$)/g, " ")
                .replace(/^[>»›<«\s—–-]+/, "")
                .replace(/\s+/g, " ")
                .trim();
        };

        const lines = Array.from(container.querySelectorAll(".caption-visual-line"));
        if (lines.length > 0) {
            const texts = lines
                .map((l) => cleanFn((l.textContent || "").replace(/\s+/g, " ").trim()))
                .filter(Boolean);
            return Array.from(new Set(texts)).join(" ").trim();
        }
        const segments = Array.from(container.querySelectorAll(".ytp-caption-segment"));
        if (segments.length > 0) {
            const raw = segments
                .map((s) => s.textContent || "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            return cleanFn(raw);
        }
        return "";
    }

    function syncActiveCue(video) {
        if (!video || !video.isConnected) return;

        // Subtitles only display if CC is actively enabled (or on YouTube Shorts)
        if (!checkIsCcActive(video)) {
            if (currentDisplayedText !== "" || (globalThis.LectoroSubtitleOverlay?.getActiveLines?.()?.length > 0)) {
                currentDisplayedText = "";
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            }
            return;
        }

        const time = video.currentTime;
        let targetText = "";

        if (cueIndex.length > 0) {
            const activeCue = findActiveCue(time);
            if (activeCue && activeCue.text) {
                targetText = activeCue.text;
            }
        } else {
            // Fallback to DOM player text ONLY if timedtext has not loaded
            const domText = getDomSubtitleText();
            if (domText) targetText = domText;
        }

        const overlayText = globalThis.LectoroSubtitleOverlay?.getActiveText?.() ?? "";
        if (targetText !== currentDisplayedText || (targetText && overlayText !== targetText)) {
            currentDisplayedText = targetText;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles(
                    targetText ? [targetText] : [],
                );
            }
        }
    }

    function startPlaybackLoop(video) {
        if (!video || isPreviewVideo(video)) return;
        stopPlaybackLoop();

        function step() {
            if (!video.paused && !video.ended) {
                syncActiveCue(video);
                playbackRafId = requestAnimationFrame(step);
            } else {
                playbackRafId = null;
            }
        }

        playbackRafId = requestAnimationFrame(step);
    }

    function stopPlaybackLoop() {
        if (playbackRafId !== null) {
            cancelAnimationFrame(playbackRafId);
            playbackRafId = null;
        }
    }

    function bindVideoEvents(video) {
        if (!video || boundVideo === video || isPreviewVideo(video)) return;
        boundVideo = video;

        video.addEventListener("play", () => {
            if (cueIndex.length === 0 && checkIsCcActive(video)) {
                requestTracklistFromBridge();
            }
            startPlaybackLoop(video);
        });
        video.addEventListener("pause", () => {
            stopPlaybackLoop();
            syncActiveCue(video);
        });
        video.addEventListener("timeupdate", () => {
            syncActiveCue(video);
        });
        video.addEventListener("seeked", () => {
            syncActiveCue(video);
        });
    }

    // ── Track Selection & Multi-Format Timedtext Fetching ─────────

    function selectBestCaptionTrack(tracks, preferredLang = "") {
        if (!Array.isArray(tracks) || tracks.length === 0) return null;

        const lang = (preferredLang || "").toLowerCase();

        // 1. Exact match for preferred language (manual track)
        if (lang) {
            const prefManual = tracks.find(
                (t) =>
                    t.kind !== "asr" &&
                    (t.languageCode?.toLowerCase() === lang ||
                     t.vssId?.toLowerCase()?.includes(`.${lang}`)),
            );
            if (prefManual) return prefManual;
        }

        // 2. Exact match for preferred language (ASR track)
        if (lang) {
            const prefAsr = tracks.find(
                (t) =>
                    t.kind === "asr" &&
                    (t.languageCode?.toLowerCase() === lang ||
                     t.vssId?.toLowerCase()?.includes(`.${lang}`)),
            );
            if (prefAsr) return prefAsr;
        }

        // 3. English manual track
        const enManual = tracks.find(
            (t) =>
                t.kind !== "asr" &&
                (t.languageCode?.toLowerCase() === "en" ||
                 t.vssId?.toLowerCase()?.includes(".en")),
        );
        if (enManual) return enManual;

        // 4. Any manual track
        const anyManual = tracks.find((t) => t.kind !== "asr");
        if (anyManual) return anyManual;

        // 5. English ASR track
        const enAsr = tracks.find(
            (t) =>
                t.kind === "asr" &&
                (t.languageCode?.toLowerCase() === "en" ||
                 t.vssId?.toLowerCase()?.includes(".en")),
        );
        if (enAsr) return enAsr;

        // 6. Any available track (including dynamic ASR)
        return tracks[0];
    }

    async function fetchTimedTextViaBridge(url) {
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        return new Promise((resolve) => {
            const onResponse = (event) => {
                if (event?.detail?.requestId === requestId) {
                    window.removeEventListener(FETCH_RESPONSE_EVENT, onResponse);
                    clearTimeout(timer);
                    resolve(event.detail.text || "");
                }
            };
            const timer = setTimeout(() => {
                window.removeEventListener(FETCH_RESPONSE_EVENT, onResponse);
                resolve("");
            }, 6000);

            window.addEventListener(FETCH_RESPONSE_EVENT, onResponse);
            window.dispatchEvent(
                new CustomEvent(FETCH_REQUEST_EVENT, {
                    detail: { requestId, url },
                }),
            );
        });
    }

    async function loadCaptionTrack(track, videoId = "") {
        if (!track || !track.baseUrl || isFetchingTrack) return;
        isFetchingTrack = true;

        try {
            const service = getSubtitleService();
            const baseUrl = track.baseUrl;
            const sep = baseUrl.includes("?") ? "&" : "?";

            // Candidate URLs in priority order
            const candidateUrls = [
                baseUrl.includes("fmt=") ? baseUrl : `${baseUrl}${sep}fmt=json3`,
                baseUrl.includes("fmt=") ? baseUrl.replace(/fmt=[^&]+/, "fmt=vtt") : `${baseUrl}${sep}fmt=vtt`,
                baseUrl.includes("fmt=") ? baseUrl.replace(/fmt=[^&]+/, "fmt=srv3") : `${baseUrl}${sep}fmt=srv3`,
                baseUrl.replace(/[?&]fmt=[^&]+/, ""),
            ];

            let loadedCues = [];

            for (const url of candidateUrls) {
                if (!url) continue;

                // 1. Try bridge fetch in MAIN world (authenticated session)
                let text = await fetchTimedTextViaBridge(url);

                // 2. Direct fetch fallback
                if (!text) {
                    try {
                        const res = await fetch(url, { credentials: "include" });
                        if (res.ok) text = await res.text();
                    } catch (_) {}
                }

                if (text && service) {
                    const cues = service.parseTimedText(text);
                    if (cues.length > 0) {
                        loadedCues = cues;
                        break;
                    }
                }
            }

            if (loadedCues.length > 0) {
                activeTrack = track;
                setCueIndex(loadedCues, videoId || currentVideoId);
            }
        } catch (error) {
            console.warn("[Lectoro] Failed to load YouTube caption track:", error);
        } finally {
            isFetchingTrack = false;
        }
    }

    function requestTracklistFromBridge() {
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        const timer = setTimeout(() => {
            window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
        }, 3000);

        function onResponse(event) {
            if (event?.detail?.requestId === requestId) {
                clearTimeout(timer);
                window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
                handleTracksAvailable(event.detail);
            }
        }

        window.addEventListener(TRACK_RESPONSE_EVENT, onResponse);
        window.dispatchEvent(
            new CustomEvent(TRACK_REQUEST_EVENT, {
                detail: { requestId },
            }),
        );
    }

    function handleTracksAvailable(detail) {
        if (!detail) return;
        const videoId = detail.videoId || getVideoIdFromUrl();
        const tracks = detail.tracks;
        const isShorts = detail.isShorts || isShortsPage();
        const ccState = isShorts
            ? true
            : (typeof detail.isCcActive === "boolean"
                ? detail.isCcActive
                : checkIsCcActive());
        isCcActive = ccState;

        if (!ccState) {
            currentDisplayedText = "";
            activeTrack = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
            stopPlaybackLoop();
            return;
        }

        if (Array.isArray(tracks) && tracks.length > 0) {
            availableTracks = tracks;
            const chosen = detail.activeTrack || selectBestCaptionTrack(tracks);
            if (chosen && (!activeTrack || chosen.vssId !== activeTrack.vssId || videoId !== currentVideoId)) {
                loadCaptionTrack(chosen, videoId);
            }
            const video = boundVideo || document.querySelector("video");
            if (video && !video.paused) startPlaybackLoop(video);
        }
    }

    // ── Direct Content-Script Observer for CC Button (Instant SSOT sync) ──
    let contentCcObserver = null;
    function syncCcButtonState() {
        const video = boundVideo || document.querySelector("video");
        const active = checkIsCcActive(video);
        if (active !== isCcActive) {
            isCcActive = active;
            if (!active) {
                currentDisplayedText = "";
                activeTrack = null;
                stopPlaybackLoop();
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            } else {
                if (cueIndex.length === 0) {
                    requestTracklistFromBridge();
                } else if (video) {
                    syncActiveCue(video);
                    if (!video.paused) startPlaybackLoop(video);
                }
            }
        }
    }

    function observeContentCcButton() {
        const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
        const btn = player?.querySelector?.(".ytp-subtitles-button") || document.querySelector(".ytp-subtitles-button");
        if (btn && (!contentCcObserver || contentCcObserver._target !== btn)) {
            contentCcObserver?.disconnect?.();
            contentCcObserver = new MutationObserver(() => syncCcButtonState());
            contentCcObserver._target = btn;
            contentCcObserver.observe(btn, {
                attributes: true,
                attributeFilter: ["aria-pressed", "class"],
            });
            syncCcButtonState();
        }
    }

    document.addEventListener("click", (e) => {
        if (e.target?.closest?.(".ytp-subtitles-button")) {
            setTimeout(syncCcButtonState, 50);
            setTimeout(syncCcButtonState, 200);
        }
    }, true);

    document.addEventListener("keydown", (e) => {
        const tag = e.target?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
        if (e.key === "c" || e.key === "C") {
            setTimeout(syncCcButtonState, 50);
            setTimeout(syncCcButtonState, 200);
        }
    }, true);

    // ── Bridge Event Listeners ────────────────────────────────────

    window.addEventListener(TIMED_TEXT_EVENT, (event) => {
        const detail = event?.detail;
        if (!detail || !detail.text) return;

        const service = getSubtitleService();
        const cues = service ? service.parseTimedText(detail.text) : [];
        if (cues.length > 0) {
            setCueIndex(cues, detail.videoId || currentVideoId);
        }
    });

    window.addEventListener(TRACKS_EVENT, (event) => {
        handleTracksAvailable(event?.detail);
    });

    window.addEventListener(NAV_EVENT, (event) => {
        const newVideoId = event?.detail?.videoId || getVideoIdFromUrl();
        if (newVideoId !== currentVideoId) {
            currentVideoId = newVideoId;
            cueIndex = [];
            currentDisplayedText = "";
            activeTrack = null;
            availableTracks = [];
            stopPlaybackLoop();
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
            requestTracklistFromBridge();
            setTimeout(observeContentCcButton, 300);
        }
    });

    // Initial check on load
    setTimeout(() => {
        currentVideoId = getVideoIdFromUrl();
        observeContentCcButton();
        requestTracklistFromBridge();
        const video = document.querySelector("video");
        if (video) bindVideoEvents(video);
    }, 400);

    // ── Navigation & Player Control ───────────────────────────────

    function requestSeek(targetSeconds, videoFallback = null) {
        if (!Number.isFinite(targetSeconds)) return;
        const target = Math.max(0, targetSeconds);

        window.dispatchEvent(
            new CustomEvent(SEEK_EVENT, {
                detail: { targetSeconds: target },
            }),
        );

        const video =
            videoFallback instanceof HTMLVideoElement
                ? videoFallback
                : boundVideo || document.querySelector("video");
        if (video && Math.abs(video.currentTime - target) > 0.3) {
            try {
                video.currentTime = target;
                if (video.paused) video.play?.().catch?.(() => {});
            } catch (_) {}
        }
    }

    function pauseVideo(videoFallback = null) {
        window.dispatchEvent(new CustomEvent(PAUSE_EVENT));
        const video =
            videoFallback instanceof HTMLVideoElement
                ? videoFallback
                : boundVideo || document.querySelector("video");
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
                : boundVideo || document.querySelector("video");
        if (video && video.paused) {
            try {
                video.play()?.catch?.(() => {});
            } catch (_) {}
        }
    }

    async function getAdjacentSubtitleTime(video, direction) {
        const targetVideo =
            video instanceof HTMLVideoElement
                ? video
                : boundVideo || document.querySelector("video");
        if (!targetVideo) return null;

        bindVideoEvents(targetVideo);

        if (cueIndex.length > 0) {
            const service = getSubtitleService();
            if (service?.findAdjacentCueTime) {
                return service.findAdjacentCueTime(
                    cueIndex,
                    targetVideo.currentTime,
                    direction,
                );
            }
        }

        return null;
    }

    // ── YouTube Adapter Export ────────────────────────────────────

    const YouTubeAdapter = {
        id: "youtube",
        name: "YouTube",
        playerSelector: "#movie_player, .html5-video-player, ytd-shorts",
        containerSelector: ".ytp-caption-window-container",
        cueSelector: ".caption-visual-line, .ytp-caption-segment",
        leafOnly: false,
        isPage,
        isShortsPage,
        isPreview: (video) => isPreviewVideo(video),
        isCcActive: (video) => checkIsCcActive(video),
        matchVideo: (video) =>
            !isPreviewVideo(video) &&
            !!(video?.closest?.("#movie_player, .html5-video-player") || isShortsPage(video)),
        getContainer: (video) => {
            if (video) bindVideoEvents(video);
            return (
                video?.closest?.("#movie_player, .html5-video-player") ||
                document
            ).querySelector(".ytp-caption-window-container");
        },
        getCueElements: (container) => {
            if (!container || !container.isConnected) return [];
            const visualLines = Array.from(
                container.querySelectorAll(".caption-visual-line"),
            );
            if (visualLines.length > 0) {
                return (
                    globalThis.LectoroBaseAdapter?.filterCueCandidates ||
                    ((x) => x)
                )(visualLines);
            }
            const segments = Array.from(
                container.querySelectorAll(".ytp-caption-segment"),
            );
            return (
                globalThis.LectoroBaseAdapter?.filterCueCandidates ||
                ((x) => x)
            )(segments);
        },
        hasTimedText: () => cueIndex.length > 0 && checkIsCcActive(boundVideo || document.querySelector("video")),
        getCueIndex: () => (checkIsCcActive(boundVideo || document.querySelector("video")) ? cueIndex : []),
        getAllCues: () => (checkIsCcActive(boundVideo || document.querySelector("video")) ? cueIndex : []),
        getCurrentSubtitleText: (video) => {
            if (!checkIsCcActive(video)) return "";
            const time = video?.currentTime ?? (boundVideo?.currentTime || 0);
            const cue = findActiveCue(time);
            if (cue && cue.text) return cue.text;
            return getDomSubtitleText();
        },
        getAdjacentSubtitleTime,
        requestSeek,
        pauseVideo,
        playVideo,
        setCueIndex,
        loadCaptionTrack,
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
