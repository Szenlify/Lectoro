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
            escapeAttr,
            ensureVoices,
            pickBestVoice: pickVoice,
        } = Utils;
        const DEFAULT_TTS_SETTINGS = Constants.DEFAULT_TTS_SETTINGS;
        const DEFAULT_READING_SETTINGS = Constants.DEFAULT_READING_SETTINGS;
        const defaultLearning = DEFAULT_READING_SETTINGS?.learningLang || "en";

        let activeAudio = null;
        let globalSpeechToken = 0;
        let providerError = null;
        let activeUtterances = [];

        function cleanText(text) {
            return Utils.cleanTextForTTS(text);
        }
        const BASE_DIACRITICS = Object.freeze({
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
        });

        const TRANSLATION_INTRO_REGEX =
            /(?:oznacza|znaczy|czyli|znaczeniu|tłumaczy|przekład|translation|translated as|meaning|means|c-à-d|bedeutet|significa|signifie)\s*:?\s*$/i;
        const SOURCE_INTRO_REGEX =
            /(?:zwrot|słowo|fraza|wyrażenie|termin|phrase|word|term|idiom|quote|tekst|zdanie|sentence)\s*:?\s*$/i;
        // Quoted substrings: "...", “...”, „...”, «...» and '...' (2+ chars, word-bounded)
        const QUOTE_REGEX_SOURCE =
            /(["“„«]([^"”»\r\n]+)["”»]|(?:^|[\s(])'([^'\r\n]{2,})'(?=[.,!?;:\s)]|$))/g;

        /** ISO 639-1 base code ("en-US" → "en") */
        function baseLangCode(lang, fallback = "") {
            return (lang || fallback).split(/[-_]/)[0].toLowerCase();
        }

        /**
         * Resolve the source-language code for quote code-switching: explicit `sourceLang`
         * wins, otherwise infer from the script of `originalText`.
         */
        function inferSourceCode(baseCode, sourceLang, originalText) {
            const explicit = baseLangCode(sourceLang);
            if (explicit || !originalText) return explicit;
            if (/[\u0400-\u04FF]/.test(originalText)) return "ru";
            if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(originalText))
                return "ja";
            if (/[\uac00-\ud7af]/.test(originalText)) return "ko";
            if (/[\u0600-\u06FF]/.test(originalText)) return "ar";
            return baseCode !== defaultLearning ? defaultLearning : "";
        }

        function isSourceLanguageQuote(
            inner,
            preSnippet,
            baseCharPattern,
            originalText,
        ) {
            if (!inner) return false;
            if (baseCharPattern && baseCharPattern.test(inner)) {
                return false;
            }
            if (TRANSLATION_INTRO_REGEX.test(preSnippet)) {
                return false;
            }
            if (originalText) {
                const normOrig = originalText
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s]/gu, " ");
                const normInner = inner
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s]/gu, " ");
                if (
                    normOrig.includes(normInner) ||
                    normInner.includes(normOrig)
                ) {
                    return true;
                }
                const innerWords = normInner
                    .split(/\s+/)
                    .filter((w) => w.length > 2);
                const origWords = new Set(
                    normOrig.split(/\s+/).filter((w) => w.length > 2),
                );
                if (
                    innerWords.length > 0 &&
                    innerWords.some((w) => origWords.has(w))
                ) {
                    return true;
                }
                if (SOURCE_INTRO_REGEX.test(preSnippet)) {
                    return true;
                }
                return false;
            }
            if (SOURCE_INTRO_REGEX.test(preSnippet)) {
                return true;
            }
            return true;
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
        function parseSpeechSegments(
            text,
            baseLang = defaultLearning,
            { sourceLang = null, originalText = null } = {},
        ) {
            const raw = String(text ?? "").trim();
            if (!raw) return [];

            const baseCode = baseLangCode(baseLang, defaultLearning);
            const srcCode = inferSourceCode(baseCode, sourceLang, originalText);

            // If source and base languages are identical (or source is unknown), no code-switching is needed
            if (!srcCode || srcCode === baseCode) {
                return [{ text: raw, lang: baseLang }];
            }

            const quoteRegex = new RegExp(QUOTE_REGEX_SOURCE.source, "g");

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

                const preSnippet = raw
                    .slice(Math.max(0, m.start - 35), m.start)
                    .trim();
                const isSourceLang = isSourceLanguageQuote(
                    m.inner,
                    preSnippet,
                    baseCharPattern,
                    originalText,
                );
                const targetSegmentLang = isSourceLang
                    ? sourceLang || defaultLearning
                    : baseLang;
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
                if (last && baseLangCode(last.lang) === baseLangCode(s.lang)) {
                    last.text += " " + s.text;
                } else {
                    merged.push({ text: s.text, lang: s.lang });
                }
            }

            return merged.length > 0 ? merged : [{ text: raw, lang: baseLang }];
        }

        /**
         * Formats speech markup so that any quotes read by TTS in the source/original language
         * are wrapped in <span class="quoteClass">"..."</span> with white styling, while the rest
         * of the explanation/translation retains its existing styling.
         */
        function formatSpeechMarkup(
            text,
            baseLang = defaultLearning,
            {
                sourceLang = null,
                originalText = null,
                quoteClass = "__qt_tts-original-quote",
            } = {},
        ) {
            const raw = String(text ?? "");
            if (!raw) return "";

            const baseCode = baseLangCode(baseLang, defaultLearning);
            const srcCode = inferSourceCode(baseCode, sourceLang, originalText);

            if (!srcCode || srcCode === baseCode) {
                return escapeHtml(raw);
            }

            const quoteRegex = new RegExp(QUOTE_REGEX_SOURCE.source, "g");
            const baseCharPattern = BASE_DIACRITICS[baseCode];

            let resultHtml = "";
            let cursor = 0;
            let match;

            while ((match = quoteRegex.exec(raw)) !== null) {
                const fullMatch = match[0];
                const inner = (match[2] || match[3] || "").trim();
                if (!inner) continue;

                let quoteStart = match.index;
                let quoteText = fullMatch;
                const leadingChar = fullMatch[0];
                if (
                    leadingChar === " " ||
                    leadingChar === "(" ||
                    leadingChar === "\t"
                ) {
                    quoteStart += 1;
                    quoteText = fullMatch.slice(1);
                }

                const quoteEnd = match.index + fullMatch.length;

                if (quoteStart > cursor) {
                    resultHtml += escapeHtml(raw.slice(cursor, quoteStart));
                }

                const preSnippet = raw
                    .slice(Math.max(0, quoteStart - 35), quoteStart)
                    .trim();
                const isSourceLang = isSourceLanguageQuote(
                    inner,
                    preSnippet,
                    baseCharPattern,
                    originalText,
                );

                if (isSourceLang) {
                    resultHtml += `<span class="${escapeAttr(quoteClass)}">${escapeHtml(quoteText)}</span>`;
                } else {
                    resultHtml += escapeHtml(quoteText);
                }

                cursor = quoteEnd;
            }

            if (cursor < raw.length) {
                resultHtml += escapeHtml(raw.slice(cursor));
            }

            return resultHtml;
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

            const segments = parseSpeechSegments(cleanedText, lang, {
                sourceLang,
                originalText,
            });
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
                utter.lang = seg.lang || lang || defaultLearning;
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

            if (isCancelled?.() || currentToken !== globalSpeechToken)
                return null;

            // Check if audio exists in local AudioCache or Cloudflare R2
            try {
                const targetVoiceId = settings.elVoiceId || "nova";
                const cacheKey = await Utils.getGeminiAudioCacheKey(targetVoiceId, cleaned, lang);

                // 1. Check local AudioCache (IndexedDB) - free, instant
                let audioBlob = typeof AudioCache !== "undefined"
                    ? await AudioCache.get(cacheKey)
                    : null;

                // 2. If not in local cache, check Cloudflare R2 CDN
                if (!audioBlob) {
                    const r2Url = await Utils.getR2AudioUrl(targetVoiceId, cleaned, lang);
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
                    if (isCancelled?.() || currentToken !== globalSpeechToken) {
                        return { type: "none", obj: null };
                    }
                    const url = URL.createObjectURL(audioBlob);
                    const audio = new Audio(url);
                    audio.volume = volume !== null ? volume : settings.ttsVolume;
                    audio.playbackRate = rate !== null ? rate : (settings.speechRate || 1);
                    activeAudio = audio;
                    audio.addEventListener(
                        "ended",
                        () => URL.revokeObjectURL(url),
                        { once: true },
                    );
                    audio.addEventListener(
                        "error",
                        () => URL.revokeObjectURL(url),
                        { once: true },
                    );
                    await audio.play();
                    return { type: "audio", obj: audio };
                }
            } catch (err) {
                console.debug("[Lectoro TTS] Hover R2 check fallback to browser voice:", err.message);
            }

            return speakBrowserDirect(cleaned, lang, settings, {
                rate,
                volume,
                voices,
                sourceLang,
                originalText,
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

            const playbackRate = Number.isFinite(rate) && rate > 0
                ? rate
                : (useConfiguredRate ? settings.speechRate : 1);
            const segments = parseSpeechSegments(cleaned, lang, {
                sourceLang,
                originalText,
            });
            const isMultilingual = segments.length > 1;

            const useNeuralTts =
                !forceBrowser &&
                !isMultilingual &&
                (settings.ttsMode === "openai" || settings.ttsMode === "gemini") &&
                !!settings.elVoiceId &&
                settings.elVoiceId !== "random" &&
                typeof SubscriptionService !== "undefined" &&
                typeof AudioCache !== "undefined";

            if (useNeuralTts) {
                try {
                    const targetVoiceId = settings.elVoiceId;
                    const audioResult = await getAudioBlob(cleaned, lang, {
                        forceBrowser: false,
                        voiceId: targetVoiceId,
                        context: "review",
                        cacheNotBefore,
                        allowSynthesis: true,
                    });

                    if (
                        audioResult?.blob &&
                        (audioResult.provider === "openai" || audioResult.provider === "gemini")
                    ) {
                        if (
                            isCancelled?.() ||
                            currentToken !== globalSpeechToken
                        ) {
                            return { type: "none", obj: null };
                        }
                        const url = URL.createObjectURL(audioResult.blob);
                        const audio = new Audio(url);
                        audio.volume = settings.ttsVolume;
                        audio.playbackRate = playbackRate;
                        activeAudio = audio;
                        audio.addEventListener(
                            "ended",
                            () => URL.revokeObjectURL(url),
                            { once: true },
                        );
                        audio.addEventListener(
                            "error",
                            () => URL.revokeObjectURL(url),
                            { once: true },
                        );
                        await audio.play();
                        return { type: "audio", obj: audio };
                    }
                } catch (err) {
                    console.warn(
                        "[Lectoro TTS] Gemini TTS playback fallback:",
                        err.message || err,
                    );
                }
            }

            // Fallback or default to Browser Speech
            const utter = speakBrowserDirect(cleaned, lang, settings, {
                rate: playbackRate,
                volume: settings.ttsVolume,
                voices,
                sourceLang,
                originalText,
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
                cacheNotBefore = 0,
                allowSynthesis = false,
                allowFallback = true,
            } = {},
        ) {
            const cleaned = cleanText(text);
            if (!cleaned) return null;

            const settings = await getTtsSettings();
            const preferredVoiceId = Constants.normalizeTtsProviderSettings({
                ...settings, elVoiceId: voiceId || settings.elVoiceId,
            }).elVoiceId;
            const cacheKey = await Utils.getGeminiAudioCacheKey(preferredVoiceId, cleaned, lang);

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
            formatSpeechMarkup,
            cancel,
            getSafetyTimeout,
            getAudioBlob,
            googleTtsUrl,
        });
    },
);
