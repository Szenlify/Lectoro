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
    btn.textContent = "⏳ Pobieram audio…";
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
                // If word not found in AI sentence, wrap the whole thing
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

            // Screenshot image
            if (w.screenshot) {
                const ts = (w.timestamp || Date.now()).toString(36);
                const imgFile = `qt_screenshot_${ts}.jpg`;
                // Convert base64 data URL to binary
                const base64 = w.screenshot.split(",")[1];
                const binaryStr = atob(base64);
                const imgData = new Uint8Array(binaryStr.length);
                for (let j = 0; j < binaryStr.length; j++) {
                    imgData[j] = binaryStr.charCodeAt(j);
                }
                files.push({ name: imgFile, data: imgData });
                backText += `<br><br><img src="${imgFile}">`;
            }

            // One sound on back only: sentence audio if sentence exists, otherwise word audio
            const audioText = w.sentence || w.original;
            const slug = audioText
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
                .substring(0, 40);
            const ts = (w.timestamp || Date.now()).toString(36);
            const audioFile = `qt_${slug}_${ts}.mp3`;
            backText += ` [sound:${audioFile}]`;
            lines.push(`${clozeText}\t${backText}`);

            // Fetch TTS audio – only what we need
            const ttsLang = w.srcLang || "en";
            if (w.sentence) {
                const sentenceBlob = await fetchAudioBlob(w.sentence, ttsLang);
                if (sentenceBlob) {
                    const audioData = new Uint8Array(
                        await sentenceBlob.arrayBuffer(),
                    );
                    files.push({ name: audioFile, data: audioData });
                }
            } else {
                const wordBlob = await fetchAudioBlob(w.original, ttsLang);
                if (wordBlob) {
                    const audioData = new Uint8Array(
                        await wordBlob.arrayBuffer(),
                    );
                    files.push({ name: audioFile, data: audioData });
                }
            }
        }

        // Add the text file
        const txtContent = lines.join("\n");
        const txtData = new TextEncoder().encode(txtContent);
        files.push({ name: `anki-cloze-${dateTag()}.txt`, data: txtData });

        // Build and download ZIP
        const zipData = buildZip(files);
        const blob = new Blob([zipData], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `anki-cloze-${dateTag()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // Mark as downloaded
        markAsDownloaded(words, data.savedWords);
    } catch (err) {
        console.error("Anki export error:", err);
        alert("Błąd eksportu: " + err.message);
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
            "Oryginał;Tłumaczenie;Zdanie;Tłumaczenie zdania;Język źr.;Język doc.;Data";
        const rows = words.map((w) => {
            const date = new Date(w.timestamp).toLocaleDateString("pl-PL");
            return [
                csvCell(w.original),
                csvCell(w.translated),
                csvCell(w.sentence || ""),
                csvCell(w.sentenceTranslated || ""),
                w.srcLang || "",
                w.tgtLang || "",
                date,
            ].join(";");
        });
        const content = BOM + header + "\n" + rows.join("\n");
        downloadFile(
            content,
            `translator-export-${dateTag()}.csv`,
            "text/csv;charset=utf-8",
        );

        // Mark as downloaded
        markAsDownloaded(words, data.savedWords);
    });
});

// ── Export: AI-generated Quiz (PDF or interactive) ─────────────────
// Moved to shared/quiz-export.js (loaded via <script> in popup.html) so the
// large quiz-generation/rendering logic can be developed on its own file.
// See: setQuizMode, generateQuizWithGemini, normalizeQuizData,
// buildQuizHtml, buildInteractiveQuizHtml.

// ── Clear visible words ───────────────────────────────────────────
document.getElementById("clearAll").addEventListener("click", () => {
    if (!confirm("Usunąć widoczne słowa?")) return;
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const visibleWords = filterWords(data.savedWords);
        const toRemove = new Set(
            visibleWords.map((w) => w.original + "|" + w.timestamp),
        );
        const remaining = data.savedWords.filter(
            (w) => !toRemove.has(w.original + "|" + w.timestamp),
        );
        chrome.storage.local.set({ savedWords: remaining }, () => {
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słów:",
                    chrome.runtime.lastError.message,
                );
            }
            loadWords();
            // Delete from Firestore in batch
            if (visibleWords.length > 0) {
                chrome.runtime.sendMessage({
                    type: "QT_FIRESTORE_DELETE_BATCH",
                    words: visibleWords.map((w) => ({
                        id: w.id,
                        original: w.original,
                        translated: w.translated,
                    })),
                });
            }
        });
    });
});

// ── Mark exported words as downloaded ─────────────────────────────
function markAsDownloaded(exportedWords, allWords) {
    const exportedSet = new Set(
        exportedWords.map((w) => w.original + "|" + w.timestamp),
    );
    const updated = allWords.map((w) => {
        if (exportedSet.has(w.original + "|" + w.timestamp)) {
            return { ...w, downloaded: true };
        }
        return w;
    });
    chrome.storage.local.set({ savedWords: updated }, () => {
        if (chrome.runtime.lastError) {
            console.error(
                "[Lectoro] Nie udało się zaktualizować słów:",
                chrome.runtime.lastError.message,
            );
        }
        loadWords();
    });
}