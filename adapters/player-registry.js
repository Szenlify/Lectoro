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
    let netflixSubtitleNavigationPending = false;

    function getRegisteredAdapters() {
        const adapters = [];
        if (globalThis.LectoroYouTubeAdapter) adapters.push(globalThis.LectoroYouTubeAdapter);
        if (globalThis.LectoroLookmovieAdapter) adapters.push(globalThis.LectoroLookmovieAdapter);
        if (globalThis.LectoroNetflixAdapter) adapters.push(globalThis.LectoroNetflixAdapter);
        if (Array.isArray(globalThis.LectoroGenericAdapters)) {
            adapters.push(...globalThis.LectoroGenericAdapters);
        }
        return adapters;
    }

    function isOwnUI(target) {
        if (globalThis.LectoroBaseAdapter?.isOwnUI) {
            return globalThis.LectoroBaseAdapter.isOwnUI(target);
        }
        return false;
    }

    function extractCueText(node) {
        if (typeof SharedUtils !== "undefined" && SharedUtils.extractSubtitleText) {
            return SharedUtils.extractSubtitleText(node);
        }
        return (node?.textContent || "").replace(/\s+/g, " ").trim();
    }

    function cueText(cue) {
        const raw = typeof cue?.text === "string" ? cue.text.trim() : "";
        if (!raw) return "";
        if (!raw.includes("<")) return raw;

        const holder = document.createElement("div");
        holder.innerHTML = raw;
        return extractCueText(holder);
    }

    function getNativeCueText(video) {
        if (!video?.textTracks) return "";
        const showing = [];
        const hidden = [];

        for (let i = 0; i < video.textTracks.length; i += 1) {
            const track = video.textTracks[i];
            if (
                !["subtitles", "captions"].includes(track.kind) ||
                track.mode === "disabled" ||
                !track.activeCues
            ) {
                continue;
            }
            const texts = Array.from(track.activeCues)
                .map(cueText)
                .filter(Boolean);
            if (texts.length === 0) continue;
            (track.mode === "showing" ? showing : hidden).push(...texts);
        }

        return Array.from(new Set(showing.length > 0 ? showing : hidden)).join(" ");
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

    function selectBestVideo() {
        let best = null;
        let bestScore = -1;
        for (const session of liveVideoSessions) {
            const video = session.video;
            if (!video.isConnected) continue;
            const score =
                visibleVideoArea(video) +
                (!video.paused && !video.ended ? 1_000_000_000 : 0);
            if (score > bestScore) {
                best = video;
                bestScore = score;
            }
        }
        return best;
    }

    function findCaptionBinding(video) {
        if (!video?.isConnected) return null;
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
            const elements = getAdapterElements(session.binding);
            if (typeof subtitleChangeCallback === "function") {
                subtitleChangeCallback(elements, session);
            }
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

        for (let i = 0; i < tracks.length; i += 1) {
            const track = tracks[i];
            if (!["subtitles", "captions"].includes(track.kind)) continue;
            if (session.tracks.has(track)) continue;
            session.tracks.add(track);
            track.addEventListener(
                "cuechange",
                () => {
                    session.nativeText = getNativeCueText(session.video);
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
        if (globalThis.LectoroLookmovieAdapter?.ensureControlsHidden) {
            globalThis.LectoroLookmovieAdapter.ensureControlsHidden();
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
                if (now - session.lastFallbackAt < CAPTION_FALLBACK_MS) return;
                session.lastFallbackAt = now;
                session.nativeText = getNativeCueText(video);
                if (hasEnabledNativeCaptionTrack(video)) return;
                refreshCaptionBinding(session, !session.binding);
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

    const initialVideos = Array.from(document.querySelectorAll("video"));
    initialVideos.forEach(registerVideo);
    const initialVideo = selectBestVideo();
    if (initialVideo) activateVideo(initialVideo);

    function isNetflixPage() {
        return !!globalThis.LectoroNetflixAdapter?.isPage?.();
    }

    function getAllCues(video) {
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

    async function navigateNetflixSubtitle(video, direction) {
        if (netflixSubtitleNavigationPending) return;
        netflixSubtitleNavigationPending = true;
        const wasPlaying = !video.paused;
        try {
            const nativeCues = getAllCues(video);
            let targetTime = getAdjacentCueTime(
                nativeCues,
                video.currentTime,
                direction,
            );
            if (targetTime === null) {
                if (wasPlaying) video.pause();
                if (typeof QT !== "undefined") {
                    QT.createHint("").show("Indeksuję napisy Netflixa…", 1200);
                }
                targetTime = await globalThis.LectoroNetflixAdapter?.getAdjacentSubtitleTime?.(
                    video,
                    direction,
                );
            }
            if (!Number.isFinite(targetTime)) {
                if (typeof QT !== "undefined") {
                    QT.createHint("").show(
                        direction < 0
                            ? "Brak wcześniejszego zdania w napisach"
                            : "Brak następnego zdania w napisach",
                        2200,
                    );
                }
                if (wasPlaying && video.paused) video.play().catch(() => {});
                return;
            }
            globalThis.LectoroNetflixAdapter?.requestSeek?.(targetTime);
        } catch (error) {
            console.warn("[Lectoro] Netflix subtitle navigation failed:", error);
            if (typeof QT !== "undefined") {
                QT.createHint("").show(
                    "Nie udało się załadować osi napisów Netflixa",
                    2400,
                );
            }
            if (wasPlaying && video.paused) video.play().catch(() => {});
        } finally {
            netflixSubtitleNavigationPending = false;
        }
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

    const PlayerRegistry = {
        get type() {
            const session = videoSessions.get(this.getVideo());
            return session?.binding?.adapter?.id || "native";
        },
        getVideo() {
            if (activeVideo?.isConnected) return activeVideo;
            const best = selectBestVideo();
            if (best) {
                activateVideo(best);
                return best;
            }
            const first = document.querySelector("video");
            if (first) activateVideo(first);
            return first;
        },
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
            if (!video) return [];
            const session = videoSessions.get(video);
            if (session && !session.binding?.container?.isConnected) {
                refreshCaptionBinding(session);
            }
            return getAdapterElements(session?.binding);
        },
        getCurrentText() {
            const video = this.getVideo();
            if (!video) return null;

            if (isNetflixPage() && globalThis.LectoroNetflixAdapter?.captureRenderedLines) {
                const elements = this.getSubtitleElements();
                const renderedLines = globalThis.LectoroNetflixAdapter.captureRenderedLines(elements);
                const renderedText = renderedLines
                    .map((line) => line.text)
                    .filter(Boolean)
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim();
                if (renderedText) return renderedText;
            }

            const nativeText = getNativeCueText(video);
            if (nativeText) return nativeText;

            const text = this.getSubtitleElements()
                .map((element) => element.textContent.trim())
                .filter(Boolean)
                .join(" ");

            return text || null;
        },
        onSubtitleChange(callback) {
            subtitleChangeCallback = callback;
        },
        getAllCues,
        getCurrentCueIndex,
        getAdjacentCueTime,
        navigateNetflixSubtitle,
        captureVideoReviewScreenshot,
        isNetflixPage,
        findCaptionBinding,
        getAdapterElements,
    };

    globalThis.LectoroPlayerRegistry = PlayerRegistry;
})();
