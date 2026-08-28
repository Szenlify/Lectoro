/**
 * Lectoro – Popup TTS Module
 * Handles speech playback in Popup / Review cards delegating to SharedTtsService.
 */
(() => {
    "use strict";

    const { cleanTextForTTS } = typeof SharedUtils !== "undefined"
        ? SharedUtils
        : { cleanTextForTTS: (t) => t };

    const SPEAK_SVG = typeof LectoroConstants !== "undefined" && LectoroConstants.SVG_ICONS?.SPEAKER
        ? LectoroConstants.SVG_ICONS.SPEAKER
        : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

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
        const utter = new SpeechSynthesisUtterance(cleanTextForTTS(text));
        utter.lang = lang || "en";
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
    globalThis.popupSpeak = popupSpeak;
    globalThis.stopPopupSpeak = stopPopupSpeak;
    globalThis.attachReviewSpeakHandlers = attachReviewSpeakHandlers;
})();
