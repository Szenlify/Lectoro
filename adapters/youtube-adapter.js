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
    let trackRequestSeq = 0;
    let isCcActive = false;
    let youtubeFocusModeActive = false;

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
            }
        });

        chrome.storage.onChanged?.addListener((changes, area) => {
            if (area === "local" && changes[ytFocusKey]) {
                const newVal = Boolean(changes[ytFocusKey].newValue);
                if (newVal !== youtubeFocusModeActive) {
                    youtubeFocusModeActive = newVal;
                }
            }
        });
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

    function setCueIndex(cues, videoId = "") {
        if (!Array.isArray(cues) || cues.length === 0) return;
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

        const lines = Array.from(container.querySelectorAll(".caption-visual-line"));
        if (lines.length > 0) {
            return lines
                .map((l) => cleanFn((l.textContent || "").trim()))
                .filter(Boolean);
        }
        const segments = Array.from(container.querySelectorAll(".ytp-caption-segment"));
        if (segments.length > 0) {
            const raw = segments
                .map((s) => s.textContent || "")
                .join("")
                .trim();
            const cleaned = cleanFn(raw);
            return cleaned ? cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
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
            if (!video.paused && !video.ended) {
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
        boundVideo = video;

        const clearSubtitlesOnLoad = () => {
            currentDisplayedText = "";
            currentDisplayedCue = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
        };

        video.addEventListener("loadstart", clearSubtitlesOnLoad);
        video.addEventListener("emptied", clearSubtitlesOnLoad);
        video.addEventListener("loadeddata", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        video.addEventListener("canplay", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });

        video.addEventListener("play", () => {
            if (cueIndex.length === 0 && checkIsCcActive(video)) {
                requestTracklistFromBridge();
            }
            startPlaybackLoop(video);
        });
        video.addEventListener("pause", () => {
            stopPlaybackLoop();
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        video.addEventListener("timeupdate", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
        video.addEventListener("seeked", () => {
            syncActiveCue(video);
            globalThis.LectoroSubtitleOverlay?.updateFocusTiming?.(video.currentTime * 1000);
        });
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
                const cues = service.parseTimedText(result.text, "", "", { preserveTiming: true });
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
        setCueIndex(masterCues, videoId);
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
            if (!cues.length) return;
            processCaptionTrack(cues, videoId || currentVideoId, generation);
        } catch (error) {
            // Caption loading error
        } finally {
            if (generation === captionGeneration) pendingTrackKey = "";
        }
    }

    function requestTracklistFromBridge() {
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        const generation = captionGeneration;
        const videoId = getVideoIdFromUrl();
        const timer = setTimeout(() => {
            window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
        }, 3000);

        function onResponse(event) {
            if (event?.detail?.requestId === requestId) {
                clearTimeout(timer);
                window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
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
        if (!detail) return;
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

        if (Array.isArray(tracks) && tracks.length === 0) {
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
            // Focus only decorates the selected automatic track; never change
            // the viewer's caption language or replace their manual captions.
            const chosen =
                (active && tracks.find((track) =>
                    (active.vssId && track.vssId === active.vssId) ||
                    (track.languageCode === active.languageCode && track.kind === active.kind)
                )) || selectBestCaptionTrack(tracks, active?.languageCode, false);

            if (chosen && (!activeTrack || chosen.baseUrl !== activeTrack.baseUrl || videoId !== currentVideoId)) {
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

    window.addEventListener(TIMED_TEXT_EVENT, (event) => {
        const detail = event?.detail;
        if (!detail?.text || !detail.url || !checkIsCcActive(boundVideo || document.querySelector("video"))) return;
        let source;
        try { source = new URL(detail.url, window.location.href); } catch (_) { return; }
        if (source.searchParams.has("tlang") || !buildTimedTextUrl(detail.url)) return;
        const videoId = source.searchParams.get("v") || detail.videoId || currentVideoId;
        if (videoId && getVideoIdFromUrl() && videoId !== getVideoIdFromUrl()) return;
        if (activeTrack?.languageCode && source.searchParams.get("lang") !== activeTrack.languageCode) return;
        const cues = getSubtitleService()?.parseTimedText(detail.text, "", "", { preserveTiming: true }) || [];
        if (cues.length) processCaptionTrack(cues, videoId);
    });

    window.addEventListener(TRACKS_EVENT, (event) => {
        handleTracksAvailable(event?.detail);
    });

    window.addEventListener(NAV_EVENT, (event) => {
        const newVideoId = event?.detail?.videoId || getVideoIdFromUrl();
        if (newVideoId !== currentVideoId) {
            invalidateCaptionRequest();
            currentDisplayedCue = null;
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

    window.addEventListener("yt-navigate-start", () => {
        invalidateCaptionRequest();
        currentDisplayedCue = null;
        currentDisplayedText = "";
        cueIndex = [];
        activeTrack = null;
        availableTracks = [];
        boundVideo = null;
        stopPlaybackLoop();
        if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
            globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
        }
    }, { passive: true });

    // Initial check on load
    if (typeof window !== "undefined" && isPage()) {
        setTimeout(() => {
            if (typeof window === "undefined" || !window?.location) return;
            currentVideoId = getVideoIdFromUrl();
            observeContentCcButton();
            requestTracklistFromBridge();
            const video = document?.querySelector?.("video");
            if (video) bindVideoEvents(video);
        }, 400);
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
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
