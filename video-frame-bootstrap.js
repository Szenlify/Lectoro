(() => {
    "use strict";

    // The top frame already receives the regular Lectoro content script.
    if (window === window.top) return;

    let requested = false;

    function requestVideoRuntime(target) {
        if (requested || !(target instanceof HTMLVideoElement)) return;
        requested = true;
        chrome.runtime.sendMessage(
            { type: "QT_ENABLE_VIDEO_FRAME" },
            (result) => {
                const error = chrome.runtime.lastError;
                if (error || !result?.ok) requested = false;
            },
        );
    }

    const initialVideo = document.querySelector("video");
    if (initialVideo) requestVideoRuntime(initialVideo);

    function handleMediaEvent(event) {
        requestVideoRuntime(event.target);
    }

    document.addEventListener("loadedmetadata", handleMediaEvent, true);
    document.addEventListener("play", handleMediaEvent, true);
})();
