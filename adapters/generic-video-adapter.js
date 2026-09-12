/**
 * Lectoro – Generic Video.js / HTML5 Player Caption Adapter
 * Handles Video.js based video player captions and control-bar auto-hiding.
 */
(() => {
    "use strict";

    let controlBarTimer = null;
    const HIDE_CLASS = "__qt_hide-controls";

    function ensureControlsHidden() {
        const vjsEl = document.querySelector(".video-js");
        if (vjsEl && !vjsEl.classList.contains(HIDE_CLASS)) {
            vjsEl.classList.add(HIDE_CLASS);
        }
    }

    function initControlBarHide() {
        const vjsEl = document.querySelector(".video-js");
        if (!vjsEl || vjsEl.__qtMouseBound) return;
        vjsEl.__qtMouseBound = true;
        vjsEl.classList.add(HIDE_CLASS);
        vjsEl.addEventListener("mousemove", () => {
            vjsEl.classList.remove(HIDE_CLASS);
            clearTimeout(controlBarTimer);
            controlBarTimer = setTimeout(() => {
                vjsEl.classList.add(HIDE_CLASS);
            }, 3000);
        });
        vjsEl.addEventListener("mouseleave", () => {
            clearTimeout(controlBarTimer);
            vjsEl.classList.add(HIDE_CLASS);
        });
    }

    initControlBarHide();
    document.addEventListener("fullscreenchange", () => setTimeout(initControlBarHide, 200));
    document.addEventListener("webkitfullscreenchange", () => setTimeout(initControlBarHide, 200));

    const { createDomAdapter } = globalThis.LectoroBaseAdapter;

    const GenericVideoAdapter = createDomAdapter({
        id: "videojs",
        name: "Video.js / HTML5 Player",
        playerSelector: ".video-js",
        containerSelector: ".vjs-text-track-display",
        cueSelector: ".vjs-text-track-cue div",
        leafOnly: true,
        isPage: () => !!document.querySelector(".video-js"),
        extraProps: {
            ensureControlsHidden,
            clearControlBarTimer() {
                clearTimeout(controlBarTimer);
            },
        },
    });

    globalThis.LectoroGenericVideoAdapter = GenericVideoAdapter;
})();
