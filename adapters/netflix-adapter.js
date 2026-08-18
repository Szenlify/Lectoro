/**
 * Lectoro – Netflix Player Caption Adapter
 * Wraps Netflix timed text bridge and DOM hit layer integration.
 */
(() => {
    "use strict";

    const NetflixAdapter = {
        id: "netflix",
        name: "Netflix",
        playerSelector: ".watch-video, [data-uia='video-canvas']",
        containerSelector: ".player-timedtext",
        cueSelector: ".player-timedtext-text-container span",
        leafOnly: true,
        documentFallback: true,

        isPage() {
            if (globalThis.LectoroNetflix?.isPage) {
                return globalThis.LectoroNetflix.isPage();
            }
            return /(^|\.)netflix\.com$/i.test(window.location.hostname);
        },

        matchVideo(video) {
            if (!this.isPage()) return false;
            return true;
        },

        getContainer(video) {
            const player = video?.closest?.(this.playerSelector) || document;
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

        requestSeek(targetSeconds) {
            if (globalThis.LectoroNetflix?.requestSeek) {
                globalThis.LectoroNetflix.requestSeek(targetSeconds);
            }
        },

        setOriginalSubtitlesHidden(hidden) {
            if (globalThis.LectoroNetflix?.setOriginalSubtitlesHidden) {
                globalThis.LectoroNetflix.setOriginalSubtitlesHidden(hidden);
            }
        },

        captureReviewImage(video) {
            if (globalThis.LectoroNetflix?.captureReviewImage) {
                return globalThis.LectoroNetflix.captureReviewImage(video);
            }
            return Promise.resolve(null);
        },

        ensureSubtitleIndex() {
            if (globalThis.LectoroNetflix?.ensureSubtitleIndex) {
                return globalThis.LectoroNetflix.ensureSubtitleIndex();
            }
            return Promise.resolve([]);
        },

        getAdjacentSubtitleTime(video, direction) {
            if (globalThis.LectoroNetflix?.getAdjacentSubtitleTime) {
                return globalThis.LectoroNetflix.getAdjacentSubtitleTime(video, direction);
            }
            return null;
        },

        createWordCloudSourceLayer(options) {
            if (globalThis.LectoroNetflix?.createWordCloudSourceLayer) {
                return globalThis.LectoroNetflix.createWordCloudSourceLayer(options);
            }
            return null;
        },

        captureRenderedLines(elements) {
            if (globalThis.LectoroNetflix?.captureRenderedLines) {
                return globalThis.LectoroNetflix.captureRenderedLines(elements);
            }
            return (elements || [])
                .map((element) => element.textContent.trim())
                .filter(Boolean)
                .map((text) => ({ text, width: 0 }));
        },
    };

    globalThis.LectoroNetflixAdapter = NetflixAdapter;
})();
