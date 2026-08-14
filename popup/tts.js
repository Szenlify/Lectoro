const { cleanTextForTTS, pickBestVoice } = SharedUtils;

// ── SVG icons for review TTS buttons ──────────────────────────────
const SPEAK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

// ── TTS for popup (respects user settings: Browser / ElevenLabs) ──
let popupElAudio = null;

// Monotonic token: lets an in-flight (async) popupSpeak call detect that a
// newer call has superseded it, so a stale card's audio never starts after
// the user already moved on to a different card.
let popupSpeakSeq = 0;
let popupElevenLabsProviderError = null;

function clearPopupElevenLabsProviderBlock() {
    popupElevenLabsProviderError = null;
}

/** Immediately stop any in-progress popup TTS (utterance or audio). */
function stopPopupSpeak() {
    popupSpeakSeq++;
    window.speechSynthesis.cancel();
    if (popupElAudio) {
        popupElAudio.pause();
        popupElAudio = null;
    }
}

/**
 * Speak text using the same engine & voice configured in settings.
 * Returns a Promise that resolves with { type: 'utter'|'audio', obj } for end-tracking.
 */
function popupSpeak(text, lang) {
    const mySeq = ++popupSpeakSeq;
    window.speechSynthesis.cancel();
    if (popupElAudio) {
        popupElAudio.pause();
        popupElAudio = null;
    }

    return new Promise((resolve) => {
        chrome.storage.local.get(
            {
                ttsMode: "browser",
                elVoiceId: "",
                speechVoice: "",
                ttsVolume: 1,
            },
            async (data) => {
                if (mySeq !== popupSpeakSeq) {
                    resolve({ type: "none", obj: null });
                    return;
                }
                const volume =
                    data.ttsVolume !== undefined ? data.ttsVolume : 1;

                // ElevenLabs path
                const useElevenLabs =
                    data.ttsMode === "elevenlabs" && !!data.elVoiceId;

                let elFailed = false;
                if (useElevenLabs) {
                    try {
                        const targetVoiceId = data.elVoiceId;
                        if (targetVoiceId === "random") {
                            throw new Error("Losowy głos jest dostępny tylko dla głosów systemowych.");
                        }

                        if (mySeq !== popupSpeakSeq) {
                            resolve({ type: "none", obj: null });
                            return;
                        }

                        const cleanText = cleanTextForTTS(text);
                        const cacheKey = `${cleanText}|${targetVoiceId}`;
                        // Cache is deliberately first: cached ElevenLabs audio
                        // remains available after the monthly/provider quota is
                        // exhausted and causes no network/API request.
                        let blob = await AudioCache.get(cacheKey);

                        if (!blob) {
                            if (popupElevenLabsProviderError) {
                                const blocked = new Error(popupElevenLabsProviderError.message);
                                blocked.code = popupElevenLabsProviderError.code;
                                throw blocked;
                            }
                            const validation = await SubscriptionService.checkElevenLabs(cleanText);
                            SubscriptionConfig.assertAllowed(validation);
                            blob = await SubscriptionService.synthesizeElevenLabs(
                                cleanText,
                                targetVoiceId,
                                "review",
                            );
                            await AudioCache.set(cacheKey, blob);
                        }
                        if (mySeq !== popupSpeakSeq) {
                            resolve({ type: "none", obj: null });
                            return;
                        }
                        const url = URL.createObjectURL(blob);
                        popupElAudio = new Audio(url);
                        popupElAudio.volume = volume;
                        popupElAudio.addEventListener(
                            "ended",
                            () => URL.revokeObjectURL(url),
                            { once: true },
                        );
                        await popupElAudio.play();
                        if (typeof setReviewVoiceStatus === "function") {
                            setReviewVoiceStatus("");
                        }
                        resolve({ type: "audio", obj: popupElAudio });
                        return;
                    } catch (err) {
                        console.warn(
                            "[Lectoro] ElevenLabs popup TTS failed:",
                            err.message || err,
                        );
                        if ([
                            "ELEVENLABS_PROVIDER_DISABLED",
                            "ELEVENLABS_PROVIDER_QUOTA",
                        ].includes(err?.code)) {
                            popupElevenLabsProviderError = {
                                code: err.code,
                                message: err.message,
                            };
                        }
                        if (typeof reportReviewVoiceFailure === "function") {
                            await reportReviewVoiceFailure(err);
                        }
                        if (SubscriptionService.isLimitError(err)) {
                            SubscriptionService.showUpgradePrompt(err);
                        }
                        elFailed = true;
                    }
                }
                // Browser SpeechSynthesis path (default, or fallback when
                // ElevenLabs failed above — never leaves playback silent).
                if (elFailed) void 0; // fallthrough intentional
                const utter = new SpeechSynthesisUtterance(
                    cleanTextForTTS(text),
                );
                utter.lang = lang || "en";
                // Review TTS always speaks at normal speed (1.0), regardless
                // of the Settings speed slider — that slider only affects
                // in-video subtitle TTS. Voice and volume still follow
                // Settings so the review card sounds like the same voice
                // the user picked, just always at a natural pace.
                utter.rate = 1;
                utter.volume = volume;
                const voice = pickBestVoice(data.speechVoice, lang);
                if (voice) utter.voice = voice;
                window.speechSynthesis.speak(utter);
                resolve({ type: "utter", obj: utter });
            },
        );
    });
}

// ── Attach TTS handlers to all .review-speak-btn in card ──────────
function attachReviewSpeakHandlers(card) {
    card.querySelectorAll(".review-speak-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            btn.classList.add("speaking");
            const done = () => btn.classList.remove("speaking");
            try {
                const result = await popupSpeak(
                    btn.dataset.text,
                    btn.dataset.lang,
                );
                if (result.type === "utter") {
                    result.obj.onend = done;
                    result.obj.onerror = done;
                } else if (result.type === "audio") {
                    result.obj.onended = done;
                    result.obj.onerror = done;
                } else {
                    done();
                }
            } catch {
                done();
            }
            setTimeout(done, 8000); // safety fallback
        });
    });
}
