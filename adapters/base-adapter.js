/**
 * Lectoro – Base Video Adapter & Adapter Factory (DRY)
 * Provides shared interfaces, cue filtering, and standard DOM adapter factory.
 */
(() => {
    "use strict";

    const PREFIX = (typeof LectoroConstants !== "undefined" && LectoroConstants.PREFIX) || "__qt_";

    function isLectoroElement(element) {
        return Array.from(element?.classList || []).some((className) =>
            className.startsWith(PREFIX),
        );
    }

    function isOwnUI(target) {
        if (typeof LectoroConstants !== "undefined" && typeof LectoroConstants.isOwnUI === "function") {
            return LectoroConstants.isOwnUI(target);
        }
        if (typeof QT !== "undefined" && typeof QT.isOwnUI === "function") {
            return QT.isOwnUI(target);
        }
        return !!target?.closest?.(`#${PREFIX}icon, #${PREFIX}tooltip, .${PREFIX}word-cloud, #${PREFIX}save_toast`);
    }

    /**
     * Filter DOM elements to extract only clean caption text nodes,
     * ignoring Lectoro's own injected UI elements.
     */
    function filterCueCandidates(candidates, { leafOnly = false, cueSelector = "" } = {}) {
        return candidates.filter((element) => {
            if (
                isOwnUI(element) ||
                isLectoroElement(element) ||
                !element.textContent?.trim()
            ) {
                return false;
            }
            if (leafOnly && cueSelector) {
                const hasPlayerOwnedChildCue = Array.from(
                    element.querySelectorAll(cueSelector),
                ).some((child) => !isOwnUI(child) && !isLectoroElement(child));
                if (hasPlayerOwnedChildCue) return false;
            }
            return true;
        });
    }

    /**
     * Factory function to create standard DOM caption adapters without boilerplate.
     */
    function createDomAdapter({
        id,
        name,
        playerSelector,
        containerSelector,
        cueSelector,
        leafOnly = false,
        documentFallback = false,
        isPage = null,
        extraProps = {},
    }) {
        return {
            id,
            name,
            playerSelector,
            containerSelector,
            cueSelector,
            leafOnly,
            documentFallback,
            isPage: isPage || (() => true),
            matchVideo(video) {
                if (!video) return false;
                return playerSelector ? !!video.closest(playerSelector) : true;
            },
            getContainer(video) {
                const player = (playerSelector && video ? video.closest(playerSelector) : null) || document;
                return player.querySelector(containerSelector);
            },
            getCueElements(container) {
                if (!container || !container.isConnected) return [];
                const candidates = Array.from(
                    new Set([
                        ...(container.matches?.(cueSelector) ? [container] : []),
                        ...container.querySelectorAll(cueSelector),
                    ]),
                );
                return filterCueCandidates(candidates, { leafOnly, cueSelector });
            },
            ...extraProps,
        };
    }

    /**
     * Extracts clean, trimmed line strings from cue elements,
     * preserving multi-line breaks where present.
     */
    function extractCueLines(elements) {
        if (!Array.isArray(elements) || elements.length === 0) return [];
        const lines = [];
        for (const el of elements) {
            if (!el || isOwnUI(el) || isLectoroElement(el)) continue;
            let text = "";
            if (typeof SharedUtils !== "undefined" && SharedUtils.extractSubtitleText) {
                text = SharedUtils.extractSubtitleText(el);
            } else {
                text = (el.textContent || "").replace(/\s+/g, " ").trim();
            }
            if (text && !lines.includes(text)) {
                lines.push(text);
            }
        }
        return lines;
    }

    globalThis.LectoroBaseAdapter = Object.freeze({
        PREFIX,
        isOwnUI,
        isLectoroElement,
        filterCueCandidates,
        createDomAdapter,
        extractCueLines,
    });
})();

