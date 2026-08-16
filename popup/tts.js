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
let lastRandomElevenLabsVoiceId = "";
let cachedRandomElevenLabsVoices = [];

function clearPopupElevenLabsProviderBlock() {
    popupElevenLabsProviderError = null;
}

async function pickRandomElevenLabsVoiceId() {
    let voices =
        typeof reviewElVoices !== "undefined" && reviewElVoices.length
            ? reviewElVoices
            : cachedRandomElevenLabsVoices;
    if (!voices.length) {
        voices = await SubscriptionService.getElevenLabsVoices("review");
        cachedRandomElevenLabsVoices = voices;
    }
    const voiceIds = voices
        .map((voice) => voice?.voice_id)
        .filter((voiceId) => voiceId && voiceId !== "random");
    if (!voiceIds.length) {
        throw new Error("Brak dostępnych głosów ElevenLabs.");
    }

    const candidates =
        voiceIds.length > 1
            ? voiceIds.filter(
                  (voiceId) => voiceId !== lastRandomElevenLabsVoiceId,
              )
            : voiceIds;
    const voiceId =
        candidates[Math.floor(Math.random() * candidates.length)];
    lastRandomElevenLabsVoiceId = voiceId;
    return voiceId;
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
 * Speak text using the engine & voice configured in settings. Callers may
 * force the system/browser voice for content that must never use ElevenLabs.
 */
function popupSpeak(
    text,
    lang,
    {
        forceBrowser = false,
        useConfiguredRate = false,
        cacheFirst = false,
        cacheNotBefore = 0,
    } = {},
) {
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
                speechRate: 1.1,
                ttsVolume: 1,
            },
            async (data) => {
                if (mySeq !== popupSpeakSeq) {
                    resolve({ type: "none", obj: null });
                    return;
                }
                const volume =
                    data.ttsVolume !== undefined ? data.ttsVolume : 1;
                const cleanText = cleanTextForTTS(text);

                const playAudioBlob = async (blob) => {
                    if (mySeq !== popupSpeakSeq) return null;
                    const url = URL.createObjectURL(blob);
                    popupElAudio = new Audio(url);
                    popupElAudio.volume = volume;
                    popupElAudio.addEventListener(
                        "ended",
                        () => URL.revokeObjectURL(url),
                        { once: true },
                    );
                    await popupElAudio.play();
                    return popupElAudio;
                };

                // Review cards keep the voice that was already synthesized
                // for their text. This lookup intentionally happens before
                // checking the currently selected system/ElevenLabs voice.
                if (!forceBrowser && cacheFirst && cleanText) {
                    const cached = await AudioCache.findByText(cleanText, {
                        notBefore: cacheNotBefore,
                    });
                    if (cached?.blob) {
                        const audio = await playAudioBlob(cached.blob);
                        if (!audio) {
                            resolve({ type: "none", obj: null });
                            return;
                        }
                        resolve({ type: "audio", obj: audio });
                        return;
                    }
                }

                // ElevenLabs path
                const useElevenLabs =
                    !forceBrowser &&
                    data.ttsMode === "elevenlabs" &&
                    !!data.elVoiceId;

                let elFailed = false;
                if (useElevenLabs) {
                    try {
                        const targetVoiceId =
                            data.elVoiceId === "random"
                                ? await pickRandomElevenLabsVoiceId()
                                : data.elVoiceId;

                        if (mySeq !== popupSpeakSeq) {
                            resolve({ type: "none", obj: null });
                            return;
                        }

                        const cacheKey = `${cleanText}|${targetVoiceId}`;
                        // Cache is deliberately first: cached ElevenLabs audio
                        // remains available after the monthly/provider quota is
                        // exhausted and causes no network/API request.
                        let blob = await AudioCache.get(cacheKey, {
                            notBefore: cacheNotBefore,
                        });

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
                        const audio = await playAudioBlob(blob);
                        if (!audio) {
                            resolve({ type: "none", obj: null });
                            return;
                        }
                        if (typeof setReviewVoiceStatus === "function") {
                            setReviewVoiceStatus("");
                        }
                        resolve({ type: "audio", obj: audio });
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
                // Ordinary review cards stay at the fixed natural pace. Some
                // explicitly marked content (the Enter AI result) follows the
                // speech-speed slider from Settings.
                utter.rate = useConfiguredRate
                    ? Math.max(
                          0.1,
                          Math.min(10, Number(data.speechRate) || 1.1),
                      )
                    : 1;
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
                    {
                        forceBrowser:
                            btn.dataset.forceBrowserTts === "true",
                        useConfiguredRate:
                            btn.dataset.useConfiguredRate === "true",
                        cacheFirst: btn.dataset.cacheFirst === "true",
                        cacheNotBefore: Number(
                            btn.dataset.cacheNotBefore || 0,
                        ),
                    },
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
