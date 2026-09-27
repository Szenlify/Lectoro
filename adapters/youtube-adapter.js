/**
 * Lectoro – YouTube Player Caption Adapter & Controller (Single Source of Truth)
 * Official timedtext extraction with Master-owned bilingual cues,
 * sub-frame playback sync, A/D timeline sentence seeking,
 * and high-fidelity DOM observer fallback with uniform Lectoro subtitle styling.
 */
(() => {
    "use strict";

    const HOST_RE = /(^|\.)youtube\.com$/i;
    const EVT = LectoroConstants.EVENT_NAMES;
    const TIMED_TEXT_EVENT = EVT.YOUTUBE_TIMED_TEXT;
    const TRACKS_EVENT = EVT.YOUTUBE_TRACKS_AVAILABLE;
    const TRACK_REQUEST_EVENT = EVT.YOUTUBE_TRACK_REQUEST;
    const TRACK_RESPONSE_EVENT = EVT.YOUTUBE_TRACK_RESPONSE;
    const FETCH_REQUEST_EVENT = EVT.YOUTUBE_FETCH_REQUEST;
    const FETCH_RESPONSE_EVENT = EVT.YOUTUBE_FETCH_RESPONSE;
    const SET_TRACK_EVENT = EVT.YOUTUBE_SET_TRACK || "__lectoro_youtube_set_track";
    const SEEK_EVENT = EVT.YOUTUBE_SEEK;
    const PAUSE_EVENT = EVT.YOUTUBE_PAUSE;
    const PLAY_EVENT = EVT.YOUTUBE_PLAY;
    const NAV_EVENT = EVT.YOUTUBE_NAVIGATION;

    let cueIndex = [];
    let cueMaxEnd = [];
    let currentVideoId = "";
    let currentDisplayedText = "";
    let availableTracks = [];
    let activeTrack = null;
    let captionGeneration = 0;
    let pendingTrackKey = "";
    let currentDisplayedCue = null;
    const pendingFetches = new Set();
    let playbackRafId = null;
    let boundVideo = null;
    let boundVideoCleanup = null;
    let trackRequestSeq = 0;
    let pendingTracklistCancel = null;
    let navigationInProgress = false;
    const captionBootstrapTimers = new Set();
    let isCcActive = false;
    let youtubeFocusModeActive = false;

    let captionStatusEl = null;
    let captionStatusKey = "";
    let captionStatusVideo = "";
    const dismissedCaptionStatuses = new Set();

    function clearCaptionStatus(reset = false) {
        captionStatusEl?.remove();
        captionStatusEl = null;
        captionStatusKey = "";
        if (reset) dismissedCaptionStatuses.clear();
    }

    function showCaptionStatus(key) {
        if (!isPage() || !checkIsCcActive(boundVideo)) return;
        const videoId = getVideoIdFromUrl();
        if (captionStatusVideo !== videoId) {
            clearCaptionStatus(true);
            captionStatusVideo = videoId;
        }
        if (dismissedCaptionStatuses.has(key)) return;
        const parent = document.fullscreenElement ||
            boundVideo?.closest?.("#movie_player, .html5-video-player") ||
            document.getElementById("movie_player");
        if (!parent) return;
        if (captionStatusKey === key && captionStatusEl) {
            if (captionStatusEl.parentElement !== parent) parent.appendChild(captionStatusEl);
            return;
        }
        clearCaptionStatus();
        const notice = document.createElement("div");
        notice.className = "__qt_youtube-caption-status";
        const message = document.createElement("div");
        message.setAttribute("role", "status");
        message.setAttribute("aria-live", "polite");
        message.textContent = SharedI18n.t(key);
        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.setAttribute("aria-label", SharedI18n.t("video_toast_close"));
        close.addEventListener("click", event => {
            event.stopPropagation();
            dismissedCaptionStatuses.add(key);
            clearCaptionStatus();
        });
        notice.appendChild(message);
        notice.appendChild(close);
        parent.appendChild(notice);
        captionStatusEl = notice;
        captionStatusKey = key;
    }

    function reportFocusUnavailable() {
        // A fetch error gives the more useful recovery action; don't overwrite it.
        if (captionStatusKey === "youtube_captions_load_failed") return;
        showCaptionStatus("youtube_focus_unavailable");
    }

    function reportFocusAvailable() {
        if (captionStatusKey === "youtube_focus_unavailable") clearCaptionStatus();
    }

    document.addEventListener("fullscreenchange", () => {
        if (captionStatusKey) showCaptionStatus(captionStatusKey);
    });

    const ytFocusKey =
        globalThis.LectoroConstants?.STORAGE_KEYS?.YOUTUBE_FOCUS_MODE ||
        "youtubeFocusMode";

    function isFocusModeEnabled() {
        return Boolean(
            youtubeFocusModeActive ||
            globalThis.LectoroSubtitleOverlay?.isFocusModeActive?.(),
        );
    }

    if (typeof chrome !== "undefined" && chrome?.storage?.local?.get) {
        chrome.storage.local.get({ [ytFocusKey]: false }, (data) => {
            if (data && typeof data[ytFocusKey] === "boolean") {
                youtubeFocusModeActive = data[ytFocusKey];
                applyFocusTrackPreference();
            }
        });

        chrome.storage.onChanged?.addListener((changes, area) => {
            if (area === "local" && changes[ytFocusKey]) {
                const newVal = Boolean(changes[ytFocusKey].newValue);
                if (newVal !== youtubeFocusModeActive) {
                    youtubeFocusModeActive = newVal;
                    if (!newVal && captionStatusKey === "youtube_focus_unavailable") clearCaptionStatus();
                    applyFocusTrackPreference();
                }
            }
        });
    }

    function applyFocusTrackPreference() {
        if (!youtubeFocusModeActive || !isCcActive || availableTracks.length === 0) return;
        const chosen = selectBestCaptionTrack(availableTracks, activeTrack?.languageCode, true);
        if (!chosen || !(chosen.kind === "asr" || chosen.vssId?.startsWith("a."))) return;
        if (!activeTrack || chosen.baseUrl !== activeTrack.baseUrl) {
            loadCaptionTrack(chosen, currentVideoId || getVideoIdFromUrl());
            dispatchSetTrackToBridge(chosen);
        }
    }

    function dispatchSetTrackToBridge(track) {
        if (!track) return;
        window.dispatchEvent(
            new CustomEvent(SET_TRACK_EVENT, {
                detail: {
                    track: {
                        languageCode: track.languageCode,
                        kind: track.kind || "",
                        vssId: track.vssId || "",
                    },
                },
            }),
        );
    }

    function getSubtitleService() {
        return globalThis.SharedSubtitleService;
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
            return active;
        }
        return isCcActive;
    }

    function getVideoIdFromUrl() {
        if (typeof window === "undefined" || !window?.location) return "";
        try {
            const params = new URLSearchParams(window.location.search);
            const v = params.get("v");
            if (v) return v;
        } catch (_) {}

        try {
            const shortsMatch = window.location.pathname?.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
            if (shortsMatch) return shortsMatch[1];

            const embedMatch = window.location.pathname?.match(/\/embed\/([a-zA-Z0-9_-]+)/);
            if (embedMatch) return embedMatch[1];
        } catch (_) {}

        return "";
    }

    // ── Cue Indexing & Binary Search ──────────────────────────────

    function setCueIndex(cues, videoId = "", language = "") {
        if (!Array.isArray(cues) || cues.length === 0) return;
        cues = getSubtitleService()?.normalizeCueSentenceCase?.(cues, language) || cues;
        cues = getSubtitleService()?.mergeShortCues?.(cues) || cues;
        cueIndex = cues;
        let maxEnd = -Infinity;
        cueMaxEnd = cues.map((cue) => (maxEnd = Math.max(maxEnd, cue.endTime)));
        if (videoId) currentVideoId = videoId;
        currentDisplayedText = "";
        currentDisplayedCue = null;

        const video = boundVideo || document.querySelector("video");
        if (video) syncActiveCue(video);
    }

    function findActiveCue(currentTime) {
        // Half-open Master intervals: both lines disappear at the exact end time.
        let low = 0;
        let high = cueIndex.length - 1;
        while (low <= high) {
            const mid = (low + high) >> 1;
            if (cueIndex[mid].startTime <= currentTime) low = mid + 1;
            else high = mid - 1;
        }
        for (let index = high; index >= 0; index--) {
            if (cueMaxEnd[index] <= currentTime) break;
            const cue = cueIndex[index];
            if (currentTime < cue.endTime) return cue;
        }
        return null;
    }

    function getDomSubtitleLines() {
        const container = document.querySelector(".ytp-caption-window-container");
        if (!container) return [];
        const cleanFn = (t) => {
            const service = getSubtitleService();
            if (service && service.cleanCueText) return service.cleanCueText(t);
            return String(t || "")
                .replace(/(?:^|\s)(?:>>+|<<+|»+|«+|››+)(?:\s|$)/g, " ")
                .replace(/^[>»›<«\s—–-]+/, "")
                .replace(/\s+/g, " ")
                .trim();
        };

        const normalizeLines = (lines) => {
            const text = lines.join(" ");
            return getSubtitleService()?.normalizeCueSentenceCase?.(
                [{ text, lines }], activeTrack?.languageCode || "",
            )?.[0]?.lines || lines;
        };
        const lines = Array.from(container.querySelectorAll(".caption-visual-line"));
        if (lines.length > 0) {
            return normalizeLines(lines
                .map((l) => cleanFn((l.textContent || "").trim()))
                .filter(Boolean));
        }
        const segments = Array.from(container.querySelectorAll(".ytp-caption-segment"));
        if (segments.length > 0) {
            const raw = segments
                .map((s) => s.textContent || "")
                .join("")
                .trim();
            const cleaned = cleanFn(raw);
            return cleaned ? normalizeLines(cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) : [];
        }
        return [];
    }

    function getDomSubtitleText() {
        return getDomSubtitleLines().join(" ").trim();
    }

    function syncActiveCue(video) {
        if (!video || !video.isConnected) return;

        // Subtitles only display if CC is actively enabled (or on YouTube Shorts)
        if (!checkIsCcActive(video)) {
            if (currentDisplayedText !== "" || (globalThis.LectoroSubtitleOverlay?.getActiveLines?.()?.length > 0)) {
                currentDisplayedText = "";
                currentDisplayedCue = null;
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            }
            return;
        }

        // Subtitles must only display once the video has loaded frame/media data
        if (typeof video.readyState === "number" && video.readyState < 2) {
            if (currentDisplayedText !== "" || (globalThis.LectoroSubtitleOverlay?.getActiveLines?.()?.length > 0)) {
                currentDisplayedText = "";
                currentDisplayedCue = null;
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            }
            return;
        }

        const time = video.currentTime;
        let targetLines = [];
        const activeCue = findActiveCue(time);

        if (cueIndex.length > 0) {
            if (activeCue) {
                if (Array.isArray(activeCue.lines) && activeCue.lines.length > 0) {
                    targetLines = activeCue.lines;
                } else if (activeCue.text) {
                    targetLines = String(activeCue.text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                }
            }
        } else {
            // Fallback to DOM player text ONLY if timedtext has not loaded
            targetLines = getDomSubtitleLines();
        }

        const targetText = targetLines.join("\n");
        const overlayText = globalThis.LectoroSubtitleOverlay?.getActiveText?.() ?? "";
        if (
            targetText !== currentDisplayedText ||
            activeCue !== currentDisplayedCue ||
            (targetText && overlayText !== targetLines.join(" "))
        ) {
            currentDisplayedText = targetText;
            currentDisplayedCue = activeCue;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                const isAsr = Boolean(
                    activeTrack?.kind === "asr" ||
                    activeTrack?.vssId?.startsWith("a.")
                );
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles(
                    targetLines,
                    { cue: activeCue, isAsr },
                );
            }
        }
    }

    function startPlaybackLoop(video) {
        if (!video || isPreviewVideo(video)) return;
        stopPlaybackLoop();

        function step() {
            if (video.isConnected && video === boundVideo && !video.paused && !video.ended) {
                syncActiveCue(video);
                globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
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
        unbindVideoEvents();
        boundVideo = video;
        const listeners = [];
        const listen = (event, handler) => {
            const guardedHandler = () => {
                if (video === boundVideo && video.isConnected) handler();
            };
            video.addEventListener(event, guardedHandler);
            listeners.push([event, guardedHandler]);
        };
        boundVideoCleanup = () => {
            for (const [event, handler] of listeners) video.removeEventListener(event, handler);
        };

        const clearSubtitlesOnLoad = () => {
            currentDisplayedText = "";
            currentDisplayedCue = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
        };

        listen("loadstart", clearSubtitlesOnLoad);
        listen("emptied", clearSubtitlesOnLoad);
        const resume = () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
            if (!video.paused && !video.ended) startPlaybackLoop(video);
            if (cueIndex.length === 0 && checkIsCcActive(video)) requestTracklistFromBridge();
        };
        // YouTube reuses the video element; autoplay may reach `playing`
        // without another `play` event after our navigation cleanup.
        for (const event of ["loadedmetadata", "loadeddata", "canplay", "playing", "play"]) {
            listen(event, resume);
        }

        listen("pause", () => {
            stopPlaybackLoop();
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        listen("timeupdate", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        listen("seeked", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        syncActiveCue(video);
        if (!video.paused && !video.ended) startPlaybackLoop(video);
    }

    function unbindVideoEvents() {
        stopPlaybackLoop();
        boundVideoCleanup?.();
        boundVideoCleanup = null;
        boundVideo = null;
    }

    // ── Track Selection & Multi-Format Timedtext Fetching ─────────

    function selectBestCaptionTrack(tracks, preferredLang = "", preferAsr = false) {
        if (!Array.isArray(tracks) || tracks.length === 0) return null;

        const lang = (preferredLang || "").toLowerCase();

        if (preferAsr) {
            // Prioritize auto-generated (ASR) tracks with word-level timestamps (timelabs)
            // 1. Exact match for preferred language (ASR track)
            if (lang) {
                const prefAsr = tracks.find(
                    (t) =>
                        (t.kind === "asr" || t.vssId?.toLowerCase()?.startsWith("a.")) &&
                        (t.languageCode?.toLowerCase() === lang ||
                         t.vssId?.toLowerCase()?.includes(`.${lang}`)),
                );
                if (prefAsr) return prefAsr;
                // Focus must not silently switch away from the chosen language.
                return tracks.find(t => t.languageCode?.toLowerCase() === lang) || null;
            }

            // 2. English ASR track
            const enAsr = tracks.find(
                (t) =>
                    (t.kind === "asr" || t.vssId?.toLowerCase()?.startsWith("a.")) &&
                    (t.languageCode?.toLowerCase() === "en" ||
                     t.vssId?.toLowerCase()?.includes(".en")),
            );
            if (enAsr) return enAsr;

            // 3. Any available ASR track
            const anyAsr = tracks.find(
                (t) => t.kind === "asr" || t.vssId?.toLowerCase()?.startsWith("a."),
            );
            if (anyAsr) return anyAsr;
        }

        // Standard track selection (or fallback if no ASR tracks exist):
        // 1. Exact match for preferred language (manual track)
        if (lang) {
            const prefManual = tracks.find(
                (t) =>
                    t.kind !== "asr" &&
                    !t.vssId?.toLowerCase()?.startsWith("a.") &&
                    (t.languageCode?.toLowerCase() === lang ||
                     t.vssId?.toLowerCase()?.includes(`.${lang}`)),
            );
            if (prefManual) return prefManual;
        }

        // 2. Exact match for preferred language (ASR track)
        if (lang) {
            const prefAsr = tracks.find(
                (t) =>
                    (t.kind === "asr" || t.vssId?.toLowerCase()?.startsWith("a.")) &&
                    (t.languageCode?.toLowerCase() === lang ||
                     t.vssId?.toLowerCase()?.includes(`.${lang}`)),
            );
            if (prefAsr) return prefAsr;
        }

        // 3. English manual track
        const enManual = tracks.find(
            (t) =>
                t.kind !== "asr" &&
                !t.vssId?.toLowerCase()?.startsWith("a.") &&
                (t.languageCode?.toLowerCase() === "en" ||
                 t.vssId?.toLowerCase()?.includes(".en")),
        );
        if (enManual) return enManual;

        // 4. Any manual track
        const anyManual = tracks.find(
            (t) => t.kind !== "asr" && !t.vssId?.toLowerCase()?.startsWith("a."),
        );
        if (anyManual) return anyManual;

        // 5. English ASR track
        const enAsr = tracks.find(
            (t) =>
                (t.kind === "asr" || t.vssId?.toLowerCase()?.startsWith("a.")) &&
                (t.languageCode?.toLowerCase() === "en" ||
                 t.vssId?.toLowerCase()?.includes(".en")),
        );
        if (enAsr) return enAsr;

        // 6. Any available track (including dynamic ASR)
        return tracks[0];
    }

    function invalidateCaptionRequest() {
        captionGeneration++;
        pendingTracklistCancel?.();
        pendingTrackKey = "";
        for (const cancel of Array.from(pendingFetches)) cancel();
        return captionGeneration;
    }

    function isCurrentRequest(generation, videoId) {
        const pageVideoId = getVideoIdFromUrl();
        return generation === captionGeneration &&
            (!videoId || !pageVideoId || videoId === pageVideoId);
    }

    function fetchTimedTextViaBridge(url) {
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        return new Promise((resolve) => {
            const finish = (result) => {
                window.removeEventListener(FETCH_RESPONSE_EVENT, onResponse);
                clearTimeout(timer);
                pendingFetches.delete(cancel);
                resolve(result);
            };
            const cancel = () => finish({ ok: false, text: "", error: "cancelled" });
            const onResponse = (event) => {
                if (event?.detail?.requestId === requestId) finish(event.detail);
            };
            const timer = setTimeout(() => finish({ ok: false, text: "", error: "timeout" }), 6000);
            pendingFetches.add(cancel);
            window.addEventListener(FETCH_RESPONSE_EVENT, onResponse);
            window.dispatchEvent(new CustomEvent(FETCH_REQUEST_EVENT, {
                detail: { requestId, url },
            }));
        });
    }

    function buildTimedTextUrl(rawBaseUrl, { lang = "", tlang = "", fmt = "json3" } = {}) {
        try {
            const url = new URL(rawBaseUrl, window.location.href);
            if (url.protocol !== "https:" || !HOST_RE.test(url.hostname) || url.pathname !== "/api/timedtext") return "";
            url.searchParams.delete("fmt");
            url.searchParams.delete("tlang");
            if (lang && !url.searchParams.has("lang")) url.searchParams.set("lang", lang);
            if (tlang) url.searchParams.set("tlang", tlang);
            if (fmt) url.searchParams.set("fmt", fmt);
            return url.href;
        } catch (_) {
            return "";
        }
    }

    async function fetchCueCandidates(urls, generation, videoId) {
        const service = getSubtitleService();
        for (const url of new Set(urls.filter(Boolean))) {
            if (!isCurrentRequest(generation, videoId)) return [];
            const result = await fetchTimedTextViaBridge(url);
            if (!isCurrentRequest(generation, videoId)) return [];
            // Never retry a rate limit or transport failure through another format/transport.
            if (!result.ok && (result.status === 429 || result.error || result.status >= 500)) {
                throw new Error(result.error || `HTTP ${result.status}`);
            }
            if (result.ok && result.text && service) {
                const cues = service.parseTimedText(result.text, "", "", { preserveTiming: true, preserveCueBoundaries: true });
                if (cues.length) return cues;
            }
        }
        return [];
    }

    function processCaptionTrack(rawCues, videoId = "", generation = captionGeneration) {
        if (!Array.isArray(rawCues) || !rawCues.length || !isCurrentRequest(generation, videoId)) return;
        const masterCues = rawCues.map((cue) => {
            const rawText = String(cue.text || "");
            const lines = Array.isArray(cue.lines) && cue.lines.length > 0
                ? cue.lines
                : rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            const text = lines.join(" ").trim();
            const res = { ...cue, text, lines };
            if (Array.isArray(cue.segs)) {
                Object.defineProperty(res, "segs", { value: cue.segs, enumerable: false });
            }
            if (cue && cue.tStartMs != null) {
                Object.defineProperty(res, "tStartMs", {
                    value: cue.tStartMs,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            }
            if (cue && cue.dDurationMs != null) {
                Object.defineProperty(res, "dDurationMs", {
                    value: cue.dDurationMs,
                    writable: true,
                    configurable: true,
                    enumerable: false,
                });
            }
            return res;
        });
        clearCaptionStatus();
        setCueIndex(masterCues, videoId, activeTrack?.languageCode || "");
    }

    async function loadCaptionTrack(track, videoId = "") {
        if (!track?.baseUrl) return;
        const key = `${videoId}|${track.baseUrl}`;
        if (pendingTrackKey === key) return;
        const generation = invalidateCaptionRequest();
        pendingTrackKey = key;
        activeTrack = track;
        currentVideoId = videoId || getVideoIdFromUrl();
        cueIndex = [];
        syncActiveCue(boundVideo || document.querySelector("video"));
        if (!isCurrentRequest(generation, videoId)) return;
        try {
            const candidateUrls = ["json3", "vtt", "srv3", ""].map((fmt) => buildTimedTextUrl(track.baseUrl, { fmt }));
            const cues = await fetchCueCandidates(candidateUrls, generation, videoId);
            if (!isCurrentRequest(generation, videoId)) return;
            if (!cues.length) {
                showCaptionStatus("youtube_captions_load_failed");
                return;
            }
            processCaptionTrack(cues, videoId || currentVideoId, generation);
        } catch (error) {
            if (isCurrentRequest(generation, videoId)) {
                showCaptionStatus("youtube_captions_load_failed");
            }
        } finally {
            if (generation === captionGeneration) pendingTrackKey = "";
        }
    }

    function requestTracklistFromBridge() {
        if (navigationInProgress || pendingTracklistCancel) return;
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        const generation = captionGeneration;
        const videoId = getVideoIdFromUrl();
        const timer = setTimeout(() => {
            cancel();
            if (isCurrentRequest(generation, videoId) && !cueIndex.length) {
                showCaptionStatus("youtube_captions_load_failed");
            }
        }, 3000);

        const cancel = () => {
            clearTimeout(timer);
            window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
            if (pendingTracklistCancel === cancel) pendingTracklistCancel = null;
        };
        pendingTracklistCancel = cancel;
        function onResponse(event) {
            if (event?.detail?.requestId === requestId) {
                cancel();
                if (isCurrentRequest(generation, videoId)) handleTracksAvailable(event.detail);
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
        if (!detail || detail.tracksReady === false) return;
        const videoId = detail.videoId || getVideoIdFromUrl();
        if (videoId && getVideoIdFromUrl() && videoId !== getVideoIdFromUrl()) return;
        const tracks = detail.tracks;
        const isShorts = detail.isShorts || isShortsPage();
        const ccState = isShorts
            ? true
            : (typeof detail.isCcActive === "boolean"
                ? detail.isCcActive
                : checkIsCcActive());
        isCcActive = ccState;
        if (!ccState) clearCaptionStatus();

        if (Array.isArray(tracks) && tracks.length === 0) {
            // Transient empty metadata must not cancel an already selected load.
            if (pendingTrackKey) return;
            if (ccState) showCaptionStatus("youtube_captions_unavailable");
            invalidateCaptionRequest();
            cueIndex = [];
            activeTrack = null;
            availableTracks = [];
            globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles?.([]);
            return;
        }
        if (!ccState) {
            invalidateCaptionRequest();
            currentDisplayedText = "";
            currentDisplayedCue = null;
            activeTrack = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
            stopPlaybackLoop();
            return;
        }

        if (Array.isArray(tracks) && tracks.length > 0) {
            availableTracks = tracks;
            const active = detail.activeTrack;
            const focusMode = isFocusModeEnabled();
            const selectedTrack =
                (active && tracks.find((track) =>
                    (active.vssId && track.vssId === active.vssId) ||
                    (track.languageCode === active.languageCode && track.kind === active.kind)
                )) || selectBestCaptionTrack(tracks, active?.languageCode, false);
            const automaticTrack = focusMode
                ? selectBestCaptionTrack(tracks, active?.languageCode, true)
                : null;
            const chosen = automaticTrack &&
                (automaticTrack.kind === "asr" || automaticTrack.vssId?.startsWith("a."))
                ? automaticTrack : selectedTrack;

            if (chosen && (!activeTrack || chosen.baseUrl !== activeTrack.baseUrl || videoId !== currentVideoId)) {
                loadCaptionTrack(chosen, videoId);
                if (focusMode && (chosen.kind === "asr" || chosen.vssId?.startsWith("a."))) {
                    dispatchSetTrackToBridge(chosen);
                }
            }
            const video = boundVideo || document.querySelector("#movie_player video, .html5-video-player video") || document.querySelector("video");
            if (video) {
                bindVideoEvents(video);
                syncActiveCue(video);
                if (!video.paused && !video.ended) startPlaybackLoop(video);
            }
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
                clearCaptionStatus();
                invalidateCaptionRequest();
                currentDisplayedText = "";
                currentDisplayedCue = null;
                activeTrack = null;
                stopPlaybackLoop();
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            } else {
                if (!activeTrack || cueIndex.length === 0) {
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

    function handleTimedText(event) {
        const detail = event?.detail;
        if (!detail?.text || !detail.url || !checkIsCcActive(boundVideo || document.querySelector("video"))) return;
        let source;
        try { source = new URL(detail.url, window.location.href); } catch (_) { return; }
        if (source.searchParams.has("tlang") || !buildTimedTextUrl(detail.url)) return;
        const videoId = source.searchParams.get("v") || detail.videoId || currentVideoId;
        if (videoId && getVideoIdFromUrl() && videoId !== getVideoIdFromUrl()) return;
        if (activeTrack?.languageCode && source.searchParams.get("lang") !== activeTrack.languageCode) return;
        if (activeTrack) {
            const sourceIsAsr = source.searchParams.get("kind") === "asr" ||
                source.searchParams.get("vss_id")?.startsWith("a.");
            const activeIsAsr = activeTrack.kind === "asr" || activeTrack.vssId?.startsWith("a.");
            if (Boolean(sourceIsAsr) !== Boolean(activeIsAsr)) return;
        }
        // The explicit track load owns its response. Late player requests must
        // not replace its JSON3 word clocks with a less detailed format.
        if (pendingTrackKey) return;
        const cues = getSubtitleService()?.parseTimedText(detail.text, "", "", { preserveTiming: true, preserveCueBoundaries: true }) || [];
        const hasWordClocks = items => items.some(cue => Array.isArray(cue.segs) &&
            new Set(cue.segs.filter(seg => /\S/u.test(seg.utf8 || ""))
                .map(seg => seg.tAbsMs ?? seg.tOffsetMs).filter(Number.isFinite)).size > 1);
        if (hasWordClocks(cueIndex) && !hasWordClocks(cues)) return;
        if (cues.length) processCaptionTrack(cues, videoId);
    }

    window.addEventListener(TIMED_TEXT_EVENT, handleTimedText);

    window.addEventListener(TRACKS_EVENT, (event) => {
        handleTracksAvailable(event?.detail);
    });

    function clearCaptionBootstrap() {
        for (const timer of captionBootstrapTimers) clearTimeout(timer);
        captionBootstrapTimers.clear();
    }

    function resetCaptionSession(videoId = "") {
        clearCaptionBootstrap();
        clearCaptionStatus(true);
        invalidateCaptionRequest();
        unbindVideoEvents();
        currentVideoId = videoId;
        currentDisplayedCue = null;
        currentDisplayedText = "";
        cueIndex = [];
        cueMaxEnd = [];
        activeTrack = null;
        availableTracks = [];
        contentCcObserver?.disconnect?.();
        contentCcObserver = null;
        globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles?.([]);
    }

    function refreshCaptionSession() {
        if (navigationInProgress || !isPage()) return;
        const videoId = getVideoIdFromUrl();
        if (!videoId) return;
        if (videoId !== currentVideoId) resetCaptionSession(videoId);
        const video = document.querySelector("#movie_player video, .html5-video-player video") || document.querySelector("video");
        if (video) {
            bindVideoEvents(video);
            syncActiveCue(video);
            if (!video.paused && !video.ended && playbackRafId === null) startPlaybackLoop(video);
        }
        observeContentCcButton();
        if (!activeTrack && !pendingTrackKey && checkIsCcActive(video)) requestTracklistFromBridge();
    }

    function resumeCaptionSession() {
        navigationInProgress = false;
        clearCaptionBootstrap();
        refreshCaptionSession();
        const videoId = getVideoIdFromUrl();
        // Retry local metadata discovery while YouTube creates its new player.
        // This does not retry a failed network fetch or reload an existing track.
        for (const delay of [150, 500, 1200, 2500, 5000]) {
            const timer = setTimeout(() => {
                captionBootstrapTimers.delete(timer);
                if (getVideoIdFromUrl() === videoId) refreshCaptionSession();
            }, delay);
            captionBootstrapTimers.add(timer);
        }
    }

    window.addEventListener(NAV_EVENT, () => {
        if (!navigationInProgress) resumeCaptionSession();
    });
    window.addEventListener("yt-navigate-start", () => {
        navigationInProgress = true;
        resetCaptionSession();
    }, { passive: true });
    for (const event of ["yt-navigate-finish", "yt-page-data-updated", "spfdone", "popstate"]) {
        window.addEventListener(event, resumeCaptionSession, { passive: true });
    }
    // Media readiness also covers a player that appears after SPA navigation.
    for (const event of ["loadedmetadata", "loadeddata", "playing"]) {
        document.addEventListener(event, (event) => {
            if (event.target?.tagName === "VIDEO") refreshCaptionSession();
        }, true);
    }
    if (typeof window !== "undefined" && isPage()) {
        const timer = setTimeout(() => {
            captionBootstrapTimers.delete(timer);
            if (typeof window === "undefined" || !window?.location) return;
            if (!navigationInProgress) resumeCaptionSession();
        }, 400);
        captionBootstrapTimers.add(timer);
    }

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
        getSubtitleLanguage: () => activeTrack?.languageCode || "",
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
            if (cueIndex.length > 0) return cue?.text || "";
            return getDomSubtitleText();
        },
        getAdjacentSubtitleTime,
        requestSeek,
        pauseVideo,
        playVideo,
        setCueIndex,
        loadCaptionTrack,
        selectBestCaptionTrack,
        isFocusModeEnabled,
        reportFocusUnavailable,
        reportFocusAvailable,
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
