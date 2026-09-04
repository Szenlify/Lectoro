/**
 * Lectoro – Player Registry & Caption Binding Manager
 * Coordinates video detection, caption observers, and adapter resolution across all supported sites.
 */
(() => {
    "use strict";

    const CAPTION_FALLBACK_MS = 300;
    const videoSessions = new WeakMap();
    const liveVideoSessions = new Set();
    let activeVideo = null;
    let videoSweepTimer = null;
    let subtitleChangeCallback = null;

    function getRegisteredAdapters() {
        const adapters = [];
        if (globalThis.LectoroYouTubeAdapter) adapters.push(globalThis.LectoroYouTubeAdapter);
        if (globalThis.LectoroGenericVideoAdapter) adapters.push(globalThis.LectoroGenericVideoAdapter);
        if (globalThis.LectoroNetflixAdapter) adapters.push(globalThis.LectoroNetflixAdapter);
        if (globalThis.LectoroTedAdapter) adapters.push(globalThis.LectoroTedAdapter);
        if (Array.isArray(globalThis.LectoroGenericAdapters)) {
            adapters.push(...globalThis.LectoroGenericAdapters);
        }
        return adapters;
    }

    function isOwnUI(target) {
        return LectoroConstants.isOwnUI(target);
    }

    function extractCueText(node) {
        return SharedUtils.extractSubtitleText(node);
    }

    function cueText(cue) {
        const raw = typeof cue?.text === "string" ? cue.text.trim() : "";
        if (!raw) return "";
        if (!raw.includes("<")) return raw;

        try {
            const doc = new DOMParser().parseFromString(raw, "text/html");
            return extractCueText(doc.body);
        } catch (_) {
            return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        }
    }

    function parseCueLineNumber(cue) {
        if (!cue) return null;
        const line = cue.line;
        if (typeof line === "number" && Number.isFinite(line)) {
            return line;
        }
        if (typeof line === "string") {
            const parsed = parseFloat(line);
            if (Number.isFinite(parsed)) return parsed;
        }
        return null;
    }

    function compareCues(a, b) {
        if (!a || !b) return 0;

        // 1. Primary: Vertical row order (top-to-bottom)
        const lineA = parseCueLineNumber(a);
        const lineB = parseCueLineNumber(b);

        if (lineA !== null && lineB !== null && lineA !== lineB) {
            // Both positive (e.g. row 13 vs row 14) or both negative (e.g. line -2 vs line -1):
            // Smaller number is always higher up on screen! (-2 is above -1, 13 is above 14)
            if ((lineA >= 0 && lineB >= 0) || (lineA < 0 && lineB < 0)) {
                return lineA - lineB;
            }
            // Mixed signs: positive is indexed from top, negative from bottom
            return lineB < 0 ? -1 : 1;
        }

        // 2. Secondary: Chronological order (earlier spoken line first)
        const startA = Number.isFinite(a.startTime) ? a.startTime : null;
        const startB = Number.isFinite(b.startTime) ? b.startTime : null;
        if (startA !== null && startB !== null && Math.abs(startA - startB) > 0.05) {
            return startA - startB;
        }

        // 3. Horizontal position (left-to-right for same line)
        const posA = Number.isFinite(a.position) ? a.position : null;
        const posB = Number.isFinite(b.position) ? b.position : null;
        if (posA !== null && posB !== null && posA !== posB) {
            return posA - posB;
        }

        return 0;
    }

    function getNativeCueLines(video) {
        if (!video?.textTracks) return [];
        let showingCues = [];
        let hiddenCues = [];

        for (let i = 0; i < video.textTracks.length; i += 1) {
            const track = video.textTracks[i];
            if (
                !["subtitles", "captions"].includes(track.kind) ||
                track.mode === "disabled" ||
                !track.activeCues ||
                track.activeCues.length === 0
            ) {
                continue;
            }

            const rawCues = Array.from(track.activeCues);
            if (rawCues.length === 0) continue;

            if (track.mode === "showing") {
                showingCues.push(...rawCues);
            } else {
                hiddenCues.push(...rawCues);
            }
        }

        // Prefer showing track; if none is showing, check hidden tracks
        const targetCues = showingCues.length > 0 ? showingCues : hiddenCues;
        if (targetCues.length === 0) return [];

        // Sort cues properly by vertical position (line) and chronological order (startTime)
        targetCues.sort(compareCues);

        const lines = [];
        for (const cue of targetCues) {
            const text = cueText(cue);
            if (!text) continue;
            // A single cue may contain \n line breaks
            const subLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
            for (const subLine of subLines) {
                if (subLine && !lines.includes(subLine)) {
                    lines.push(subLine);
                }
            }
        }

        // Final heuristic for live TV / roll-up captions: if 2 lines were extracted without clear vertical ordering,
        // check if line 0 terminates a sentence with punctuation while line 1 begins or continues a sentence.
        if (lines.length === 2) {
            const endsWithPunct = /[.!?]["']?$/.test(lines[0]);
            const nextEndsWithPunct = /[.!?]["']?$/.test(lines[1]);
            if (endsWithPunct && !nextEndsWithPunct) {
                lines.reverse();
            }
        }

        return lines;
    }

    function getNativeCueText(video) {
        const lines = getNativeCueLines(video);
        return lines.length > 0 ? lines.join(" ") : "";
    }

    function hasEnabledNativeCaptionTrack(video) {
        if (!video?.textTracks) return false;
        for (let i = 0; i < video.textTracks.length; i += 1) {
            const track = video.textTracks[i];
            if (
                ["subtitles", "captions"].includes(track.kind) &&
                track.mode !== "disabled"
            ) {
                return true;
            }
        }
        return false;
    }

    function isPreviewOrThumbnailVideo(video) {
        if (!video || !video.isConnected) return true;

        const hostname = (typeof window !== "undefined" && window.location.hostname) || "";

        // 1. YouTube checks
        if (/(^|\.)youtube\.com$/i.test(hostname)) {
            // Shorts are explicitly allowed!
            if (
                window.location.pathname.includes("/shorts/") ||
                video.closest("ytd-shorts, ytd-reel-video-renderer, #shorts-player")
            ) {
                return false;
            }

            // Preview containers on YouTube homepage / feed / search / channel
            if (
                video.closest(
                    "ytd-thumbnail, ytd-video-preview, ytd-inline-preview-renderer, #inline-preview-player, ytd-rich-grid-row #preview, ytd-rich-item-renderer #preview, ytd-compact-video-renderer #preview",
                )
            ) {
                return true;
            }

            // If on YouTube and not /watch, not /shorts, not /embed, and not main #movie_player
            if (
                !window.location.pathname.startsWith("/watch") &&
                !window.location.pathname.startsWith("/shorts") &&
                !window.location.pathname.startsWith("/embed") &&
                !video.closest("#movie_player")
            ) {
                return true;
            }
        }

        // 2. Netflix checks
        if (/(^|\.)netflix\.com$/i.test(hostname)) {
            if (!window.location.pathname.includes("/watch/")) {
                return true;
            }
            if (
                video.closest(
                    ".previewModal--player_container, .billboard-row, .bob-card, .jawBoneContainer, .titleCard, .slider-item, .hero-image-wrapper",
                )
            ) {
                return true;
            }
        }

        // 3. Small dimension check (unless in fullscreen or Shorts)
        if (!document.fullscreenElement && !window.location.pathname.includes("/shorts/")) {
            const rect = video.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.width < 220 || rect.height < 120)) {
                return true;
            }
        }

        return false;
    }

    function isCcActive(video) {
        if (!video || !video.isConnected) return false;
        if (isPreviewOrThumbnailVideo(video)) return false;

        const session = videoSessions.get(video);
        const adapter = session?.binding?.adapter;

        // 1. Adapter-specific CC check
        if (typeof adapter?.isCcActive === "function") {
            return adapter.isCcActive(video);
        }

        // 2. YouTube adapter check
        if (globalThis.LectoroYouTubeAdapter?.isPage?.()) {
            if (typeof globalThis.LectoroYouTubeAdapter?.isCcActive === "function") {
                return globalThis.LectoroYouTubeAdapter.isCcActive(video);
            }
        }

        // 3. Netflix adapter check
        if (globalThis.LectoroNetflixAdapter?.isPage?.()) {
            if (typeof globalThis.LectoroNetflixAdapter?.isCcActive === "function") {
                return globalThis.LectoroNetflixAdapter.isCcActive(video);
            }
        }

        // 4. TED Talks adapter check
        if (globalThis.LectoroTedAdapter?.isPage?.()) {
            if (typeof globalThis.LectoroTedAdapter?.isCcActive === "function") {
                return globalThis.LectoroTedAdapter.isCcActive(video);
            }
        }

        // 5. Native text tracks check
        if (hasEnabledNativeCaptionTrack(video)) {
            return true;
        }

        // 5. Video.js / HTML5 / generic DOM container check
        if (session?.binding?.container) {
            const container = session.binding.container;
            if (container.isConnected && container.offsetParent !== null) {
                const elements = getAdapterElements(session.binding);
                if (elements.length > 0) return true;
            }
        }

        return false;
    }

    let lastMouseX = -1;
    let lastMouseY = -1;
    let lastHoveredVideo = null;

    function handlePointerActivity(e) {
        if (!e) return;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        const target = e.target;
        if (!target) return;
        if (target.tagName === "VIDEO" && target instanceof HTMLVideoElement && target.isConnected) {
            lastHoveredVideo = target;
            return;
        }
        const container = target.closest?.(
            "article, [data-testid='tweet'], [data-testid='videoPlayer'], [data-testid='videoComponent'], .html5-video-player, .vjs-tech, .video-js, [data-player-root]"
        );
        const video = container?.querySelector?.("video");
        if (video && video instanceof HTMLVideoElement && video.isConnected) {
            lastHoveredVideo = video;
        }
    }

    document.addEventListener("mousemove", handlePointerActivity, { passive: true, capture: true });
    document.addEventListener("pointerdown", handlePointerActivity, { passive: true, capture: true });

    function getEffectiveMousePos() {
        if (lastMouseX >= 0 && lastMouseY >= 0) {
            return { x: lastMouseX, y: lastMouseY };
        }
        if (typeof QT !== "undefined" && typeof QT.getMousePos === "function") {
            const pos = QT.getMousePos();
            if (pos && pos.x >= 0 && pos.y >= 0) return pos;
        }
        return { x: -1, y: -1 };
    }

    function isDedicatedWatchPage() {
        if (document.fullscreenElement) return true;
        if (isNetflixPage() && window.location.pathname.includes("/watch/")) return true;
        const host = window.location.hostname;
        if (
            (host.includes("youtube.com") || host.includes("youtube-nocookie.com")) &&
            (window.location.pathname.startsWith("/watch") || window.location.pathname.startsWith("/embed") || window.location.pathname.startsWith("/shorts")) &&
            document.querySelector("#movie_player video")
        ) {
            return true;
        }
        return false;
    }

    function isVideoInViewport(video) {
        if (!video || !video.isConnected) return false;
        const rect = video.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return false;
        const overlapX = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
        const overlapY = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return overlapX > 20 && overlapY > 20;
    }

    function getVideoDistanceToPoint(video, x, y) {
        if (!video || !video.isConnected) return Infinity;
        const rect = video.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return Infinity;

        if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
            return Infinity;
        }

        // 1. Direct hit on video element
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
            return 0;
        }

        // 2. Direct hit on tweet/player container
        const container = video.closest?.(
            "article, [data-testid='tweet'], [data-testid='videoPlayer'], [data-testid='videoComponent'], .html5-video-player, .vjs-tech, .video-js, [data-player-root]"
        );
        if (container) {
            const cRect = container.getBoundingClientRect();
            if (x >= cRect.left && x <= cRect.right && y >= cRect.top && y <= cRect.bottom) {
                return 0;
            }
        }

        // 3. Distance from point to bounding box
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        return Math.hypot(dx, dy);
    }

    function visibleVideoArea(video) {
        const rect = video.getBoundingClientRect();
        const width = Math.max(
            0,
            Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
        );
        const height = Math.max(
            0,
            Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
        );
        return width * height;
    }

    const MAX_MOUSE_VICINITY_PX = 320;

    function selectBestVideo(options = {}) {
        const requireNearby = !!options.requireNearbyMouse;
        const pos = getEffectiveMousePos();
        const hasMousePos = pos.x >= 0 && pos.y >= 0;

        const candidates = [];
        const seenVideos = new Set();

        for (const session of liveVideoSessions) {
            const v = session.video;
            if (!v || !v.isConnected || seenVideos.has(v)) continue;
            if (isPreviewOrThumbnailVideo(v)) continue;
            seenVideos.add(v);
            candidates.push(v);
        }

        const domVideos = document.querySelectorAll("video");
        for (let i = 0; i < domVideos.length; i++) {
            const v = domVideos[i];
            if (!v || !v.isConnected || seenVideos.has(v)) continue;
            if (isPreviewOrThumbnailVideo(v)) continue;
            seenVideos.add(v);
            candidates.push(v);
        }

        const visibleCandidates = candidates.filter(isVideoInViewport);

        if (visibleCandidates.length === 0) {
            if (isDedicatedWatchPage() && !requireNearby) {
                const primary = document.querySelector(".watch-video video, [data-uia='video-canvas'] video, #movie_player video");
                if (primary && primary.isConnected && !isPreviewOrThumbnailVideo(primary)) {
                    return primary;
                }
            }
            return null;
        }

        if (hasMousePos) {
            const ranked = visibleCandidates.map((v) => {
                const isHovered = lastHoveredVideo === v;
                const dist = isHovered ? 0 : getVideoDistanceToPoint(v, pos.x, pos.y);
                const area = visibleVideoArea(v);
                const isPlaying = !v.paused && !v.ended;
                return { video: v, dist, area, isPlaying, isHovered };
            });

            ranked.sort((a, b) => {
                if (Math.abs(a.dist - b.dist) > 10) {
                    return a.dist - b.dist;
                }
                if (a.isPlaying !== b.isPlaying) {
                    return a.isPlaying ? -1 : 1;
                }
                return b.area - a.area;
            });

            const top = ranked[0];

            if (requireNearby || !isDedicatedWatchPage()) {
                if (top.dist <= MAX_MOUSE_VICINITY_PX || top.isHovered) {
                    return top.video;
                }
                return null;
            }

            return top.video;
        }

        if (requireNearby) {
            if (isDedicatedWatchPage()) return visibleCandidates[0];
            return null;
        }

        visibleCandidates.sort((a, b) => {
            const aPlaying = !a.paused && !a.ended;
            const bPlaying = !b.paused && !b.ended;
            if (aPlaying !== bPlaying) return aPlaying ? -1 : 1;
            return visibleVideoArea(b) - visibleVideoArea(a);
        });

        return visibleCandidates[0] || null;
    }

    function findCaptionBinding(video) {
        if (!video?.isConnected || isPreviewOrThumbnailVideo(video)) return null;
        const adapters = getRegisteredAdapters();

        for (const adapter of adapters) {
            const roots = [];
            const player = adapter.playerSelector
                ? video.closest(adapter.playerSelector)
                : null;
            if (player) roots.push(player);
            if (adapter.documentFallback) roots.push(document);
            if (roots.length === 0) continue;

            for (const root of roots) {
                const container = root.querySelector(adapter.containerSelector);
                if (container && !isOwnUI(container)) {
                    return { adapter, container };
                }
            }
        }
        return null;
    }

    function getAdapterElements(binding) {
        if (!binding?.container?.isConnected) return [];
        if (typeof binding.adapter?.getCueElements === "function") {
            return binding.adapter.getCueElements(binding.container);
        }
        const candidates = Array.from(
            new Set([
                ...(binding.container.matches(binding.adapter.cueSelector)
                    ? [binding.container]
                    : []),
                ...binding.container.querySelectorAll(binding.adapter.cueSelector),
            ]),
        );
        return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(candidates, {
            leafOnly: !!binding.adapter?.leafOnly,
            cueSelector: binding.adapter?.cueSelector,
        });
    }

    function dispatchSubtitleChange(session) {
        if (!session || session !== videoSessions.get(activeVideo)) return;
        if (session.binding?.adapter?.hasTimedText?.()) return;

        if (isPreviewOrThumbnailVideo(session.video) || !isCcActive(session.video)) {
            if (typeof subtitleChangeCallback === "function") {
                subtitleChangeCallback({
                    lines: [],
                    fullText: "",
                    elements: [],
                    session,
                    video: session.video,
                });
            }
            return;
        }

        const adapterElements = getAdapterElements(session.binding);
        const captionAdapter =
            session.binding?.adapter ||
            (isNetflixPage() ? globalThis.LectoroNetflixAdapter : null);
        const indexedLines = captionAdapter?.getCurrentCueLines?.(
            session.video,
        );
        const hasIndexedLines = Array.isArray(indexedLines);
        // Netflix removes and recreates its caption DOM while seeking. Once an
        // indexed timeline exists, it is the stable source of truth and avoids
        // briefly clearing Lectoro's subtitle overlay.
        let lines = hasIndexedLines
            ? indexedLines
            : globalThis.LectoroBaseAdapter?.extractCueLines?.(adapterElements) || [];

        // Direct container text fallback for #subtitles-container on TED
        if (!hasIndexedLines && lines.length === 0 && globalThis.LectoroTedAdapter?.isPage?.()) {
            const tedContainer = document.getElementById("subtitles-container");
            if (tedContainer && !tedContainer.classList.contains("opacity-0")) {
                const tedText = (tedContainer.textContent || "").replace(/\s+/g, " ").trim();
                if (tedText) lines = [tedText];
            }
        }
        if (!hasIndexedLines && lines.length === 0 && session.video?.textTracks) {
            lines = getNativeCueLines(session.video);
        }
        if (!hasIndexedLines && lines.length === 0) {
            const getAllCuesFn = captionAdapter?.getAllCues || (globalThis.LectoroTedAdapter?.isPage?.() ? globalThis.LectoroTedAdapter.getAllCues : null);
            if (typeof getAllCuesFn === "function") {
                const all = getAllCuesFn(session.video);
                if (Array.isArray(all) && all.length > 0) {
                    const now = session.video.currentTime;
                    const match = all.find((c) => now >= c.startTime && now <= c.endTime);
                    if (match) {
                        if (Array.isArray(match.lines) && match.lines.length > 0) {
                            lines = match.lines;
                        } else if (match.text) {
                            lines = match.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                        }
                    }
                }
            }
        }
        const fullText = lines.join(" ").trim();
        if (typeof subtitleChangeCallback === "function") {
            subtitleChangeCallback({
                lines,
                fullText,
                elements: adapterElements,
                session,
                video: session.video,
            });
        }
    }

    function queueSubtitleDomScan(session) {
        if (
            session !== videoSessions.get(session.video) ||
            session !== videoSessions.get(activeVideo) ||
            document.hidden ||
            session.domFrame !== null
        ) {
            return;
        }

        session.domFrame = requestAnimationFrame(() => {
            session.domFrame = null;
            if (session !== videoSessions.get(activeVideo)) return;
            dispatchSubtitleChange(session);
        });
    }

    function disconnectCaptionObserver(session) {
        session.domObserver?.disconnect();
        session.domObserver = null;
        if (session.domFrame !== null) cancelAnimationFrame(session.domFrame);
        session.domFrame = null;
    }

    function refreshCaptionBinding(session, forceScan = false) {
        if (
            session !== videoSessions.get(activeVideo) ||
            document.hidden ||
            !session.video.isConnected
        ) {
            return;
        }

        const current = session.binding;
        if (!current?.container?.isConnected) {
            disconnectCaptionObserver(session);
            session.binding = findCaptionBinding(session.video);
        }

        if (session.binding && !session.domObserver) {
            session.domObserver = new MutationObserver(() =>
                queueSubtitleDomScan(session),
            );
            session.domObserver.observe(session.binding.container, {
                childList: true,
                subtree: true,
                characterData: true,
            });
            forceScan = true;
        }

        if (forceScan) queueSubtitleDomScan(session);
    }

    function refreshNativeTracks(session) {
        const tracks = session.video.textTracks;
        if (!tracks) return;

        if (!session.hasAddTrackListener) {
            session.hasAddTrackListener = true;
            try {
                tracks.addEventListener("addtrack", () => refreshNativeTracks(session), {
                    signal: session.controller.signal,
                });
            } catch (_) {}
        }

        for (let i = 0; i < tracks.length; i += 1) {
            const track = tracks[i];
            if (session.tracks.has(track)) continue;
            session.tracks.add(track);
            track.addEventListener(
                "cuechange",
                () => {
                    session.nativeText = getNativeCueText(session.video);
                    if (session === videoSessions.get(activeVideo)) {
                        queueSubtitleDomScan(session);
                    }
                },
                { signal: session.controller.signal },
            );
        }
        session.nativeText = getNativeCueText(session.video);
    }

    function activateVideo(video) {
        const session = registerVideo(video);
        if (!session) return;

        if (activeVideo !== video) {
            const previous = videoSessions.get(activeVideo);
            if (previous) disconnectCaptionObserver(previous);
            activeVideo = video;
        }

        refreshNativeTracks(session);
        refreshCaptionBinding(session, true);
        if (globalThis.LectoroGenericVideoAdapter?.ensureControlsHidden) {
            globalThis.LectoroGenericVideoAdapter.ensureControlsHidden();
        }
    }

    function teardownVideoSession(session) {
        if (!session || session !== videoSessions.get(session.video)) return;
        disconnectCaptionObserver(session);
        session.controller.abort();
        videoSessions.delete(session.video);
        liveVideoSessions.delete(session);
        if (activeVideo === session.video) activeVideo = null;
    }

    function scheduleVideoSweep() {
        if (videoSweepTimer !== null || liveVideoSessions.size === 0) return;
        videoSweepTimer = setTimeout(() => {
            videoSweepTimer = null;
            for (const session of Array.from(liveVideoSessions)) {
                if (!session.video.isConnected) teardownVideoSession(session);
            }
            if (!activeVideo) {
                const next = selectBestVideo();
                if (next) activateVideo(next);
            }
            scheduleVideoSweep();
        }, 10_000);
    }

    function registerVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return null;
        const existing = videoSessions.get(video);
        if (existing) return existing;

        const controller = new AbortController();
        const session = {
            video,
            controller,
            tracks: new WeakSet(),
            nativeText: "",
            binding: null,
            domObserver: null,
            domFrame: null,
            lastFallbackAt: 0,
        };
        const signal = controller.signal;

        videoSessions.set(video, session);
        liveVideoSessions.add(session);
        refreshNativeTracks(session);

        video.addEventListener("play", () => activateVideo(video), { signal });
        video.addEventListener("loadedmetadata", () => activateVideo(video), {
            signal,
        });
        video.addEventListener(
            "emptied",
            () => {
                session.nativeText = "";
                session.binding = null;
                disconnectCaptionObserver(session);
            },
            { signal },
        );
        video.addEventListener(
            "timeupdate",
            () => {
                if (
                    activeVideo !== video ||
                    video.paused ||
                    video.ended ||
                    document.hidden
                ) {
                    return;
                }
                const now = performance.now();
                const fallbackMs = isNetflixPage()
                    ? 50
                    : CAPTION_FALLBACK_MS;
                if (now - session.lastFallbackAt < fallbackMs) return;
                session.lastFallbackAt = now;
                session.nativeText = getNativeCueText(video);
                refreshCaptionBinding(session, !session.binding);
                queueSubtitleDomScan(session);
            },
            { signal },
        );

        if (video.textTracks?.addEventListener) {
            const refresh = () => {
                refreshNativeTracks(session);
                if (activeVideo === video) refreshCaptionBinding(session, true);
            };
            video.textTracks.addEventListener("addtrack", refresh, { signal });
            video.textTracks.addEventListener("removetrack", refresh, { signal });
            video.textTracks.addEventListener("change", refresh, { signal });
        }

        scheduleVideoSweep();
        return session;
    }

    function handleVideoLifecycleEvent(event) {
        if (!(event.target instanceof HTMLVideoElement)) return;
        registerVideo(event.target);
        if (event.type === "play" || event.type === "loadedmetadata") {
            activateVideo(event.target);
        }
    }

    function sweepDeadVideoSessions() {
        for (const session of Array.from(liveVideoSessions)) {
            if (!session.video.isConnected) teardownVideoSession(session);
        }
        if (!activeVideo || !activeVideo.isConnected) {
            const next = selectBestVideo();
            if (next) activateVideo(next);
        }
    }

    document.addEventListener("play", handleVideoLifecycleEvent, true);
    document.addEventListener("loadedmetadata", handleVideoLifecycleEvent, true);
    document.addEventListener("visibilitychange", () => {
        const session = videoSessions.get(activeVideo);
        if (!session) return;
        if (document.hidden) disconnectCaptionObserver(session);
        else refreshCaptionBinding(session, true);
    });
    window.addEventListener("pagehide", () => {
        for (const session of Array.from(liveVideoSessions)) {
            teardownVideoSession(session);
        }
        clearTimeout(videoSweepTimer);
        videoSweepTimer = null;
    });
    window.addEventListener("popstate", sweepDeadVideoSessions, { passive: true });
    document.addEventListener("yt-navigate-finish", sweepDeadVideoSessions, { passive: true });
    document.addEventListener("yt-page-data-updated", sweepDeadVideoSessions, { passive: true });

    const initialVideos = Array.from(document.querySelectorAll("video"));
    initialVideos.forEach(registerVideo);
    const initialVideo = selectBestVideo();
    if (initialVideo) activateVideo(initialVideo);

    function isNetflixPage() {
        return !!globalThis.LectoroNetflixAdapter?.isPage?.();
    }

    function getAllCues(video) {
        const session = videoSessions.get(video);
        const adapter =
            session?.binding?.adapter ||
            (isNetflixPage() ? globalThis.LectoroNetflixAdapter : null);
        if (typeof adapter?.getAllCues === "function") {
            const adapterCues = adapter.getAllCues(video);
            if (Array.isArray(adapterCues) && adapterCues.length > 0) {
                return adapterCues;
            }
        }
        if (!video?.textTracks) return [];
        const cues = [];
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (
                !["subtitles", "captions"].includes(track.kind) ||
                track.mode === "disabled" ||
                !track.cues
            ) {
                continue;
            }
            for (let j = 0; j < track.cues.length; j++) cues.push(track.cues[j]);
        }
        const seen = new Set();
        return cues
            .filter((c) => {
                const key = `${c.startTime.toFixed(3)}-${c.endTime.toFixed(3)}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .sort((a, b) => a.startTime - b.startTime);
    }

    function getCurrentCueIndex(cues, time) {
        let idx = 0;
        for (let i = cues.length - 1; i >= 0; i--) {
            if (time >= cues[i].startTime - 0.05) {
                idx = i;
                break;
            }
        }
        return idx;
    }

    function getAdjacentCueTime(cues, currentTime, direction) {
        if (!Array.isArray(cues) || cues.length === 0) return null;
        if (globalThis.SharedSubtitleService?.findAdjacentCueTime) {
            return globalThis.SharedSubtitleService.findAdjacentCueTime(
                cues,
                currentTime,
                direction,
            );
        }
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
            currentTime <= currentCue.endTime + 0.15;
        const targetIndex = isInsideCurrentCue
            ? previousIndex - 1
            : previousIndex;
        return targetIndex >= 0 ? cues[targetIndex].startTime : null;
    }

    let netflixVirtualTargetTime = null;
    let netflixVirtualResetTimer = null;
    let netflixVideoBound = null;

    function ensureNetflixVideoSeekedListener(video) {
        if (!video || netflixVideoBound === video) return;
        netflixVideoBound = video;
        video.addEventListener(
            "seeked",
            () => {
                if (
                    Number.isFinite(netflixVirtualTargetTime) &&
                    Math.abs(video.currentTime - netflixVirtualTargetTime) < 0.45
                ) {
                    netflixVirtualTargetTime = null;
                }
                const session = videoSessions.get(video);
                if (session === videoSessions.get(activeVideo)) {
                    dispatchSubtitleChange(session);
                }
            },
            { passive: true },
        );
    }

    async function navigateNetflixSubtitle(video, direction) {
        if (!video) return;
        ensureNetflixVideoSeekedListener(video);
        const wasPlaying = !video.paused;
        try {
            const baseTime =
                Number.isFinite(netflixVirtualTargetTime)
                    ? netflixVirtualTargetTime
                    : video.currentTime;

            let targetTime = await globalThis.LectoroNetflixAdapter?.getAdjacentSubtitleTime?.(
                baseTime,
                direction,
            );

            // Several key presses may be waiting for the first subtitle
            // download. Rebase later continuations on the virtual target
            // selected by the earlier press instead of repeating one cue.
            if (
                Number.isFinite(netflixVirtualTargetTime) &&
                Math.abs(netflixVirtualTargetTime - baseTime) > 0.04
            ) {
                targetTime = await globalThis.LectoroNetflixAdapter?.getAdjacentSubtitleTime?.(
                    netflixVirtualTargetTime,
                    direction,
                );
            }

            if (!Number.isFinite(targetTime)) {
                const nativeCues = getAllCues(video);
                if (nativeCues.length > 0) {
                    targetTime = getAdjacentCueTime(
                        nativeCues,
                        baseTime,
                        direction,
                    );
                }
            }
            if (!Number.isFinite(targetTime)) {
                if (typeof QT !== "undefined" && QT.createHint) {
                    QT.createHint(LectoroConstants.UI_CLASSES.SUB_HINT).show(
                        direction < 0
                            ? "No previous subtitle in timeline"
                            : "No next subtitle in timeline",
                        1800,
                    );
                }
                if (wasPlaying && video.paused) video.play().catch(() => {});
                return;
            }

            // Immediately register virtual target so consecutive rapid keypresses calculate subsequent cues
            netflixVirtualTargetTime = targetTime;

            if (netflixVirtualResetTimer) clearTimeout(netflixVirtualResetTimer);
            netflixVirtualResetTimer = setTimeout(() => {
                netflixVirtualTargetTime = null;
            }, 1500);

            // The bridge executes the first seek immediately and safely
            // coalesces only genuinely rapid follow-up requests.
            globalThis.LectoroNetflixAdapter?.requestSeek?.(targetTime, video);

            // Render the indexed cue now instead of waiting for Netflix to
            // rebuild .player-timedtext after its media pipeline catches up.
            const session = videoSessions.get(video);
            if (session === videoSessions.get(activeVideo)) {
                dispatchSubtitleChange(session);
            }
        } catch (error) {
            console.warn("[Lectoro] Netflix subtitle navigation failed:", error);
            if (typeof QT !== "undefined" && QT.createHint) {
                QT.createHint(LectoroConstants.UI_CLASSES.SUB_HINT).show(
                    "Could not load Netflix subtitle timeline",
                    2200,
                );
            }
            if (wasPlaying && video.paused) video.play().catch(() => {});
        }
    }

    async function navigateSubtitle(video, direction) {
        if (!video) return;
        if (isNetflixPage()) {
            return navigateNetflixSubtitle(video, direction);
        }

        const session = videoSessions.get(video);
        const adapter = session?.binding?.adapter;
        if (typeof adapter?.getAdjacentSubtitleTime === "function") {
            try {
                const targetTime = await adapter.getAdjacentSubtitleTime(
                    video,
                    direction,
                );
                if (Number.isFinite(targetTime)) {
                    if (typeof adapter.requestSeek === "function") {
                        adapter.requestSeek(targetTime, video);
                    } else {
                        video.currentTime = targetTime;
                    }
                    if (video.paused) video.play().catch?.(() => {});
                    return;
                }
            } catch (_) {}
        }

        const nativeCues = getAllCues(video);
        let targetTime = null;
        if (nativeCues.length > 0) {
            targetTime = getAdjacentCueTime(
                nativeCues,
                video.currentTime,
                direction,
            );
        }

        // On Netflix, NEVER use +-3s fallback seeking
        if (isNetflixPage()) {
            return;
        }

        if (!Number.isFinite(targetTime)) {
            const fallbackDelta = direction > 0 ? 3 : -3;
            targetTime = Math.max(
                0,
                Math.min(
                    video.duration || Infinity,
                    video.currentTime + fallbackDelta,
                ),
            );
        }

        video.currentTime = targetTime;
        if (video.paused) video.play().catch?.(() => {});
    }

    async function captureVideoReviewScreenshot(video) {
        if (isNetflixPage() && globalThis.LectoroNetflixAdapter?.captureReviewImage) {
            return (await globalThis.LectoroNetflixAdapter.captureReviewImage(video)) || "";
        }
        if (typeof QT !== "undefined" && QT.captureVideoScreenshot) {
            return QT.captureVideoScreenshot(video) || "";
        }
        return "";
    }

    function pauseVideo(video = null) {
        const targetVideo = video || PlayerRegistry.getVideo();
        if (!targetVideo) return false;
        const session = videoSessions.get(targetVideo);
        const adapter = session?.binding?.adapter;
        if (typeof adapter?.pauseVideo === "function") {
            adapter.pauseVideo(targetVideo);
            return true;
        }
        if (!targetVideo.paused) {
            try {
                targetVideo.pause();
                return true;
            } catch (_) {}
        }
        return false;
    }

    function playVideo(video = null) {
        const targetVideo = video || PlayerRegistry.getVideo();
        if (!targetVideo) return;
        const session = videoSessions.get(targetVideo);
        const adapter = session?.binding?.adapter;
        if (typeof adapter?.playVideo === "function") {
            adapter.playVideo(targetVideo);
            return;
        }
        if (targetVideo.paused) {
            try {
                targetVideo.play()?.catch?.(() => {});
            } catch (_) {}
        }
    }

    const PlayerRegistry = {
        get type() {
            const session = videoSessions.get(this.getVideo());
            return session?.binding?.adapter?.id || "native";
        },
        getVideo(options = {}) {
            // 1. Prioritize visible video near the cursor
            const best = selectBestVideo(options);
            if (best) {
                if (activeVideo !== best) activateVideo(best);
                return best;
            }

            // 2. If requireNearbyMouse was explicitly requested and no video is near, return null
            if (options.requireNearbyMouse) {
                return null;
            }

            // 3. On dedicated single-player pages:
            if (isDedicatedWatchPage()) {
                if (document.fullscreenElement) {
                    const fs = document.fullscreenElement.querySelector("video") || (document.fullscreenElement.tagName === "VIDEO" ? document.fullscreenElement : null);
                    if (fs && isVideoInViewport(fs)) return fs;
                }
                const dedicated = document.querySelector(".watch-video video, [data-uia='video-canvas'] video, #movie_player video");
                if (dedicated && isVideoInViewport(dedicated)) return dedicated;
            }

            // 4. Return activeVideo ONLY if it is still visible in the viewport!
            if (activeVideo?.isConnected && isVideoInViewport(activeVideo) && !isPreviewOrThumbnailVideo(activeVideo)) {
                return activeVideo;
            }

            return null;
        },
        pauseVideo,
        playVideo,
        getSubtitleContainer() {
            const video = this.getVideo();
            if (!video) return null;
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            return session?.binding?.container || null;
        },
        getSubtitleElements() {
            const video = this.getVideo();
            if (!video || isPreviewOrThumbnailVideo(video)) {
                return [];
            }
            if (globalThis.LectoroSubtitleOverlay?.getCustomSubtitleElements) {
                const customEls = globalThis.LectoroSubtitleOverlay.getCustomSubtitleElements();
                if (customEls.length > 0) return customEls;
            }
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            return getAdapterElements(session?.binding);
        },
        getCurrentLines() {
            const video = this.getVideo();
            if (!video || isPreviewOrThumbnailVideo(video)) {
                return [];
            }
            if (globalThis.LectoroSubtitleOverlay?.getActiveLines) {
                const customLines = globalThis.LectoroSubtitleOverlay.getActiveLines();
                if (customLines.length > 0) return customLines;
            }
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            const adapterElements = getAdapterElements(session?.binding);
            if (adapterElements.length > 0) {
                const lines = globalThis.LectoroBaseAdapter?.extractCueLines?.(adapterElements) || [];
                if (lines.length > 0) return lines;
            }
            const nativeLines = getNativeCueLines(video);
            if (nativeLines.length > 0) return nativeLines;
            return [];
        },
        getCurrentText() {
            const video = this.getVideo();
            if (!video || isPreviewOrThumbnailVideo(video)) {
                return null;
            }
            if (globalThis.LectoroSubtitleOverlay?.getActiveText) {
                const customText = globalThis.LectoroSubtitleOverlay.getActiveText();
                if (customText) return customText;
            }

            const session = videoSessions.get(video);
            const adapter = session?.binding?.adapter;
            if (typeof adapter?.getCurrentSubtitleText === "function") {
                const adapterText = adapter.getCurrentSubtitleText(video);
                if (adapterText) return adapterText;
            }

            const nativeText = getNativeCueText(video);
            if (nativeText) return nativeText;

            const lines = this.getCurrentLines();
            if (lines.length > 0) return lines.join(" ");

            const elements = this.getSubtitleElements();
            if (elements.length === 0) return null;

            const texts = elements
                .map((element) => {
                    if (typeof SharedUtils !== "undefined" && SharedUtils.extractSubtitleText) {
                        return SharedUtils.extractSubtitleText(element);
                    }
                    return element.textContent.trim();
                })
                .filter(Boolean);

            return Array.from(new Set(texts)).join(" ") || null;
        },
        onSubtitleChange(callback) {
            subtitleChangeCallback = callback;
        },
        getSubtitleContext(video = null, activeText = "", options = {}) {
            const targetVideo = video || this.getVideo();
            const cues = this.getAllCues(targetVideo);
            const subService =
                globalThis.SharedSubtitleService ||
                globalThis.LectoroSubtitleService;

            if (
                Array.isArray(cues) &&
                cues.length > 0 &&
                typeof subService?.getSurroundingContext === "function"
            ) {
                return subService.getSurroundingContext(
                    cues,
                    targetVideo,
                    activeText,
                    options,
                );
            }

            return {
                before: [],
                current: String(activeText || "").trim(),
                after: [],
            };
        },
        getAllCues,
        getCurrentCueIndex,
        getAdjacentCueTime,
        navigateNetflixSubtitle,
        navigateSubtitle,
        captureVideoReviewScreenshot,
        isNetflixPage,
        isPreviewOrThumbnailVideo,
        isCcActive,
        findCaptionBinding,
        getAdapterElements,
    };

    globalThis.LectoroPlayerRegistry = PlayerRegistry;
})();
