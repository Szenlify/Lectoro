/**
 * Lectoro – YouTube Player Caption Adapter & Controller (Single Source of Truth)
 * Dual-source engine: direct timedtext API extraction (with full sentence reconstruction
 * for dynamic/ASR subtitles), sub-frame playback sync, A/D timeline sentence seeking,
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
    let translationCueIndex = [];
    let currentVideoId = "";
    let currentDisplayedText = "";
    let currentDisplayedTranslation = "";
    let availableTracks = [];
    let activeTrack = null;
    let translationTrack = null;
    let isFetchingTrack = false;
    let isFetchingTranslationTrack = false;
    let playbackRafId = null;
    let boundVideo = null;
    let trackRequestSeq = 0;
    let isCcActive = false;
    let currentTargetLang = "pl";
    let currentLearningLang = "en";
    const DUAL_SUBS_KEY = LectoroConstants?.STORAGE_KEYS?.DUAL_SUBTITLES || "dualSubtitles";
    let dualSubtitlesEnabled = true;

    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
        chrome.storage.local.get({ [DUAL_SUBS_KEY]: true }, (data) => {
            if (typeof data?.[DUAL_SUBS_KEY] === "boolean") {
                dualSubtitlesEnabled = data[DUAL_SUBS_KEY];
            }
        });
    }

    async function getTargetLanguage() {
        if (typeof globalThis.SharedTranslatorService?.getTargetLang === "function") {
            try {
                const lang = await globalThis.SharedTranslatorService.getTargetLang();
                if (lang) { currentTargetLang = lang; return lang; }
            } catch (_) {}
        }
        if (typeof chrome !== "undefined" && chrome?.storage?.local) {
            try {
                const data = await chrome.storage.local.get({
                    [LectoroConstants.STORAGE_KEYS.TARGET_LANG]: LectoroConstants.DEFAULT_READING_SETTINGS.targetLang,
                });
                const lang = data[LectoroConstants.STORAGE_KEYS.TARGET_LANG] || "pl";
                currentTargetLang = lang;
                return lang;
            } catch (_) {}
        }
        return currentTargetLang || "pl";
    }

    async function getLearningLanguage() {
        if (typeof globalThis.SharedTranslatorService?.getLearningLang === "function") {
            try {
                const lang = await globalThis.SharedTranslatorService.getLearningLang();
                if (lang) { currentLearningLang = lang; return lang; }
            } catch (_) {}
        }
        return currentLearningLang || "en";
    }

    function fetchViaBridge(url) {
        return new Promise((resolve) => {
            const requestId = `${Date.now()}-${++trackRequestSeq}`;
            const timer = setTimeout(() => {
                window.removeEventListener(FETCH_RESPONSE_EVENT, onResponse);
                resolve("");
            }, 6000);

            function onResponse(event) {
                if (event?.detail?.requestId === requestId) {
                    clearTimeout(timer);
                    window.removeEventListener(FETCH_RESPONSE_EVENT, onResponse);
                    resolve(event.detail.text || "");
                }
            }

            window.addEventListener(FETCH_RESPONSE_EVENT, onResponse);
            window.dispatchEvent(
                new CustomEvent(FETCH_REQUEST_EVENT, {
                    detail: { requestId, url },
                }),
            );
        });
    }

    async function ensureTranslationTrackLoaded(track, videoId = "") {
        if (!track || !track.baseUrl || isFetchingTranslationTrack) return;
        if (translationCueIndex.length > 0 && currentVideoId === videoId) return;
        isFetchingTranslationTrack = true;
        try {
            const url = track.baseUrl.includes("?")
                ? `${track.baseUrl}&__lectoro_bridge=1`
                : `${track.baseUrl}?__lectoro_bridge=1`;
            const text = await fetchViaBridge(url);
            if (text) {
                const service = getSubtitleService();
                const cues = service ? service.parseTimedText(text) : [];
                if (cues.length > 0) {
                    setTranslationCueIndex(cues, videoId || currentVideoId);
                    const video = boundVideo || document.querySelector("video");
                    if (video) syncActiveCue(video);
                }
            }
        } catch (_) {} finally {
            isFetchingTranslationTrack = false;
        }
    }

    function getSubtitleService() {
        return globalThis.SharedSubtitleService;
    }

    function isPage() {
        return HOST_RE.test(window.location.hostname);
    }

    function isShortsPage(video = null) {
        if (typeof window !== "undefined" && window.location?.pathname?.includes("/shorts/")) {
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

    function setTranslationCueIndex(cues, videoId = "") {
        if (!Array.isArray(cues) || cues.length === 0) return;
        translationCueIndex = cues;
        if (videoId) currentVideoId = videoId;
        currentDisplayedTranslation = "";

        const video = boundVideo || document.querySelector("video");
        if (video) syncActiveCue(video);
    }

    function findActiveCueInIndex(cues, currentTime) {
        if (!Array.isArray(cues) || cues.length === 0) return null;

        let low = 0;
        let high = cues.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const cue = cues[mid];

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
        const end = Math.min(cues.length - 1, low + 1);
        for (let i = start; i <= end; i++) {
            const cue = cues[i];
            if (currentTime >= cue.startTime - 0.05 && currentTime <= cue.endTime + 0.05) {
                return cue;
            }
        }

        return null;
    }

    function findActiveCue(currentTime) {
        return findActiveCueInIndex(cueIndex, currentTime);
    }

    function syncNativeDomSubtitles(origText, transText) {
        try {
            const container = document.querySelector(".ytp-caption-window-container");
            if (!container) return;

            let transContainer = container.querySelector(".ytp-caption-translation-container");
            if (!transText) {
                if (transContainer) transContainer.style.display = "none";
                return;
            }

            if (!transContainer) {
                transContainer = document.createElement("div");
                transContainer.className = "ytp-caption-translation-container";
                transContainer.setAttribute("dir", "auto");
                transContainer.style.setProperty("display", "block", "important");
                transContainer.style.setProperty("text-align", "center", "important");
                transContainer.style.setProperty("margin-top", "4px", "important");
                transContainer.style.setProperty("pointer-events", "none", "important");

                const span = document.createElement("span");
                span.className = "ytp-caption-translation-text";
                span.style.setProperty("font-size", "60%", "important");
                span.style.setProperty("color", "#d1d5db", "important");
                span.style.setProperty("background-color", "rgba(8, 8, 8, 0.75)", "important");
                span.style.setProperty("padding", "1px 6px", "important");
                span.style.setProperty("border-radius", "4px", "important");
                span.style.setProperty("display", "inline-block", "important");
                span.style.setProperty("text-shadow", "0 2px 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)", "important");
                transContainer.appendChild(span);

                const windowEl = container.querySelector(".caption-window") || container;
                windowEl.appendChild(transContainer);
            }

            transContainer.style.display = "block";
            const textEl = transContainer.querySelector(".ytp-caption-translation-text");
            if (textEl && textEl.textContent !== transText) {
                textEl.textContent = transText;
            }
        } catch (_) {}
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
            if (
                currentDisplayedText !== "" ||
                currentDisplayedTranslation !== "" ||
                (globalThis.LectoroSubtitleOverlay?.getActiveLines?.()?.length > 0)
            ) {
                currentDisplayedText = "";
                currentDisplayedTranslation = "";
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
                syncNativeDomSubtitles("", "");
            }
            return;
        }

        const time = video.currentTime;
        let targetOrigText = "";
        let targetTransText = "";

        // 1. Original cue lookup
        if (cueIndex.length > 0) {
            const activeCue = findActiveCueInIndex(cueIndex, time);
            if (activeCue && activeCue.text) {
                targetOrigText = activeCue.text;
            }
        } else {
            // Fallback to DOM player text ONLY if timedtext has not loaded
            const domText = getDomSubtitleText();
            if (domText) targetOrigText = domText;
        }

        // 2. Translation cue lookup (only if dual subtitles is enabled)
        if (dualSubtitlesEnabled) {
            if (translationCueIndex.length > 0) {
                const activeTransCue = findActiveCueInIndex(translationCueIndex, time);
                if (activeTransCue && activeTransCue.text) {
                    targetTransText = activeTransCue.text;
                }
            } else if (availableTracks.length > 0 && !isFetchingTranslationTrack) {
                const targetLang = currentTargetLang || "pl";
                const transTrack = selectTranslationTrack(availableTracks, targetLang, activeTrack);
                if (transTrack && transTrack.baseUrl) {
                    translationTrack = transTrack;
                    ensureTranslationTrackLoaded(transTrack, currentVideoId);
                }
            }
        }

        const overlayText = globalThis.LectoroSubtitleOverlay?.getActiveText?.() ?? "";
        const overlayTranslation = globalThis.LectoroSubtitleOverlay?.getActiveTranslationText?.() ?? "";

        if (
            targetOrigText !== currentDisplayedText ||
            targetTransText !== currentDisplayedTranslation ||
            (targetOrigText && overlayText !== targetOrigText) ||
            (targetTransText && overlayTranslation !== targetTransText)
        ) {
            currentDisplayedText = targetOrigText;
            currentDisplayedTranslation = targetTransText;

            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles(
                    targetOrigText ? [targetOrigText] : [],
                    { translationText: targetTransText },
                );
            }

            syncNativeDomSubtitles(targetOrigText, targetTransText);
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
            if ((cueIndex.length === 0 || translationCueIndex.length === 0) && checkIsCcActive(video)) {
                if (availableTracks.length > 0) {
                    handleTracksAvailable({ tracks: availableTracks, isCcActive: true });
                } else {
                    requestTracklistFromBridge();
                }
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



    function selectTranslationTrack(tracks, targetLang = "pl", originalTrack = null) {
        if (!Array.isArray(tracks) || tracks.length === 0) return null;
        const tgt = (targetLang || "pl").toLowerCase();

        // 1. Direct manual track in target language (e.g. lang=pl)
        // /api/timedtext?v=xxx&lang=pl ← oryginał (np. polski) i wyświetlaj jako "tłumaczenie"
        const directManual = tracks.find(
            (t) =>
                t !== originalTrack &&
                t.kind !== "asr" &&
                (t.languageCode?.toLowerCase() === tgt ||
                 t.vssId?.toLowerCase()?.includes(`.${tgt}`)),
        );
        if (directManual && directManual.baseUrl) {
            return {
                ...directManual,
                isAutoTranslated: false,
                targetLang: tgt,
            };
        }

        // 2. Direct ASR track in target language
        const directAsr = tracks.find(
            (t) =>
                t !== originalTrack &&
                (t.languageCode?.toLowerCase() === tgt ||
                 t.vssId?.toLowerCase()?.includes(`.${tgt}`)),
        );
        if (directAsr && directAsr.baseUrl) {
            return {
                ...directAsr,
                isAutoTranslated: false,
                targetLang: tgt,
            };
        }

        // 3. Translated track via &tlang=targetLang from original track
        // lub /api/timedtext?v=xxx&lang=en&tlang=pl ← tłumaczenie
        const baseTrack = (originalTrack && originalTrack.baseUrl)
            ? originalTrack
            : (selectBestCaptionTrack(tracks) || tracks[0]);
        if (baseTrack && baseTrack.baseUrl) {
            let transUrl = baseTrack.baseUrl;
            if (transUrl.includes("tlang=")) {
                transUrl = transUrl.replace(/tlang=[^&]+/, `tlang=${tgt}`);
            } else {
                const sep = transUrl.includes("?") ? "&" : "?";
                transUrl = `${transUrl}${sep}tlang=${tgt}`;
            }

            return {
                baseUrl: transUrl,
                languageCode: tgt,
                name: `Translation (${tgt})`,
                kind: baseTrack.kind || "",
                vssId: baseTrack.vssId ? `${baseTrack.vssId}.t.${tgt}` : `t.${tgt}`,
                isTranslatable: false,
                isAutoTranslated: true,
                targetLang: tgt,
            };
        }

        return null;
    }

    async function loadCaptionTrack(track, videoId = "") {
        if (!track) return;
        activeTrack = track;
    }

    async function loadTranslationCaptionTrack(track, videoId = "") {
        if (!track) return;
        translationTrack = track;
    }

    async function loadDualCaptionTracks(origTrack, transTrack, videoId = "") {
        if (origTrack) activeTrack = origTrack;
        if (transTrack) translationTrack = transTrack;
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

    async function handleTracksAvailable(detail) {
        if (!detail) return;
        const videoId = detail.videoId || getVideoIdFromUrl();
        const tracks = detail.tracks;
        if (Array.isArray(tracks) && tracks.length > 0) {
            availableTracks = tracks;
        }
        const isShorts = detail.isShorts || isShortsPage();
        const ccState = isShorts
            ? true
            : (typeof detail.isCcActive === "boolean"
                ? detail.isCcActive
                : checkIsCcActive());
        isCcActive = ccState;

        if (!ccState) {
            currentDisplayedText = "";
            currentDisplayedTranslation = "";
            activeTrack = null;
            translationTrack = null;
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
            syncNativeDomSubtitles("", "");
            stopPlaybackLoop();
            return;
        }

        const effectiveTracks = (Array.isArray(tracks) && tracks.length > 0) ? tracks : availableTracks;
        if (Array.isArray(effectiveTracks) && effectiveTracks.length > 0) {
            const learningLang = await getLearningLanguage();

            let chosenOrig = detail.activeTrack;
            if (chosenOrig && !chosenOrig.baseUrl) {
                chosenOrig = effectiveTracks.find(
                    (t) =>
                        (chosenOrig.vssId && t.vssId === chosenOrig.vssId) ||
                        (chosenOrig.languageCode && t.languageCode === chosenOrig.languageCode)
                ) || chosenOrig;
            }
            if (!chosenOrig || !chosenOrig.baseUrl) {
                chosenOrig = selectBestCaptionTrack(effectiveTracks, learningLang);
            }
            activeTrack = chosenOrig;

            if (dualSubtitlesEnabled && effectiveTracks.length > 0) {
                const targetLang = await getTargetLanguage();
                const transTrack = selectTranslationTrack(effectiveTracks, targetLang, chosenOrig);
                if (transTrack && transTrack.baseUrl && translationCueIndex.length === 0) {
                    translationTrack = transTrack;
                    ensureTranslationTrackLoaded(transTrack, videoId);
                }
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
                currentDisplayedTranslation = "";
                activeTrack = null;
                translationTrack = null;
                stopPlaybackLoop();
                if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                    globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
                }
                syncNativeDomSubtitles("", "");
            } else {
                if (cueIndex.length === 0 || translationCueIndex.length === 0) {
                    if (availableTracks.length > 0) {
                        handleTracksAvailable({ tracks: availableTracks, isCcActive: true });
                    } else {
                        requestTracklistFromBridge();
                    }
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

    window.addEventListener(TIMED_TEXT_EVENT, async (event) => {
        const detail = event?.detail;
        if (!detail || !detail.text) return;

        const service = getSubtitleService();
        const cues = service ? service.parseTimedText(detail.text) : [];
        if (cues.length === 0) return;

        const url = detail.url || "";
        const targetLang = await getTargetLanguage();

        const isTranslation =
            url.includes("tlang=") ||
            (targetLang && (
                url.includes(`lang=${targetLang}`) ||
                url.includes(`vss_id=.${targetLang}`) ||
                url.includes(`vss_id=%2E${targetLang}`) ||
                url.includes(`vss_id=a.${targetLang}`) ||
                url.includes(`vss_id=a%2E${targetLang}`)
            ));

        if (isTranslation) {
            setTranslationCueIndex(cues, detail.videoId || currentVideoId);
        } else {
            setCueIndex(cues, detail.videoId || currentVideoId);
        }

        const video = boundVideo || document.querySelector("video");
        if (video) syncActiveCue(video);
    });

    window.addEventListener(TRACKS_EVENT, (event) => {
        handleTracksAvailable(event?.detail);
    });

    window.addEventListener(NAV_EVENT, (event) => {
        const newVideoId = event?.detail?.videoId || getVideoIdFromUrl();
        if (newVideoId !== currentVideoId) {
            currentVideoId = newVideoId;
            cueIndex = [];
            translationCueIndex = [];
            currentDisplayedText = "";
            currentDisplayedTranslation = "";
            activeTrack = null;
            translationTrack = null;
            availableTracks = [];
            stopPlaybackLoop();
            if (globalThis.LectoroSubtitleOverlay?.renderCustomSubtitles) {
                globalThis.LectoroSubtitleOverlay.renderCustomSubtitles([]);
            }
            syncNativeDomSubtitles("", "");
            requestTracklistFromBridge();
            setTimeout(observeContentCcButton, 300);
        }
    });

    if (typeof chrome !== "undefined" && chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener(async (changes, area) => {
            if (area !== "local") return;
            const targetLangKey = LectoroConstants?.STORAGE_KEYS?.TARGET_LANG || "targetLang";
            if (changes[targetLangKey]) {
                const newTargetLang = changes[targetLangKey].newValue;
                if (newTargetLang) {
                    currentTargetLang = newTargetLang;
                    liveTranslationCache.clear();
                    const video = boundVideo || document.querySelector("video");
                    if (video) syncActiveCue(video);
                }
            }
            if (changes[DUAL_SUBS_KEY] && typeof changes[DUAL_SUBS_KEY].newValue === "boolean") {
                dualSubtitlesEnabled = changes[DUAL_SUBS_KEY].newValue;
                if (!dualSubtitlesEnabled) {
                    currentDisplayedTranslation = "";
                }
                const video = boundVideo || document.querySelector("video");
                if (video) syncActiveCue(video);
            }
        });
    }

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
        getTranslationLanguage: () => translationTrack?.languageCode || "",
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
        getTranslationCueIndex: () => (checkIsCcActive(boundVideo || document.querySelector("video")) ? translationCueIndex : []),
        getAllCues: () => (checkIsCcActive(boundVideo || document.querySelector("video")) ? cueIndex : []),
        getCurrentSubtitleText: (video) => {
            if (!checkIsCcActive(video)) return "";
            const time = video?.currentTime ?? (boundVideo?.currentTime || 0);
            const cue = findActiveCueInIndex(cueIndex, time);
            if (cue && cue.text) return cue.text;
            return getDomSubtitleText();
        },
        getCurrentTranslationText: (video) => {
            if (!checkIsCcActive(video)) return "";
            if (!dualSubtitlesEnabled) return "";
            const time = video?.currentTime ?? (boundVideo?.currentTime || 0);
            if (translationCueIndex.length > 0) {
                const cue = findActiveCueInIndex(translationCueIndex, time);
                if (cue && cue.text) return cue.text;
            }
            return currentDisplayedTranslation || "";
        },
        getAdjacentSubtitleTime,
        requestSeek,
        pauseVideo,
        playVideo,
        setCueIndex,
        setTranslationCueIndex,
        loadCaptionTrack,
        loadTranslationCaptionTrack,
        loadDualCaptionTracks,
        selectBestCaptionTrack,
        selectTranslationTrack,
        ensureTranslationTrackLoaded,
        isDualSubtitlesEnabled: () => dualSubtitlesEnabled,
        setDualSubtitlesEnabled: (val) => { dualSubtitlesEnabled = !!val; },
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
