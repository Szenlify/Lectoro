/**
 * Lectoro – Universal TTS & Speech Synthesis Service (SSOT)
 * Single Source of Truth for Web Speech API, Gemini TTS neural voices,
 * voice selection heuristics, audio caching, safety timeouts, and cancellation.
 */
(function initTtsService(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const resolve = (name, path) =>
        (root && root[name]) || (isNode ? require(path) : undefined);
    const api = factory({
        Utils: resolve("SharedUtils", "./utils"),
        Constants: resolve("LectoroConstants", "./constants"),
    });
    if (isNode) module.exports = api;
    if (root) root.SharedTtsService = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createTtsService(deps) {
        "use strict";

        const { Utils, Constants } = deps;
        const {
            escapeHtml,
            ensureVoices,
            pickBestVoice: pickVoice,
        } = Utils;
        const DEFAULT_TTS_SETTINGS = Constants.DEFAULT_TTS_SETTINGS;
        const DEFAULT_READING_SETTINGS = Constants.DEFAULT_READING_SETTINGS;
        const defaultLearning = DEFAULT_READING_SETTINGS?.learningLang || "en";

        let activeAudio = null;
        let activeSourceNode = null;
        let sharedAudioContext = null;
        let globalSpeechToken = 0;
        let providerError = null;
        let activeUtterances = [];

        function cleanText(text) {
            return Utils.cleanTextForTTS(text);
        }
        function hasArrowSymbol(text) {
            if (typeof Utils?.hasArrow === "function") {
                return Utils.hasArrow(text);
            }
            return /(?:[-=]+>|<[-=]+|[→←↑↓↔↕⇒⇐⇔➔➜➝➞➟➠➡➢➣➤\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F\u2B00-\u2BFF\u2794-\u27BF])/.test(String(text || ""));
        }
        /** ISO 639-1 base code ("en-US" → "en") */
        function baseLangCode(lang, fallback = "") {
            return (lang || fallback).split(/[-_]/)[0].toLowerCase();
        }

        // Compatibility helper: quotes are ordinary text, never language markup.
        function formatSpeechMarkup(text) {
            return escapeHtml(String(text ?? ""));
        }

        function getSafetyTimeout(text, rate = 1) {
            const words = String(text || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean);
            const estimatedMs =
                (words.length / Math.max(0.5, Number(rate) * 1.5 || 1.5)) *
                1000;
            return Math.min(300000, Math.max(6000, estimatedMs + 6000));
        }

        async function getTtsSettings() {
            if (typeof chrome === "undefined" || !chrome?.storage?.local) {
                return { ...DEFAULT_TTS_SETTINGS };
            }
            const data = await chrome.storage.local.get({
                ...DEFAULT_TTS_SETTINGS,
                learningLang: DEFAULT_READING_SETTINGS?.learningLang || "en",
            });
            const migrated = Constants.normalizeTtsProviderSettings(data);
            if (data.ttsMode !== migrated.ttsMode || data.elVoiceId !== migrated.elVoiceId) {
                await chrome.storage.local.set(migrated);
            }
            Object.assign(data, migrated);
            const rawVol =
                data.ttsVolume !== undefined
                    ? Number(data.ttsVolume)
                    : DEFAULT_TTS_SETTINGS.ttsVolume;
            return {
                ttsMode: data.ttsMode || DEFAULT_TTS_SETTINGS.ttsMode,
                learningLang: data.learningLang || DEFAULT_READING_SETTINGS?.learningLang || "en",
                speechVoice:
                    data.speechVoice || DEFAULT_TTS_SETTINGS.speechVoice,
                speechRate: Math.max(
                    0.1,
                    Math.min(
                        10,
                        Number(data.speechRate) ||
                            DEFAULT_TTS_SETTINGS.speechRate,
                    ),
                ),
                ttsVolume: Number.isFinite(rawVol)
                    ? Math.max(0, Math.min(1, rawVol))
                    : DEFAULT_TTS_SETTINGS.ttsVolume,
                elVoiceId: data.elVoiceId || DEFAULT_TTS_SETTINGS.elVoiceId,
            };
        }

        /**
         * Stop all in-progress speech playback immediately.
         */
        function cancel() {
            globalSpeechToken += 1;
            try {
                window.speechSynthesis?.cancel();
            } catch (_) {}
            activeUtterances = [];
            if (activeSourceNode) {
                try {
                    activeSourceNode.stop();
                } catch (_) {}
                activeSourceNode = null;
            }
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
        function speakBrowserDirect(
            cleanedText,
            lang,
            settings,
            {
                rate = null,
                volume = null,
                isCancelled = null,
                voices = null,
            } = {},
        ) {
            if (!cleanedText) return null;
            if (isCancelled?.()) return null;

            // One utterance in the explicitly requested language, including quotes.
            const utter = new SpeechSynthesisUtterance(cleanedText);
            utter.lang = lang || defaultLearning;
            utter.rate = rate !== null ? rate : settings.speechRate;
            utter.volume = volume !== null ? volume : settings.ttsVolume;
            const voice = pickVoice(settings.speechVoice, utter.lang, voices);
            if (voice) utter.voice = voice;

            try {
                window.speechSynthesis?.speak(utter);
            } catch (error) {
                console.warn("[Lectoro TTS] SpeechSynthesis error:", error);
                return null;
            }
            activeUtterances = [utter];
            utter.addEventListener("end", () => {
                activeUtterances = [];
            });
            return utter;
        }

        /**
         * Play an audio blob using Web Audio API for gain boosting + transparent dynamic limiter.
         * Boosting Nova by ~1.85x (+5.3 dB) and Onyx by ~1.30x (+2.3 dB) compensates for OpenAI's naturally
         * softer recording level (-21 LUFS) relative to system/browser TTS (-14 LUFS).
         * Dynamics compressor acts as a transparent peak limiter preventing distortion or clipping.
         * Falls back to standard HTMLAudioElement when Web Audio is unavailable.
         */
        async function playAudioBlob(
            blob,
            {
                voiceId = "nova",
                volume = null,
                rate = null,
                isCancelled = null,
                currentToken = globalSpeechToken,
            } = {},
        ) {
            if (!blob || blob.size === 0) return { type: "none", obj: null };
            if (isCancelled?.() || currentToken !== globalSpeechToken) {
                return { type: "none", obj: null };
            }

            const rawGain =
                (Constants.OPENAI_VOICE_GAIN &&
                    Constants.OPENAI_VOICE_GAIN[voiceId]) ||
                1.0;
            const userVolume = Number.isFinite(volume) && volume >= 0 ? volume : 1.0;
            const targetGain = rawGain * userVolume;
            const playbackRate = Number.isFinite(rate) && rate > 0 ? rate : 1.0;

            const AudioCtx =
                typeof window !== "undefined" &&
                (window.AudioContext ||
                    window.webkitAudioContext ||
                    (typeof globalThis !== "undefined" &&
                        (globalThis.AudioContext || globalThis.webkitAudioContext)));

            // 1. Try Web Audio API for gain boosting + transparent dynamic limiter
            if (AudioCtx) {
                try {
                    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
                        sharedAudioContext = new AudioCtx();
                    }
                    if (sharedAudioContext.state === "suspended") {
                        await sharedAudioContext.resume();
                    }

                    const arrayBuffer = await blob.arrayBuffer();
                    if (isCancelled?.() || currentToken !== globalSpeechToken) {
                        return { type: "none", obj: null };
                    }

                    const audioBuffer = await sharedAudioContext.decodeAudioData(arrayBuffer);
                    if (isCancelled?.() || currentToken !== globalSpeechToken) {
                        return { type: "none", obj: null };
                    }

                    const ctx = sharedAudioContext;
                    const source = ctx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.playbackRate.value = playbackRate;

                    // Dynamics compressor acts as a transparent peak limiter to prevent clipping
                    const compressor = ctx.createDynamicsCompressor();
                    compressor.threshold.setValueAtTime(-3, ctx.currentTime);
                    compressor.knee.setValueAtTime(6, ctx.currentTime);
                    compressor.ratio.setValueAtTime(12, ctx.currentTime);
                    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
                    compressor.release.setValueAtTime(0.05, ctx.currentTime);

                    const gainNode = ctx.createGain();
                    gainNode.gain.setValueAtTime(targetGain, ctx.currentTime);

                    source.connect(gainNode);
                    gainNode.connect(compressor);
                    compressor.connect(ctx.destination);

                    activeSourceNode = source;

                    const listeners = { ended: new Set(), error: new Set() };
                    let ended = false;
                    const finish = () => {
                        if (!ended) {
                            ended = true;
                            if (activeSourceNode === source) {
                                activeSourceNode = null;
                            }
                            if (activeAudio === proxyAudio) {
                                activeAudio = null;
                            }
                            for (const fn of listeners.ended) {
                                try { fn(); } catch (_) {}
                            }
                            if (typeof proxyAudio.onended === "function") {
                                try { proxyAudio.onended(); } catch (_) {}
                            }
                        }
                    };

                    source.onended = finish;

                    const proxyAudio = {
                        _source: source,
                        pause: () => {
                            try { source.stop(); } catch (_) {}
                            finish();
                        },
                        stop: () => {
                            try { source.stop(); } catch (_) {}
                            finish();
                        },
                        addEventListener: (event, handler) => {
                            if (listeners[event]) listeners[event].add(handler);
                        },
                        removeEventListener: (event, handler) => {
                            if (listeners[event]) listeners[event].delete(handler);
                        },
                        onended: null,
                        onerror: null,
                    };

                    activeAudio = proxyAudio;
                    source.start(0);
                    return { type: "audio", obj: proxyAudio };
                } catch (audioCtxError) {
                    console.warn(
                        "[Lectoro TTS] Web Audio API playback failed, falling back to HTMLAudioElement:",
                        audioCtxError?.message || audioCtxError,
                    );
                }
            }

            // 2. Fallback to HTML Audio Element
            if (isCancelled?.() || currentToken !== globalSpeechToken) {
                return { type: "none", obj: null };
            }

            if (typeof Audio === "function") {
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.volume = Math.min(1.0, userVolume);
                audio.playbackRate = playbackRate;
                activeAudio = audio;
                audio.addEventListener(
                    "ended",
                    () => {
                        URL.revokeObjectURL(url);
                        if (activeAudio === audio) activeAudio = null;
                    },
                    { once: true },
                );
                audio.addEventListener(
                    "error",
                    () => {
                        URL.revokeObjectURL(url);
                        if (activeAudio === audio) activeAudio = null;
                    },
                    { once: true },
                );
                await audio.play();
                return { type: "audio", obj: audio };
            }

            return { type: "none", obj: null };
        }

        /**
         * Speak text using Web Speech API (browser synthesizer),
         * with intelligent R2 check: if audio exists in local cache or R2, play high-quality audio;
         * otherwise immediately fall back to Google Chrome system voice.
         */
        async function speakBrowser(
            text,
            lang = defaultLearning,
            {
                rate = null,
                volume = null,
                sourceLang = null,
                isCancelled = null,
            } = {},
        ) {
            const isArrow = hasArrowSymbol(text);
            const cleaned = cleanText(text);
            if (!cleaned) return null;

            cancel();
            const currentToken = globalSpeechToken;
            const [settings, voices] = await Promise.all([
                getTtsSettings(),
                ensureVoices(),
            ]);

            if (isCancelled?.() || currentToken !== globalSpeechToken)
                return null;

            const effectiveLang = isArrow
                ? (sourceLang || settings.learningLang || defaultLearning)
                : (lang || defaultLearning);

            // Check if audio exists in local AudioCache or Cloudflare R2
            try {
                const targetVoiceId = settings.elVoiceId || "nova";
                const cacheKey = await Utils.getGeminiAudioCacheKey(targetVoiceId, cleaned, effectiveLang);

                // 1. Check local AudioCache (IndexedDB) - free, instant
                let audioBlob = typeof AudioCache !== "undefined"
                    ? await AudioCache.get(cacheKey)
                    : null;

                // 2. If not in local cache, check Cloudflare R2 CDN
                if (!audioBlob) {
                    const r2Url = await Utils.getR2AudioUrl(targetVoiceId, cleaned, effectiveLang);
                    let inR2 = false;
                    try {
                        const headRes = await fetch(r2Url, {
                            method: "HEAD",
                            signal: AbortSignal.timeout(600),
                        });
                        if (
                            headRes.ok &&
                            /^audio\/(?:mpeg|mp3|wav|wave|x-wav)(?:;|$)/i.test(
                                headRes.headers.get("content-type") || "",
                            )
                        ) {
                            inR2 = true;
                        }
                    } catch (_) {
                        inR2 = false;
                    }

                    if (inR2) {
                        // Download from R2 via proxy (charges usage if signed in, or direct CDN fallback)
                        try {
                            if (typeof SubscriptionService !== "undefined") {
                                audioBlob = await SubscriptionService.synthesizeGeminiTts(
                                    cleaned,
                                    targetVoiceId,
                                    "hover",
                                    lang,
                                    { onlyIfCached: true },
                                );
                            }
                        } catch (_) {
                            try {
                                const cdnRes = await fetch(r2Url, { signal: AbortSignal.timeout(1500) });
                                if (cdnRes.ok) audioBlob = await cdnRes.blob();
                            } catch (_) {}
                        }
                        if (audioBlob && typeof AudioCache !== "undefined") {
                            await AudioCache.set(cacheKey, audioBlob);
                        }
                    }
                }

                // If audio was found in local cache or R2, play it!
                if (audioBlob && audioBlob.size > 0) {
                    return playAudioBlob(audioBlob, {
                        voiceId: targetVoiceId,
                        volume: volume !== null ? volume : settings.ttsVolume,
                        rate: rate !== null ? rate : (settings.speechRate || 1),
                        isCancelled,
                        currentToken,
                    });
                }
            } catch (err) {
                console.debug("[Lectoro TTS] Hover R2 check fallback to browser voice:", err.message);
            }

            return speakBrowserDirect(cleaned, effectiveLang, settings, {
                rate,
                volume,
                voices,
                isCancelled: () =>
                    isCancelled?.() || currentToken !== globalSpeechToken,
            });
        }

        /**
         * Universal speak function respecting user settings and optional Gemini TTS / AudioCache.
         */
        async function speak(
            text,
            lang = defaultLearning,
            {
                forceBrowser = false,
                useConfiguredRate = true,
                rate = null,
                sourceLang = null,
                cacheNotBefore = 0,
                isCancelled = null,
            } = {},
        ) {
            const isArrow = hasArrowSymbol(text);
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

            const effectiveLang = isArrow
                ? (sourceLang || settings.learningLang || defaultLearning)
                : (lang || defaultLearning);

            const playbackRate = Number.isFinite(rate) && rate > 0
                ? rate
                : (useConfiguredRate ? settings.speechRate : 1);
            const useNeuralTts =
                !forceBrowser &&
                (settings.ttsMode === "openai" || settings.ttsMode === "gemini") &&
                !!settings.elVoiceId &&
                settings.elVoiceId !== "random" &&
                typeof SubscriptionService !== "undefined" &&
                typeof AudioCache !== "undefined";

            if (useNeuralTts) {
                try {
                    const targetVoiceId = settings.elVoiceId;
                    const audioResult = await getAudioBlob(cleaned, effectiveLang, {
                        forceBrowser: false,
                        voiceId: targetVoiceId,
                        context: "review",
                        sourceLang: effectiveLang,
                        cacheNotBefore,
                        allowSynthesis: true,
                    });

                    if (
                        audioResult?.blob &&
                        (audioResult.provider === "openai" || audioResult.provider === "gemini")
                    ) {
                        return playAudioBlob(audioResult.blob, {
                            voiceId: audioResult.voiceId || targetVoiceId,
                            volume: settings.ttsVolume,
                            rate: playbackRate,
                            isCancelled,
                            currentToken,
                        });
                    }
                } catch (err) {
                    console.warn(
                        "[Lectoro TTS] Gemini TTS playback fallback:",
                        err.message || err,
                    );
                }
            }

            // Fallback or default to Browser Speech
            const utter = speakBrowserDirect(cleaned, effectiveLang, settings, {
                rate: playbackRate,
                volume: settings.ttsVolume,
                voices,
                isCancelled: () =>
                    isCancelled?.() || currentToken !== globalSpeechToken,
            });

            return { type: "utter", obj: utter };
        }

        /** Helper URL for web TTS fallback (Google TTS audio endpoint) */
        function googleTtsUrl(text, lang) {
            const tl = encodeURIComponent(baseLangCode(lang, defaultLearning));
            const q = encodeURIComponent(text);
            return `${Constants.ENDPOINTS.GOOGLE_TTS}?ie=UTF-8&client=tw-ob&tl=${tl}&q=${q}`;
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
         * Cloudflare R2 CDN, and Gemini TTS neural synthesis with automatic fallback.
         * Single Source of Truth for audio downloads (e.g. Anki export).
         */
        async function getAudioBlob(
            text,
            lang = defaultLearning,
            {
                forceBrowser = false,
                voiceId = null,
                context = "review",
                sourceLang = null,
                cacheNotBefore = 0,
                allowSynthesis = false,
                allowFallback = true,
            } = {},
        ) {
            const isArrow = hasArrowSymbol(text);
            const cleaned = cleanText(text);
            if (!cleaned) return null;

            const settings = await getTtsSettings();
            const effectiveLang = isArrow
                ? (sourceLang || settings.learningLang || defaultLearning)
                : (lang || defaultLearning);
            const preferredVoiceId = Constants.normalizeTtsProviderSettings({
                ...settings, elVoiceId: voiceId || settings.elVoiceId,
            }).elVoiceId;
            const cacheKey = await Utils.getGeminiAudioCacheKey(preferredVoiceId, cleaned, effectiveLang);

            // Only the requested model, voice, language and exact text may satisfy this request.
            // Legacy ElevenLabs blobs remain in storage, but are not presented as Gemini audio.
            if (!forceBrowser) {
                try {
                    const blob = typeof AudioCache !== "undefined"
                        ? await AudioCache.get(cacheKey, { notBefore: cacheNotBefore }) : null;
                    if (blob?.size > 0) return { blob, provider: "gemini", cached: true, voiceId: preferredVoiceId };
                } catch (error) {
                    console.warn("[Lectoro TTS] Audio cache read failed:", error.message);
                }
                // A freshness cutoff applies to local metadata; CDN objects have no creation metadata.
                if (!cacheNotBefore) {
                    try {
                        const response = await fetch(await Utils.getR2AudioUrl(preferredVoiceId, cleaned, lang), { signal: AbortSignal.timeout(5000) });
                        if (response.ok && /^audio\/(?:mpeg|mp3|wav|wave|x-wav)(?:;|$)/i.test(response.headers.get("content-type") || "")) {
                            const blob = await response.blob();
                            if (blob.size > 0) {
                                if (typeof AudioCache !== "undefined") await AudioCache.set(cacheKey, blob);
                                return { blob, provider: "openai", cached: true, voiceId: preferredVoiceId };
                            }
                        }
                    } catch (_) { /* A cache miss falls through to synthesis. */ }
                }
            }

            // ── STEP 3: TTS Proxy Synthesis (Live API) - executed ONLY when allowSynthesis is true ──
            const canSynthesize =
                allowSynthesis &&
                !forceBrowser &&
                (settings.ttsMode === "openai" || settings.ttsMode === "gemini") &&
                !!preferredVoiceId &&
                preferredVoiceId !== "random" &&
                typeof SubscriptionService !== "undefined" &&
                (!providerError || Date.now() >= providerError.retryAfter);

            if (canSynthesize) {
                try {
                    const validation =
                        await SubscriptionService.checkGeminiTts(cleaned);
                    if (typeof SubscriptionConfig !== "undefined") {
                        SubscriptionConfig.assertAllowed(validation);
                    }
                    const blob = await SubscriptionService.synthesizeGeminiTts(
                        cleaned,
                        preferredVoiceId,
                        context || "review",
                        lang,
                        { skipCacheCheck: true },
                    );
                    if (blob && blob.size > 0) {
                        if (
                            typeof AudioCache !== "undefined" &&
                            typeof AudioCache.set === "function"
                        ) {
                            await AudioCache.set(
                                cacheKey,
                                blob,
                            );
                        }
                        return {
                            blob,
                            provider: "openai",
                            cached: false,
                            voiceId: preferredVoiceId,
                        };
                    }
                } catch (err) {
                    console.warn(
                        "[Lectoro TTS] Gemini TTS getAudioBlob fallback:",
                        err.message || err,
                    );
                    const isLimit =
                        err?.code === "GEMINI_TTS_MONTHLY_LIMIT_REACHED" ||
                        err?.limit?.code === "GEMINI_TTS_MONTHLY_LIMIT_REACHED" ||
                        err?.status === 429;
                    if (isLimit) {
                        try {
                            if (typeof SubscriptionService !== "undefined") {
                                void SubscriptionService.effectiveProfile(false).then((prof) => {
                                    const renewalTimestamp =
                                        prof?.stripeCurrentPeriodEnd ||
                                        prof?.usage?.elevenLabsCharacters?.month ||
                                        null;
                                    const renewalDate = typeof Utils !== "undefined" && typeof Utils.formatNextUsageRenewalDate === "function"
                                        ? Utils.formatNextUsageRenewalDate(renewalTimestamp)
                                        : "";
                                    if (typeof window !== "undefined") {
                                        window.dispatchEvent(
                                            new CustomEvent("lectoro-tts-quota-exhausted", {
                                                detail: { renewalDate, renewalTimestamp },
                                            }),
                                        );
                                    }
                                    if (typeof chrome !== "undefined" && chrome.storage?.local) {
                                        chrome.storage.local.set({
                                            ttsQuotaExhausted: { renewalDate, renewalTimestamp, at: Date.now() },
                                        });
                                    }
                                });
                            }
                        } catch (_) {}
                    }
                    if (
                        [
                            "GEMINI_TTS_PROVIDER_DISABLED",
                            "GEMINI_TTS_PROVIDER_QUOTA",
                        ].includes(err?.code)
                    ) {
                        providerError = {
                            code: err.code,
                            message: err.message,
                            retryAfter: Date.now() + 60000,
                        };
                    }
                }
            }

            // ── STEP 4: Fallback to Google / Web TTS audio blob ──
            if (allowFallback) {
                const fallbackBlob = await fetchFallbackAudioBlob(
                    cleaned,
                    lang,
                );
                if (fallbackBlob && fallbackBlob.size > 0) {
                    return {
                        blob: fallbackBlob,
                        provider: "google-tts",
                        cached: false,
                    };
                }
            }

            return null;
        }

        return Object.freeze({
            speak,
            speakBrowser,
            playAudioBlob,
            formatSpeechMarkup,
            cancel,
            getSafetyTimeout,
            getAudioBlob,
            googleTtsUrl,
        });
    },
);
