/**
 * Lectoro – LookMovie / Video.js Player Caption Adapter
 * Handles LookMovie (and any Video.js based video player) captions and control-bar auto-hiding.
 */
(() => {
    "use strict";

    let controlBarTimer = null;

    function ensureControlsHidden() {
        const vjsEl = document.querySelector(".video-js");
        if (vjsEl && !vjsEl.classList.contains("__qt_hide-controls")) {
            vjsEl.classList.add("__qt_hide-controls");
        }
    }

    function initControlBarHide() {
        const vjsEl = document.querySelector(".video-js");
        if (!vjsEl || vjsEl.__qtMouseBound) return;
        vjsEl.__qtMouseBound = true;
        vjsEl.classList.add("__qt_hide-controls");
        vjsEl.addEventListener("mousemove", () => {
            vjsEl.classList.remove("__qt_hide-controls");
            clearTimeout(controlBarTimer);
            controlBarTimer = setTimeout(() => {
                vjsEl.classList.add("__qt_hide-controls");
            }, 3000);
        });
        vjsEl.addEventListener("mouseleave", () => {
            clearTimeout(controlBarTimer);
            vjsEl.classList.add("__qt_hide-controls");
        });
    }

    // Initialize Video.js control bar listeners
    initControlBarHide();
    document.addEventListener("fullscreenchange", () =>
        setTimeout(initControlBarHide, 200),
    );
    document.addEventListener("webkitfullscreenchange", () =>
        setTimeout(initControlBarHide, 200),
    );

    const LookmovieAdapter = {
        id: "videojs",
        name: "Video.js / LookMovie",
        playerSelector: ".video-js",
        containerSelector: ".vjs-text-track-display",
        cueSelector: ".vjs-text-track-cue div",
        leafOnly: true,
        documentFallback: false,

        isPage() {
            return /(^|\.)lookmovie/i.test(window.location.hostname);
        },

        matchVideo(video) {
            if (!video) return false;
            return !!video.closest(this.playerSelector);
        },

        getContainer(video) {
            const player = video.closest(this.playerSelector) || document;
            return player.querySelector(this.containerSelector);
        },

        getCueElements(container) {
            if (!container || !container.isConnected) return [];
            const candidates = Array.from(container.querySelectorAll(this.cueSelector));
            return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(candidates, {
                leafOnly: true,
                cueSelector: this.cueSelector,
            });
        },

        ensureControlsHidden,
        clearControlBarTimer() {
            clearTimeout(controlBarTimer);
        },
    };

    globalThis.LectoroLookmovieAdapter = LookmovieAdapter;
})();
