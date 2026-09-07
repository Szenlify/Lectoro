/**
 * Lectoro – Video Keyboard Hotkeys & Navigation Manager
 * Handles WSAD, Enter, Z, Space, Speed, and subtitle seeking across video players.
 */
(() => {
    "use strict";

    const NAV_KEYS = new Set([
        "a", "A", "ArrowLeft",
        "d", "D", "ArrowRight",
        "w", "W", "ArrowUp",
        "s", "S", "ArrowDown",
        "e", "E",
        "Enter", "NumpadEnter",
        "q", "Q",
        "Escape",
        "z", "Z",
        "[", "{", "]", "}",
        "Home", "PageUp",
    ]);

    const FALLBACK_SKIP_SECONDS = 3;
    let lastNetflixNavRepeatTime = 0;
    const NETFLIX_KEY_REPEAT_THROTTLE_MS = 120;

    function getRegistry() {
        return globalThis.LectoroPlayerRegistry;
    }

    function getOverlay() {
        return globalThis.LectoroSubtitleOverlay;
    }

    function isTyping(target) {
        if (!target) return false;
        const tag = target.tagName;
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            target.isContentEditable
        );
    }

    document.addEventListener(
        "keydown",
        (e) => {
            if (isTyping(e.target)) return;

            const key = e.key;
            if (key === " " || key === "Spacebar") {
                const overlay = getOverlay();
                if (overlay?.isSubtitleUiOpen?.()) {
                    overlay?.restoreOriginal?.();
                }
                overlay?.closeSubTooltip?.({ resumeVideo: false });
                return;
            }
            if (!NAV_KEYS.has(key)) return;

            const registry = getRegistry();
            const overlay = getOverlay();

            const video = registry?.getVideo({ requireNearbyMouse: true });
            if (!video) return;

            const isHorizontalSubtitleNavigation = [
                "a", "A", "ArrowLeft",
                "d", "D", "ArrowRight",
            ].includes(key);

            if (isHorizontalSubtitleNavigation) {
                const isNetflix =
                    (typeof registry?.isNetflixPage === "function" && registry.isNetflixPage()) ||
                    /(^|\.)netflix\.com$/i.test(window.location.hostname);
                if (isNetflix && e.repeat) {
                    const now = Date.now();
                    if (now - lastNetflixNavRepeatTime < NETFLIX_KEY_REPEAT_THROTTLE_MS) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        return;
                    }
                    lastNetflixNavRepeatTime = now;
                }
            }

            const subtitleUiOpen = overlay?.isSubtitleUiOpen?.() || false;
            const aiTooltipOpen = overlay?.isAiTooltipActive?.() || false;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Holding S must not close the session just opened by the first keydown.
            if (e.repeat && ["s", "S", "e", "E", "ArrowDown"].includes(key)) return;

            // Speed Control: [ and ]
            if (["[", "{", "]", "}"].includes(key)) {
                let currentRate = video.playbackRate;
                if (key === "[" || key === "{") {
                    currentRate = Math.max(0.25, currentRate - 0.05);
                } else {
                    currentRate = Math.min(2.0, currentRate + 0.05);
                }
                currentRate = Math.round(currentRate * 100) / 100;
                video.playbackRate = currentRate;
                overlay?.showSpeedOverlay(currentRate, video);
                return;
            }

            // AI Explanation Toggle: Enter / Q
            if (
                key === "Enter" ||
                key === "NumpadEnter" ||
                key === "q" ||
                key === "Q"
            ) {
                if (e.repeat) return;
                if (aiTooltipOpen) {
                    overlay?.closeAiTooltip?.({ resumeVideo: true });
                } else {
                    overlay?.handleAIExplain(video);
                }
                return;
            }

            // AI Explanation Queue Navigation & Controls: W (replay TTS) / ArrowRight / ArrowLeft / A / D / Z (save active card) / Escape
            if (aiTooltipOpen) {
                if (key === "w" || key === "W") {
                    if (overlay?.replayCurrentAiExplainTts?.()) {
                        return;
                    }
                }
                if (key === "ArrowRight" || key === "d" || key === "D") {
                    if (overlay?.nextAiExplainItem?.({ manual: true })) {
                        return;
                    }
                }
                if (key === "ArrowLeft" || key === "a" || key === "A") {
                    if (overlay?.prevAiExplainItem?.({ manual: true })) {
                        return;
                    }
                }
                if (key === "z" || key === "Z") {
                    if (overlay?.saveCurrentAiExplainItem?.()) {
                        return;
                    }
                }
                if (key === "Escape") {
                    overlay?.closeAiTooltip?.({ resumeVideo: true });
                    return;
                }
                overlay?.closeAiTooltip?.({
                    resumeVideo: !isHorizontalSubtitleNavigation,
                });
                if (!isHorizontalSubtitleNavigation) return;
            }

            // Save Current Subtitle Sentence: Z / Home / PageUp
            if (
                key === "z" ||
                key === "Z" ||
                key === "Home" ||
                key === "PageUp"
            ) {
                overlay?.saveCurrentSentenceToReview();
                return;
            }

            // Hide Video.js controls
            if (globalThis.LectoroGenericVideoAdapter?.ensureControlsHidden) {
                globalThis.LectoroGenericVideoAdapter.ensureControlsHidden();
                globalThis.LectoroGenericVideoAdapter.clearControlBarTimer();
            }

            // Hide Netflix controls & badges when navigating via keyboard hotkeys
            if (globalThis.LectoroNetflixAdapter?.ensureControlsHidden) {
                globalThis.LectoroNetflixAdapter.ensureControlsHidden();
            }

            // Close existing subtitle overlay UI if open
            if (subtitleUiOpen) {
                try {
                    overlay?.restoreOriginal();
                } finally {
                    overlay?.resumeVideoAfterSubtitleClose(video);
                }
                if (!isHorizontalSubtitleNavigation) return;
            }

            // Subtitle Word Cloud / Sentence Translation: S / E / ArrowDown
            if (
                key === "s" ||
                key === "S" ||
                key === "ArrowDown" ||
                key === "e" ||
                key === "E"
            ) {
                if (!e.repeat) void globalThis.LectoroReadingModes.start(video);
                return;
            }

            // Play / Pause Toggle: W / ArrowUp
            if (key === "w" || key === "W" || key === "ArrowUp") {
                if (video.paused) {
                    if (typeof registry?.playVideo === "function") {
                        registry.playVideo(video);
                    } else {
                        video.play().catch?.(() => {});
                    }
                } else {
                    if (typeof registry?.pauseVideo === "function") {
                        registry.pauseVideo(video);
                    } else {
                        video.pause();
                    }
                }
                return;
            }

            // Previous Subtitle / Seek Backward: A / ArrowLeft
            if (key === "a" || key === "A" || key === "ArrowLeft") {
                const isNetflix =
                    (typeof registry?.isNetflixPage === "function" && registry.isNetflixPage()) ||
                    /(^|\.)netflix\.com$/i.test(window.location.hostname);

                if (typeof registry?.navigateSubtitle === "function") {
                    registry.navigateSubtitle(video, -1);
                } else if (typeof registry?.navigateNetflixSubtitle === "function" && isNetflix) {
                    registry.navigateNetflixSubtitle(video, -1);
                } else if (!isNetflix) {
                    video.currentTime = Math.max(0, video.currentTime - FALLBACK_SKIP_SECONDS);
                    if (video.paused) video.play().catch?.(() => {});
                }
                return;
            }

            // Next Subtitle / Seek Forward: D / ArrowRight
            if (key === "d" || key === "D" || key === "ArrowRight") {
                const isNetflix =
                    (typeof registry?.isNetflixPage === "function" && registry.isNetflixPage()) ||
                    /(^|\.)netflix\.com$/i.test(window.location.hostname);

                if (typeof registry?.navigateSubtitle === "function") {
                    registry.navigateSubtitle(video, 1);
                } else if (typeof registry?.navigateNetflixSubtitle === "function" && isNetflix) {
                    registry.navigateNetflixSubtitle(video, 1);
                } else if (!isNetflix) {
                    video.currentTime = Math.min(
                        video.duration || Infinity,
                        video.currentTime + FALLBACK_SKIP_SECONDS,
                    );
                    if (video.paused) video.play().catch?.(() => {});
                }
                return;
            }
        },
        true,
    );
})();
