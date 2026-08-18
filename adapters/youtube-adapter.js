/**
 * Lectoro – YouTube Player Caption Adapter (DRY)
 * Handles YouTube HTML5 video player and caption rendering.
 */
(() => {
    "use strict";

    const { createDomAdapter } = globalThis.LectoroBaseAdapter || {};

    const YouTubeAdapter = typeof createDomAdapter === "function"
        ? createDomAdapter({
              id: "youtube",
              name: "YouTube",
              playerSelector: "#movie_player, .html5-video-player",
              containerSelector: ".ytp-caption-window-container",
              cueSelector: ".ytp-caption-segment",
              leafOnly: false,
              isPage: () => /(^|\.)youtube\.com$/i.test(window.location.hostname),
          })
        : {
              id: "youtube",
              name: "YouTube",
              playerSelector: "#movie_player, .html5-video-player",
              containerSelector: ".ytp-caption-window-container",
              cueSelector: ".ytp-caption-segment",
              isPage: () => /(^|\.)youtube\.com$/i.test(window.location.hostname),
              matchVideo: (video) => !!video?.closest?.("#movie_player, .html5-video-player"),
              getContainer: (video) => (video?.closest?.("#movie_player, .html5-video-player") || document).querySelector(".ytp-caption-window-container"),
              getCueElements: (container) => container ? Array.from(container.querySelectorAll(".ytp-caption-segment")) : [],
          };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
