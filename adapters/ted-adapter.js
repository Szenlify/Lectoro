/**
 * Lectoro – TED Talks Video Player & Captions Adapter
 * Accurately captures full subtitle sentences in the exact language selected in the TED player.
 */
(() => {
    "use strict";

    function isTedPage() {
        const hostname = (typeof window !== "undefined" && window.location?.hostname) || "";
        return /(^|\.)ted\.com$/i.test(hostname);
    }

    function isCcActive(video) {
        if (!video || !video.isConnected) return false;
        if (!isTedPage()) return false;

        const subContainer = document.getElementById("subtitles-container");
        if (subContainer) {
            if (subContainer.classList.contains("opacity-0")) {
                return false;
            }
            const text = (subContainer.textContent || "").trim();
            if (text.length > 0) return true;
        }

        if (video.textTracks) {
            for (let i = 0; i < video.textTracks.length; i++) {
                const track = video.textTracks[i];
                if ((track.mode === "showing" || track.mode === "hidden") && track.activeCues?.length > 0) {
                    return true;
                }
            }
        }

        return false;
    }

    function getCueElements(container) {
        const root = container || document.getElementById("subtitles-container");
        if (!root || !root.isConnected) return [];

        if (root.id !== "subtitles-container" && !root.closest("#subtitles-container")) {
            return [];
        }

        if (root.classList.contains("opacity-0")) {
            return [];
        }

        let target =
            root.querySelector(".whitespace-pre-line") ||
            root.querySelector("span[dir]") ||
            root.querySelector(".text-textPrimary-onDark") ||
            root.querySelector("p") ||
            root.querySelector("span");

        if (!target && root.children.length > 0) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (node.textContent.trim()) {
                    target = node.parentElement;
                    break;
                }
            }
        }

        target = target || root;

        const text = (target.textContent || "").trim();
        if (text) {
            return [target];
        }

        return [];
    }

    function getAllCues(video) {
        if (!video?.textTracks) return [];
        for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if ((track.mode === "showing" || track.mode === "hidden") && track.cues && track.cues.length > 0) {
                const cues = [];
                for (let j = 0; j < track.cues.length; j++) {
                    const c = track.cues[j];
                    if (c && typeof c.startTime === "number") {
                        const raw = (c.text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                        if (raw) {
                            cues.push({
                                startTime: c.startTime,
                                endTime: c.endTime,
                                text: raw,
                            });
                        }
                    }
                }
                if (cues.length > 0) {
                    return cues.sort((a, b) => a.startTime - b.startTime);
                }
            }
        }
        return [];
    }

    const TedAdapter = {
        id: "ted",
        name: "TED Talks",
        playerSelector: "#subtitles-container, .ted-player, #ted-player, [data-testid*='player']",
        containerSelector: "#subtitles-container",
        cueSelector: ".whitespace-pre-line, span[dir], .text-textPrimary-onDark, span",
        leafOnly: false,
        documentFallback: true,
        isPage: isTedPage,
        isCcActive,
        getCueElements,
        getAllCues,
    };

    globalThis.LectoroTedAdapter = TedAdapter;
})();
