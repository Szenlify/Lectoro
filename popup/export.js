const {csvCell} =
  typeof SharedUtils !== "undefined"
    ? SharedUtils
    : {csvCell: (s) => String(s ?? "")};

// ── Unified Audio Fetcher (SSOT with Gemini TTS, R2 CDN & AudioCache) ──
async function fetchAudioBlob(text, lang, {allowFallback = true} = {}) {
  if (
    typeof SharedTtsService !== "undefined" &&
    typeof SharedTtsService.getAudioBlob === "function"
  ) {
    const res = await SharedTtsService.getAudioBlob(text, lang, {
      context: "review",
      allowSynthesis: false, // Do not trigger fresh Gemini TTS synthesis on export; fallback to system voice if missing from R2 CDN
      allowFallback,
    });
    if (res?.blob) return res;
  }
  if (!allowFallback) return null;
  // Direct network fallback if SharedTtsService is unavailable
  try {
    const defaultLearning = (typeof SharedTranslatorService !== "undefined" && typeof SharedTranslatorService.getLearningLang === "function")
      ? (await SharedTranslatorService.getLearningLang())
      : ((typeof LectoroConstants !== "undefined" && LectoroConstants.DEFAULT_READING_SETTINGS?.learningLang) || "en");
    const baseLang = encodeURIComponent((lang || defaultLearning).split("-")[0]);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${baseLang}&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return {blob, provider: "google-tts", cached: false};
  } catch {
    return null;
  }
}

// One saved expression per card. Only saved translations and original context
// belong here; AI examples and explanations are deliberately excluded.
function buildAnkiCard(word) {
  const original = String(word.original || "").trim();
  const translated = String(word.translated || "").trim();
  const sentence = String(word.sentence || "").trim();
  const sentenceTranslated = String(word.sentenceTranslated || "").trim();
  const layout = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 24px auto; padding: 0 16px; text-align: center; color: inherit; line-height: 1.6; overflow-wrap: anywhere;";
  const front = '<div class="lectoro-anki-card" style="' + layout + '"><div dir="auto" style="font-size: 28px; font-weight: 500;">' + escapeHtml(original) + '</div></div>';
  const parts = ['<div dir="auto" style="font-size: 24px; font-weight: 500;">' + escapeHtml(translated) + '</div>'];
  if (sentence && sentence !== original) {
    parts.push('<div dir="auto" style="margin-top: 24px; font-size: 17px;">' + escapeHtml(sentence) + '</div>');
    if (sentenceTranslated && sentenceTranslated !== translated) {
      parts.push('<div dir="auto" style="margin-top: 6px; font-size: 15px;">' + escapeHtml(sentenceTranslated) + '</div>');
    }
  }
  return { front, parts, layout };
}

// Quote TSV fields because HTML attributes and saved text can contain quotes.
function ankiTsvField(value) {
  return '"' + String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/"/g, '""') + '"';
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
          canvas.toBlob(
            (blob) => {
              resolve({dataUrl, blob});
            },
            "image/jpeg",
            0.85
          );
        } catch (e) {
          console.warn("[Lectoro] Canvas to JPEG error:", e);
          resolve(null);
        }
      };
      img.onerror = (err) => {
        console.warn("[Lectoro] Image load for JPEG conversion error:", err);
        resolve(null);
      };
      img.src =
        typeof imageSource === "string"
          ? imageSource
          : URL.createObjectURL(imageSource);
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
  {type: "anki", badgeId: "ankiFreeBadge", title: "Free Anki exports"},
  {type: "excel", badgeId: "excelFreeBadge", title: "Free Excel exports"},
  {type: "quiz", badgeId: "quizFreeBadge", title: "Free quizzes"},
];

async function getExportQuota(type) {
  if (
    typeof SubscriptionService !== "undefined" &&
    typeof SubscriptionService.getExportQuotaState === "function"
  ) {
    return SubscriptionService.getExportQuotaState(type);
  }
  const currentMonth = SharedUtils.currentMonth();
  const data = await chrome.storage.local.get({
    exportUsage: null,
    quizGenerationsFreeCount: 0,
  });
  const usage =
    data.exportUsage && data.exportUsage.month === currentMonth
      ? data.exportUsage
      : {
          month: currentMonth,
          anki: 0,
          excel: 0,
          quiz: Number(data.quizGenerationsFreeCount) || 0,
        };
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
  if (
    typeof SubscriptionService !== "undefined" &&
    typeof SubscriptionService.recordExport === "function"
  ) {
    await SubscriptionService.recordExport(type);
  } else {
    const currentMonth = SharedUtils.currentMonth();
    const data = await chrome.storage.local.get({exportUsage: null});
    const usage =
      data.exportUsage && data.exportUsage.month === currentMonth
        ? data.exportUsage
        : {month: currentMonth, anki: 0, excel: 0, quiz: 0};
    usage[type] = (Number(usage[type]) || 0) + 1;
    await chrome.storage.local.set({exportUsage: usage});
  }
  await updateAllExportBadgesUI();
}

async function enforceExportQuota(type) {
  const quotaState = await getExportQuota(type);
  const typeLabels = {anki: "Anki", excel: "Excel", quiz: "Quiz"};
  const label = typeLabels[type] || type;

  if (quotaState.isFree) {
    if (quotaState.used >= quotaState.limit) {
      const message = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("export_quota_limit", null, { limit: quotaState.limit, type: label })
        : `You have reached the monthly limit of ${quotaState.limit} free ${label} exports. Upgrade to Basic or Pro for unlimited exports!`;
      if (
        typeof GeminiProxy !== "undefined" &&
        typeof GeminiProxy.showUpgradePrompt === "function"
      ) {
        GeminiProxy.showUpgradePrompt({
          reason: `free_${type}_limit`,
          feature: `export_${type}`,
          message,
        });
      } else if (
        typeof SubscriptionService !== "undefined" &&
        typeof SubscriptionService.openPlans === "function"
      ) {
        SubscriptionService.openPlans();
      } else {
        alert(message);
      }
      return false;
    }
  } else if (type === "quiz") {
    if (quotaState.paidUsed >= quotaState.paidLimit) {
      const oldestTs = Math.min(
        ...(quotaState.paidHistory?.length
          ? quotaState.paidHistory
          : [Date.now()])
      );
      const waitMins = Math.max(
        1,
        Math.ceil((ONE_HOUR_MS - (Date.now() - oldestTs)) / 60000)
      );
      const hourlyMsg = typeof SharedI18n !== "undefined"
        ? SharedI18n.t("export_quiz_hourly_limit", null, { limit: quotaState.paidLimit, wait: waitMins })
        : `Hourly limit of ${quotaState.paidLimit} quizzes reached. Try again in ${waitMins} min.`;
      alert(hourlyMsg);
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
        badge.title = typeof SharedI18n !== "undefined"
          ? SharedI18n.t("export_badge_tooltip", null, { title: item.title, used: state.used, limit: state.limit })
          : `${item.title}: used ${state.used} of ${state.limit} this month`;
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
if (
  typeof chrome !== "undefined" &&
  chrome.storage &&
  chrome.storage.onChanged
) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.exportUsage ||
        changes.quizGenerationsFreeCount ||
        changes.subscriptionProfileCache)
    ) {
      updateAllExportBadgesUI();
    }
  });
}

// ── Export: Anki Basic with audio (.zip) ──────────────────────────
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

  setBtnText(
    typeof SharedI18n !== "undefined"
      ? SharedI18n.t("export_preparing")
      : "⏳ Preparing…"
  );
  btn.disabled = true;

  try {
    const allWords = await SharedWordRepository.getStoredWords();
    const words = filterWords(allWords).filter((word) => String(word.original || "").trim() && String(word.translated || "").trim());
    if (words.length === 0) {
      setBtnText(origText);
      btn.disabled = false;
      return;
    }

    const files = [];
    const lines = [];

    const defaultLearningLang = (await SharedTranslatorService.getLearningLang()) || LectoroConstants.DEFAULT_READING_SETTINGS.learningLang;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      setBtnText(
        typeof SharedI18n !== "undefined"
          ? SharedI18n.t("export_downloading", null, { current: i + 1, total: words.length })
          : `⏳ Downloading (${i + 1}/${words.length})…`
      );


      const card = buildAnkiCard(w);
      const frontCardHtml = card.front;
      const extraParts = card.parts;

      const ts =
        (w.id
          ? w.id.replace(/[^a-zA-Z0-9_-]/g, "")
          : (w.timestamp || Date.now()).toString(36)) +
        "_" +
        (i + 1);

      // Keep saved screenshots as portable Anki media.
      let screenshotSrc = null;
      if (w.screenshot) {
        let rawSrc = null;
        if (w.screenshot.startsWith("data:")) {
          rawSrc = w.screenshot;
        } else {
          const resolvedUrl =
            typeof SharedUtils !== "undefined" &&
            typeof SharedUtils.resolveImageUrl === "function"
              ? SharedUtils.resolveImageUrl(w.screenshot)
              : w.screenshot;
          if (/^https?:\/\//i.test(resolvedUrl)) {
            rawSrc = resolvedUrl;
          }
        }

        if (rawSrc) {
          const imgFile = `lectoro_img_${ts}.jpg`;
          const jpegRes =
            typeof imageToJpeg === "function"
              ? await imageToJpeg(rawSrc)
              : null;
          if (jpegRes?.blob) {
            screenshotSrc = imgFile;
            const imgBuffer = await jpegRes.blob.arrayBuffer();
            files.push({name: imgFile, data: new Uint8Array(imgBuffer)});
          } else if (rawSrc.startsWith("data:")) {
            screenshotSrc = rawSrc;
          } else {
            screenshotSrc = rawSrc;
          }
        }

        if (screenshotSrc) {
          extraParts.push(
            `<img src="${escapeAttr(screenshotSrc)}" alt="" style="display: block; max-width: 100%; max-height: 220px; width: auto; height: auto; margin: 24px auto 0; border-radius: 4px;">`
          );
        }
      }

      // Prefer existing pronunciation recordings.
      let audioFile = null;
      const ttsLang = w.srcLang || defaultLearningLang;

      // Pronunciation of the exact expression being learned.
      const textCandidates = [w.original].filter((text) => typeof text === "string" && text.trim());

      let audioRes = null;
      let usedAudioText = "";

      // Probe candidate texts in R2 CDN and AudioCache for authentic Gemini TTS audio
      for (const candText of textCandidates) {
        const res = await fetchAudioBlob(candText, ttsLang, {
          allowFallback: false,
        });
        if (res?.blob && res.provider === "gemini") {
          audioRes = res;
          usedAudioText = candText;
          break;
        }
      }

      // If no Gemini TTS recording exists in R2 or cache, fallback to Google TTS
      if (!audioRes) {
        usedAudioText = w.original || "";
        if (usedAudioText) {
          audioRes = await fetchAudioBlob(usedAudioText, ttsLang, {
            allowFallback: true,
          });
        }
      }

      const slug =
        (usedAudioText || "audio")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "")
          .substring(0, 30) || "audio";
      const audioExtension = /audio\/(?:wav|wave|x-wav)/i.test(audioRes?.blob?.type || "") ? "wav" : "mp3";
      const candidateAudioFile = `lectoro_${slug}_${ts}.${audioExtension}`;
      if (audioRes?.blob && audioRes.blob.size > 0) {
        audioFile = candidateAudioFile;
        const audioBuffer = await audioRes.blob.arrayBuffer();
        files.push({name: audioFile, data: new Uint8Array(audioBuffer)});

      }

      const backCardHtml = '<div class="lectoro-anki-extra" style="' + card.layout + '">' + extraParts.join('') + '</div>';
      const finalBack = backCardHtml + (audioFile ? ' [sound:' + audioFile + ']' : '');
      lines.push(ankiTsvField(frontCardHtml) + '\t' + ankiTsvField(finalBack));
    }

    // Add a two-field Anki Basic file
    const dt =
      typeof dateTag === "function"
        ? dateTag()
        : typeof SharedUtils !== "undefined" && SharedUtils.dateTag
          ? SharedUtils.dateTag()
          : new Date().toISOString().slice(0, 10);
    const headerLines = [
      "#separator:tab",
      "#html:true",
      "#tags:lectoro",
      "#deck:Lectoro",
      "#notetype:Basic",
      "#columns:Front\tBack",
    ];
    const txtContent = headerLines.join("\n") + "\n" + lines.join("\n");
    const txtData = new TextEncoder().encode(txtContent);
    files.push({name: `anki-${dt}.txt`, data: txtData});

    // Add helpful Anki Import Guide in ZIP (English)
    const readmeContent = [
      "===============================================================",
      "LECTORO - HOW TO IMPORT FLASHCARDS INTO ANKI",
      "===============================================================",
      "",
      "Your ZIP archive contains generated flashcards (.txt), video screenshots (.jpg),",
      "and crystal-clear audio recordings (.wav / .mp3).",
      "",
      "Follow these simple steps to import your flashcards into Anki:",
      "",
      "STEP 1:",
      "Copy media files to Anki's 'collection.media' folder",
      "---------------------------------------------------------------",
      "All image files (.jpg) and audio files (.wav / .mp3) from this archive",
      "should be copied to Anki's media folder: 'collection.media'.",
      "",
      "Where to find this folder on your computer:",
      "• Windows:",
      "  You can find this folder quickly:",
      "  Press the Windows Key + R on your keyboard.",
      "  Type %APPDATA%\Anki2 into the run box and press Enter.",
      "  or",
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
      `3. Select the file: 'anki-${dt}.txt' from this archive.`,
      "4. Choose Basic (or its localized equivalent), with column 1 as Front and column 2 as Back. Enable HTML and select the Lectoro deck.",
      "5. Click 'Import'.",
      "",
      "Each card shows your saved expression first, then its translation and original context. No AI examples or explanations.",
      "===============================================================",
    ].join("\r\n");
    files.push({
      name: "HOW_TO_IMPORT_TO_ANKI.txt",
      data: new TextEncoder().encode(readmeContent),
    });

    // Build and download ZIP
    setBtnText(typeof SharedI18n !== "undefined" ? SharedI18n.t("export_packing_zip") : "⏳ Packing ZIP…");
    const zipData = buildZip(files);
    const blob = new Blob([zipData], {type: "application/zip"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anki-${dt}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Record successful export
    await recordExportSuccess("anki");

    // Mark as downloaded
    markAsDownloaded(words);
  } catch (err) {
    console.error("Anki export error:", err);
    const errText = typeof SharedI18n !== "undefined"
      ? SharedI18n.t("export_error", null, { error: err.message })
      : ("Export error: " + err.message);
    alert(errText);
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

  const allWords = await SharedWordRepository.getStoredWords();
  const words = filterWords(allWords);
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
      ? typeof SharedUtils !== "undefined" &&
        typeof SharedUtils.resolveImageUrl === "function"
        ? SharedUtils.resolveImageUrl(w.screenshot)
        : w.screenshot
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
  const dt =
    typeof dateTag === "function"
      ? dateTag()
      : typeof SharedUtils !== "undefined" && SharedUtils.dateTag
        ? SharedUtils.dateTag()
        : new Date().toISOString().slice(0, 10);
  downloadFile(content, `lectoro-export-${dt}.csv`, "text/csv;charset=utf-8");

  // Record successful export
  await recordExportSuccess("excel");

  // Mark as downloaded
  markAsDownloaded(words);
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

    const allWords = await SharedWordRepository.getStoredWords();
    const words = filterWords(allWords);
    if (words.length === 0) {
      alert(typeof SharedI18n !== "undefined" ? SharedI18n.t("quiz_no_words") : "No words available to generate quiz.");
      return;
    }

    const scope = document.getElementById("quizScope")?.value || "5";
    const source = document.getElementById("quizSource")?.value || "recent";
    const targetLang = (await SharedTranslatorService.getTargetLang()) || LectoroConstants.DEFAULT_READING_SETTINGS.targetLang;

    const labelEl = exportQuizBtn.querySelector(".quiz-btn-label");
    exportQuizBtn.disabled = true;
    exportQuizBtn.classList.add("loading");
    if (labelEl) {
      labelEl.innerHTML =
        '<span class="ai-loader-label">✨ AI…</span>';
    } else {
      exportQuizBtn.innerHTML =
        '<span class="ai-loader-label">✨ AI…</span>';
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
        markAsDownloaded(result.quizWords);
      }

      // Successfully generated: update local quota
      await recordExportSuccess("quiz");
    } catch (err) {
      console.error("Quiz export error:", err);
      if (!GeminiProxy?.isLimitError?.(err)) {
        const qErr = typeof SharedI18n !== "undefined"
          ? SharedI18n.t("quiz_error", null, { error: err.message || err })
          : ("Quiz generation error: " + (err.message || err));
        alert(qErr);
      }
    } finally {
      exportQuizBtn.disabled = false;
      exportQuizBtn.classList.remove("loading");
      const readyLabel = typeof SharedI18n !== "undefined" ? SharedI18n.t("quiz_btn_ready") : "✨ AI Quiz";
      if (labelEl) {
        labelEl.textContent = readyLabel;
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
  const confirmClear = typeof SharedI18n !== "undefined"
    ? SharedI18n.t("words_clear_all_confirm")
    : "Delete visible words?";
  if (!confirm(confirmClear)) return;
  const words = await SharedWordRepository.getStoredWords();
  const visibleWords = filterWords(words);
  if (visibleWords.length === 0) return;

  await SharedWordRepository.deleteWords(visibleWords);
  loadWords();
});

// ── Mark exported words as downloaded ─────────────────────────────
async function markAsDownloaded(exportedWords) {
  try {
    await SharedWordRepository.markWordsDownloaded(exportedWords);
  } catch (err) {
    console.error("[Lectoro] Failed to mark downloaded words:", err);
  }
  loadWords();
}
