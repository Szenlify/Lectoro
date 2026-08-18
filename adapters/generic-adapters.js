/**
 * Lectoro – Generic HTML5 Video Player Adapters
 * Provides caption bindings for Shaka Player, JWPlayer, Plyr, Clappr, and standard HTML5 tracks.
 */
(() => {
    "use strict";

    const filterCues = (candidates, leafOnly, cueSelector) => {
        return (globalThis.LectoroBaseAdapter?.filterCueCandidates || ((x) => x))(candidates, {
            leafOnly,
            cueSelector,
        });
    };

    const GenericAdapters = [
        {
            id: "shaka",
            name: "Shaka Player",
            playerSelector: ".shaka-video-container",
            containerSelector: ".shaka-text-container",
            cueSelector: ".shaka-text-container span",
            leafOnly: true,
            documentFallback: false,
            matchVideo(video) {
                return !!video?.closest?.(this.playerSelector);
            },
            getContainer(video) {
                const player = video?.closest?.(this.playerSelector) || document;
                return player.querySelector(this.containerSelector);
            },
            getCueElements(container) {
                if (!container || !container.isConnected) return [];
                const candidates = Array.from(container.querySelectorAll(this.cueSelector));
                return filterCues(candidates, true, this.cueSelector);
            },
        },
        {
            id: "jwplayer",
            name: "JWPlayer",
            playerSelector: ".jwplayer",
            containerSelector: ".jw-captions",
            cueSelector: ".jw-text-track-cue",
            leafOnly: false,
            documentFallback: false,
            matchVideo(video) {
                return !!video?.closest?.(this.playerSelector);
            },
            getContainer(video) {
                const player = video?.closest?.(this.playerSelector) || document;
                return player.querySelector(this.containerSelector);
            },
            getCueElements(container) {
                if (!container || !container.isConnected) return [];
                const candidates = Array.from(container.querySelectorAll(this.cueSelector));
                return filterCues(candidates, false, this.cueSelector);
            },
        },
        {
            id: "plyr",
            name: "Plyr",
            playerSelector: ".plyr",
            containerSelector: ".plyr__captions",
            cueSelector: ".plyr__caption",
            leafOnly: false,
            documentFallback: false,
            matchVideo(video) {
                return !!video?.closest?.(this.playerSelector);
            },
            getContainer(video) {
                const player = video?.closest?.(this.playerSelector) || document;
                return player.querySelector(this.containerSelector);
            },
            getCueElements(container) {
                if (!container || !container.isConnected) return [];
                const candidates = Array.from(container.querySelectorAll(this.cueSelector));
                return filterCues(candidates, false, this.cueSelector);
            },
        },
        {
            id: "clappr",
            name: "Clappr",
            playerSelector: ".clappr-container",
            containerSelector: ".clappr-subtitle, .cc-line",
            cueSelector: ".cc-line, .clappr-subtitle",
            leafOnly: false,
            documentFallback: false,
            matchVideo(video) {
                return !!video?.closest?.(this.playerSelector);
            },
            getContainer(video) {
                const player = video?.closest?.(this.playerSelector) || document;
                return player.querySelector(this.containerSelector);
            },
            getCueElements(container) {
                if (!container || !container.isConnected) return [];
                const candidates = Array.from(container.querySelectorAll(this.cueSelector));
                return filterCues(candidates, false, this.cueSelector);
            },
        },
    ];

    globalThis.LectoroGenericAdapters = GenericAdapters;
})();
