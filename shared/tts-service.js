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
        if (typeof chrome === "undefined" || !chrome?.storage?.local) {
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
                const audioResult = await getAudioBlob(cleaned, lang, {
                    forceBrowser: false,
                    voiceId: targetVoiceId,
                    context: "review",
                    cacheNotBefore,
                    allowSynthesis: true,
                });

                if (audioResult?.blob && audioResult.provider === "elevenlabs") {
                    if (isCancelled?.() || currentToken !== globalSpeechToken) {
                        return { type: "none", obj: null };
                    }
                    const url = URL.createObjectURL(audioResult.blob);
                    const audio = new Audio(url);
                    audio.volume = settings.ttsVolume;
                    activeAudio = audio;
                    audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
                    audio.addEventListener("error", () => URL.revokeObjectURL(url), { once: true });
                    await audio.play();
                    return { type: "audio", obj: audio };
                }
            } catch (err) {
                console.warn("[Lectoro TTS] ElevenLabs playback fallback:", err.message || err);
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

    /** Helper URL for web TTS fallback (Google TTS audio endpoint) */
    function googleTtsUrl(text, lang) {
        const tl = encodeURIComponent((lang || "en").split("-")[0]);
        const q = encodeURIComponent(text);
        return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${q}`;
    }

    async function fetchFallbackAudioBlob(text, lang) {
        try {
            const url = googleTtsUrl(text, lang);
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.blob();
        } catch {
            return null;
        }
    }

    /**
     * Universal audio blob getter respecting user settings, IndexedDB AudioCache,
     * Cloudflare R2 CDN, and ElevenLabs neural synthesis with automatic fallback.
     * Single Source of Truth for audio downloads (e.g. Anki export).
     */
    async function getAudioBlob(
        text,
        lang = "en",
        {
            forceBrowser = false,
            voiceId = null,
            context = "review",
            cacheNotBefore = 0,
            allowSynthesis = false,
            allowFallback = true,
        } = {},
    ) {
        const cleaned = cleanText(text);
        if (!cleaned) return null;

        const settings = await getTtsSettings();
        const preferredVoiceId = voiceId || settings.elVoiceId || "";

        // ── STEP 1: Local IndexedDB AudioCache (always checked for cached ElevenLabs audio) ──
        if (typeof AudioCache !== "undefined" && !forceBrowser) {
            try {
                if (preferredVoiceId) {
                    const blob = await AudioCache.get(`${cleaned}|${preferredVoiceId}`, { notBefore: cacheNotBefore });
                    if (blob && blob.size > 0) {
                        return { blob, provider: "elevenlabs", cached: true, voiceId: preferredVoiceId };
                    }
                }
                if (typeof AudioCache.findByText === "function") {
                    const cachedMatch = await AudioCache.findByText(cleaned, { notBefore: cacheNotBefore });
                    if (cachedMatch?.blob && cachedMatch.blob.size > 0) {
                        return { blob: cachedMatch.blob, provider: "elevenlabs", cached: true, voiceId: cachedMatch.voiceId || preferredVoiceId };
                    }
                }
            } catch (cacheErr) {
                console.warn("[Lectoro TTS] AudioCache lookup warning:", cacheErr.message || cacheErr);
            }
        }

        // ── STEP 2: Cloudflare R2 CDN (Static public cache, zero token cost) ──
        if (
            !forceBrowser &&
            typeof SharedUtils !== "undefined" &&
            typeof SharedUtils.getR2AudioUrl === "function"
        ) {
            // Probe candidate voice IDs in priority order
            const candidateVoiceIds = [
                preferredVoiceId,
                settings.elVoiceId,
                "CwhRBWXzGAHq8TQ4Fs17", // Roger
                "EXAVITQu4vr4xnSDxMaL", // Sarah
                "IKne3meq5aSn9XLyUdCD", // Charlie
                "21m00Tcm4TlvDq8ikWAM", // Rachel
                "default",
                "roger",
                "sarah",
                "charlie",
            ].filter((v, idx, arr) => v && typeof v === "string" && arr.indexOf(v) === idx);

            for (const candVoice of candidateVoiceIds) {
                try {
                    const r2Url = await SharedUtils.getR2AudioUrl(candVoice, cleaned);
                    if (r2Url) {
                        const r2Res = await fetch(r2Url);
                        if (r2Res.ok) {
                            const blob = await r2Res.blob();
                            if (blob && blob.size > 0) {
                                if (typeof AudioCache !== "undefined" && typeof AudioCache.set === "function") {
                                    AudioCache.set(`${cleaned}|${candVoice}`, blob).catch(() => {});
                                }
                                return { blob, provider: "elevenlabs", cached: true, voiceId: candVoice };
                            }
                        }
                    }
                } catch {
                    // Silently try next candidate
                }
            }

            // Also probe flat audio/{hash}.mp3 if voice-scoped paths were not found
            try {
                const hash = await SharedUtils.computeTextHash(cleaned);
                const flatUrl = `https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/audio/${hash}.mp3`;
                const flatRes = await fetch(flatUrl);
                if (flatRes.ok) {
                    const blob = await flatRes.blob();
                    if (blob && blob.size > 0) {
                        if (typeof AudioCache !== "undefined" && typeof AudioCache.set === "function") {
                            AudioCache.set(`${cleaned}|default`, blob).catch(() => {});
                        }
                        return { blob, provider: "elevenlabs", cached: true, voiceId: "default" };
                    }
                }
            } catch {
                // Silently continue
            }
        }

        // ── STEP 3: ElevenLabs Proxy Synthesis (Live API) - executed ONLY when allowSynthesis is true ──
        const canSynthesize =
            allowSynthesis &&
            !forceBrowser &&
            settings.ttsMode === "elevenlabs" &&
            !!preferredVoiceId &&
            preferredVoiceId !== "random" &&
            typeof SubscriptionService !== "undefined" &&
            !providerError;

        if (canSynthesize) {
            try {
                const validation = await SubscriptionService.checkElevenLabs(cleaned);
                if (typeof SubscriptionConfig !== "undefined") {
                    SubscriptionConfig.assertAllowed(validation);
                }
                const blob = await SubscriptionService.synthesizeElevenLabs(
                    cleaned,
                    preferredVoiceId,
                    context || "review",
                );
                if (blob && blob.size > 0) {
                    if (typeof AudioCache !== "undefined" && typeof AudioCache.set === "function") {
                        await AudioCache.set(`${cleaned}|${preferredVoiceId}`, blob);
                    }
                    return { blob, provider: "elevenlabs", cached: false, voiceId: preferredVoiceId };
                }
            } catch (err) {
                console.warn("[Lectoro TTS] ElevenLabs getAudioBlob fallback:", err.message || err);
                if (["ELEVENLABS_PROVIDER_DISABLED", "ELEVENLABS_PROVIDER_QUOTA"].includes(err?.code)) {
                    providerError = { code: err.code, message: err.message };
                }
            }
        }

        // ── STEP 4: Fallback to Google / Web TTS audio blob ──
        if (allowFallback) {
            const fallbackBlob = await fetchFallbackAudioBlob(cleaned, lang);
            if (fallbackBlob && fallbackBlob.size > 0) {
                return { blob: fallbackBlob, provider: "google-tts", cached: false };
            }
        }

        return null;
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
        getAudioBlob,
    });
});
