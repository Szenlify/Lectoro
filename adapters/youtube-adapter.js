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
              cueSelector: ".caption-visual-line, .ytp-caption-segment",
              leafOnly: false,
              isPage: () => /(^|\.)youtube\.com$/i.test(window.location.hostname),
              extraProps: {
                  getCueElements(container) {
                      if (!container || !container.isConnected) return [];
                      const visualLines = Array.from(container.querySelectorAll(".caption-visual-line"));
                      if (visualLines.length > 0) {
                          return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(visualLines);
                      }
                      const segments = Array.from(container.querySelectorAll(".ytp-caption-segment"));
                      return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(segments);
                  },
              },
          })
        : {
              id: "youtube",
              name: "YouTube",
              playerSelector: "#movie_player, .html5-video-player",
              containerSelector: ".ytp-caption-window-container",
              cueSelector: ".caption-visual-line, .ytp-caption-segment",
              isPage: () => /(^|\.)youtube\.com$/i.test(window.location.hostname),
              matchVideo: (video) => !!video?.closest?.("#movie_player, .html5-video-player"),
              getContainer: (video) => (video?.closest?.("#movie_player, .html5-video-player") || document).querySelector(".ytp-caption-window-container"),
              getCueElements: (container) => {
                  if (!container || !container.isConnected) return [];
                  const visualLines = Array.from(container.querySelectorAll(".caption-visual-line"));
                  if (visualLines.length > 0) {
                      return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(visualLines);
                  }
                  return Array.from(container.querySelectorAll(".ytp-caption-segment"));
              },
          };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
