/** Player-scoped feedback for unavailable official dual subtitle tracks. */
(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    root.LectoroDualSubtitleToast = api;
})(globalThis, function () {
    "use strict";

    function create({ getVideo, getPlayerContainer, onRetryError }) {
        let current = null;

        function dismiss({ immediate = false } = {}) {
            const state = current;
            if (!state) return;
            current = null;
            cancelAnimationFrame(state.frame);
            state.cleanup();
            state.element.classList.remove("__qt_dual-toast-visible");
            const remove = () => {
                try { state.element.hidePopover?.(); } catch (_) { }
                state.element.remove();
            };
            if (immediate) remove();
            else setTimeout(remove, 300);
        }

        function show({ retry, duration = 8000 } = {}) {
            dismiss({ immediate: true });
            const video = getVideo();
            if (!video) return;
            const element = document.createElement("div");
            element.id = "__qt_dual_subtitle_toast";
            const nativePopover = "popover" in HTMLElement.prototype;
            if (nativePopover) element.setAttribute("popover", "manual");
            element.setAttribute("aria-label", "Lectoro AI notification");
            element.innerHTML = `
                <span class="__qt_dual-toast-logo"><img alt="" width="32" height="32"></span>
                <div class="__qt_dual-toast-body">
                    <div role="status" aria-live="polite" aria-atomic="true">
                        <strong>Lectoro AI</strong>
                        <p>Failed to load dual subtitles. Please try again.</p>
                    </div>
                    <button type="button" class="__qt_dual-toast-retry">↻ Retry</button>
                </div>
                <button type="button" class="__qt_dual-toast-close" aria-label="Close notification">✕</button>
                <span class="__qt_dual-toast-progress" aria-hidden="true"></span>`;
            element.querySelector("img").src = chrome.runtime.getURL("icons/icon48.png");
            const bar = element.querySelector(".__qt_dual-toast-progress");
            const retryButton = element.querySelector(".__qt_dual-toast-retry");
            retryButton.disabled = typeof retry !== "function";
            const lifetime = Number.isFinite(duration) && duration > 0 ? duration : 5000;
            const state = { element, remaining: lifetime, lastTime: null, frame: null, cleanup: () => {} };
            current = state;
            const paused = new Set();

            function updatePosition() {
                if (current !== state) return;
                if (getVideo() !== video || !video.isConnected) {
                    dismiss({ immediate: true });
                    return;
                }
                const parent = document.fullscreenElement || document.body;
                if (element.parentElement !== parent) parent.appendChild(element);
                const rect = (getPlayerContainer(video) || video).getBoundingClientRect();
                element.style.top = `${Math.max(20, rect.top + 20)}px`;
                element.style.right = `${Math.max(20, window.innerWidth - rect.right + 20)}px`;
                element.style.maxWidth = `${Math.max(0, Math.min(rect.width, window.innerWidth) - 40)}px`;
                if (nativePopover && !element.matches(":popover-open")) {
                    try { element.showPopover(); } catch (_) { }
                }
            }

            function advance(now) {
                if (state.lastTime !== null) state.remaining = Math.max(0, state.remaining - (now - state.lastTime));
                state.lastTime = now;
                bar.style.transform = `scaleX(${state.remaining / lifetime})`;
            }

            function tick(now) {
                if (current !== state || paused.size) return;
                advance(now);
                if (state.remaining <= 0) dismiss();
                else state.frame = requestAnimationFrame(tick);
            }

            function pause(reason) {
                if (current !== state) return;
                if (!paused.size) advance(performance.now());
                paused.add(reason);
                cancelAnimationFrame(state.frame);
                state.lastTime = null;
            }

            function resume(reason) {
                paused.delete(reason);
                if (current !== state || paused.size) return;
                state.lastTime = performance.now();
                cancelAnimationFrame(state.frame);
                state.frame = requestAnimationFrame(tick);
            }

            const visibilityChanged = () => document.hidden ? pause("hidden") : resume("hidden");
            element.addEventListener("pointerenter", () => pause("hover"));
            element.addEventListener("pointerleave", () => resume("hover"));
            element.addEventListener("focusin", () => pause("focus"));
            element.addEventListener("focusout", (event) => {
                if (!element.contains(event.relatedTarget)) resume("focus");
            });
            // Clicking the notification must not toggle the player's playback.
            for (const type of ["click", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "keydown", "keyup"]) {
                element.addEventListener(type, (event) => event.stopPropagation());
            }
            element.querySelector(".__qt_dual-toast-close").addEventListener("click", () => dismiss());
            retryButton.addEventListener("click", async () => {
                if (current !== state || retryButton.disabled) return;
                retryButton.disabled = true;
                dismiss();
                try { await retry(); } catch (error) { onRetryError?.(error, retry); }
            });
            window.addEventListener("resize", updatePosition, { passive: true });
            window.addEventListener("scroll", updatePosition, { passive: true, capture: true });
            document.addEventListener("fullscreenchange", updatePosition);
            document.addEventListener("visibilitychange", visibilityChanged);
            const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updatePosition) : null;
            observer?.observe(getPlayerContainer(video) || video);
            state.cleanup = () => {
                window.removeEventListener("resize", updatePosition);
                window.removeEventListener("scroll", updatePosition, true);
                document.removeEventListener("fullscreenchange", updatePosition);
                document.removeEventListener("visibilitychange", visibilityChanged);
                observer?.disconnect();
            };
            updatePosition();
            state.frame = requestAnimationFrame((now) => {
                if (current !== state) return;
                element.classList.add("__qt_dual-toast-visible");
                state.lastTime = now;
                if (document.hidden) pause("hidden");
                else state.frame = requestAnimationFrame(tick);
            });
        }

        return { show, dismiss };
    }

    return { create };
});
