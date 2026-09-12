/**
 * Lectoro – Generic HTML5 Video Player Adapters (DRY)
 * Declaratively provides caption bindings for Shaka Player, JWPlayer, Plyr, and Clappr.
 */
(() => {
    "use strict";

    const { createDomAdapter } = globalThis.LectoroBaseAdapter || {};

    if (typeof createDomAdapter !== "function") {
        console.error("[Lectoro] LectoroBaseAdapter.createDomAdapter is not defined.");
        return;
    }

    const GenericAdapters = [
        createDomAdapter({
            id: "shaka",
            name: "Shaka Player",
            playerSelector: ".shaka-video-container",
            containerSelector: ".shaka-text-container",
            cueSelector: ".shaka-text-container span",
            leafOnly: true,
        }),
        createDomAdapter({
            id: "jwplayer",
            name: "JWPlayer",
            playerSelector: ".jwplayer",
            containerSelector: ".jw-captions",
            cueSelector: ".jw-text-track-cue",
            leafOnly: false,
        }),
        createDomAdapter({
            id: "plyr",
            name: "Plyr",
            playerSelector: ".plyr",
            containerSelector: ".plyr__captions",
            cueSelector: ".plyr__caption",
            leafOnly: false,
        }),
        createDomAdapter({
            id: "clappr",
            name: "Clappr",
            playerSelector: ".clappr-container",
            containerSelector: ".clappr-subtitle, .cc-line",
            cueSelector: ".cc-line, .clappr-subtitle",
            leafOnly: false,
        }),
    ];

    globalThis.LectoroGenericAdapters = Object.freeze(GenericAdapters);
})();
