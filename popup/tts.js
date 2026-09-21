/**
 * Lectoro – Popup TTS Module
 * Handles speech playback in Popup / Review cards delegating to SharedTtsService.
 */
(() => {
    "use strict";

    const SPEAK_SVG = LectoroConstants.SVG_ICONS.SPEAKER;
    const SLOW_SPEAK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 15a7 7 0 0 1 14 0H5Z"/><path d="m8 9 4 3 4-3M12 12v3M7 15v3M16 15v3M5 14l-2-1M19 12h1a2 2 0 0 1 0 4h-1"/></svg>';

    let popupSpeakSeq = 0;

    /** Immediately stop any in-progress popup TTS */
    function stopPopupSpeak() {
        popupSpeakSeq++;
        if (typeof SharedTtsService !== "undefined") {
            SharedTtsService.cancel();
        } else {
            window.speechSynthesis?.cancel();
        }
    }

    /**
     * Speak text in popup review/settings using SharedTtsService.
     */
    async function popupSpeak(
        text,
        lang,
        {
            forceBrowser = false,
            useConfiguredRate = false,
            rate = null,
            cacheFirst = false,
            cacheNotBefore = 0,
            sourceLang = null,
            originalText = null,
        } = {},
    ) {
        const mySeq = ++popupSpeakSeq;

        if (typeof SharedTtsService !== "undefined") {
            const result = await SharedTtsService.speak(text, lang, {
                forceBrowser,
                useConfiguredRate,
                rate,
                cacheFirst,
                cacheNotBefore,
                sourceLang,
                originalText,
                isCancelled: () => mySeq !== popupSpeakSeq,
            });
            return result;
        }

        // Fallback if SharedTtsService is not yet loaded
        window.speechSynthesis?.cancel();
        const defaultLang =
            (typeof LectoroConstants !== "undefined" &&
                LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) ||
            "en";
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = lang || defaultLang;
        if (Number.isFinite(rate) && rate > 0) utter.rate = rate;
        window.speechSynthesis?.speak(utter);
        return { type: "utter", obj: utter };
    }

    /** Attach TTS handlers to all .review-speak-btn in card */
    function attachReviewSpeakHandlers(card) {
        if (!card) return;
        card.querySelectorAll(".review-speak-btn").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                btn.classList.add("speaking");
                const done = () => btn.classList.remove("speaking");
                try {
                    const result = await popupSpeak(
                        btn.dataset.text,
                        btn.dataset.lang,
                        {
                            forceBrowser: btn.dataset.forceBrowserTts === "true",
                            rate: btn.dataset.rate ? Number(btn.dataset.rate) : null,
                            useConfiguredRate: btn.dataset.useConfiguredRate === "true",
                            cacheFirst: btn.dataset.cacheFirst === "true",
                            cacheNotBefore: Number(btn.dataset.cacheNotBefore || 0),
                            sourceLang: btn.dataset.sourceLang,
                            originalText: btn.dataset.originalText,
                        },
                    );
                    if (result?.type === "utter" && result.obj) {
                        result.obj.onend = done;
                        result.obj.onerror = done;
                    } else if (result?.type === "audio" && result.obj) {
                        result.obj.onended = done;
                        result.obj.onerror = done;
                    } else {
                        done();
                    }
                } catch {
                    done();
                }
                setTimeout(done, 8000);
            });
        });
    }

    globalThis.SPEAK_SVG = SPEAK_SVG;
    globalThis.SLOW_SPEAK_SVG = SLOW_SPEAK_SVG;
    globalThis.popupSpeak = popupSpeak;
    globalThis.stopPopupSpeak = stopPopupSpeak;
    globalThis.attachReviewSpeakHandlers = attachReviewSpeakHandlers;
})();
