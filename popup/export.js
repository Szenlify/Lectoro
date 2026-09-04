const { csvCell } = typeof SharedUtils !== "undefined"
    ? SharedUtils
    : { csvCell: (s) => String(s ?? "") };

// ── Unified Audio Fetcher (SSOT with ElevenLabs, R2 CDN & AudioCache) ──
async function fetchAudioBlob(text, lang, { allowFallback = true } = {}) {
    if (typeof SharedTtsService !== "undefined" && typeof SharedTtsService.getAudioBlob === "function") {
        const res = await SharedTtsService.getAudioBlob(text, lang, {
            context: "review",
            allowSynthesis: false, // Do not trigger fresh ElevenLabs synthesis on export; fallback to system voice if missing from R2 CDN
            allowFallback,
        });
        if (res?.blob) return res;
    }
    if (!allowFallback) return null;
    // Direct network fallback if SharedTtsService is unavailable
    try {
        const baseLang = encodeURIComponent((lang || "en").split("-")[0]);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${baseLang}&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return { blob, provider: "google-tts", cached: false };
    } catch {
        return null;
    }
}

// ── Smart keyword extractor for whole sentences (e.g. saved via key Z) ──
function findBestClozeWord(sentence) {
    if (!sentence || typeof sentence !== "string") return null;

    // Common English stop words / function words to avoid clozing
    const stopWords = new Set([
        "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
        "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
        "below", "between", "both", "but", "by", "can", "can't", "cannot", "could", "couldn't",
        "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each",
        "few", "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't",
        "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
        "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've",
        "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself", "just",
        "let's", "like", "me", "more", "most", "mustn't", "my", "myself", "no", "nor",
        "not", "now", "of", "off", "on", "once", "only", "or", "other", "ought",
        "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd",
        "she'll", "she's", "should", "shouldn't", "so", "some", "such", "than", "that", "that's",
        "the", "their", "theirs", "them", "themselves", "then", "there", "there's", "these", "they",
        "they'd", "they'll", "they're", "they've", "this", "those", "through", "to", "too", "under",
        "until", "up", "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've",
        "were", "weren't", "what", "what's", "when", "when's", "where", "where's", "which", "while",
        "who", "who's", "whom", "why", "why's", "with", "won't", "would", "wouldn't", "you",
        "you'd", "you'll", "you're", "you've", "your", "yours", "yourself", "yourselves",
        "yeah", "yes", "okay", "oh", "um", "uh", "got", "get", "going", "go", "see", "say", "said"
    ]);

    // Tokenize into words while stripping punctuation
    const tokens = sentence.match(/[a-zA-Z\u00C0-\u024F]+(?:'[a-zA-Z]+)?/g) || [];
    if (tokens.length === 0) return null;

    const candidates = [];
    for (let i = 0; i < tokens.length; i++) {
        const rawWord = tokens[i];
        const lower = rawWord.toLowerCase();

        // Skip contractions and very short words
        if (lower.startsWith("'") || lower.length < 3) continue;
        if (stopWords.has(lower)) continue;

        // Score based on length and linguistic suffixes
        let score = lower.length * 2;
        if (/(tion|ment|able|ible|ous|ful|less|ive|ly|ize|ise|ity|est|ence|ance)$/i.test(lower)) {
            score += 6;
        }
        if (i > 0 && i < tokens.length - 1) {
            score += 2;
        }

        candidates.push({ word: rawWord, score });
    }

    if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].word;
    }

    // Fallback: pick the longest word in the sentence
    let longest = tokens[0];
    for (const t of tokens) {
        if (t.length > longest.length) longest = t;
    }
    return longest;
}

// ── Convert image to standard JPEG for 100% mobile phone (iOS / Android) compatibility ──
async function imageToJpeg(imageSource) {
    if (typeof document === "undefined" || typeof Image === "undefined") {
        return null;
    }
    return new Promise((resolve) => {
        try {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = img.naturalWidth || img.width || 640;
                    canvas.height = img.naturalHeight || img.height || 360;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return resolve(null);
                    ctx.fillStyle = "#000000";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0);
                    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
                    canvas.toBlob((blob) => {
                        resolve({ dataUrl, blob });
                    }, "image/jpeg", 0.85);
                } catch (e) {
                    console.warn("[Lectoro] Canvas to JPEG error:", e);
                    resolve(null);
                }
            };
            img.onerror = (err) => {
                console.warn("[Lectoro] Image load for JPEG conversion error:", err);
                resolve(null);
            };
            img.src = typeof imageSource === "string" ? imageSource : URL.createObjectURL(imageSource);
        } catch (err) {
            console.warn("[Lectoro] imageToJpeg exception:", err);
            resolve(null);
        }
    });
}

// ── Simple ZIP builder (no library needed) ────────────────────────
function buildZip(files) {
    // files: [{name: string, data: Uint8Array}]
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
        const nameBytes = new TextEncoder().encode(file.name);
        const data = file.data;

        // Local file header
        const local = new Uint8Array(30 + nameBytes.length + data.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true); // signature
        lv.setUint16(4, 20, true); // version needed
        lv.setUint16(6, 0, true); // flags
        lv.setUint16(8, 0, true); // compression (store)
        lv.setUint16(10, 0, true); // mod time
        lv.setUint16(12, 0, true); // mod date
        lv.setUint32(14, crc32(data), true); // crc32
        lv.setUint32(18, data.length, true); // compressed size
        lv.setUint32(22, data.length, true); // uncompressed size
        lv.setUint16(26, nameBytes.length, true); // name length
        lv.setUint16(28, 0, true); // extra length
        local.set(nameBytes, 30);
        local.set(data, 30 + nameBytes.length);
        localHeaders.push(local);

        // Central directory header
        const central = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(central.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0, true);
        cv.setUint16(10, 0, true);
        cv.setUint16(12, 0, true);
        cv.setUint16(14, 0, true);
        cv.setUint32(16, crc32(data), true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint16(30, 0, true);
        cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true);
        cv.setUint16(36, 0, true);
        cv.setUint32(38, 0x20, true); // external attrs
        cv.setUint32(42, offset, true); // local header offset
        central.set(nameBytes, 46);
        centralHeaders.push(central);

        offset += local.length;
    }

    const centralSize = centralHeaders.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const total = offset + centralSize + 22;
    const result = new Uint8Array(total);
    let pos = 0;
    for (const lh of localHeaders) {
        result.set(lh, pos);
        pos += lh.length;
    }
    for (const ch of centralHeaders) {
        result.set(ch, pos);
        pos += ch.length;
    }
    result.set(eocd, pos);
    return result;
}

function crc32(data) {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

// ── Unified Export Quota Management (SSOT with SubscriptionConfig & SubscriptionService) ──
const ONE_HOUR_MS = 60 * 60 * 1000;
const EXPORT_TYPES_CONFIG = [
    { type: "anki", badgeId: "ankiFreeBadge", title: "Free Anki exports" },
    { type: "excel", badgeId: "excelFreeBadge", title: "Free Excel exports" },
    { type: "quiz", badgeId: "quizFreeBadge", title: "Free quizzes" },
];

async function getExportQuota(type) {
    if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.getExportQuotaState === "function") {
        return SubscriptionService.getExportQuotaState(type);
    }
    const currentMonth = SharedUtils.currentMonth();
    const data = await chrome.storage.local.get({
        exportUsage: null,
        quizGenerationsFreeCount: 0,
    });
    const usage = (data.exportUsage && data.exportUsage.month === currentMonth)
        ? data.exportUsage
        : { month: currentMonth, anki: 0, excel: 0, quiz: Number(data.quizGenerationsFreeCount) || 0 };
    const used = Math.max(0, Number(usage[type]) || 0);
    return {
        plan: "free",
        isFree: true,
        type,
        used,
        limit: 3,
        remaining: Math.max(0, 3 - used),
        allowed: used < 3,
    };
}

async function recordExportSuccess(type) {
    if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.recordExport === "function") {
        await SubscriptionService.recordExport(type);
    } else {
        const currentMonth = SharedUtils.currentMonth();
        const data = await chrome.storage.local.get({ exportUsage: null });
        const usage = (data.exportUsage && data.exportUsage.month === currentMonth)
            ? data.exportUsage
            : { month: currentMonth, anki: 0, excel: 0, quiz: 0 };
        usage[type] = (Number(usage[type]) || 0) + 1;
        await chrome.storage.local.set({ exportUsage: usage });
    }
    await updateAllExportBadgesUI();
}

async function enforceExportQuota(type) {
    const quotaState = await getExportQuota(type);
    const typeLabels = { anki: "Anki", excel: "Excel", quiz: "Quiz" };
    const label = typeLabels[type] || type;

    if (quotaState.isFree) {
        if (quotaState.used >= quotaState.limit) {
            const message = `You have reached the monthly limit of ${quotaState.limit} free ${label} exports. Upgrade to Basic or Pro for unlimited exports!`;
            if (typeof GeminiProxy !== "undefined" && typeof GeminiProxy.showUpgradePrompt === "function") {
                GeminiProxy.showUpgradePrompt({
                    reason: `free_${type}_limit`,
                    feature: `export_${type}`,
                    message,
                });
            } else if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.openPlans === "function") {
                SubscriptionService.openPlans();
            } else {
                alert(message);
            }
            return false;
        }
    } else if (type === "quiz") {
        if (quotaState.paidUsed >= quotaState.paidLimit) {
            const oldestTs = Math.min(...(quotaState.paidHistory?.length ? quotaState.paidHistory : [Date.now()]));
            const waitMins = Math.max(1, Math.ceil((ONE_HOUR_MS - (Date.now() - oldestTs)) / 60000));
            alert(`Hourly limit of ${quotaState.paidLimit} quizzes reached. Try again in ${waitMins} min.`);
            return false;
        }
    }
    return true;
}

async function updateAllExportBadgesUI() {
    try {
        for (const item of EXPORT_TYPES_CONFIG) {
            const badge = document.getElementById(item.badgeId);
            if (!badge) continue;

            const state = await getExportQuota(item.type);
            if (state.isFree) {
                badge.style.display = "inline-block";
                badge.textContent = `${state.used}/${state.limit}`;
                badge.title = `${item.title}: used ${state.used} of ${state.limit} this month`;
                badge.classList.toggle("is-limit", state.used >= state.limit);
            } else {
                badge.style.display = "none";
            }
        }
    } catch (e) {
        console.error("Error updating export quotas UI:", e);
    }
}

// Initial UI check and sync listener for all export quotas
updateAllExportBadgesUI();
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.exportUsage || changes.quizGenerationsFreeCount || changes.subscriptionProfileCache)) {
            updateAllExportBadgesUI();
        }
    });
}

// ── Export: Anki Cloze with audio (.zip) ──────────────────────────
document.getElementById("exportAnki").addEventListener("click", async () => {
    const btn = document.getElementById("exportAnki");
    const labelEl = btn.querySelector(".export-btn-label");
    const origText = labelEl ? labelEl.textContent : btn.textContent;
    const setBtnText = (txt) => {
        if (labelEl) labelEl.textContent = txt;
        else btn.textContent = txt;
    };

    if (!(await enforceExportQuota("anki"))) {
        return;
    }

    setBtnText("⏳ Preparing…");
    btn.disabled = true;

    try {
        const data = await new Promise((r) =>
            chrome.storage.local.get({ savedWords: [] }, r),
        );
        const words = filterWords(data.savedWords || []);
        if (words.length === 0) {
            setBtnText(origText);
            btn.disabled = false;
            return;
        }

        const files = [];
        const lines = [];

        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            setBtnText(`⏳ Downloading (${i + 1}/${words.length})…`);

            const srcLangTag = escapeHtml((w.srcLang || "en").toUpperCase());
            const tgtLangTag = escapeHtml((w.tgtLang || "pl").toUpperCase());

            const sentenceSource = (w.aiSentence || w.sentence || "").trim();
            const cleanOriginal = (w.original || "").trim();
            const cleanTranslated = (w.translated || "").trim();

            const wordsCount = cleanOriginal.split(/\s+/).filter(Boolean).length;

            let clozeSentenceHtml = "";
            let sentencePromptTop = "";

            if (sentenceSource && cleanOriginal && sentenceSource !== cleanOriginal) {
                // Case 1: Word or phrase selected from a separate context sentence
                const escapedSentence = escapeHtml(sentenceSource);
                const escapedOriginal = escapeHtml(cleanOriginal);
                const escapedTranslated = escapeHtml(cleanTranslated);

                const regex = new RegExp(
                    `(${cleanOriginal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
                    "i",
                );
                if (regex.test(sentenceSource)) {
                    clozeSentenceHtml = escapedSentence.replace(
                        regex,
                        `{{c1::$1::${escapedTranslated}}}`,
                    );
                } else {
                    clozeSentenceHtml = `{{c1::${escapedOriginal}::${escapedTranslated}}}<div style="margin-top: 14px; font-size: 15px; line-height: 1.5; color: #94a3b8; font-style: italic; text-align: center;">"${escapedSentence}"</div>`;
                }
            } else if (wordsCount === 1) {
                // Case 2: Standalone single word
                clozeSentenceHtml = `{{c1::${escapeHtml(cleanOriginal)}::${escapeHtml(cleanTranslated)}}}`;
            } else {
                // Case 3: Full sentence saved via key Z or whole subtitle line!
                // Smart Cloze: Identify the most meaningful content keyword in the sentence,
                // generate a cloze deletion with a first-letter hint [k...],
                // and display the full sentence translation above as context.
                const keyWord = findBestClozeWord(cleanOriginal);
                if (keyWord) {
                    const escapedSentence = escapeHtml(cleanOriginal);
                    const regex = new RegExp(`(${keyWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
                    const firstChar = keyWord.charAt(0);
                    const hint = `${firstChar}...`;
                    clozeSentenceHtml = escapedSentence.replace(regex, `{{c1::$1::${hint}}}`);
                } else {
                    clozeSentenceHtml = `{{c1::${escapeHtml(cleanOriginal)}::${escapeHtml(cleanTranslated)}}}`;
                }

                if (cleanTranslated) {
                    sentencePromptTop = `<div style="font-size: 15px; line-height: 1.55; color: #cbd5e1; font-style: italic; margin: 0 auto 16px; text-align: center; max-width: 500px; padding: 8px 16px; background: rgba(0, 0, 0, 0.3); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06);">"${escapeHtml(cleanTranslated)}"</div>`;
                }
            }

            // Wrap Front Side in modern centered Lectoro card container with cloze styling
            const frontCardHtml = `<style>.lectoro-anki-card .cloze { color: #38bdf8 !important; font-weight: 700; text-decoration: none; border-bottom: 2px solid #38bdf8; padding-bottom: 1px; }</style><div class="lectoro-anki-card" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 16px auto; padding: 26px 28px; background: linear-gradient(180deg, #0f172a 0%, #090d16 100%); border: 1px solid rgba(56, 189, 248, 0.22); border-radius: 20px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05); color: #f8fafc; text-align: center;"><div style="display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 18px;"><span style="background: rgba(255, 255, 255, 0.06); color: #94a3b8; font-size: 11px; font-weight: 600; padding: 4px 12px; border-radius: 20px; letter-spacing: 0.08em; border: 1px solid rgba(255, 255, 255, 0.08);">LectoroAI.com</span></div>${sentencePromptTop}<div style="font-size: 20px; line-height: 1.65; color: #f8fafc; font-weight: 500; text-align: center; max-width: 500px; margin: 0 auto;">${clozeSentenceHtml}</div></div>`;

            // Build Extra (Back side details)
            const extraParts = [];

            // 1. Translation row (Centered hero title)
            extraParts.push(`<div style="margin-bottom: 18px; text-align: center;"><div style="font-size: 11px; text-transform: uppercase; color: #38bdf8; font-weight: 700; letter-spacing: 0.12em; margin-bottom: 4px;">TŁUMACZENIE</div><div style="font-size: 26px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; text-shadow: 0 2px 12px rgba(56, 189, 248, 0.25);">${escapeHtml(cleanTranslated)}</div></div>`);

            // 2. Original context sentence translation (Centered)
            if (w.sentenceTranslated && w.sentenceTranslated !== w.aiSentenceTranslated && w.sentenceTranslated !== cleanTranslated) {
                extraParts.push(`<div style="font-size: 14px; line-height: 1.55; color: #94a3b8; font-style: italic; margin: 0 auto 16px; text-align: center; max-width: 480px; padding: 8px 16px; background: rgba(0, 0, 0, 0.25); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.06);">"${escapeHtml(w.sentenceTranslated)}"</div>`);
            }

            // 3. AI sentence & translation (Centered)
            if (w.aiSentence || w.aiSentenceTranslated) {
                const aiSent = escapeHtml(w.aiSentence || "");
                const aiSentTr = escapeHtml(w.aiSentenceTranslated || "");
                extraParts.push(`<div style="margin: 0 auto 16px; max-width: 480px; padding: 12px 16px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.22); border-radius: 14px; text-align: center;"><div style="font-size: 11px; font-weight: 700; color: #c084fc; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px;">✨ Przykład AI</div>${aiSent ? `<div style="font-size: 14px; color: #f1f5f9; font-weight: 500; line-height: 1.5;">${aiSent}</div>` : ""}${aiSentTr ? `<div style="font-size: 13px; color: #cbd5e1; font-style: italic; margin-top: 4px;">${aiSentTr}</div>` : ""}</div>`);
            }

            const ts = (w.id ? w.id.replace(/[^a-zA-Z0-9_-]/g, "") : (w.timestamp || Date.now()).toString(36)) + "_" + (i + 1);

            // 4. Screenshot image: convert to standard JPEG (.jpg) for 100% mobile (iOS/Android) compatibility
            let screenshotSrc = null;
            if (w.screenshot) {
                let rawSrc = null;
                if (w.screenshot.startsWith("data:")) {
                    rawSrc = w.screenshot;
                } else {
                    const resolvedUrl =
                        typeof SharedUtils !== "undefined" && typeof SharedUtils.resolveImageUrl === "function"
                            ? SharedUtils.resolveImageUrl(w.screenshot)
                            : w.screenshot;
                    if (/^https?:\/\//i.test(resolvedUrl)) {
                        rawSrc = resolvedUrl;
                    }
                }

                if (rawSrc) {
                    const imgFile = `lectoro_img_${ts}.jpg`;
                    const jpegRes = typeof imageToJpeg === "function" ? await imageToJpeg(rawSrc) : null;
                    if (jpegRes?.blob) {
                        screenshotSrc = jpegRes.dataUrl;
                        const imgBuffer = await jpegRes.blob.arrayBuffer();
                        files.push({ name: imgFile, data: new Uint8Array(imgBuffer) });
                    } else if (rawSrc.startsWith("data:")) {
                        screenshotSrc = rawSrc;
                    } else {
                        screenshotSrc = rawSrc;
                    }
                }

                if (screenshotSrc) {
                    extraParts.push(`<div style="margin: 16px auto 0; text-align: center;"><div style="display: inline-block; max-width: 100%; border-radius: 14px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.12); background: #000000; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);"><img src="${escapeAttr(screenshotSrc)}" style="max-width: 100%; max-height: 250px; width: auto; height: auto; display: block; margin: 0 auto; object-fit: contain;"></div></div>`);
                }
            }

            // 5. Audio: priority search for ElevenLabs recording in R2 CDN / AudioCache
            let audioFile = null;
            let audioDataUri = null;
            const ttsLang = w.srcLang || "en";

            // Candidate texts in priority order:
            // 1) Original subtitle sentence from video (w.sentence)
            // 2) Original saved word/sentence (w.original)
            // 3) Combined word + sentence (e.g. from review session)
            // 4) AI example sentence (w.aiSentence)
            const textCandidates = [
                w.sentence,
                w.original,
                (w.sentence && w.original && w.sentence !== w.original) ? `${w.original}. ${w.sentence}` : null,
                w.aiSentence,
            ].filter((t) => t && typeof t === "string" && t.trim().length > 0);

            let audioRes = null;
            let usedAudioText = "";

            // Probe candidate texts in R2 CDN and AudioCache for authentic ElevenLabs audio
            for (const candText of textCandidates) {
                const res = await fetchAudioBlob(candText, ttsLang, { allowFallback: false });
                if (res?.blob && res.provider === "elevenlabs") {
                    audioRes = res;
                    usedAudioText = candText;
                    break;
                }
            }

            // If no ElevenLabs recording exists in R2 or cache, fallback to Google TTS
            if (!audioRes) {
                usedAudioText = w.sentence || w.original || w.aiSentence || "";
                if (usedAudioText) {
                    audioRes = await fetchAudioBlob(usedAudioText, ttsLang, { allowFallback: true });
                }
            }

            const slug = (usedAudioText || "audio")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
                .substring(0, 30) || "audio";
            const candidateAudioFile = `lectoro_${slug}_${ts}.mp3`;
            if (audioRes?.blob && audioRes.blob.size > 0) {
                audioFile = candidateAudioFile;
                const audioBuffer = await audioRes.blob.arrayBuffer();
                files.push({ name: audioFile, data: new Uint8Array(audioBuffer) });

                // Read blob as base64 data URI for instant playable in-card audio
                audioDataUri = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(audioRes.blob);
                });
            }

            if (audioDataUri) {
                extraParts.push(`<div style="margin: 16px auto 0; max-width: 380px; padding: 8px 16px; background: rgba(0, 0, 0, 0.35); border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: center; gap: 10px;"><span style="font-size: 11px; color: #38bdf8; font-weight: 700; letter-spacing: 0.05em;">AUDIO</span><audio controls src="${audioDataUri}" style="height: 32px; width: 100%; max-width: 300px; outline: none;"></audio></div>`);
            }

            // Wrap Extra in matching centered companion card container
            const backCardHtml = `<div class="lectoro-anki-extra" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 14px auto 0; padding: 24px 28px; background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5); color: #f8fafc; text-align: center;">${extraParts.join("")}</div>`;

            // Clean newlines and tabs to guarantee valid TSV lines
            const cleanField = (str) =>
                String(str || "")
                    .replace(/[\r\n]+/g, "")
                    .replace(/\t/g, " ");

            let finalBack = cleanField(backCardHtml);
            if (audioFile) {
                // Native Anki audio tag outside HTML tags so Anki's parser detects it
                finalBack += ` [sound:${audioFile}]`;
            }

            lines.push(`${cleanField(frontCardHtml)}\t${finalBack}`);
        }

        // Add single unified Anki Cloze file
        const dt = typeof dateTag === "function" ? dateTag() : (typeof SharedUtils !== "undefined" && SharedUtils.dateTag ? SharedUtils.dateTag() : new Date().toISOString().slice(0, 10));
        const headerLines = [
            "#separator:tab",
            "#html:true",
            "#tags:lectoro",
            "#deck:Lectoro",
            "#notetype:Cloze",
        ];
        const txtContent = headerLines.join("\n") + "\n" + lines.join("\n");
        const txtData = new TextEncoder().encode(txtContent);
        files.push({ name: `anki-cloze-${dt}.txt`, data: txtData });

        // Add helpful Anki Import Guide in ZIP (English)
        const readmeContent = [
            "===============================================================",
            "LECTORO - HOW TO IMPORT FLASHCARDS INTO ANKI",
            "===============================================================",
            "",
            "Your ZIP archive contains generated flashcards (.txt), video screenshots (.jpg),",
            "and crystal-clear audio recordings (.mp3).",
            "",
            "Follow these simple steps to import your flashcards into Anki:",
            "",
            "STEP 1 (Recommended for full offline audio sync):",
            "Copy media files to Anki's 'collection.media' folder",
            "---------------------------------------------------------------",
            "All image files (.jpg) and audio files (.mp3) from this archive",
            "should be copied to Anki's media folder: 'collection.media'.",
            "",
            "Where to find this folder on your computer:",
            "• Windows:",
            "  %APPDATA%\\Anki2\\[ProfileName]\\collection.media",
            "  (Paste the path above into the Windows Explorer address bar)",
            "• macOS:",
            "  ~/Library/Application Support/Anki2/[ProfileName]/collection.media",
            "  (In Finder, press Cmd+Shift+G and paste the path above)",
            "• Linux:",
            "  ~/.local/share/Anki2/[ProfileName]/collection.media",
            "",
            "STEP 2: Import cards into Anki",
            "---------------------------------------------------------------",
            "1. Open Anki.",
            "2. Click: File -> Import... (or press Ctrl+I / Cmd+I).",
            `3. Select the file: 'anki-cloze-${dt}.txt' from this archive.`,
            "4. Anki will automatically map the card fields and assign them to the 'Lectoro' deck.",
            "5. Click 'Import'.",
            "",
            "Done! Your cards are now ready for study on Desktop, iOS, and Android with centered modern visuals and clear pronunciation.",
            "===============================================================",
        ].join("\r\n");
        files.push({
            name: "HOW_TO_IMPORT_TO_ANKI.txt",
            data: new TextEncoder().encode(readmeContent),
        });

        // Build and download ZIP
        setBtnText("⏳ Packing ZIP…");
        const zipData = buildZip(files);
        const blob = new Blob([zipData], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `anki-cloze-${dt}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Record successful export
        await recordExportSuccess("anki");

        // Mark as downloaded
        markAsDownloaded(words, data.savedWords);
    } catch (err) {
        console.error("Anki export error:", err);
        alert("Export error: " + err.message);
    } finally {
        setBtnText(origText);
        btn.disabled = false;
    }
});

// ── Export: CSV (Excel) ───────────────────────────────────────────
document.getElementById("exportCsv").addEventListener("click", async () => {
    if (!(await enforceExportQuota("excel"))) {
        return;
    }

    const data = await new Promise((r) =>
        chrome.storage.local.get({ savedWords: [] }, r),
    );
    const words = filterWords(data.savedWords || []);
    if (words.length === 0) return;

    // BOM for Excel UTF-8
    const BOM = "\uFEFF";
    const header =
        "Original;Translation;Sentence;Sentence Translation;AI Sentence;AI Sentence Translation;Source Lang;Target Lang;Date;Image URL";
    const rows = words.map((w) => {
        const date = w.timestamp
            ? new Date(w.timestamp).toLocaleDateString("en-US")
            : "";
        const screenshotUrl = w.screenshot
            ? (typeof SharedUtils !== "undefined" && typeof SharedUtils.resolveImageUrl === "function"
                ? SharedUtils.resolveImageUrl(w.screenshot)
                : w.screenshot)
            : "";
        return [
            csvCell(w.original),
            csvCell(w.translated),
            csvCell(w.sentence || ""),
            csvCell(w.sentenceTranslated || ""),
            csvCell(w.aiSentence || ""),
            csvCell(w.aiSentenceTranslated || ""),
            w.srcLang || "",
            w.tgtLang || "",
            date,
            csvCell(screenshotUrl),
        ].join(";");
    });
    const content = BOM + header + "\n" + rows.join("\n");
    const dt = typeof dateTag === "function" ? dateTag() : (typeof SharedUtils !== "undefined" && SharedUtils.dateTag ? SharedUtils.dateTag() : new Date().toISOString().slice(0, 10));
    downloadFile(
        content,
        `lectoro-export-${dt}.csv`,
        "text/csv;charset=utf-8",
    );

    // Record successful export
    await recordExportSuccess("excel");

    // Mark as downloaded
    markAsDownloaded(words, data.savedWords);
});

// ── Export: AI-generated Quiz (Lazy Loaded) ───────────────────────
const quizOutputMode = "interactive";

let quizScriptLoadingPromise = null;
async function ensureQuizExportLoaded() {
    if (typeof window.QuizExport !== "undefined") {
        return window.QuizExport;
    }
    if (quizScriptLoadingPromise) {
        return quizScriptLoadingPromise;
    }
    quizScriptLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "shared/quiz-export.js";
        script.onload = () => {
            quizScriptLoadingPromise = null;
            resolve(window.QuizExport);
        };
        script.onerror = (err) => {
            quizScriptLoadingPromise = null;
            reject(new Error("Failed to load quiz generator module."));
        };
        document.body.appendChild(script);
    });
    return quizScriptLoadingPromise;
}

const exportQuizBtn = document.getElementById("exportQuiz");
if (exportQuizBtn) {
    exportQuizBtn.addEventListener("click", async () => {
        const origText = exportQuizBtn.innerHTML;

        if (!(await enforceExportQuota("quiz"))) {
            return;
        }

        const cachedUsage = await GeminiProxy?.getCachedUsage?.();
        if (cachedUsage?.limit > 0 && cachedUsage.used >= cachedUsage.limit) {
            GeminiProxy.showUpgradePrompt(cachedUsage);
            return;
        }

        const data = await new Promise((r) =>
            chrome.storage.local.get({ savedWords: [], targetLang: "pl" }, r),
        );
        const allWords = data.savedWords || [];
        const words = filterWords(allWords);
        if (words.length === 0) {
            alert("No words available to generate quiz.");
            return;
        }

        const scope = document.getElementById("quizScope")?.value || "5";
        const source = document.getElementById("quizSource")?.value || "recent";
        const targetLang = data.targetLang || "pl";

        const labelEl = exportQuizBtn.querySelector(".quiz-btn-label");
        exportQuizBtn.disabled = true;
        exportQuizBtn.classList.add("loading");
        if (labelEl) {
            labelEl.innerHTML = '<span class="ai-loader-label review-ai-loader-label">✨ AI…</span>';
        } else {
            exportQuizBtn.innerHTML = '<span class="ai-loader-label review-ai-loader-label">✨ AI…</span>';
        }

        try {
            const QuizEngine = await ensureQuizExportLoaded();
            if (!QuizEngine) {
                throw new Error("QuizExport module was not initialized.");
            }
            const result = await QuizEngine.runExport({
                words,
                scope,
                source,
                mode: quizOutputMode,
                targetLang,
            });
            if (result && result.quizWords) {
                markAsDownloaded(result.quizWords, allWords);
            }

            // Successfully generated: update local quota
            await recordExportSuccess("quiz");
        } catch (err) {
            console.error("Quiz export error:", err);
            if (!GeminiProxy?.isLimitError?.(err)) {
                alert("Quiz generation error: " + (err.message || err));
            }
        } finally {
            exportQuizBtn.disabled = false;
            exportQuizBtn.classList.remove("loading");
            if (labelEl) {
                labelEl.textContent = "✨ AI Quiz";
            } else {
                exportQuizBtn.innerHTML = origText;
            }
            if (typeof refreshAiUsageUI === "function") refreshAiUsageUI();
            await updateAllExportBadgesUI();
        }
    });
}

// ── Clear visible words ───────────────────────────────────────────
document.getElementById("clearAll").addEventListener("click", async () => {
    if (!confirm("Delete visible words?")) return;
    const words = typeof SharedWordRepository !== "undefined"
        ? await SharedWordRepository.getStoredWords()
        : (await chrome.storage.local.get({ savedWords: [] })).savedWords || [];
    const visibleWords = filterWords(words);
    if (visibleWords.length === 0) return;

    if (typeof SharedWordRepository !== "undefined") {
        await SharedWordRepository.deleteWords(visibleWords);
    } else {
        const toRemove = new Set(
            visibleWords.map((w) => w.original + "|" + w.timestamp),
        );
        const remaining = words.filter(
            (w) => !toRemove.has(w.original + "|" + w.timestamp),
        );
        await chrome.storage.local.set({ savedWords: remaining });
    }
    loadWords();
});

// ── Mark exported words as downloaded ─────────────────────────────
async function markAsDownloaded(exportedWords, allWords) {
    try {
        if (typeof SharedWordRepository !== "undefined") {
            await SharedWordRepository.markWordsDownloaded(exportedWords);
        } else {
            const exportedSet = new Set(
                exportedWords.map((w) => (w.id ? w.id : `${w.original}|${w.timestamp}`)),
            );
            const updated = (allWords || []).map((w) => {
                const key = w.id ? w.id : `${w.original}|${w.timestamp}`;
                if (exportedSet.has(key)) {
                    return { ...w, downloaded: true };
                }
                return w;
            });
            await chrome.storage.local.set({ savedWords: updated });
        }
    } catch (err) {
        console.error("[Lectoro] Failed to mark downloaded words:", err);
    }
    loadWords();
}
