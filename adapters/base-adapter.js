/**
 * Lectoro – Base Video Adapter Helpers & Contract
 * Shared interfaces and helper utilities for player caption adapters.
 */
(() => {
    "use strict";

    const PREFIX = "__qt_";

    function isLectoroElement(element) {
        return Array.from(element?.classList || []).some((className) =>
            className.startsWith(PREFIX),
        );
    }

    function isOwnUI(target) {
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

    globalThis.LectoroBaseAdapter = Object.freeze({
        PREFIX,
        isOwnUI,
        isLectoroElement,
        filterCueCandidates,
    });
})();
