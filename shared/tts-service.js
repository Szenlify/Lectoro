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
    let activeUtterances = [];

    function cleanText(text) {
        return typeof SharedUtils !== "undefined" && SharedUtils.cleanTextForTTS
            ? SharedUtils.cleanTextForTTS(text)
            : String(text ?? "").trim();
    }

    /**
     * Parse text into language-tagged speech segments so foreign quotes,
     * idioms, and inserts inside explanations are read by their authentic native voice.
     *
     * Example:
     *   Base Lang: "pl" (Polish)
     *   Source Lang: "en" (English)
     *   Text: 'Zwrot "All right, I'll just go by myself" wyraża akceptację...'
     *   Result:
     *     [
     *       { text: "Zwrot", lang: "pl" },
     *       { text: "All right, I'll just go by myself", lang: "en" },
     *       { text: "wyraża akceptację...", lang: "pl" }
     *     ]
     */
    function parseSpeechSegments(text, baseLang = "en", { sourceLang = null, originalText = null } = {}) {
        const raw = String(text ?? "").trim();
        if (!raw) return [];

        const baseCode = (baseLang || "en").split(/[-_]/)[0].toLowerCase();
        let srcCode = (sourceLang || "").split(/[-_]/)[0].toLowerCase();

        // If sourceLang was not explicitly passed, infer from originalText if available
        if (!srcCode && originalText) {
            if (/[\u0400-\u04FF]/.test(originalText)) srcCode = "ru";
            else if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(originalText)) srcCode = "ja";
            else if (/[\uac00-\ud7af]/.test(originalText)) srcCode = "ko";
            else if (/[\u0600-\u06FF]/.test(originalText)) srcCode = "ar";
            else if (baseCode !== "en") srcCode = "en";
        }

        // If source and base languages are identical (or source is unknown), no code-switching is needed
        if (!srcCode || srcCode === baseCode) {
            return [{ text: raw, lang: baseLang }];
        }

        // Regex matching quoted substrings:
        // Double quotes ("..."), curly quotes (“...”, „...”, «...»), single quotes ('...')
        const quoteRegex = /(["“„«]([^"”»\r\n]+)["”»]|(?:^|[\s(])'([^'\r\n]{2,})'(?=[.,!?;:\s)]|$))/g;

        const matches = [];
        let match;
        while ((match = quoteRegex.exec(raw)) !== null) {
            const fullMatch = match[0];
            const inner = (match[2] || match[3] || "").trim();
            if (!inner) continue;

            const innerStart = match.index + fullMatch.indexOf(inner);
            const innerEnd = innerStart + inner.length;

            matches.push({
                start: match.index,
                end: match.index + fullMatch.length,
                innerStart,
                innerEnd,
                inner,
            });
        }

        if (matches.length === 0) {
            return [{ text: raw, lang: baseLang }];
        }

        // Language-specific diacritics to avoid mistaking base-language quotes for foreign ones
        const BASE_DIACRITICS = {
            pl: /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/,
            de: /[äöüßÄÖÜ]/,
            fr: /[éàèùâêîôûëïüçœæÉÀÈÙÂÊÎÔÛËÏÜÇ]/,
            es: /[áéíóúüñ¿¡ÁÉÍÓÚÜÑ]/,
            it: /[àèéìíîòóùúÀÈÉÌÍÎÒÓÙÚ]/,
            pt: /[ãõáéíóúâêôçÃÕÁÉÍÓÚÂÊÔÇ]/,
            cs: /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/,
            sk: /[áäčďdžéíĺľňóôŕšťúýžÁÄČĎDŽÉÍĹĽŇÓÔŔŠŤÚÝŽ]/,
            tr: /[çğıöşüÇĞİÖŞÜ]/,
            ru: /[\u0400-\u04FF]/,
            uk: /[іїєґІЇЄҐ\u0400-\u04FF]/,
            zh: /[\u4e00-\u9fff]/,
            ja: /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/,
            ko: /[\uac00-\ud7af]/,
            ar: /[\u0600-\u06FF]/,
        };

        const baseCharPattern = BASE_DIACRITICS[baseCode];

        const segments = [];
        let cursor = 0;

        for (const m of matches) {
            if (m.start > cursor) {
                const preText = raw.slice(cursor, m.start).trim();
                if (preText) {
                    segments.push({ text: preText, lang: baseLang });
                }
            }

            let isSourceLang = true;
            if (baseCharPattern && baseCharPattern.test(m.inner)) {
                isSourceLang = false;
            } else if (originalText) {
                const normOrig = originalText.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
                const normInner = m.inner.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ");
                if (normOrig.includes(normInner) || normInner.includes(normOrig)) {
                    isSourceLang = true;
                }
            }

            const targetSegmentLang = isSourceLang ? (sourceLang || "en") : baseLang;
            segments.push({ text: m.inner, lang: targetSegmentLang });
            cursor = m.end;
        }

        if (cursor < raw.length) {
            const postText = raw.slice(cursor).trim();
            if (postText) {
                segments.push({ text: postText, lang: baseLang });
            }
        }

        const merged = [];
        for (const s of segments) {
            if (!s.text.trim()) continue;
            const last = merged[merged.length - 1];
            if (last && last.lang.split(/[-_]/)[0].toLowerCase() === s.lang.split(/[-_]/)[0].toLowerCase()) {
                last.text += " " + s.text;
            } else {
                merged.push({ text: s.text, lang: s.lang });
            }
        }

        return merged.length > 0 ? merged : [{ text: raw, lang: baseLang }];
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
        activeUtterances = [];
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
            sourceLang = null,
            originalText = null,
        } = {},
    ) {
        if (!cleanedText) return null;
        if (isCancelled?.()) return null;

        const segments = parseSpeechSegments(cleanedText, lang, { sourceLang, originalText });
        if (!segments.length) return null;

        const utterances = [];
        let firstUtter = null;
        let lastUtter = null;

        for (const seg of segments) {
            if (!seg.text.trim()) continue;
            if (isCancelled?.()) {
                cancel();
                return null;
            }

            const utter = new SpeechSynthesisUtterance(seg.text);
            utter.lang = seg.lang || lang || "en";
            utter.rate = rate !== null ? rate : settings.speechRate;
            utter.volume = volume !== null ? volume : settings.ttsVolume;
            const voice = pickVoice(settings.speechVoice, seg.lang, voices);
            if (voice) utter.voice = voice;

            try {
                window.speechSynthesis?.speak(utter);
                if (!firstUtter) firstUtter = utter;
                lastUtter = utter;
                utterances.push(utter);
            } catch (error) {
                console.warn("[Lectoro TTS] SpeechSynthesis error:", error);
            }
        }

        if (!lastUtter) return null;

        activeUtterances = utterances;
        lastUtter.addEventListener("end", () => {
            activeUtterances = [];
        });

        if (firstUtter && firstUtter !== lastUtter) {
            firstUtter.addEventListener("error", (e) => {
                try {
                    lastUtter.onerror?.(e);
                } catch (_) {}
            });
        }

        return lastUtter;
    }

    /**
     * Speak text using Web Speech API (browser synthesizer).
     */
    async function speakBrowser(
        text,
        lang = "en",
        {
            rate = null,
            volume = null,
            isCancelled = null,
            sourceLang = null,
            originalText = null,
        } = {},
    ) {
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
            sourceLang,
            originalText,
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
            sourceLang = null,
            originalText = null,
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

        const segments = parseSpeechSegments(cleaned, lang, { sourceLang, originalText });
        const isMultilingual = segments.length > 1;

        const useElevenLabs =
            !forceBrowser &&
            !isMultilingual &&
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
            sourceLang,
            originalText,
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
        parseSpeechSegments,
        ensureVoices,
        cancel,
        pickVoice,
        getTtsSettings,
        cleanText,
        getSafetyTimeout,
        getAudioBlob,
    });
});
