/**
 * LectoroAI – Universal Video Controller
 * Uniwersalny kontroler wideo dla wszystkich platform (YouTube, Netflix, HTML5 / Video.js).
 *
 * Zapewnia jednolite sterowanie klawiaturą jak na YouTube dla KAŻDEGO odtwarzacza wideo:
 * - A / ArrowLeft : Poprzedni dialog LUB odnowienie bieżącego dialogu (po upływie 50% czasu trwania)
 * - D / ArrowRight: Następny dialog (lub przeskok o 5s przy braku napisów)
 * - W / ArrowUp   : Odtwarzaj / Pauza (Play / Pause toggle)
 * - S / ArrowDown : Tryb czytania napisów / Chmura słów (Reading Mode / Word Cloud)
 * - [ / ]         : Zmiana prędkości odtwarzania (-0.05x / +0.05x)
 * - Q / Enter     : Wyjaśnienie AI (AI Explanation Tooltip)
 * - Z / V / Home  : Zapisz zdanie do powtórek SRS (Sentence Review)
 * - Space         : Zamknięcie dymku / wznowienie wideo
 */
(() => {
    "use strict";

    // ============================================================================
    // PARAMETRY STEROWANIA WIDEO (TUTAJ MOŻNA ŁATWO ZMIENIĆ WARTOŚCI DLA WSZYSTKICH PLATFORM)
    // ============================================================================

    /**
     * 1. REPLAY_THRESHOLD_RATIO:
     * Określa, po upływie jakiej części napisów kliknięcie "A" lub "ArrowLeft"
     * odnawia bieżące napisy od początku, zamiast cofać do poprzednich.
     *
     * Wartość domyślna: 0.5 (czyli dokładnie 50% - po upływie połowy napisów następuje odnowienie).
     * - Jeśli chcesz, aby odnawiały się wcześniej (np. po 30% trwania napisów) -> ustaw 0.3
     * - Jeśli chcesz, aby odnawiały się później (np. po 70% trwania napisów) -> ustaw 0.7
     */
    const REPLAY_THRESHOLD_RATIO = 0.5;

    /**
     * 2. MIN_REPLAY_SECONDS:
     * Minimalny czas (w sekundach) od początku napisów, po którym "A" / "ArrowLeft"
     * odnawia bieżące napisy (zabezpieczenie dla bardzo krótkich napisów).
     */
    const MIN_REPLAY_SECONDS = 0.4;

    /**
     * 3. FALLBACK_SEEK_SECONDS:
     * Przeskok w sekundach (domyślnie 5s jak na YouTube), gdy wideo
     * nie posiada ścieżki napisów dialogowych.
     */
    const FALLBACK_SEEK_SECONDS = 5;

    /**
     * 4. NETFLIX_ADVANCE_OFFSET:
     * Bufor wyprzedzenia dźwięku na Netflix (125ms jak w Language Reactor),
     * zapobiegający ucinaniu pierwszej sylaby lektora.
     */
    const NETFLIX_ADVANCE_OFFSET = 0.125;

    // ============================================================================

    const NAV_KEYS = new Set([
        "a", "A", "ArrowLeft",
        "d", "D", "ArrowRight",
        "w", "W", "ArrowUp",
        "s", "S", "ArrowDown",
        "Enter", "NumpadEnter",
        "q", "Q",
        "Escape",
        "z", "Z", "v", "V",
        "[", "{", "]", "}",
        "Home", "PageUp",
    ]);

    let lastNetflixNavRepeatTime = 0;
    const NETFLIX_KEY_REPEAT_THROTTLE_MS = 120;
    let isInitialized = false;

    function getRegistry() {
        return globalThis.LectoroPlayerRegistry;
    }

    function getOverlay() {
        return globalThis.LectoroSubtitleOverlay;
    }

    function isNetflixEnvironment() {
        const registry = getRegistry();
        return Boolean(
            (typeof registry?.isNetflixPage === "function" && registry.isNetflixPage()) ||
            (typeof window !== "undefined" && /(^|\.)netflix\.com$/i.test(window.location?.hostname || ""))
        );
    }

    function isTyping(target) {
        if (!target) return false;
        const tag = target.tagName;
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            target.isContentEditable
        );
    }

    /**
     * Uniwersalny algorytm wyliczania czasu sąsiedniego dialogu (używany przez YouTube, Netflix i HTML5).
     *
     * @param {Array<{startTime: number, endTime: number, text?: string}>} cues
     * @param {number|HTMLVideoElement} videoOrTime
     * @param {number} direction 1 dla następnego dialogu, -1 dla poprzedniego / odnowienia
     * @param {object} [options]
     * @returns {number|null} docelowy czas przeskoku w sekundach lub null
     */
    function calculateAdjacentCueTime(cues, videoOrTime, direction, options = {}) {
        if (!Array.isArray(cues) || cues.length === 0) return null;

        const currentTime =
            typeof videoOrTime === "number"
                ? videoOrTime
                : Number(videoOrTime?.currentTime ?? NaN);

        if (!Number.isFinite(currentTime)) return null;

        const dir = direction >= 0 ? 1 : -1;
        const thresholdRatio =
            typeof options.thresholdRatio === "number"
                ? options.thresholdRatio
                : REPLAY_THRESHOLD_RATIO;
        const minReplaySec =
            typeof options.minReplaySeconds === "number"
                ? options.minReplaySeconds
                : MIN_REPLAY_SECONDS;
        const advanceOffset =
            typeof options.advanceOffset === "number"
                ? options.advanceOffset
                : (isNetflixEnvironment() ? NETFLIX_ADVANCE_OFFSET : 0);

        const TIME_EPSILON = 0.05;

        if (dir > 0) {
            // Przeskok w przód (Następny dialog: 'D' / 'ArrowRight')
            const next = cues.find(
                (c) => (c.startTime - advanceOffset) > currentTime + TIME_EPSILON,
            );
            return next ? Math.max(0, next.startTime - advanceOffset) : null;
        }

        // Przeskok w tył (Poprzedni dialog / Odnowienie bieżącego: 'A' / 'ArrowLeft')
        let activeIndex = -1;
        for (let i = 0; i < cues.length; i++) {
            const c = cues[i];
            const start = c.startTime - advanceOffset - TIME_EPSILON;
            const end = (Number.isFinite(c.endTime) ? c.endTime : c.startTime + 2.5) + 0.15;
            if (currentTime >= start && currentTime <= end) {
                activeIndex = i;
                break;
            }
        }

        let lastStartedIndex = -1;
        for (let i = cues.length - 1; i >= 0; i--) {
            if ((cues[i].startTime - advanceOffset) <= currentTime + TIME_EPSILON) {
                lastStartedIndex = i;
                break;
            }
        }

        if (activeIndex !== -1) {
            const activeCue = cues[activeIndex];
            const cueDuration = Math.max(
                0.5,
                (Number.isFinite(activeCue.endTime) ? activeCue.endTime : activeCue.startTime + 2.5) - activeCue.startTime,
            );
            const timeSinceStart = currentTime - (activeCue.startTime - advanceOffset);
            const replayThreshold = Math.max(minReplaySec, cueDuration * thresholdRatio);

            // Jeśli minęła ponad połowa napisów (thresholdRatio), odnawiamy bieżący dialog od początku
            if (timeSinceStart >= replayThreshold) {
                return Math.max(0, activeCue.startTime - advanceOffset);
            }

            // W przeciwnym razie (początek dialogu) cofamy do poprzedniego dialogu
            const prevIndex = activeIndex - 1;
            return prevIndex >= 0
                ? Math.max(0, cues[prevIndex].startTime - advanceOffset)
                : Math.max(0, cues[0].startTime - advanceOffset);
        }

        if (lastStartedIndex !== -1) {
            // W ciszy pomiędzy dialogami: skaczemy do dialogu, który właśnie się skończył
            return Math.max(0, cues[lastStartedIndex].startTime - advanceOffset);
        }

        // Przed pierwszym dialogiem: skaczemy do początku pierwszego dialogu
        return Math.max(0, cues[0].startTime - advanceOffset);
    }

    /**
     * Uniwersalna nawigacja napisów (YouTube, Netflix, HTML5 / Video.js).
     */
    async function navigateSubtitle(video, direction) {
        const registry = getRegistry();
        const targetVideo =
            video ||
            registry?.getVideo?.({ requireNearbyMouse: true }) ||
            registry?.getVideo?.() ||
            (typeof document !== "undefined" ? document.querySelector("video") : null);

        if (!targetVideo) return;

        // Jeśli PlayerRegistry ma dedykowaną obsługę (w tym Netflix Player Bridge), używamy jej
        if (typeof registry?.navigateSubtitle === "function") {
            return registry.navigateSubtitle(targetVideo, direction);
        }

        // Standardowy fallback dla dowolnego HTML5 <video>
        const fallbackDelta = direction > 0 ? FALLBACK_SEEK_SECONDS : -FALLBACK_SEEK_SECONDS;
        targetVideo.currentTime = Math.max(
            0,
            Math.min(targetVideo.duration || Infinity, targetVideo.currentTime + fallbackDelta),
        );
        if (targetVideo.paused) {
            targetVideo.play?.().catch?.(() => {});
        }
    }

    /**
     * Uniwersalne przełączanie Odtwarzaj / Pauza.
     */
    function togglePlayPause(video) {
        const registry = getRegistry();
        const targetVideo =
            video ||
            registry?.getVideo?.({ requireNearbyMouse: true }) ||
            registry?.getVideo?.() ||
            (typeof document !== "undefined" ? document.querySelector("video") : null);

        if (!targetVideo) return;

        if (targetVideo.paused) {
            if (typeof registry?.playVideo === "function") {
                registry.playVideo(targetVideo);
            } else {
                targetVideo.play?.().catch?.(() => {});
            }
        } else {
            if (typeof registry?.pauseVideo === "function") {
                registry.pauseVideo(targetVideo);
            } else {
                targetVideo.pause?.();
            }
        }
    }

    /**
     * Uniwersalna zmiana prędkości odtwarzania.
     */
    function adjustSpeed(video, delta) {
        const registry = getRegistry();
        const overlay = getOverlay();
        const targetVideo =
            video ||
            registry?.getVideo?.({ requireNearbyMouse: true }) ||
            registry?.getVideo?.() ||
            (typeof document !== "undefined" ? document.querySelector("video") : null);

        if (!targetVideo) return;

        let currentRate = targetVideo.playbackRate || 1.0;
        currentRate = Math.max(0.25, Math.min(2.0, currentRate + delta));
        currentRate = Math.round(currentRate * 100) / 100;
        targetVideo.playbackRate = currentRate;
        overlay?.showSpeedOverlay?.(currentRate, targetVideo);
    }

    /**
     * Główny uniwersalny listener klawiatury dla wszystkich wideo.
     */
    function handleKeyDown(e) {
        if (isTyping(e.target)) return;

        const key = e.key;
        const overlay = getOverlay();

        if (key === " " || key === "Spacebar") {
            if (overlay?.isSubtitleUiOpen?.()) {
                overlay?.restoreOriginal?.();
            }
            overlay?.closeSubTooltip?.({ resumeVideo: false });
            return;
        }

        if (!NAV_KEYS.has(key)) return;

        const registry = getRegistry();
        const video =
            registry?.getVideo?.({ requireNearbyMouse: true }) ||
            registry?.getVideo?.() ||
            (typeof document !== "undefined" ? document.querySelector("video") : null);

        if (!video) return;

        const isHorizontalSubtitleNavigation = [
            "a", "A", "ArrowLeft",
            "d", "D", "ArrowRight",
        ].includes(key);

        if (isHorizontalSubtitleNavigation && isNetflixEnvironment() && e.repeat) {
            const now = Date.now();
            if (now - lastNetflixNavRepeatTime < NETFLIX_KEY_REPEAT_THROTTLE_MS) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return;
            }
            lastNetflixNavRepeatTime = now;
        }

        const subtitleUiOpen = overlay?.isSubtitleUiOpen?.() || false;
        const aiTooltipOpen = Boolean(
            overlay?.isAiTooltipActive?.() ||
            (typeof document !== "undefined" && (
                (typeof document.body?.hasAttribute === "function" && document.body.hasAttribute("data-lectoro-ai-active")) ||
                (typeof document.querySelector === "function" && document.querySelector(".lectoro-ai-explain-overlay"))
            ))
        );

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // Przytrzymanie 'S' nie może natychmiast zamknąć dopiero co otwartej sesji czytania
        if (e.repeat && ["s", "S", "ArrowDown"].includes(key)) return;

        // Kontrola prędkości: [ oraz ]
        if (["[", "{", "]", "}"].includes(key)) {
            adjustSpeed(video, (key === "[" || key === "{") ? -0.05 : 0.05);
            return;
        }

        // Wyjaśnienie AI: Enter / Q
        if (["Enter", "NumpadEnter", "q", "Q"].includes(key)) {
            if (e.repeat) return;
            if (aiTooltipOpen) {
                overlay?.closeAiTooltip?.({ resumeVideo: true });
            } else {
                overlay?.handleAIExplain?.(video);
            }
            return;
        }

        // Sterowanie otwartym dymkiem AI (W, A, D, Strzałki, Z, V, Escape)
        if (aiTooltipOpen) {
            if (["w", "W", "ArrowUp"].includes(key)) {
                overlay?.closeAiTooltip?.({ resumeVideo: true });
                return;
            }
            if (key === "ArrowRight" || key === "d" || key === "D") {
                overlay?.nextAiExplainItem?.({ manual: true });
                return;
            }
            if (key === "ArrowLeft" || key === "a" || key === "A") {
                overlay?.prevAiExplainItem?.({ manual: true });
                return;
            }
            if (["z", "Z", "v", "V"].includes(key)) {
                overlay?.saveCurrentAiExplainItem?.();
                return;
            }
            if (key === "Escape") {
                overlay?.closeAiTooltip?.({ resumeVideo: true });
                return;
            }
            overlay?.closeAiTooltip?.({ resumeVideo: !isHorizontalSubtitleNavigation });
            if (!isHorizontalSubtitleNavigation) return;
        }

        // Zapisanie bieżącego zdania do powtórek SRS: Z / V / Home / PageUp
        if (["z", "Z", "v", "V", "Home", "PageUp"].includes(key)) {
            overlay?.saveCurrentSentenceToReview?.();
            return;
        }

        // Ukrycie kontrolek odtwarzaczy HTML5 i Netflix
        if (globalThis.LectoroGenericVideoAdapter?.ensureControlsHidden) {
            globalThis.LectoroGenericVideoAdapter.ensureControlsHidden();
            globalThis.LectoroGenericVideoAdapter.clearControlBarTimer?.();
        }
        if (globalThis.LectoroNetflixAdapter?.ensureControlsHidden) {
            globalThis.LectoroNetflixAdapter.ensureControlsHidden();
        }

        // Zamknięcie nakładki napisów, jeśli była otwarta
        if (subtitleUiOpen) {
            try {
                overlay?.restoreOriginal?.();
            } finally {
                overlay?.resumeVideoAfterSubtitleClose?.(video);
            }
            if (!isHorizontalSubtitleNavigation) return;
        }

        // Tryb czytania napisów / Chmura słów: S / ArrowDown
        if (["s", "S", "ArrowDown"].includes(key)) {
            if (!e.repeat && globalThis.LectoroReadingModes?.start) {
                void globalThis.LectoroReadingModes.start(video);
            }
            return;
        }

        // Odtwarzaj / Pauza: W / ArrowUp (identycznie na YouTube, Netflix i HTML5)
        if (["w", "W", "ArrowUp"].includes(key)) {
            togglePlayPause(video);
            return;
        }

        // Poprzedni dialog / Odnowienie napisów: A / ArrowLeft (identycznie jak na YouTube)
        if (["a", "A", "ArrowLeft"].includes(key)) {
            navigateSubtitle(video, -1);
            return;
        }

        // Następny dialog: D / ArrowRight (identycznie jak na YouTube)
        if (["d", "D", "ArrowRight"].includes(key)) {
            navigateSubtitle(video, 1);
            return;
        }
    }

    function init() {
        if (isInitialized || typeof document === "undefined") return;
        document.addEventListener("keydown", handleKeyDown, true);
        isInitialized = true;
    }

    // Automatyczna inicjalizacja kontrolera
    init();

    const UniversalVideoController = {
        init,
        handleKeyDown,
        calculateAdjacentCueTime,
        navigateSubtitle,
        togglePlayPause,
        adjustSpeed,
        getConfig() {
            return {
                REPLAY_THRESHOLD_RATIO,
                MIN_REPLAY_SECONDS,
                FALLBACK_SEEK_SECONDS,
                NETFLIX_ADVANCE_OFFSET,
            };
        },
    };

    globalThis.LectoroUniversalVideoController = UniversalVideoController;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = UniversalVideoController;
    }
})();
