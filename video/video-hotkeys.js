/**
 * Lectoro – Video Keyboard Hotkeys & Navigation Manager
 * Handles WSAD, Enter, Z, Space, Speed, Reels, and subtitle seeking across video players.
 */
(() => {
    "use strict";

    const NAV_KEYS = new Set([
        "a", "A", "ArrowLeft",
        "d", "D", "ArrowRight",
        "w", "W", "ArrowUp",
        "s", "S", "ArrowDown",
        "e", "E",
        "Enter",
        "q", "Q",
        "r", "R",
        "z", "Z",
        "[", "{", "]", "}",
        "Home", "PageUp",
    ]);

    const FALLBACK_SKIP_SECONDS = 3;

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
            if (!NAV_KEYS.has(key)) return;

            const registry = getRegistry();
            const overlay = getOverlay();
            const video = registry?.getVideo();
            if (!video) return;

            const isHorizontalSubtitleNavigation = [
                "a", "A", "ArrowLeft",
                "d", "D", "ArrowRight",
            ].includes(key);

            const subtitleUiOpen = overlay?.isSubtitleUiOpen?.() || false;

            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

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
                overlay?.showSpeedOverlay(currentRate);
                return;
            }

            // Reels Mode Toggle: R
            if (key === "r" || key === "R") {
                overlay?.setReelsMode(!overlay.isReelsMode());
                return;
            }

            // AI Explanation Toggle: Enter / Q
            if (key === "Enter" || key === "q" || key === "Q") {
                if (overlay?.isAiTooltipActive?.()) {
                    overlay.closeAiTooltip();
                } else {
                    overlay?.handleAIExplain(video);
                }
                return;
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

            // Hide LookMovie / VideoJS controls
            if (globalThis.LectoroLookmovieAdapter?.ensureControlsHidden) {
                globalThis.LectoroLookmovieAdapter.ensureControlsHidden();
                globalThis.LectoroLookmovieAdapter.clearControlBarTimer();
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
                if (typeof cleanupReading === "function") cleanupReading();
                const modeRevision = overlay?.nextSubtitleModeRevision();
                if (!modeRevision) return;

                const handleSubtitleAction = (data) => {
                    if (modeRevision !== overlay.subtitleModeRevision) return;
                    overlay.resetSubtitleModeStarting();
                    const snapshot = overlay.captureSubtitleSnapshot();
                    const { text, elements, layout } = snapshot;
                    if (!text) return;

                    const translationTask = overlay.createSubtitleTranslationTask(
                        text,
                        modeRevision,
                    );

                    if (registry.isNetflixPage()) {
                        globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(true);
                    }

                    if (data.wordCloudMode && data.subtitleTTS) {
                        overlay.showWordClouds(video, {
                            skipSpeech: true,
                            revision: modeRevision,
                            sourceText: text,
                            sourceElements: elements,
                            translationTask,
                            keepOriginalHidden: true,
                        }).catch((error) => {
                            console.warn("[Lectoro] Word cloud mode failed:", error);
                            overlay.removeWordClouds();
                        });

                        overlay.doSentenceTranslation(video, text, {
                            speakTranslated: true,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    } else if (data.wordCloudMode) {
                        overlay.showWordClouds(video, {
                            skipSpeech: false,
                            revision: modeRevision,
                            sourceText: text,
                            sourceElements: elements,
                            translationTask,
                            keepOriginalHidden: false,
                        }).catch((error) => {
                            console.warn("[Lectoro] Word cloud mode failed:", error);
                            if (modeRevision !== overlay.subtitleModeRevision) return;
                            overlay.removeWordClouds();
                            globalThis.LectoroNetflixAdapter?.setOriginalSubtitlesHidden?.(false);
                        });
                    } else if (data.subtitleTTS) {
                        overlay.doSentenceTranslation(video, text, {
                            speakTranslated: true,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    } else {
                        overlay.doSentenceTranslation(video, text, {
                            speakTranslated: false,
                            revision: modeRevision,
                            layout,
                            translationTask,
                        });
                    }
                };

                if (chrome?.storage?.local) {
                    chrome.storage.local.get(
                        { wordCloudMode: true, subtitleTTS: false },
                        handleSubtitleAction,
                    );
                } else {
                    handleSubtitleAction({
                        wordCloudMode: true,
                        subtitleTTS: false,
                    });
                }
                return;
            }

            // Play / Pause Toggle: W / ArrowUp
            if (key === "w" || key === "W" || key === "ArrowUp") {
                if (video.paused) {
                    video.play().catch?.(() => {});
                } else {
                    video.pause();
                }
                return;
            }

            // Previous Subtitle / Seek Backward: A / ArrowLeft
            if (key === "a" || key === "A" || key === "ArrowLeft") {
                if (registry.isNetflixPage()) {
                    registry.navigateNetflixSubtitle(video, -1);
                    return;
                }

                const cues = registry.getAllCues(video);
                const hasCues = cues.length > 0;
                let targetTime;

                if (hasCues) {
                    const idx = registry.getCurrentCueIndex(cues, video.currentTime);
                    targetTime =
                        video.currentTime - cues[idx].startTime > 1.5 && idx >= 0
                            ? cues[idx].startTime
                            : cues[Math.max(0, idx - 1)].startTime;
                } else {
                    targetTime = Math.max(0, video.currentTime - FALLBACK_SKIP_SECONDS);
                }

                video.currentTime = targetTime;
                if (video.paused) video.play().catch?.(() => {});
                return;
            }

            // Next Subtitle / Seek Forward: D / ArrowRight
            if (key === "d" || key === "D" || key === "ArrowRight") {
                if (registry.isNetflixPage()) {
                    registry.navigateNetflixSubtitle(video, 1);
                    return;
                }

                const cues = registry.getAllCues(video);
                const hasCues = cues.length > 0;
                let targetTime;

                if (hasCues) {
                    const idx = registry.getCurrentCueIndex(cues, video.currentTime);
                    targetTime = cues[Math.min(cues.length - 1, idx + 1)].startTime;
                } else {
                    targetTime = Math.min(
                        video.duration || Infinity,
                        video.currentTime + FALLBACK_SKIP_SECONDS,
                    );
                }

                video.currentTime = targetTime;
                if (video.paused) video.play().catch?.(() => {});
            }
        },
        true,
    );
})();
