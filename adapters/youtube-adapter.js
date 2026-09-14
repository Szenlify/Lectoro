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
    const SEEK_EVENT = EVT.YOUTUBE_SEEK;
    const PAUSE_EVENT = EVT.YOUTUBE_PAUSE;
    const PLAY_EVENT = EVT.YOUTUBE_PLAY;
    const NAV_EVENT = EVT.YOUTUBE_NAVIGATION;

    let cueIndex = [];
    let cueMaxEnd = [];
    let currentVideoId = "";
    let currentDisplayedText = "";
    let currentDisplayedTranslation = "";
    let availableTracks = [];
    let activeTrack = null;
    let captionGeneration = 0;
    let pendingTrackKey = "";
    let lastMasterTrack = null;
    let currentDisplayedCue = null;
    let dualEnabled = true;
    const defaultTargetLang = LectoroConstants.DEFAULT_READING_SETTINGS.targetLang;
    let targetLanguage = defaultTargetLang;
    let dualStatus = "idle";
    let settingsRevision = 0;
    const pendingFetches = new Set();
    const settingsReady = (async () => {
        try {
            const revision = settingsRevision;
            const settings = await chrome.storage.local.get({
                targetLang: defaultTargetLang,
                doubleSubtitles: true,
            });
            if (revision !== settingsRevision) return;
            dualEnabled = settings.doubleSubtitles !== false;
            targetLanguage = settings.targetLang || defaultTargetLang;
        } catch (_) {}
    })();
    let playbackRafId = null;
    let boundVideo = null;
    let trackRequestSeq = 0;
    let isCcActive = false;

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
        let maxEnd = -Infinity;
        cueMaxEnd = cues.map((cue) => (maxEnd = Math.max(maxEnd, cue.endTime)));
        if (videoId) currentVideoId = videoId;
        currentDisplayedText = "";
        currentDisplayedTranslation = "";
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
                currentDisplayedTranslation = "";
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
                currentDisplayedTranslation = "";
                currentDisplayedCue = null;
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
            }
            return;
        }

        const time = video.currentTime;
        let targetText = "";
        let targetTranslation = "";
        const activeCue = findActiveCue(time);

        if (cueIndex.length > 0) {
            if (activeCue && activeCue.text) {
                targetText = activeCue.text;
                targetTranslation = dualEnabled ? activeCue.translation || "" : "";
            }
        } else {
            // Fallback to DOM player text ONLY if timedtext has not loaded
            const domText = getDomSubtitleText();
            if (domText) targetText = domText;
        }

        const overlayText = globalThis.LectoroSubtitleOverlay?.getActiveText?.() ?? "";
        if (
            targetText !== currentDisplayedText ||
            targetTranslation !== currentDisplayedTranslation ||
            activeCue !== currentDisplayedCue ||
            (targetText && overlayText !== targetText)
        ) {
            currentDisplayedText = targetText;
            currentDisplayedTranslation = targetTranslation;
            currentDisplayedCue = activeCue;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                const lines = Array.isArray(activeCue?.lines) && activeCue.lines.length > 0
                    ? activeCue.lines
                    : (targetText ? [targetText] : []);
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles(
                    lines,
                    { secondaryText: targetTranslation, cue: activeCue },
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

        const clearSubtitlesOnLoad = () => {
            currentDisplayedText = "";
            currentDisplayedTranslation = "";
            currentDisplayedCue = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
        };

        video.addEventListener("loadstart", clearSubtitlesOnLoad);
        video.addEventListener("emptied", clearSubtitlesOnLoad);
        video.addEventListener("loadeddata", () => {
            syncActiveCue(video);
        });
        video.addEventListener("canplay", () => {
            syncActiveCue(video);
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

    function reportDualStatus(status) {
        const nextStatus = dualEnabled ? status : "idle";
        if (nextStatus === dualStatus && nextStatus === "error") return;
        dualStatus = nextStatus;
        globalThis.LectoroSubtitleOverlay?.setDualSubtitleStatus?.({
            platform: "youtube",
            status: nextStatus,
            retry: retryDualSubtitles,
        });
    }

    async function retryDualSubtitles() {
        await settingsReady;
        if (!dualEnabled) return;
        reportDualStatus("loading");
        if (lastMasterTrack && checkIsCcActive(boundVideo || document.querySelector("video"))) {
            const { cues, baseUrl, videoId } = lastMasterTrack;
            await processCaptionTrackWithDualSync(cues, baseUrl, videoId);
        } else if (activeTrack?.baseUrl) {
            await loadCaptionTrack(activeTrack, currentVideoId);
        } else {
            requestTracklistFromBridge();
        }
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

    async function processCaptionTrackWithDualSync(rawCues, baseUrl = "", videoId = "", generation = invalidateCaptionRequest()) {
        if (!Array.isArray(rawCues) || !rawCues.length || !isCurrentRequest(generation, videoId)) return;
        const service = getSubtitleService();
        const masterCues = rawCues.map((cue) => {
            const text = String(cue.text || "").replace(/\s+/g, " ").trim();
            const res = { ...cue, text, lines: [text], translation: "" };
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
        const pairedMaster = service?.pairTwoClusters ? service.pairTwoClusters(masterCues) : masterCues;
        // Rebuild translations from original clusters, never from already paired output.
        lastMasterTrack = { cues: masterCues, baseUrl, videoId };
        setCueIndex(pairedMaster, videoId);
        await settingsReady;
        if (!isCurrentRequest(generation, videoId)) return;
        if (!dualEnabled) {
            reportDualStatus("idle");
            return;
        }
        reportDualStatus("loading");
        try {
            if (!baseUrl || !service?.alignSlaveTrackToMaster) throw new Error("missing_track");
            const language = targetLanguage;
            const sourceLanguage = activeTrack?.languageCode || new URL(baseUrl).searchParams.get("lang") || "";
            if (sourceLanguage.toLowerCase() === language.toLowerCase()) {
                const sameLangCues = masterCues.map((cue) => ({ ...cue, translation: cue.text }));
                const pairedSame = service?.pairTwoClusters ? service.pairTwoClusters(sameLangCues) : sameLangCues;
                setCueIndex(pairedSame, videoId);
                reportDualStatus("ready");
                return;
            }
            const translatedUrls = ["json3", "vtt", "srv3", ""].map((fmt) =>
                buildTimedTextUrl(baseUrl, { lang: sourceLanguage, tlang: language, fmt }));
            const slaveCues = await fetchCueCandidates(translatedUrls, generation, videoId);
            if (!isCurrentRequest(generation, videoId)) return;
            if (!slaveCues.length) throw new Error("missing_translation");
            const unifiedCues = service.alignSlaveTrackToMaster(masterCues, slaveCues, { alignSentences: true });
            if (!unifiedCues.some((cue) => cue.translation)) throw new Error("unaligned_translation");
            const pairedUnified = service?.pairTwoClusters ? service.pairTwoClusters(unifiedCues) : unifiedCues;
            setCueIndex(pairedUnified, videoId);
            reportDualStatus("ready");
        } catch (error) {
            if (isCurrentRequest(generation, videoId)) reportDualStatus("error");
        }
    }

    async function loadCaptionTrack(track, videoId = "") {
        if (!track?.baseUrl) return;
        const key = `${videoId}|${track.baseUrl}`;
        if (pendingTrackKey === key) return;
        const generation = invalidateCaptionRequest();
        pendingTrackKey = key;
        activeTrack = track;
        currentVideoId = videoId || getVideoIdFromUrl();
        lastMasterTrack = null;
        cueIndex = [];
        syncActiveCue(boundVideo || document.querySelector("video"));
        await settingsReady;
        if (!isCurrentRequest(generation, videoId)) return;
        reportDualStatus("loading");
        try {
            const candidateUrls = ["json3", "vtt", "srv3", ""].map((fmt) => buildTimedTextUrl(track.baseUrl, { fmt }));
            const cues = await fetchCueCandidates(candidateUrls, generation, videoId);
            if (!isCurrentRequest(generation, videoId)) return;
            if (!cues.length) throw new Error("missing_track");
            await processCaptionTrackWithDualSync(cues, track.baseUrl, videoId || currentVideoId, generation);
        } catch (error) {
            if (isCurrentRequest(generation, videoId)) reportDualStatus("error");
        } finally {
            if (generation === captionGeneration) pendingTrackKey = "";
        }
    }

    function requestTracklistFromBridge() {
        const requestId = `${Date.now()}-${++trackRequestSeq}`;
        const generation = captionGeneration;
        const videoId = getVideoIdFromUrl();
        const timer = setTimeout(async () => {
            window.removeEventListener(TRACK_RESPONSE_EVENT, onResponse);
            await settingsReady;
            if (isCurrentRequest(generation, videoId) && !lastMasterTrack) reportDualStatus("error");
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
            const generation = invalidateCaptionRequest();
            cueIndex = [];
            lastMasterTrack = null;
            activeTrack = null;
            availableTracks = [];
            globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles?.([]);
            void (async () => {
                await settingsReady;
                if (isCurrentRequest(generation, videoId)) reportDualStatus("error");
            })();
            return;
        }
        if (!ccState) {
            invalidateCaptionRequest();
            reportDualStatus("idle");
            currentDisplayedText = "";
            currentDisplayedTranslation = "";
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
            const chosen = (active && tracks.find((track) =>
                (active.vssId && track.vssId === active.vssId) ||
                (track.languageCode === active.languageCode && track.kind === active.kind))) || selectBestCaptionTrack(tracks, active?.languageCode);
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
                reportDualStatus("idle");
                currentDisplayedText = "";
                currentDisplayedTranslation = "";
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
        const cues = getSubtitleService()?.parseTimedText(detail.text, "", "", { preserveTiming: true, preserveCueBoundaries: true }) || [];
        if (cues.length) void processCaptionTrackWithDualSync(cues, detail.url, videoId);
    });

    // Unsolicited Slave events never update the DOM: only the current Master request owns its translation.
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || (!changes.doubleSubtitles && !changes.targetLang)) return;
            settingsRevision++;
            if (changes.doubleSubtitles) dualEnabled = changes.doubleSubtitles.newValue !== false;
            if (changes.targetLang) targetLanguage = changes.targetLang.newValue || defaultTargetLang;
            invalidateCaptionRequest();
            if (lastMasterTrack && checkIsCcActive(boundVideo || document.querySelector("video"))) {
                const { cues, baseUrl, videoId } = lastMasterTrack;
                void processCaptionTrackWithDualSync(cues, baseUrl, videoId);
            } else {
                cueIndex = cueIndex.map((cue) => ({ ...cue, translation: "" }));
                syncActiveCue(boundVideo || document.querySelector("video"));
                reportDualStatus("idle");
                if (activeTrack?.baseUrl && checkIsCcActive(boundVideo || document.querySelector("video"))) {
                    void loadCaptionTrack(activeTrack, currentVideoId);
                } else if (dualEnabled) {
                    void retryDualSubtitles();
                }
            }
        });
    }

    window.addEventListener(TRACKS_EVENT, (event) => {
        handleTracksAvailable(event?.detail);
    });

    window.addEventListener(NAV_EVENT, (event) => {
        const newVideoId = event?.detail?.videoId || getVideoIdFromUrl();
        if (newVideoId !== currentVideoId) {
            invalidateCaptionRequest();
            reportDualStatus("idle");
            lastMasterTrack = null;
            currentDisplayedTranslation = "";
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
        reportDualStatus("idle");
        lastMasterTrack = null;
        currentDisplayedTranslation = "";
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
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
