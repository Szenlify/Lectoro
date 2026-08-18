/**
 * Lectoro – YouTube Player Caption Adapter
 * Handles YouTube HTML5 video player and caption rendering.
 */
(() => {
    "use strict";

    const YouTubeAdapter = {
        id: "youtube",
        name: "YouTube",
        playerSelector: "#movie_player, .html5-video-player",
        containerSelector: ".ytp-caption-window-container",
        cueSelector: ".ytp-caption-segment",
        leafOnly: false,
        documentFallback: false,

        isPage() {
            return /(^|\.)youtube\.com$/i.test(window.location.hostname);
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
                leafOnly: false,
                cueSelector: this.cueSelector,
            });
        },
    };

    globalThis.LectoroYouTubeAdapter = YouTubeAdapter;
})();
