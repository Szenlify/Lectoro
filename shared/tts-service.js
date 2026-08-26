/**
 * Lectoro – Universal TTS & Speech Synthesis Service (SSOT)
 * Single Source of Truth for Web Speech API, ElevenLabs neural voices,
 * voice selection heuristics, audio caching, safety timeouts, and cancellation.
 */
(function initTtsService(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) {
        root.SharedTtsService = api;
        root.TtsService = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTtsService() {
    "use strict";

    let activeAudio = null;
    let globalSpeechToken = 0;
    let providerError = null;

    function cleanText(text) {
        return typeof SharedUtils !== "undefined" && SharedUtils.cleanTextForTTS
            ? SharedUtils.cleanTextForTTS(text)
            : String(text ?? "").trim();
    }

    function getSafetyTimeout(text, rate = 1) {
        const words = String(text || "").trim().split(/\s+/).filter(Boolean);
        const estimatedMs = (words.length / Math.max(0.5, Number(rate) * 1.5 || 1.5)) * 1000;
        return Math.min(300000, Math.max(6000, estimatedMs + 6000));
    }

    async function getTtsSettings() {
        if (!chrome?.storage?.local) {
            return {
                ttsMode: "browser",
                speechVoice: "",
                speechRate: 1.1,
                ttsVolume: 1,
                elVoiceId: "",
            };
        }
        const data = await chrome.storage.local.get({
            ttsMode: "browser",
            speechVoice: "",
            speechRate: 1.1,
            ttsVolume: 1,
            elVoiceId: "",
        });
        const rawVol = data.ttsVolume !== undefined ? Number(data.ttsVolume) : 1;
        return {
            ttsMode: data.ttsMode || "browser",
            speechVoice: data.speechVoice || "",
            speechRate: Math.max(0.1, Math.min(10, Number(data.speechRate) || 1.1)),
            ttsVolume: Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 1,
            elVoiceId: data.elVoiceId || "",
        };
    }

    /**
     * Asynchronously ensure Web Speech API voices are loaded.
     * Resolves immediately if voices are already loaded, or listens for 'voiceschanged' with safety timeout.
     */
    async function ensureVoices(timeoutMs = 250) {
        if (typeof SharedUtils !== "undefined" && SharedUtils.ensureVoices) {
            return SharedUtils.ensureVoices(timeoutMs);
        }
        if (typeof window === "undefined" || !window.speechSynthesis) return [];
        const current = window.speechSynthesis.getVoices?.() || [];
        if (current.length > 0) return current;

        return new Promise((resolve) => {
            let timer = null;
            const handler = () => {
                if (timer) clearTimeout(timer);
                try {
                    window.speechSynthesis?.removeEventListener?.("voiceschanged", handler);
                } catch (_) {}
                resolve(window.speechSynthesis?.getVoices?.() || []);
            };
            try {
                window.speechSynthesis?.addEventListener?.("voiceschanged", handler);
            } catch (_) {}
            timer = setTimeout(() => {
                try {
                    window.speechSynthesis?.removeEventListener?.("voiceschanged", handler);
                } catch (_) {}
                resolve(window.speechSynthesis?.getVoices?.() || []);
            }, timeoutMs);
        });
    }

    function pickVoice(savedVoiceName, lang, voicesList = null) {
        if (typeof SharedUtils !== "undefined" && SharedUtils.pickBestVoice) {
            return SharedUtils.pickBestVoice(savedVoiceName, lang, voicesList);
        }
        const voices = (Array.isArray(voicesList) && voicesList.length > 0)
            ? voicesList
            : (window.speechSynthesis?.getVoices?.() || []);
        if (!voices.length) return null;

        const base = (lang || "en").split("-")[0].toLowerCase();
        const langVoices = voices.filter((v) => (v.lang || "").toLowerCase().startsWith(base));

        if (savedVoiceName && savedVoiceName !== "random") {
            const exact = (langVoices.length ? langVoices : voices).find((v) => v.name === savedVoiceName);
            if (exact) return exact;
        }

        if (!langVoices.length) return null;

        const googleVoice = langVoices.find((v) => /google/i.test(v.name));
        return googleVoice || langVoices[0];
    }

    /**
     * Stop all in-progress speech playback immediately.
     */
    function cancel() {
        globalSpeechToken += 1;
        try {
            window.speechSynthesis?.cancel();
        } catch (_) {}
        if (activeAudio) {
            try {
                activeAudio.pause();
                activeAudio = null;
            } catch (_) {}
        }
    }

    /**
     * Internal direct browser synthesis without resetting tokens.
     */
    function speakBrowserDirect(cleanedText, lang, settings, { rate = null, volume = null, isCancelled = null, voices = null } = {}) {
        if (!cleanedText) return null;
        if (isCancelled?.()) return null;

        const utter = new SpeechSynthesisUtterance(cleanedText);
        utter.lang = lang || "en";
        utter.rate = rate !== null ? rate : settings.speechRate;
        utter.volume = volume !== null ? volume : settings.ttsVolume;
        const voice = pickVoice(settings.speechVoice, lang, voices);
        if (voice) utter.voice = voice;

        try {
            window.speechSynthesis?.speak(utter);
            return utter;
        } catch (error) {
            console.warn("[Lectoro TTS] SpeechSynthesis error:", error);
            return null;
        }
    }

    /**
     * Speak text using Web Speech API (browser synthesizer).
     */
    async function speakBrowser(text, lang = "en", { rate = null, volume = null, isCancelled = null } = {}) {
        const cleaned = cleanText(text);
        if (!cleaned) return null;

        cancel();
        const currentToken = globalSpeechToken;
        const [settings, voices] = await Promise.all([
            getTtsSettings(),
            ensureVoices(),
        ]);

        if (isCancelled?.() || currentToken !== globalSpeechToken) return null;

        return speakBrowserDirect(cleaned, lang, settings, {
            rate,
            volume,
            voices,
            isCancelled: () => isCancelled?.() || currentToken !== globalSpeechToken,
        });
    }

    /**
     * Universal speak function respecting user settings and optional ElevenLabs / AudioCache.
     */
    async function speak(
        text,
        lang = "en",
        {
            forceBrowser = false,
            useConfiguredRate = true,
            cacheNotBefore = 0,
            isCancelled = null,
        } = {},
    ) {
        const cleaned = cleanText(text);
        if (!cleaned) return { type: "none", obj: null };

        cancel();
        const currentToken = globalSpeechToken;
        const [settings, voices] = await Promise.all([
            getTtsSettings(),
            ensureVoices(),
        ]);

        if (isCancelled?.() || currentToken !== globalSpeechToken) {
            return { type: "none", obj: null };
        }

        const useElevenLabs =
            !forceBrowser &&
            settings.ttsMode === "elevenlabs" &&
            !!settings.elVoiceId &&
            settings.elVoiceId !== "random" &&
            typeof SubscriptionService !== "undefined" &&
            typeof AudioCache !== "undefined";

        if (useElevenLabs) {
            try {
                const targetVoiceId = settings.elVoiceId;

                if (isCancelled?.() || currentToken !== globalSpeechToken) {
                    return { type: "none", obj: null };
                }

                const cacheKey = `${cleaned}|${targetVoiceId}`;
                // Step 1 (Local Cache): Check IndexedDB (LectoroAudioDB)
                let blob = await AudioCache.get(cacheKey, { notBefore: cacheNotBefore });

                if (!blob) {
                    // Step 2 (Global R2 Cache): Check deterministic public CDN URL directly
                    let r2Url = null;
                    if (
                        typeof SharedUtils !== "undefined" &&
                        typeof SharedUtils.getR2AudioUrl === "function"
                    ) {
                        r2Url = await SharedUtils.getR2AudioUrl(targetVoiceId, cleaned);
                    }

                    if (r2Url) {
                        try {
                            const r2Res = await fetch(r2Url);
                            if (r2Res.ok) {
                                blob = await r2Res.blob();
                                // Cache in local IndexedDB for future instant playback
                                await AudioCache.set(cacheKey, blob);
                            }
                        } catch (r2Err) {
                            console.warn(
                                "[Lectoro TTS] Direct R2 CDN fetch warning:",
                                r2Err.message || r2Err,
                            );
                        }
                    }

                    // Step 3 (ElevenLabs Synthesis - Cache MISS):
                    // Synthesize via proxy only if neither local DB nor R2 CDN had the audio
                    if (!blob) {
                        if (providerError) {
                            const err = new Error(providerError.message);
                            err.code = providerError.code;
                            throw err;
                        }
                        const validation =
                            await SubscriptionService.checkElevenLabs(cleaned);
                        if (typeof SubscriptionConfig !== "undefined") {
                            SubscriptionConfig.assertAllowed(validation);
                        }
                        blob = await SubscriptionService.synthesizeElevenLabs(
                            cleaned,
                            targetVoiceId,
                            "review",
                        );
                        await AudioCache.set(cacheKey, blob);
                    }
                }

                if (isCancelled?.() || currentToken !== globalSpeechToken) {
                    return { type: "none", obj: null };
                }

                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.volume = settings.ttsVolume;
                activeAudio = audio;
                audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
                audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
                await audio.play();
                return { type: "audio", obj: audio };
            } catch (err) {
                console.warn("[Lectoro TTS] ElevenLabs fallback to browser voice:", err.message || err);
                if (["ELEVENLABS_PROVIDER_DISABLED", "ELEVENLABS_PROVIDER_QUOTA"].includes(err?.code)) {
                    providerError = { code: err.code, message: err.message };
                }
            }
        }

        // Fallback or default to Browser Speech
        const utter = speakBrowserDirect(cleaned, lang, settings, {
            rate: useConfiguredRate ? settings.speechRate : 1.0,
            volume: settings.ttsVolume,
            voices,
            isCancelled: () => isCancelled?.() || currentToken !== globalSpeechToken,
        });

        return { type: "utter", obj: utter };
    }

    // Pre-warm browser voices in background immediately on script evaluation
    try {
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.getVoices?.();
        }
    } catch (_) {}

    return Object.freeze({
        speak,
        speakBrowser,
        ensureVoices,
        cancel,
        pickVoice,
        getTtsSettings,
        cleanText,
        getSafetyTimeout,
    });
});
