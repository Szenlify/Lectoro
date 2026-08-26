const { csvCell } = typeof SharedUtils !== "undefined"
    ? SharedUtils
    : { csvCell: (s) => String(s ?? "") };

// ── Google TTS URL helper ─────────────────────────────────────────
function googleTtsUrl(text, lang) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
}

// ── Fetch audio as blob ───────────────────────────────────────────
async function fetchAudioBlob(text, lang) {
    try {
        const url = googleTtsUrl(text, lang);
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.blob();
    } catch {
        return null;
    }
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

// ── Export: Anki Cloze with audio (.zip) ──────────────────────────
document.getElementById("exportAnki").addEventListener("click", async () => {
    const btn = document.getElementById("exportAnki");
    const origText = btn.textContent;
    btn.textContent = "⏳ Preparing…";
    btn.disabled = true;

    try {
        const data = await new Promise((r) =>
            chrome.storage.local.get({ savedWords: [] }, r),
        );
        const words = filterWords(data.savedWords || []);
        if (words.length === 0) {
            btn.textContent = origText;
            btn.disabled = false;
            return;
        }

        const files = [];
        const lines = [];

        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            btn.textContent = `⏳ Downloading (${i + 1}/${words.length})…`;

            // Build Cloze text: sentence with the word as {{c1::word::translation}}
            // Priority: AI sentence > original sentence > word only
            let clozeText;
            const sentenceSource = w.aiSentence || w.sentence;
            if (sentenceSource) {
                // Replace the word in sentence with cloze deletion
                const regex = new RegExp(
                    `(${w.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
                    "i",
                );
                clozeText = sentenceSource.replace(
                    regex,
                    `{{c1::$1::${w.translated}}}`,
                );
                // If word not found in sentence, wrap the word and append sentence
                if (clozeText === sentenceSource) {
                    clozeText = `{{c1::${w.original}::${w.translated}}}<br><br>${sentenceSource}`;
                }
            } else {
                clozeText = `{{c1::${w.original}::${w.translated}}}`;
            }

            // Back side: translation + sentence translations + screenshot + audio
            let backText = w.translated;
            if (w.aiSentenceTranslated) {
                backText += `<br><br>✨ <i>${w.aiSentenceTranslated}</i>`;
            }
            if (
                w.sentenceTranslated &&
                w.sentenceTranslated !== w.aiSentenceTranslated
            ) {
                backText += `<br><br><i>${w.sentenceTranslated}</i>`;
            }

            const ts = (w.id ? w.id.replace(/[^a-zA-Z0-9_-]/g, "") : (w.timestamp || Date.now()).toString(36)) + "_" + (i + 1);

            // Screenshot image (local base64 or remote URL downloaded from Cloudflare R2)
            if (w.screenshot) {
                if (w.screenshot.startsWith("data:")) {
                    const mime =
                        w.screenshot.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,/)?.[1] ||
                        "image/jpeg";
                    const ext = mime.includes("webp")
                        ? "webp"
                        : mime.includes("png")
                          ? "png"
                          : "jpg";
                    const imgFile = `lectoro_img_${ts}.${ext}`;
                    const base64 = w.screenshot.split(",")[1] || "";
                    if (base64) {
                        const binaryStr = atob(base64);
                        const imgData = new Uint8Array(binaryStr.length);
                        for (let j = 0; j < binaryStr.length; j++) {
                            imgData[j] = binaryStr.charCodeAt(j);
                        }
                        files.push({ name: imgFile, data: imgData });
                        backText += `<br><br><img src="${imgFile}">`;
                    }
                } else {
                    const resolvedUrl =
                        typeof SharedUtils !== "undefined" && typeof SharedUtils.resolveImageUrl === "function"
                            ? SharedUtils.resolveImageUrl(w.screenshot)
                            : w.screenshot;
                    if (/^https?:\/\//i.test(resolvedUrl)) {
                        try {
                            const imgRes = await fetch(resolvedUrl);
                            if (imgRes.ok) {
                                const contentType = imgRes.headers.get("content-type") || "";
                                let ext = "jpg";
                                if (contentType.includes("webp") || resolvedUrl.endsWith(".webp")) ext = "webp";
                                else if (contentType.includes("png") || resolvedUrl.endsWith(".png")) ext = "png";
                                else if (contentType.includes("jpeg") || contentType.includes("jpg") || resolvedUrl.endsWith(".jpg") || resolvedUrl.endsWith(".jpeg")) ext = "jpg";

                                const imgFile = `lectoro_img_${ts}.${ext}`;
                                const imgData = new Uint8Array(await imgRes.arrayBuffer());
                                files.push({ name: imgFile, data: imgData });
                                backText += `<br><br><img src="${imgFile}">`;
                            } else {
                                backText += `<br><br><img src="${escapeAttr(resolvedUrl)}">`;
                            }
                        } catch (imgErr) {
                            console.warn("[Lectoro] Could not download remote screenshot for Anki:", imgErr);
                            backText += `<br><br><img src="${escapeAttr(resolvedUrl)}">`;
                        }
                    }
                }
            }

            // Audio: prefer full sentence (AI or context), fallback to word
            const audioText = w.aiSentence || w.sentence || w.original;
            const slug = (audioText || "audio")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
                .substring(0, 30) || "audio";
            const audioFile = `lectoro_${slug}_${ts}.mp3`;

            // Fetch TTS audio
            const ttsLang = w.srcLang || "en";
            const audioBlob = await fetchAudioBlob(audioText, ttsLang);
            if (audioBlob) {
                const audioData = new Uint8Array(await audioBlob.arrayBuffer());
                files.push({ name: audioFile, data: audioData });
                backText += ` [sound:${audioFile}]`;
            }

            // Clean newlines and tabs to guarantee valid TSV lines
            const cleanField = (str) =>
                String(str || "")
                    .replace(/[\r\n]+/g, "<br>")
                    .replace(/\t/g, " ");

            lines.push(`${cleanField(clozeText)}\t${cleanField(backText)}`);
        }

        // Add the Anki text file with standard directives
        const dt = typeof dateTag === "function" ? dateTag() : (typeof SharedUtils !== "undefined" && SharedUtils.dateTag ? SharedUtils.dateTag() : new Date().toISOString().slice(0, 10));
        const headerLines = [
            "#separator:tab",
            "#html:true",
            "#tags:lectoro",
            "#columns:Text\tExtra",
        ];
        const txtContent = headerLines.join("\n") + "\n" + lines.join("\n");
        const txtData = new TextEncoder().encode(txtContent);
        files.push({ name: `anki-cloze-${dt}.txt`, data: txtData });

        // Build and download ZIP
        btn.textContent = "⏳ Packing ZIP…";
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

        // Mark as downloaded
        markAsDownloaded(words, data.savedWords);
    } catch (err) {
        console.error("Anki export error:", err);
        alert("Export error: " + err.message);
    } finally {
        btn.textContent = origText;
        btn.disabled = false;
    }
});

// ── Export: CSV (Excel) ───────────────────────────────────────────
document.getElementById("exportCsv").addEventListener("click", () => {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
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

        // Mark as downloaded
        markAsDownloaded(words, data.savedWords);
    });
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

const FREE_QUIZ_MAX = 3;
const PAID_QUIZ_HOURLY_MAX = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;

async function getQuizUserPlan() {
    try {
        if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.effectiveProfile === "function") {
            const profile = await SubscriptionService.effectiveProfile(false).catch(() => null);
            if (profile?.plan) return profile.plan.toLowerCase();
        }
        const data = await chrome.storage.local.get({ subscriptionProfileCache: null });
        if (data.subscriptionProfileCache?.plan) {
            return data.subscriptionProfileCache.plan.toLowerCase();
        }
    } catch (e) {}
    return "free";
}

async function getQuizQuotaState() {
    const plan = await getQuizUserPlan();
    const isFree = plan === "free";
    const data = await chrome.storage.local.get({
        quizGenerationsFreeCount: 0,
        quizGenerationsPaidHistory: [],
    });

    const freeUsed = Math.max(0, Number(data.quizGenerationsFreeCount) || 0);

    const now = Date.now();
    const rawHistory = Array.isArray(data.quizGenerationsPaidHistory) ? data.quizGenerationsPaidHistory : [];
    const validHistory = rawHistory.filter((ts) => typeof ts === "number" && now - ts < ONE_HOUR_MS);

    return {
        plan,
        isFree,
        freeUsed,
        freeLimit: FREE_QUIZ_MAX,
        paidUsed: validHistory.length,
        paidLimit: PAID_QUIZ_HOURLY_MAX,
        paidHistory: validHistory,
    };
}

async function updateQuizQuotaUI() {
    const badge = document.getElementById("quizFreeBadge");
    if (!badge) return;

    try {
        const state = await getQuizQuotaState();
        if (state.isFree) {
            badge.style.display = "inline-block";
            badge.textContent = `${state.freeUsed}/${state.freeLimit}`;
            badge.title = `Free quizzes: used ${state.freeUsed} of ${state.freeLimit}`;
            badge.classList.toggle("is-limit", state.freeUsed >= state.freeLimit);
        } else {
            // For paid plans, the limit badge is not shown normally
            badge.style.display = "none";
        }
    } catch (e) {
        console.error("Error updating quiz quota UI:", e);
    }
}

// Initial UI check and sync listener
updateQuizQuotaUI();
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.quizGenerationsFreeCount || changes.subscriptionProfileCache)) {
            updateQuizQuotaUI();
        }
    });
}

const exportQuizBtn = document.getElementById("exportQuiz");
if (exportQuizBtn) {
    exportQuizBtn.addEventListener("click", async () => {
        const origText = exportQuizBtn.innerHTML;

        const quotaState = await getQuizQuotaState();
        if (quotaState.isFree) {
            if (quotaState.freeUsed >= quotaState.freeLimit) {
                if (typeof GeminiProxy !== "undefined" && typeof GeminiProxy.showUpgradePrompt === "function") {
                    GeminiProxy.showUpgradePrompt({
                        reason: "free_quiz_limit",
                        message: "You have reached the limit of 3 free quizzes. Upgrade to Basic or Pro to generate up to 10 quizzes per hour!",
                    });
                } else if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.openPlans === "function") {
                    SubscriptionService.openPlans();
                } else {
                    alert("You have reached the limit of 3 free quizzes. Upgrade to a paid plan to generate unlimited quizzes!");
                }
                return;
            }
        } else {
            if (quotaState.paidUsed >= quotaState.paidLimit) {
                const oldestTs = Math.min(...quotaState.paidHistory);
                const waitMins = Math.max(1, Math.ceil((ONE_HOUR_MS - (Date.now() - oldestTs)) / 60000));
                alert(`Hourly limit of ${quotaState.paidLimit} quizzes reached. Try again in ${waitMins} min.`);
                return;
            }
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
            labelEl.innerHTML = '<span class="quiz-btn-spinner"></span><span>AI…</span>';
        } else {
            exportQuizBtn.innerHTML = '<span class="quiz-btn-spinner"></span><span>AI…</span>';
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
            if (quotaState.isFree) {
                await chrome.storage.local.set({
                    quizGenerationsFreeCount: quotaState.freeUsed + 1,
                });
            } else {
                await chrome.storage.local.set({
                    quizGenerationsPaidHistory: [...quotaState.paidHistory, Date.now()],
                });
            }
            await updateQuizQuotaUI();
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
            await updateQuizQuotaUI();
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
