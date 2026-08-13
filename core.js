/**
 * Quick Translator – Core Module
 * Shared constants, utilities, UI, translation, TTS, storage,
 * and reusable subtitle helpers used by all site-specific modules.
 *
 * Exposes: window.QT
 */
(() => {
    "use strict";

    // ── Constants ──────────────────────────────────────────────────
    const { escapeHtml, escapeAttr, cleanTextForTTS, pickBestVoice } =
        SharedUtils;
    const PREFIX = "__qt_";
    const ICON_ID = PREFIX + "icon";
    const TOOLTIP_ID = PREFIX + "tooltip";

    // ── SVG Icons ──────────────────────────────────────────────────
    const SVG = {
        TRANSLATE: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>`,
        SPEAKER: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
        SAVE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
        SAVE_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#4ecdc4" stroke="#4ecdc4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
        SAVE_SENTENCE: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        SAVE_SENTENCE_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#4ecdc4" stroke="#4ecdc4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
        SAVE_AI: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
        SAVE_AI_CHECK: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#a78bfa" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
        READ: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
        AI: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6 6 1-4.5 4.25L17 20l-5-3.75L7 20l.5-6.75L3 9l6-1 3-6z"/><path d="M8 13h8"/><path d="M8 17h8"/></svg>`,
        IMAGE_SEARCH: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    };

    // ── Language Names ─────────────────────────────────────────────
    const LANG_NAMES = {
        pl: "PL",
        en: "EN",
    };

    function langTag(code) {
        return LANG_NAMES[code] || code?.toUpperCase() || "?";
    }

    // ── Pre-load Voices ────────────────────────────────────────────
    window.speechSynthesis?.getVoices();
    if (window.speechSynthesis?.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
            window.speechSynthesis.getVoices();
        };
    }

    // ── Internal State ─────────────────────────────────────────────
    let tooltipEl = null;
    let lastMouseX = 0;
    let lastMouseY = 0;
    let elAudioEl = null;

    const cleanupHandlers = [];
    const dismissHandlers = [];

    // ── Review-due toast notification ──────────────────────────────
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === "QT_REVIEW_DUE" && msg.count > 0) {
            showReviewDueToast(msg.count);
        }
    });

    function showReviewDueToast(count) {
        // Don't duplicate
        const existing = document.getElementById(PREFIX + "review_toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.id = PREFIX + "review_toast";
        toast.innerHTML = `<span style="margin-right:6px">🧠</span> ${count === 1 ? "Pojawiła się powtórka!" : `Pojawiły się ${count} powtórki!`}`;
        document.body.appendChild(toast);

        // Trigger enter animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.classList.add(PREFIX + "toast_visible");
            });
        });

        // Auto-dismiss after 4s
        setTimeout(() => {
            toast.classList.remove(PREFIX + "toast_visible");
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    document.addEventListener("mousemove", (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    // ═══════════════════════════════════════════════════════════════
    //  Utility Functions
    // ═══════════════════════════════════════════════════════════════

    /** Strip [bracketed] content (e.g. [Applause], [Music]) */
    function stripBrackets(text) {
        return text
            .replace(/\[.*?\]/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    /** Check if a DOM element is part of our UI */
    function isOwnUI(target) {
        return !!target?.closest?.(`#${ICON_ID}, #${TOOLTIP_ID}`);
    }

    // ═══════════════════════════════════════════════════════════════
    //  UI – Overlay Parent
    // ═══════════════════════════════════════════════════════════════

    /**
     * Returns the best parent for overlay UI.
     * In fullscreen, the browser only renders children of the fullscreen element.
     */
    function getOverlayParent() {
        return (
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.body
        );
    }

    // ═══════════════════════════════════════════════════════════════
    //  UI – Tooltip
    // ═══════════════════════════════════════════════════════════════

    function getTooltip() {
        if (tooltipEl) {
            const parent = getOverlayParent();
            if (tooltipEl.parentElement !== parent)
                parent.appendChild(tooltipEl);
            return tooltipEl;
        }
        tooltipEl = document.createElement("div");
        tooltipEl.id = TOOLTIP_ID;
        getOverlayParent().appendChild(tooltipEl);
        return tooltipEl;
    }

    function showTooltip(html, rect, preferredPosition = "top") {
        const tip = getTooltip();
        tip.innerHTML = html;
        tip.classList.remove("visible");

        const inFullscreen = !!(
            document.fullscreenElement || document.webkitFullscreenElement
        );
        const gap = 10;

        if (inFullscreen) {
            tip.style.position = "fixed";
            tip.style.left = "0px";
            tip.style.top = "0px";

            const tipRect = tip.getBoundingClientRect();
            let left = rect.left + (rect.width - tipRect.width) / 2;
            let top;
            if (preferredPosition === "bottom") {
                top = rect.bottom + gap;
            } else {
                top = rect.top - tipRect.height - gap;
            }

            top = Math.max(4, top);
            top = Math.min(top, window.innerHeight - tipRect.height - 4);
            left = Math.max(
                4,
                Math.min(left, window.innerWidth - tipRect.width - 4),
            );

            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        } else {
            tip.style.position = "absolute";
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;

            tip.style.left = "0px";
            tip.style.top = "0px";

            const tipRect = tip.getBoundingClientRect();
            let left = rect.left + scrollX + (rect.width - tipRect.width) / 2;
            let top;

            if (preferredPosition === "bottom") {
                top = rect.bottom + scrollY + gap;
            } else {
                top = rect.top + scrollY - tipRect.height - gap;
            }

            top = Math.max(scrollY + 4, top);
            top = Math.min(
                top,
                scrollY +
                    document.documentElement.clientHeight -
                    tipRect.height -
                    4,
            );

            left = Math.max(
                scrollX + 4,
                Math.min(
                    left,
                    scrollX +
                        document.documentElement.clientWidth -
                        tipRect.width -
                        4,
                ),
            );

            tip.style.left = `${left}px`;
            tip.style.top = `${top}px`;
        }

        requestAnimationFrame(() => tip.classList.add("visible"));
    }

    function hideTooltip() {
        if (!tooltipEl) return;
        tooltipEl.classList.remove("visible");
        setTimeout(() => {
            if (tooltipEl) tooltipEl.innerHTML = "";
        }, 180);
    }

    function showLoading(rect, preferredPosition = "top") {
        showTooltip(
            `<div class="${PREFIX}loading"><div class="${PREFIX}spinner"></div></div>`,
            rect,
            preferredPosition,
        );
    }

    /** Hide all UI: tooltip + registered cleanup handlers */
    function hideAll() {
        hideTooltip();
        cleanupHandlers.forEach((fn) => fn());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Dismiss & Cleanup Registration
    // ═══════════════════════════════════════════════════════════════

    function addCleanup(fn) {
        cleanupHandlers.push(fn);
    }
    function addDismissHandler(fn) {
        dismissHandlers.push(fn);
    }
    function runDismiss() {
        dismissHandlers.forEach((fn) => fn());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Google Translate (free, no key)
    // ═══════════════════════════════════════════════════════════════

    async function googleTranslate(text, targetLang) {
        const url =
            "https://translate.googleapis.com/translate_a/single" +
            "?client=gtx&sl=auto&tl=" +
            encodeURIComponent(targetLang) +
            "&dt=t&q=" +
            encodeURIComponent(text);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const translated = data[0].map((s) => s[0]).join("");
        const detectedLang = data[2] || "auto";
        return { translated, detectedLang };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Translation Cache Factory
    // ═══════════════════════════════════════════════════════════════

    function createTranslateCache(maxSize = 200) {
        const cache = new Map();
        return {
            async get(text, targetLang) {
                const key = `${text}|${targetLang}`;
                if (cache.has(key)) return cache.get(key);
                const result = await googleTranslate(text, targetLang);
                cache.set(key, result);
                if (cache.size > maxSize)
                    cache.delete(cache.keys().next().value);
                return result;
            },
            clear() {
                cache.clear();
            },
            get size() {
                return cache.size;
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  TTS – ElevenLabs
    // ═══════════════════════════════════════════════════════════════

    /** Extract a human-readable reason from an ElevenLabs error response (e.g. quota_exceeded, invalid_api_key). */
    async function elevenLabsErrorMessage(res) {
        try {
            const data = await res.json();
            const detail = data?.detail;
            const status =
                typeof detail === "object" ? detail?.status : undefined;
            const message =
                typeof detail === "object" ? detail?.message : detail;
            if (status === "quota_exceeded")
                return "skończyły się kredyty ElevenLabs";
            if (res.status === 401) return "nieprawidłowy klucz API ElevenLabs";
            return message || `HTTP ${res.status}`;
        } catch {
            return `HTTP ${res.status}`;
        }
    }

    async function speakElevenLabs(text, apiKey, voiceId) {
        try {
            const cleanText = cleanTextForTTS(text);
            const cacheKey = `${cleanText}|${voiceId}`;
            let blob = await AudioCache.get(cacheKey);

            if (!blob) {
                const res = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                    {
                        method: "POST",
                        headers: {
                            "xi-api-key": apiKey,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            text: cleanText,
                            model_id: "eleven_flash_v2_5",
                            voice_settings: {
                                stability: 0.5,
                                similarity_boost: 0.75,
                            },
                        }),
                    },
                );
                if (!res.ok) throw new Error(await elevenLabsErrorMessage(res));
                blob = await res.blob();
                await AudioCache.set(cacheKey, blob);
            }

            const url = URL.createObjectURL(blob);
            if (elAudioEl) {
                elAudioEl.pause();
                URL.revokeObjectURL(elAudioEl.src);
            }
            elAudioEl = new Audio(url);
            elAudioEl.play();
            return elAudioEl;
        } catch (err) {
            console.warn(
                "[QuickTranslator] ElevenLabs TTS failed:",
                err.message || err,
            );
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  TTS – Unified (Browser or ElevenLabs)
    // ═══════════════════════════════════════════════════════════════

    function speak(text, lang) {
        window.speechSynthesis.cancel();
        if (elAudioEl) {
            elAudioEl.pause();
            elAudioEl = null;
        }

        return new Promise((resolve) => {
            if (!chrome?.storage?.sync) {
                const utter = new SpeechSynthesisUtterance(
                    cleanTextForTTS(text),
                );
                utter.lang = lang;
                const voice = pickBestVoice("", lang);
                if (voice) utter.voice = voice;
                utter.rate = 1.3;
                window.speechSynthesis.speak(utter);
                resolve(utter);
                return;
            }

            chrome.storage.local.get(
                {
                    ttsMode: "browser",
                    elApiKey: "",
                    elVoiceId: "",
                    speechVoice: "",
                    speechRate: 1.3,
                    ttsVolume: 1,
                },
                async (data) => {
                    const vol =
                        data.ttsVolume !== undefined ? data.ttsVolume : 1;
                    let audio = null;
                    if (
                        data.ttsMode === "elevenlabs" &&
                        data.elApiKey &&
                        data.elVoiceId
                    ) {
                        audio = await speakElevenLabs(
                            text,
                            data.elApiKey,
                            data.elVoiceId,
                        );
                        if (audio instanceof HTMLAudioElement)
                            audio.volume = vol;
                    }
                    if (!audio) {
                        // ElevenLabs disabled/not configured, or the request
                        // failed (e.g. quota exceeded) — fall back to the
                        // browser voice so playback never goes silent.
                        const utter = new SpeechSynthesisUtterance(
                            cleanTextForTTS(text),
                        );
                        utter.lang = lang;
                        utter.rate = data.speechRate;
                        utter.volume = vol;
                        const voice = pickBestVoice(data.speechVoice, lang);
                        if (voice) utter.voice = voice;
                        window.speechSynthesis.speak(utter);
                        resolve(utter);
                    } else {
                        resolve(audio);
                    }
                },
            );
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Storage
    // ═══════════════════════════════════════════════════════════════

    function getTargetLang() {
        return new Promise((resolve) => {
            if (chrome?.storage?.local) {
                chrome.storage.local.get({ targetLang: "pl" }, (d) =>
                    resolve(d.targetLang),
                );
            } else {
                resolve("pl");
            }
        });
    }

    function saveWord(entry) {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.get({ savedWords: [] }, (data) => {
            const words = data.savedWords || [];
            const exists = words.some(
                (w) =>
                    w.original === entry.original &&
                    w.translated === entry.translated &&
                    (w.sentence || "") === (entry.sentence || "") &&
                    (w.aiSentence || "") === (entry.aiSentence || ""),
            );
            if (!exists) {
                // Stable id so edits/syncs never change this word's identity
                if (!entry.id) entry.id = SharedUtils.generateId();
                // Attach spaced-repetition metadata
                if (!entry.sr) {
                    entry.sr = {
                        step: 0,
                        easeFactor: 2.5,
                        interval: 0,
                        nextReview: Date.now(), // due immediately
                        lastReview: null,
                    };
                }
                entry.updatedAt = Date.now();
                words.push(entry);
                chrome.storage.local.set({ savedWords: words }, () => {
                    if (chrome.runtime.lastError) {
                        console.error(
                            "[Lectoro] Nie udało się zapisać słowa:",
                            chrome.runtime.lastError.message,
                        );
                    }
                });
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Video Screenshot Capture
    // ═══════════════════════════════════════════════════════════════

    /**
     * Capture a screenshot of the current video frame as a base64 JPEG.
     * Returns null if no video is playing or capture fails.
     */
    function captureVideoScreenshot() {
        try {
            const video = document.querySelector("video");
            if (!video || video.readyState < 2) return null;

            const vw = video.videoWidth || video.clientWidth || 640;
            const vh = video.videoHeight || video.clientHeight || 360;
            const MAX = 640;
            const scale = Math.min(MAX / vw, MAX / vh, 1);
            const width = Math.round(vw * scale);
            const height = Math.round(vh * scale);
            const ratio = window.devicePixelRatio || 1;
            const canvas = document.createElement("canvas");
            canvas.width = width * ratio;
            canvas.height = height * ratio;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            ctx.drawImage(video, 0, 0, width, height);
            return canvas.toDataURL("image/jpeg", 0.9);
        } catch (e) {
            console.warn("[Lectoro] Screenshot capture failed:", e);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Gemini AI API Base
    // ═══════════════════════════════════════════════════════════════

    async function geminiRequest(
        prompt,
        { temperature = 0.8, maxOutputTokens = 200 } = {},
    ) {
        // Bezpieczne proxy – klucz Gemini API jest TYLKO na serwerze Firebase.
        // GeminiProxy weryfikuje token Firebase Auth i sprawdza plan użytkownika.
        if (typeof GeminiProxy === "undefined") {
            throw new Error(
                "GeminiProxy niedostępny – sprawdź kolejność skryptów.",
            );
        }
        return GeminiProxy.requestJSON(prompt, {
            temperature,
            maxOutputTokens,
        });
    }

    // ═══════════════════════════════════════════════════════════════
    //  Gemini AI – Wrappers
    // ═══════════════════════════════════════════════════════════════

    async function geminiGenerateSentence(word, translated, srcLang, tgtLang) {
        const prompt = AIPrompts.sentenceExample(
            word,
            translated,
            srcLang,
            tgtLang,
        );

        const parsed = await geminiRequest(prompt, {
            temperature: 0.8,
            maxOutputTokens: 200,
        });
        return {
            sentence: parsed.sentence || "",
            translation: parsed.translation || "",
        };
    }

    async function geminiExplainSentence(sentence, targetLang) {
        const prompt = AIPrompts.explainSentence(sentence, targetLang);

        const parsed = await geminiRequest(prompt, {
            temperature: 0.7,
            maxOutputTokens: 250,
        });
        return {
            translation: parsed.translation || "",
            explanation: parsed.explanation || "",
        };
    }

    async function geminiMovieTranslate(text, targetLang) {
        const prompt = AIPrompts.movieTranslate(text, targetLang);

        const parsed = await geminiRequest(prompt, {
            temperature: 0.8,
            maxOutputTokens: 260,
        });
        return {
            translation: parsed.translation || "",
            explanation: parsed.explanation || "",
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Shared Tooltip HTML Builder
    // ═══════════════════════════════════════════════════════════════

    /**
     * Build a standard translation tooltip.
     * @param {Object} opts
     * @param {string} opts.srcLang       - detected source language code
     * @param {string} opts.targetLang    - target language code
     * @param {string} opts.original      - original word/phrase
     * @param {string} opts.translated    - translated word/phrase
     * @param {string|null} opts.fullLine        - full sentence (original)
     * @param {string|null} opts.fullTranslated  - full sentence (translated)
     * @param {boolean} opts.speakFullLine       - show speak buttons on full-line rows
     */
    function buildTooltipHtml({
        srcLang,
        targetLang,
        original,
        translated,
        fullLine = null,
        fullTranslated = null,
        speakFullLine = false,
    }) {
        const P = PREFIX;
        const cleanFullLine = fullLine ? stripBrackets(fullLine) : "";
        const cleanFullTranslated = fullTranslated
            ? stripBrackets(fullTranslated)
            : "";

        // Full-line section (sentence context)
        let fullLineHtml = "";
        if (fullLine && fullTranslated && cleanFullLine) {
            const speakOrig = speakFullLine
                ? `<button class="${P}speak" data-text="${escapeAttr(cleanFullLine)}" data-lang="${escapeAttr(srcLang)}" title="Odczytaj zdanie">${SVG.SPEAKER}</button>`
                : "";
            const speakTrans = speakFullLine
                ? `<button class="${P}speak" data-text="${escapeAttr(cleanFullTranslated)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj tłumaczenie zdania">${SVG.SPEAKER}</button>`
                : "";

            fullLineHtml = `
                <div class="${P}row" style="margin-top:6px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">
                    <span class="${P}label">ALL</span>
                    <span class="${P}text ${P}original" style="font-size:12px;">${escapeHtml(cleanFullLine)}</span>
                    ${speakOrig}
                </div>
                <div class="${P}row">
                    <span class="${P}label"></span>
                    <span class="${P}text ${P}translated" style="font-size:12px;">${escapeHtml(cleanFullTranslated)}</span>
                    ${speakTrans}
                </div>`;
        }

        // Common data attributes for all save buttons
        const dataAttrs = `data-src="${escapeAttr(original)}" data-translated="${escapeAttr(translated)}" data-src-lang="${escapeAttr(srcLang)}" data-tgt-lang="${escapeAttr(targetLang)}" data-sentence="${escapeAttr(cleanFullLine)}" data-sentence-translated="${escapeAttr(cleanFullTranslated)}"`;

        return `
            <div class="${P}header">
                <span>${langTag(srcLang)} → ${langTag(targetLang)}</span>
            </div>
            <div class="${P}body">
                <div class="${P}row">
                    <span class="${P}label">${langTag(srcLang)}</span>
                    <span class="${P}text ${P}original">${escapeHtml(original)}</span>
                    <span class="${P}word-actions">
                        <button class="${P}speak" data-text="${escapeAttr(original)}" data-lang="${escapeAttr(srcLang)}" title="Odczytaj oryginał">${SVG.SPEAKER}</button>
                        <button class="${P}img-search" data-word="${escapeAttr(original)}" title="Szukaj obrazu w Google (nowa karta)">${SVG.IMAGE_SEARCH}</button>
                    </span>
                </div>
                <div class="${P}row">
                    <span class="${P}label">${langTag(targetLang)}</span>
                    <span class="${P}text ${P}translated">${escapeHtml(translated)}</span>
                    <span class="${P}word-actions">
                        <button class="${P}speak" data-text="${escapeAttr(translated)}" data-lang="${escapeAttr(targetLang)}" title="Odczytaj tłumaczenie">${SVG.SPEAKER}</button>
                        <button class="${P}img-search" data-word="${escapeAttr(translated)}" title="Szukaj obrazu w Google (nowa karta)">${SVG.IMAGE_SEARCH}</button>
                    </span>
                </div>
                ${fullLineHtml}
            </div>
            <div class="${P}ai-result" id="${P}ai-result" style="display:none;"></div>
            <div class="${P}save-footer">
                <button class="${P}save-word-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz samo słowo">
                    ${SVG.SAVE} <span>Słowo</span>
                </button>
                <button class="${P}save-sentence-footer-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz z aktualnym zdaniem" ${!cleanFullLine ? 'disabled style="opacity:0.35;cursor:default;"' : ""}>
                    ${SVG.SAVE_SENTENCE} <span>Zdanie</span>
                </button>
                <button class="${P}save-ai-btn ${P}save-footer-btn" ${dataAttrs} title="Zapisz z mądrym zdaniem AI (Gemini)">
                    ${SVG.SAVE_AI} <span>AI</span>
                </button>
            </div>`;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Shared Tooltip Handler Attacher
    // ═══════════════════════════════════════════════════════════════

    /** Attach TTS + save handlers to all buttons in the current tooltip */
    function attachTooltipHandlers() {
        if (!tooltipEl) return;

        // TTS speak buttons
        tooltipEl.querySelectorAll(`.${PREFIX}speak`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                btn.classList.add("speaking");
                speak(btn.dataset.text, btn.dataset.lang).then((result) => {
                    const onDone = () => btn.classList.remove("speaking");
                    if (result && typeof result.onend !== "undefined") {
                        result.onend = onDone;
                        result.onerror = onDone;
                    } else if (result instanceof HTMLAudioElement) {
                        result.onended = onDone;
                        result.onerror = onDone;
                    }
                });
            });
        });

        // Google Images search buttons (open in new tab)
        tooltipEl.querySelectorAll(`.${PREFIX}img-search`).forEach((btn) => {
            btn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const word = (btn.dataset.word || "").trim();
                if (!word) return;
                const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(word)}`;
                window.open(url, "_blank", "noopener,noreferrer");
            });
        });

        /** Helper: build base save entry from a button's data attributes */
        function buildSaveEntry(btn) {
            const screenshot = captureVideoScreenshot();
            return {
                original: btn.dataset.src,
                translated: btn.dataset.translated,
                srcLang: btn.dataset.srcLang,
                tgtLang: btn.dataset.tgtLang,
                sentence: "",
                sentenceTranslated: "",
                aiSentence: "",
                aiSentenceTranslated: "",
                screenshot: screenshot || "",
                timestamp: Date.now(),
                downloaded: false,
            };
        }

        // Save word only (no sentence)
        const saveWordBtn = tooltipEl.querySelector(`.${PREFIX}save-word-btn`);
        if (saveWordBtn) {
            saveWordBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                saveWord(buildSaveEntry(saveWordBtn));
                saveWordBtn.innerHTML =
                    SVG.SAVE_CHECK + " <span>Zapisano!</span>";
                saveWordBtn.classList.add("saved");
            });
        }

        // Save with current sentence
        const saveSentenceBtn = tooltipEl.querySelector(
            `.${PREFIX}save-sentence-footer-btn`,
        );
        if (saveSentenceBtn && !saveSentenceBtn.disabled) {
            saveSentenceBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const entry = buildSaveEntry(saveSentenceBtn);
                entry.sentence = saveSentenceBtn.dataset.sentence || "";
                entry.sentenceTranslated =
                    saveSentenceBtn.dataset.sentenceTranslated || "";
                saveWord(entry);
                saveSentenceBtn.innerHTML =
                    SVG.SAVE_SENTENCE_CHECK + " <span>Zapisano!</span>";
                saveSentenceBtn.classList.add("saved");
            });
        }

        // Save with AI-generated sentence (Gemini)
        const saveAiBtn = tooltipEl.querySelector(`.${PREFIX}save-ai-btn`);
        if (saveAiBtn) {
            saveAiBtn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                if (
                    saveAiBtn.classList.contains("saved") ||
                    saveAiBtn.classList.contains("loading")
                )
                    return;

                saveAiBtn.classList.add("loading");
                saveAiBtn.innerHTML = `<span class="${PREFIX}spinner-small"></span> <span>Generuję…</span>`;

                const aiResultEl = tooltipEl.querySelector(
                    `#${PREFIX}ai-result`,
                );

                try {
                    const result = await geminiGenerateSentence(
                        saveAiBtn.dataset.src,
                        saveAiBtn.dataset.translated,
                        saveAiBtn.dataset.srcLang,
                        saveAiBtn.dataset.tgtLang,
                    );

                    // Show AI sentence in tooltip
                    if (aiResultEl) {
                        aiResultEl.style.display = "block";
                        aiResultEl.innerHTML = `
                            <div class="${PREFIX}ai-label">✨ AI zdanie:</div>
                            <div class="${PREFIX}ai-text">${escapeHtml(result.sentence)}</div>
                            <div class="${PREFIX}ai-translation">${escapeHtml(result.translation)}</div>`;
                    }

                    const entry = buildSaveEntry(saveAiBtn);
                    entry.aiSentence = result.sentence;
                    entry.aiSentenceTranslated = result.translation;
                    // Also use AI sentence as the main sentence for Anki cloze
                    entry.sentence = result.sentence;
                    entry.sentenceTranslated = result.translation;
                    saveWord(entry);

                    saveAiBtn.innerHTML =
                        SVG.SAVE_AI_CHECK + " <span>Zapisano!</span>";
                    saveAiBtn.classList.remove("loading");
                    saveAiBtn.classList.add("saved");
                } catch (err) {
                    console.error("[Lectoro] Gemini AI error:", err);
                    saveAiBtn.classList.remove("loading");
                    saveAiBtn.innerHTML =
                        SVG.SAVE_AI +
                        ` <span style="color:#f87171;">Błąd</span>`;

                    if (aiResultEl) {
                        aiResultEl.style.display = "block";
                        aiResultEl.innerHTML = `<div style="color:#f87171;font-size:11px;padding:6px 12px;">⚠ ${escapeHtml(err.message)}</div>`;
                    }

                    setTimeout(() => {
                        saveAiBtn.innerHTML = SVG.SAVE_AI + " <span>AI</span>";
                    }, 3000);
                }
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle – Buffer Factory
    // ═══════════════════════════════════════════════════════════════

    /**
     * Creates a subtitle history buffer.
     * Accumulates subtitle text over time for sentence extraction.
     */
    function createSubtitleBuffer(maxSize = 3000, keepSize = 2000) {
        let buffer = "";
        let lastSegment = "";

        return {
            /** Append new subtitle text, de-duplicating overlaps */
            append(text) {
                const trimmed = text.trim();
                if (!trimmed || trimmed === lastSegment) return;
                if (buffer.endsWith(trimmed)) return;

                let overlap = 0;
                const maxOvl = Math.min(trimmed.length, buffer.length);
                for (let i = 1; i <= maxOvl; i++) {
                    if (buffer.endsWith(trimmed.substring(0, i))) overlap = i;
                }

                const newPart = trimmed.substring(overlap);
                if (newPart) {
                    buffer +=
                        (buffer && !buffer.endsWith(" ") ? " " : "") + newPart;
                }
                lastSegment = trimmed;

                if (buffer.length > maxSize) {
                    buffer = buffer.substring(buffer.length - keepSize);
                }
            },

            /** Extract the sentence containing the given word */
            extractSentence(word) {
                const idx = buffer.lastIndexOf(word);
                if (idx === -1) return null;

                const enders = /[.!?…]/;
                let start = 0;
                for (let i = idx - 1; i >= 0; i--) {
                    if (enders.test(buffer[i])) {
                        start = i + 1;
                        break;
                    }
                }
                let end = buffer.length;
                for (let i = idx + word.length; i < buffer.length; i++) {
                    if (enders.test(buffer[i])) {
                        end = i + 1;
                        break;
                    }
                }

                const sentence = buffer.substring(start, end).trim();
                return sentence.length > word.length + 2 ? sentence : null;
            },

            clear() {
                buffer = "";
                lastSegment = "";
            },
            get text() {
                return buffer;
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle – Word Splitter
    // ═══════════════════════════════════════════════════════════════

    /** Split an element's text content into individual clickable word spans */
    function splitIntoWordSpans(el, wordClass) {
        const text = el.textContent;
        if (!text.trim()) return;

        // Preserve original font-style (italic from <i>/<em> tags or inline/CSS styles)
        const hasItalicChild = !!el.querySelector("i, em");
        const computedStyle = window.getComputedStyle(el).fontStyle;
        const originalFontStyle =
            hasItalicChild || computedStyle === "italic" ? "italic" : "";

        el.textContent = "";

        const parts = text.match(/\S+|\s+/g) || [];
        for (const part of parts) {
            if (/\S/.test(part)) {
                const span = document.createElement("span");
                span.className = wordClass;
                span.textContent = part;
                if (originalFontStyle) {
                    span.style.fontStyle = originalFontStyle;
                }
                el.appendChild(span);
            } else {
                el.appendChild(document.createTextNode(part));
            }
        }

        // Also preserve font-style on the parent element itself
        if (originalFontStyle) {
            el.style.fontStyle = originalFontStyle;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle – Hint Factory
    // ═══════════════════════════════════════════════════════════════

    /** Create a popup hint element (e.g. "hover on a word to translate") */
    function createHint(className, getParent) {
        let el = null;
        let timer = null;
        // Default to the fullscreen-aware overlay parent so hints stay
        // visible even when the page/video is in native fullscreen mode.
        const parentFn = getParent || getOverlayParent;

        return {
            show(msg, duration = 4000) {
                if (!el) {
                    el = document.createElement("div");
                    el.className = className;
                    parentFn().appendChild(el);
                }
                const parent = parentFn();
                if (el.parentElement !== parent) parent.appendChild(el);

                el.textContent = msg;
                el.classList.add("visible");
                clearTimeout(timer);
                timer = setTimeout(
                    () => el.classList.remove("visible"),
                    duration,
                );
            },
        };
    }

    // ═══════════════════════════════════════════════════════════════
    //  Subtitle – Find Word at Point
    // ═══════════════════════════════════════════════════════════════

    /**
     * Find a word span at screen coordinates using elementsFromPoint.
     * Works through invisible overlay divs (Netflix, LookMovie, etc.)
     */
    function findWordAtPoint(x, y, wordClass) {
        const els = document.elementsFromPoint(x, y);
        for (const el of els) {
            if (el.classList?.contains(wordClass)) return el;
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Video Control Helpers
    // ═══════════════════════════════════════════════════════════════

    function getVideo() {
        return document.querySelector("video");
    }

    /** Pause the video if playing. Returns true if it was playing. */
    function pauseVideo() {
        const v = getVideo();
        if (v && !v.paused) {
            v.pause();
            return true;
        }
        return false;
    }

    /** Resume the video if it's paused. */
    function resumeVideo() {
        const v = getVideo();
        if (v && v.paused) v.play();
    }

    // ═══════════════════════════════════════════════════════════════
    //  Expose Global Namespace
    // ═══════════════════════════════════════════════════════════════

    window.QT = {
        // Constants
        PREFIX,
        ICON_ID,
        TOOLTIP_ID,
        SVG,

        // Utilities
        escapeHtml,
        escapeAttr,
        stripBrackets,
        cleanTextForTTS,
        langTag,
        isOwnUI,

        // UI
        getOverlayParent,
        showTooltip,
        hideTooltip,
        hideAll,
        showLoading,
        getTooltipEl: () => tooltipEl,
        getMousePos: () => ({ x: lastMouseX, y: lastMouseY }),

        // Translation
        translate: googleTranslate,
        createTranslateCache,

        // TTS
        speak,
        pickBestVoice,
        getElAudioEl: () => elAudioEl,
        setElAudioEl: (v) => {
            elAudioEl = v;
        },

        // Storage
        getTargetLang,
        saveWord,

        // AI & Screenshot
        geminiGenerateSentence,
        geminiExplainSentence,
        geminiMovieTranslate,
        captureVideoScreenshot,

        // Tooltip
        buildTooltipHtml,
        attachTooltipHandlers,

        // Subtitle utilities
        createSubtitleBuffer,
        splitIntoWordSpans,
        createHint,
        findWordAtPoint,

        // Cleanup & dismiss
        addCleanup,
        addDismissHandler,
        runDismiss,

        // Video
        getVideo,
        pauseVideo,
        resumeVideo,
    };
})();
