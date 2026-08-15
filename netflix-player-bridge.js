(() => {
    "use strict";

    const SEEK_EVENT = "__lectoro_netflix_seek";
    const ARTWORK_REQUEST_EVENT = "__lectoro_netflix_artwork_request";
    const ARTWORK_RESPONSE_EVENT = "__lectoro_netflix_artwork_response";

    function getNetflixPlayer() {
        const videoPlayer =
            window.netflix?.appContext?.state?.playerApp?.getAPI?.()
                ?.videoPlayer;
        const sessionIds = videoPlayer?.getAllPlayerSessionIds?.() || [];
        const sessionId =
            sessionIds.find((id) => String(id).includes("watch")) ||
            sessionIds[0];
        return sessionId
            ? videoPlayer.getVideoPlayerBySessionId(sessionId)
            : null;
    }

    window.addEventListener(SEEK_EVENT, (event) => {
        const requestedMs = Number(event.detail?.targetMs);
        if (!Number.isFinite(requestedMs) || requestedMs < 0) return;

        try {
            const player = getNetflixPlayer();
            if (!player?.seek) return;

            const durationMs = Number(player.getDuration?.());
            const targetMs = Number.isFinite(durationMs)
                ? Math.min(requestedMs, durationMs)
                : requestedMs;
            player.seek(targetMs);
            player.play?.();
        } catch (_) {
            // Netflix's private player API can be unavailable while an episode
            // is loading. A later key press will retry with the active session.
        }
    });

    window.addEventListener(ARTWORK_REQUEST_EVENT, () => {
        const artwork = Array.from(
            navigator.mediaSession?.metadata?.artwork || [],
        ).sort((a, b) => {
            const aSize = parseInt(a.sizes, 10) || 0;
            const bSize = parseInt(b.sizes, 10) || 0;
            return bSize - aSize;
        })[0];
        window.dispatchEvent(
            new CustomEvent(ARTWORK_RESPONSE_EVENT, {
                detail: { url: artwork?.src || "" },
            }),
        );
    });
})();
