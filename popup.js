// popup.js – Settings, saved words list, filtering & export (Anki / CSV)

const { escapeHtml, escapeAttr, isDueForReview, countDueWords } = SharedUtils;

// ── Elements ──────────────────────────────────────────────────────
const select = document.getElementById("targetLang");
const savedMsg = document.getElementById("saved");
const wordListEl = document.getElementById("wordList");
const statsEl = document.getElementById("stats");

// ── Tab switching ─────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        if (typeof stopPopupSpeak === "function") stopPopupSpeak();
        document
            .querySelectorAll(".tab")
            .forEach((t) => t.classList.remove("active"));
        document
            .querySelectorAll(".tab-content")
            .forEach((c) => c.classList.remove("active"));
        tab.classList.add("active");
        document
            .getElementById("tab-" + tab.dataset.tab)
            .classList.add("active");
        if (tab.dataset.tab === "words") loadWords();
        if (tab.dataset.tab === "review") loadReviewQueue();
    });
});

// ── Voice & rate elements ─────────────────────────────────────────
const voiceSelect = document.getElementById("voiceSelect");
const rateRange = document.getElementById("rateRange");
const rateValue = document.getElementById("rateValue");
const volumeRange = document.getElementById("volumeRange");
const volumeValue = document.getElementById("volumeValue");

// ── Auto-switch to Review tab if there are due reviews ────────────
chrome.storage.local.get({ savedWords: [] }, (data) => {
    const words = data.savedWords || [];
    const now = Date.now();
    const dueCount = countDueWords(words, now);
    if (dueCount > 0) {
        document
            .querySelectorAll(".tab")
            .forEach((t) => t.classList.remove("active"));
        document
            .querySelectorAll(".tab-content")
            .forEach((c) => c.classList.remove("active"));
        const reviewTab = document.querySelector('.tab[data-tab="review"]');
        if (reviewTab) reviewTab.classList.add("active");
        document.getElementById("tab-review")?.classList.add("active");
        loadReviewQueue();
    }
});

// ── Flash saved message ───────────────────────────────────────────
function flashSaved() {
    savedMsg.classList.add("show");
    setTimeout(() => savedMsg.classList.remove("show"), 1500);
}

// ── Firebase Cloud Sync UI ────────────────────────────────────────
function renderSyncUI() {
    const container = document.getElementById("syncContent");
    if (!container) return;

    // Not configured
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-ghost); padding:4px 0; line-height:1.6;">
                Skonfiguruj Firebase w <code style="font-size:10px; background:var(--glass-strong); padding:2px 5px; border-radius:4px;">firebase-config.js</code> aby synchronizować słowa między urządzeniami.
            </div>`;
        return;
    }

    FirebaseSync.getUser().then((user) => {
        if (user) {
            // Signed in
            chrome.storage.local.get({ lastFirebaseSync: null }, (data) => {
                const lastSync = data.lastFirebaseSync;
                const lastSyncText = lastSync
                    ? new Date(lastSync).toLocaleTimeString("pl-PL", {
                          hour: "2-digit",
                          minute: "2-digit",
                      })
                    : "nigdy";

                container.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <span style="color:var(--mint); font-size:13px;">✓</span>
                        <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${escapeHtml(user.email)}</span>
                    </div>
                    <div style="font-size:10px; color:var(--text-ghost); margin-bottom:10px;">
                        Ostatnia synchronizacja: ${lastSyncText}
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button id="firebaseSyncNow" class="sync-btn sync-primary">🔄 Synchronizuj</button>
                        <button id="firebaseSignOut" class="sync-btn sync-danger">Wyloguj</button>
                    </div>`;

                document
                    .getElementById("firebaseSyncNow")
                    ?.addEventListener("click", async () => {
                        const btn = document.getElementById("firebaseSyncNow");
                        btn.textContent = "⏳ Synchronizuję...";
                        btn.disabled = true;
                        try {
                            await chrome.runtime.sendMessage({
                                type: "QT_FIREBASE_SYNC",
                            });
                            btn.textContent = "✓ Gotowe!";
                            setTimeout(() => {
                                renderSyncUI();
                                loadWords();
                                maybeRefreshReviewQueue();
                                initReviewBadge();
                            }, 1200);
                        } catch (e) {
                            btn.textContent = "✗ Błąd";
                            setTimeout(() => renderSyncUI(), 2000);
                        }
                    });

                document
                    .getElementById("firebaseSignOut")
                    ?.addEventListener("click", async () => {
                        chrome.runtime.sendMessage({
                            type: "QT_FIREBASE_SIGN_OUT",
                        });
                        // Clear local auth too so UI updates instantly
                        await FirebaseSync.signOut();
                        renderSyncUI();
                    });
            });
        } else {
            // Not signed in
            container.innerHTML = `
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                    Synchronizuj słowa i powtórki między urządzeniami.
                </div>
                <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;">
                    🔑 Zaloguj się przez Google
                </button>`;

            document
                .getElementById("firebaseSignIn")
                ?.addEventListener("click", async () => {
                    const btn = document.getElementById("firebaseSignIn");
                    btn.textContent = "⏳ Logowanie...";
                    btn.disabled = true;
                    try {
                        // Send sign-in to background service worker.
                        // The popup may close when the OAuth window opens –
                        // the service worker keeps running and saves auth data.
                        chrome.runtime.sendMessage(
                            { type: "QT_FIREBASE_SIGN_IN" },
                            (response) => {
                                // This callback runs ONLY if popup stayed open
                                if (chrome.runtime.lastError) return;
                                if (response?.ok) {
                                    renderSyncUI();
                                    loadWords();
                                    maybeRefreshReviewQueue();
                                    initReviewBadge();
                                } else if (response?.error) {
                                    btn.textContent = "✗ " + response.error;
                                    btn.disabled = false;
                                    setTimeout(() => renderSyncUI(), 3000);
                                }
                            },
                        );
                    } catch (e) {
                        console.error("[Lectoro] Sign in error:", e);
                        btn.textContent =
                            "✗ " + (e.message || "Błąd logowania");
                        btn.disabled = false;
                        setTimeout(() => renderSyncUI(), 3000);
                    }
                });
        }
    });
}

// Render sync UI on popup load (handles case where user completed auth
// while popup was closed – will show logged-in state immediately)
renderSyncUI();

// Also listen for auth changes while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.firebaseAuth) {
        renderSyncUI();
    }
    if (area === "local" && changes.lastFirebaseSync) {
        renderSyncUI();
        loadWords();
        maybeRefreshReviewQueue();
        initReviewBadge();
    }
    if (area === "local" && changes.savedWords) {
        // Refresh review queue whenever words change (e.g. synced SR data)
        // But skip if the change came from rating a word in the current session
        if (!_reviewSaving) {
            maybeRefreshReviewQueue();
        }
        initReviewBadge();
    }
});

// ── Settings: load & save language ────────────────────────────────
chrome.storage.sync.get(
    { targetLang: "pl", speechVoice: "", speechRate: 1.3, ttsVolume: 1 },
    (data) => {
        select.value = data.targetLang;
        rateRange.value = data.speechRate;
        rateValue.textContent = parseFloat(data.speechRate).toFixed(2);
        if (data.ttsVolume !== undefined && volumeRange) {
            volumeRange.value = data.ttsVolume;
            volumeValue.textContent = Math.round(data.ttsVolume * 100) + "%";
        }
        // Load voices and set selection
        loadVoices(data.speechVoice);
    },
);

select.addEventListener("change", () => {
    chrome.storage.sync.set({ targetLang: select.value }, flashSaved);
});

// ── Subtitle reading modes ───────────────────────────────────────
const subtitleTTSToggle = document.getElementById("subtitleTTS");
const wordCloudModeToggle = document.getElementById("wordCloudMode");

function syncSubtitleModeUI() {
    chrome.storage.sync.get(
        { subtitleTTS: false, wordCloudMode: true },
        (data) => {
            subtitleTTSToggle.checked = !!data.subtitleTTS;
            wordCloudModeToggle.checked = !!data.wordCloudMode;
        },
    );
}

syncSubtitleModeUI();

subtitleTTSToggle.addEventListener("change", () => {
    chrome.storage.sync.set(
        { subtitleTTS: subtitleTTSToggle.checked },
        flashSaved,
    );
});

wordCloudModeToggle.addEventListener("change", () => {
    chrome.storage.sync.set(
        { wordCloudMode: wordCloudModeToggle.checked },
        flashSaved,
    );
});

// Subtitle Styles UI removed — settings are preserved in storage and
// `core.js` will continue to read/apply subtitle style keys if present.

// ── Populate voices ───────────────────────────────────────────────
function loadVoices(selectedVoice) {
    const voices = window.speechSynthesis.getVoices();
    voiceSelect.innerHTML = '<option value="">🔊 Domyślny</option>';
    voices
        .filter((v) => /google/i.test(v.name))
        .forEach((v) => {
            const opt = document.createElement("option");
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.name === selectedVoice) opt.selected = true;
            voiceSelect.appendChild(opt);
        });
}

// Voices may load async
window.speechSynthesis.onvoiceschanged = () => {
    chrome.storage.sync.get({ speechVoice: "" }, (data) => {
        loadVoices(data.speechVoice);
    });
};

voiceSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ speechVoice: voiceSelect.value }, flashSaved);
});

// ── Rate slider ───────────────────────────────────────────────────
rateRange.addEventListener("input", () => {
    rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
});
rateRange.addEventListener("change", () => {
    chrome.storage.sync.set(
        { speechRate: parseFloat(rateRange.value) },
        flashSaved,
    );
});

// ── Volume slider ─────────────────────────────────────────────────
if (volumeRange) {
    volumeRange.addEventListener("input", () => {
        volumeValue.textContent =
            Math.round(parseFloat(volumeRange.value) * 100) + "%";
    });
    volumeRange.addEventListener("change", () => {
        chrome.storage.sync.set(
            { ttsVolume: parseFloat(volumeRange.value) },
            flashSaved,
        );
    });
}

// ── TTS Mode toggle (Browser / ElevenLabs) ───────────────────────
const modeBrowserBtn = document.getElementById("modeBrowser");
const modeELBtn = document.getElementById("modeEL");
const browserTtsSettings = document.getElementById("browserTtsSettings");
const elSettingsPanel = document.getElementById("elSettings");
const elApiKeyInput = document.getElementById("elApiKey");
const elVoiceSelect = document.getElementById("elVoiceSelect");
const elStatusEl = document.getElementById("elStatus");

function setTtsMode(mode) {
    if (mode === "elevenlabs") {
        modeBrowserBtn.classList.remove("active");
        modeELBtn.classList.add("active");
        browserTtsSettings.style.display = "none";
        elSettingsPanel.classList.add("visible");
    } else {
        modeELBtn.classList.remove("active");
        modeBrowserBtn.classList.add("active");
        browserTtsSettings.style.display = "";
        elSettingsPanel.classList.remove("visible");
    }
    chrome.storage.sync.set({ ttsMode: mode }, flashSaved);
}

modeBrowserBtn.addEventListener("click", () => setTtsMode("browser"));
modeELBtn.addEventListener("click", () => setTtsMode("elevenlabs"));

// Load saved mode
chrome.storage.sync.get(
    { ttsMode: "browser", elApiKey: "", elVoiceId: "" },
    (data) => {
        if (data.ttsMode === "elevenlabs") setTtsMode("elevenlabs");
        if (data.elApiKey) {
            elApiKeyInput.value = data.elApiKey;
            loadELVoices(data.elApiKey, data.elVoiceId);
        }
    },
);

// Save API key on change & load voices
let elKeyDebounce = null;
elApiKeyInput.addEventListener("input", () => {
    clearTimeout(elKeyDebounce);
    elKeyDebounce = setTimeout(() => {
        const key = elApiKeyInput.value.trim();
        chrome.storage.sync.set({ elApiKey: key }, flashSaved);
        if (key) loadELVoices(key);
    }, 600);
});

// Load ElevenLabs voices
async function loadELVoices(apiKey, selectedVoiceId) {
    elStatusEl.textContent = "Ładowanie głosów…";
    elStatusEl.className = "el-status";
    try {
        const res = await fetch("https://api.elevenlabs.io/v1/voices", {
            headers: { "xi-api-key": apiKey },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const voices = data.voices || [];
        elVoiceSelect.innerHTML = "";
        voices.forEach((v) => {
            const opt = document.createElement("option");
            opt.value = v.voice_id;
            const labels = v.labels ? Object.values(v.labels).join(", ") : "";
            opt.textContent = `${v.name}${labels ? " (" + labels + ")" : ""}`;
            if (v.voice_id === selectedVoiceId) opt.selected = true;
            elVoiceSelect.appendChild(opt);
        });
        elStatusEl.textContent = `✓ Załadowano ${voices.length} głosów`;
        elStatusEl.className = "el-status ok";
        // Auto-select first if none selected
        if (!selectedVoiceId && voices.length) {
            chrome.storage.sync.set({ elVoiceId: voices[0].voice_id });
        }
    } catch (err) {
        elStatusEl.textContent = `✗ Błąd: ${err.message}`;
        elStatusEl.className = "el-status err";
        elVoiceSelect.innerHTML = '<option value="">— Błąd API —</option>';
    }
}

elVoiceSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ elVoiceId: elVoiceSelect.value }, flashSaved);
});

// ── Gemini API Key ────────────────────────────────────────────────
const geminiApiKeyInput = document.getElementById("geminiApiKey");
chrome.storage.sync.get({ geminiApiKey: "" }, (data) => {
    if (data.geminiApiKey) geminiApiKeyInput.value = data.geminiApiKey;
});
let geminiKeyDebounce = null;
geminiApiKeyInput.addEventListener("input", () => {
    clearTimeout(geminiKeyDebounce);
    geminiKeyDebounce = setTimeout(() => {
        chrome.storage.sync.set(
            { geminiApiKey: geminiApiKeyInput.value.trim() },
            flashSaved,
        );
    }, 600);
});

// ── Filter state ──────────────────────────────────────────────────
let currentFilter = "all";

document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document
            .querySelectorAll(".filter-btn")
            .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.dataset.filter;
        loadWords();
    });
});

// ── Time helpers ──────────────────────────────────────────────────
function startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function startOfWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
    return d.getTime();
}
function startOfMonth() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    return d.getTime();
}

// ── Filter words ──────────────────────────────────────────────────
function filterWords(words) {
    switch (currentFilter) {
        case "today":
            return words.filter((w) => w.timestamp >= startOfDay());
        case "week":
            return words.filter((w) => w.timestamp >= startOfWeek());
        case "month":
            return words.filter((w) => w.timestamp >= startOfMonth());
        case "new":
            return words.filter((w) => !w.downloaded);
        default:
            return words;
    }
}

// ── Load & render words ───────────────────────────────────────────
function loadWords() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const all = data.savedWords || [];
        const filtered = filterWords(all);

        statsEl.textContent = `${filtered.length} z ${all.length} słów`;

        if (filtered.length === 0) {
            wordListEl.innerHTML = `
                <div class="empty-state">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                    <div>Brak zapisanych słów</div>
                </div>`;
            return;
        }

        // Sort newest first
        const sorted = [...filtered].sort((a, b) => b.timestamp - a.timestamp);

        wordListEl.innerHTML = sorted
            .map((w, i) => {
                const date = new Date(w.timestamp).toLocaleDateString("pl-PL", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                });
                const isNew = !w.downloaded ? " new-item" : "";
                let sentenceHtml = "";
                if (w.sentence) {
                    const esc = escapeHtml(w.sentence);
                    const escWord = escapeHtml(w.original);
                    const highlighted = esc.replace(
                        new RegExp(
                            `(${escWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
                            "i",
                        ),
                        '<span class="wi-cloze">$1</span>',
                    );
                    sentenceHtml = `<div class="wi-sentence">${highlighted}</div>`;
                    if (w.sentenceTranslated) {
                        sentenceHtml += `<div class="wi-sentence" style="color:rgba(255,255,255,0.25);">${escapeHtml(w.sentenceTranslated)}</div>`;
                    }
                }
                return `<div class="word-item${isNew}" data-index="${i}">
                    <div class="wi-texts">
                        <div class="wi-original">${escapeHtml(w.original)}</div>
                        <div class="wi-translated">${escapeHtml(w.translated)}</div>
                        ${sentenceHtml}
                        <div class="wi-meta">${date} · ${(w.srcLang || "?").toUpperCase()}→${(w.tgtLang || "?").toUpperCase()}</div>
                    </div>
                    <button class="wi-delete" data-original="${escapeAttr(w.original)}" data-ts="${w.timestamp}" title="Usuń">✕</button>
                </div>`;
            })
            .join("");

        // Delete handlers
        wordListEl.querySelectorAll(".wi-delete").forEach((btn) => {
            btn.addEventListener("click", () => {
                const orig = btn.dataset.original;
                const ts = parseInt(btn.dataset.ts);
                deleteWord(orig, ts);
            });
        });
    });
}

// ── Delete word ───────────────────────────────────────────────────
function deleteWord(original, timestamp) {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const wordToDelete = data.savedWords.find(
            (w) => w.original === original && w.timestamp === timestamp,
        );
        const words = data.savedWords.filter(
            (w) => !(w.original === original && w.timestamp === timestamp),
        );
        chrome.storage.local.set({ savedWords: words }, () => {
            loadWords();
            // Delete from Firestore (fire-and-forget via background)
            if (wordToDelete) {
                chrome.runtime.sendMessage({
                    type: "QT_FIRESTORE_DELETE",
                    word: {
                        original: wordToDelete.original,
                        translated: wordToDelete.translated,
                    },
                });
            }
        });
    });
}

// ── Delete single review word (from review tab) ──────────────────
function deleteReviewWord(w) {
    if (!confirm(`Usunąć "${w.original}" z bazy danych?`)) return;
    stopPopupSpeak();
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords.filter(
            (x) =>
                !(x.original === w.original && x.translated === w.translated),
        );
        chrome.storage.local.set({ savedWords: words }, () => {
            // Delete from Firestore
            chrome.runtime.sendMessage({
                type: "QT_FIRESTORE_DELETE",
                word: { original: w.original, translated: w.translated },
            });
            // Remove from current queue and continue
            reviewQueue.splice(reviewIndex, 1);
            reviewTotalDue = reviewQueue.length;
            if (reviewIndex >= reviewQueue.length)
                reviewIndex = reviewQueue.length - 1;
            if (reviewIndex < 0) reviewIndex = 0;
            reviewAnswerShown = false;
            renderReview();
        });
    });
}

// ── Delete all due reviews ───────────────────────────────────────
function deleteAllReviews() {
    if (!confirm("Usunąć WSZYSTKIE słowa w kolejce powtórek z bazy danych?"))
        return;
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const allWords = data.savedWords || [];
        const now = Date.now();
        const dueWords = allWords.filter((w) => isDueForReview(w, now));
        if (dueWords.length === 0) return;

        const dueSet = new Set(
            dueWords.map((w) => w.original + "|" + w.translated),
        );
        const remaining = allWords.filter(
            (w) => !dueSet.has(w.original + "|" + w.translated),
        );
        chrome.storage.local.set({ savedWords: remaining }, () => {
            // Delete from Firestore in batch
            chrome.runtime.sendMessage({
                type: "QT_FIRESTORE_DELETE_BATCH",
                words: dueWords.map((w) => ({
                    original: w.original,
                    translated: w.translated,
                })),
            });
            reviewQueue = [];
            reviewIndex = 0;
            reviewTotalDue = 0;
            reviewAnswerShown = false;
            renderReview();
        });
    });
}

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
let quizOutputMode = "pdf";
const quizModePdfBtn = document.getElementById("quizModePdf");
const quizModeInteractiveBtn = document.getElementById("quizModeInteractive");
function setQuizMode(mode) {
    quizOutputMode = mode;
    quizModePdfBtn.classList.toggle("active", mode === "pdf");
    quizModeInteractiveBtn.classList.toggle("active", mode === "interactive");
}
quizModePdfBtn?.addEventListener("click", () => setQuizMode("pdf"));
quizModeInteractiveBtn?.addEventListener("click", () =>
    setQuizMode("interactive"),
);

document.getElementById("exportQuiz").addEventListener("click", async () => {
    const btn = document.getElementById("exportQuiz");
    const origText = btn.innerHTML;

    const data = await new Promise((r) =>
        chrome.storage.local.get({ savedWords: [] }, r),
    );
    const words = filterWords(data.savedWords || []);
    if (words.length === 0) {
        alert("Brak słów do wygenerowania quizu.");
        return;
    }

    const { geminiApiKey } = await new Promise((r) =>
        chrome.storage.sync.get({ geminiApiKey: "" }, r),
    );
    if (!geminiApiKey) {
        alert(
            "Aby wygenerować quiz AI, wpisz najpierw klucz Gemini API w zakładce ⚙️ Ustawienia.",
        );
        return;
    }

    // Word scope: newest N, or all (respecting the active list filter above)
    const scope = document.getElementById("quizScope").value;
    const sorted = [...words].sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0),
    );
    const quizWords =
        scope === "all"
            ? sorted.slice(0, 60)
            : sorted.slice(0, parseInt(scope, 10));

    btn.disabled = true;
    btn.innerHTML = "⏳ Generuję quiz…";
    try {
        const quiz = await generateQuizWithGemini(quizWords, geminiApiKey);
        const html =
            quizOutputMode === "interactive"
                ? buildInteractiveQuizHtml(quiz, quizWords)
                : buildQuizHtml(quiz, quizWords);
        // A data: URL (not a blob: URL) so the page still loads even after
        // the extension popup closes (which happens as soon as the new tab gets focus).
        const dataUrl =
            "data:text/html;charset=utf-8," + encodeURIComponent(html);
        chrome.tabs.create({ url: dataUrl });
        markAsDownloaded(quizWords, data.savedWords);
    } catch (err) {
        console.error("Quiz export error:", err);
        alert("Błąd generowania quizu: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
});

/** Ask Gemini to build a varied quiz (multiple choice, fill-in-the-blank,
 * matching, translation, true/false) from the saved word list. */
async function generateQuizWithGemini(words, geminiApiKey) {
    const LANG_ADJ = {
        en: "angielskim",
        es: "hiszpańskim",
        de: "niemieckim",
        fr: "francuskim",
        it: "włoskim",
        pt: "portugalskim",
        ru: "rosyjskim",
        pl: "polskim",
        uk: "ukraińskim",
        ja: "japońskim",
        ko: "koreańskim",
        zh: "chińskim",
        nl: "niderlandzkim",
        sv: "szwedzkim",
        tr: "tureckim",
    };
    const srcLang = words[0]?.srcLang || "en";
    const srcLangAdj = LANG_ADJ[srcLang] || srcLang.toUpperCase();

    const wordList = words
        .map((w, i) => {
            const parts = [`${i + 1}. "${w.original}" = "${w.translated}"`];
            if (w.sentence) parts.push(`(przykład: ${w.sentence})`);
            return parts.join(" ");
        })
        .join("\n");

    // Random nonce + shuffled type order nudge the model toward a different mix
    // of section types/questions each time, even for the exact same word list.
    const nonce = Math.random().toString(36).slice(2, 10);
    const allTypes = [
        "multiple_choice",
        "fill_blank",
        "matching",
        "translation",
        "true_false",
        "word_order",
        "error_correction",
        "odd_one_out",
    ];
    const shuffledTypes = [...allTypes].sort(() => Math.random() - 0.5);
    const sectionCount = 5 + Math.floor(Math.random() * 3); // 5-7 sections
    const chosenTypes = shuffledTypes.slice(
        0,
        Math.min(sectionCount, allTypes.length),
    );

    const prompt = `Jesteś asystentem do nauki języków. Uczeń uczy się słówek w języku ${srcLangAdj} (kolumna "słowo źródłowe" poniżej), a ich polskie tłumaczenie podano tylko jako pomoc. Stwórz bardziej rozbudowany, zróżnicowany i wymagający test/quiz sprawdzający WYŁĄCZNIE znajomość słówek w języku ${srcLangAdj} – każda oczekiwana odpowiedź (luka do uzupełnienia, poprawna opcja, odpowiedź w translation/word_order/error_correction) MUSI być w języku ${srcLangAdj}, NIGDY po polsku. Treści poleceń/instrukcji i ewentualne opisy znaczeń pisz po polsku, żeby uczeń rozumiał zadanie, ale sama odpowiedź zawsze ma być słowem/zdaniem w języku ${srcLangAdj}.

WAŻNE — zróżnicowanie między generacjami: token unikalności ${nonce}. Za KAŻDYM razem, nawet dla identycznej listy słówek, wybierz inny zestaw typów sekcji, inną ich kolejność, inne konkretne pytania, przykłady i zdania – quiz nigdy nie powinien wyglądać tak samo dwa razy z rzędu. W tej generacji użyj DOKŁADNIE tych typów sekcji, w tej kolejności: ${chosenTypes.join(", ")}. Mieszaj też poziom trudności pytań w ramach sekcji (część łatwiejszych, część trudniejszych/podchwytliwych).

Opis dostępnych typów sekcji:
- multiple_choice: pytanie po polsku (np. opisujące znaczenie, synonim lub kontekst użycia), 4 opcje odpowiedzi w języku ${srcLangAdj} (jedna poprawna, pozostałe sensowne dystraktory).
- fill_blank: zdanie W JĘZYKU ${srcLangAdj} z luką "___" w miejscu słówka; odpowiedź to brakujące słowo w języku ${srcLangAdj}.
- matching: pary słowo źródłowe (${srcLangAdj}) <-> polskie tłumaczenie, do połączenia (jedyna sekcja, gdzie polski się pojawia, bo to dopasowywanie a nie pisanie odpowiedzi).
- translation: polecenie po polsku w stylu "Jak powiedzieć po ${srcLangAdj}u: '<polskie słowo>'?"; odpowiedź to słowo w języku ${srcLangAdj}.
- true_false: stwierdzenie po polsku o znaczeniu słówka w języku ${srcLangAdj} (prawda/fałsz), odpowiedź to tylko true/false.
- word_order: podaj potasowaną listę pojedynczych wyrazów tworzących poprawne zdanie w języku ${srcLangAdj} zawierające jedno z uczonych słówek (pole "words"); odpowiedź ("answer") to całe poprawnie ułożone zdanie w języku ${srcLangAdj}.
- error_correction: podaj zdanie w języku ${srcLangAdj} zawierające jeden celowy błąd GRAMATYCZNY dotyczący uczonego słówka (np. zła forma czasownika/czas gramatyczny, zły przyimek, brak/zła forma liczby mnogiej, zły szyk zdania, zły article/rodzajnik, niepoprawna zgoda podmiotu z orzeczeniem) — słowo docelowe MUSI być zapisane poprawnie ortograficznie, błąd nie może polegać na literówce ani zmienionej pojedynczej literze w pisowni. Odpowiedź ("answer") to CAŁE poprawione zdanie w języku ${srcLangAdj}.
- odd_one_out: podaj 4 słowa w języku ${srcLangAdj} (w tym uczone słówka) z jednej kategorii znaczeniowej + 1 pasujące do innej kategorii (pole "options"); odpowiedź ("answer") to wyraz, który nie pasuje.

Nie używaj wszystkich słówek w każdej sekcji – rozłóż je sensownie pomiędzy sekcje.

Lista słówek:
${wordList}

Odpowiedz WYŁĄCZNIE w tym dokładnym formacie JSON (uwzględnij TYLKO sekcje typów wskazanych powyżej, w podanej kolejności), bez żadnego dodatkowego tekstu:
{
  "title": "krótki tytuł quizu",
  "sections": [
    {"type": "multiple_choice", "instructions": "...", "questions": [{"question": "...", "options": ["...","...","...","..."], "answer": "..."}]},
    {"type": "fill_blank", "instructions": "...", "questions": [{"sentence": "... ___ ...", "answer": "..."}]},
    {"type": "matching", "instructions": "...", "pairs": [{"a": "...", "b": "..."}]},
    {"type": "translation", "instructions": "...", "questions": [{"prompt": "...", "answer": "..."}]},
    {"type": "true_false", "instructions": "...", "questions": [{"statement": "...", "answer": true}]},
    {"type": "word_order", "instructions": "...", "questions": [{"words": ["...","...","..."], "answer": "..."}]},
    {"type": "error_correction", "instructions": "...", "questions": [{"sentence": "...", "answer": "..."}]},
    {"type": "odd_one_out", "instructions": "...", "questions": [{"options": ["...","...","...","..."], "answer": "..."}]}
  ]
}`;

    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1, maxOutputTokens: 4500 },
            }),
        },
    );
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Gemini HTTP ${res.status}`);
    }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Gemini: brak odpowiedzi JSON");
    return JSON.parse(jsonMatch[0]);
}

/** Render the quiz JSON as a print-ready HTML document (questions, then answer key). */
function buildQuizHtml(quiz, words) {
    const title = escapeHtml(quiz.title || "Quiz językowy");
    const sectionTitles = {
        multiple_choice: "Wielokrotny wybór",
        fill_blank: "Uzupełnij luki",
        matching: "Dopasuj pary",
        translation: "Przetłumacz",
        true_false: "Prawda czy fałsz",
        word_order: "Ułóż zdanie",
        error_correction: "Znajdź i popraw błąd",
        odd_one_out: "Który wyraz nie pasuje?",
    };

    let qNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            const heading = sectionTitles[sec.type] || sec.type;
            let body = "";
            if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const opts = (q.options || [])
                            .map(
                                (o, i) =>
                                    `<div class="quiz-option">${String.fromCharCode(65 + i)}) ${escapeHtml(o)}</div>`,
                            )
                            .join("");
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.question || "")}</p><div class="quiz-options">${opts}</div></div>`;
                    })
                    .join("");
            } else if (sec.type === "fill_blank") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "matching") {
                const aList = (sec.pairs || [])
                    .map((p, i) => `<li>${i + 1}. ${escapeHtml(p.a)}</li>`)
                    .join("");
                const bList = [...(sec.pairs || [])]
                    .sort(() => Math.random() - 0.5)
                    .map(
                        (p, i) =>
                            `<li>${String.fromCharCode(65 + i)}. ${escapeHtml(p.b)}</li>`,
                    )
                    .join("");
                body = `<div class="quiz-matching"><ol class="quiz-match-col">${aList}</ol><ol class="quiz-match-col" type="A">${bList}</ol></div>`;
            } else if (sec.type === "translation") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "true_false") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.statement)} <span class="quiz-tf">☐ Prawda &nbsp; ☐ Fałsz</span></p></div>`;
                    })
                    .join("");
            } else if (sec.type === "word_order") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const shuffled = [...(q.words || [])].sort(
                            () => Math.random() - 0.5,
                        );
                        const tiles = shuffled
                            .map(
                                (w) =>
                                    `<span class="quiz-tile">${escapeHtml(w)}</span>`,
                            )
                            .join(" ");
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${tiles}</p><p class="quiz-answer-line">Odpowiedź: ______________________________________</p></div>`;
                    })
                    .join("");
            } else if (sec.type === "error_correction") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="quiz-question"><p><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p><p class="quiz-answer-line">Poprawka: ______________________________________</p></div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>${escapeHtml(heading)}</h2><p class="quiz-instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
        })
        .join("");

    // Answer key on its own printed page
    const answerKeyHtml = (quiz.sections || [])
        .map((sec) => {
            if (
                sec.type === "multiple_choice" ||
                sec.type === "translation" ||
                sec.type === "fill_blank" ||
                sec.type === "word_order" ||
                sec.type === "error_correction" ||
                sec.type === "odd_one_out"
            ) {
                return (sec.questions || [])
                    .map((q) => `<li>${escapeHtml(q.answer)}</li>`)
                    .join("");
            }
            if (sec.type === "true_false") {
                return (sec.questions || [])
                    .map((q) => `<li>${q.answer ? "Prawda" : "Fałsz"}</li>`)
                    .join("");
            }
            if (sec.type === "matching") {
                return (sec.pairs || [])
                    .map(
                        (p) =>
                            `<li>${escapeHtml(p.a)} → ${escapeHtml(p.b)}</li>`,
                    )
                    .join("");
            }
            return "";
        })
        .join("");

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
    body { font-family: Georgia, 'Times New Roman', serif; max-width: 800px; margin: 30px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.5; }
    h1 { font-size: 24px; border-bottom: 3px solid #333; padding-bottom: 8px; }
    h2 { font-size: 17px; margin-top: 28px; color: #333; }
    .quiz-instructions { font-style: italic; color: #555; margin-bottom: 12px; }
    .quiz-section { page-break-inside: avoid; }
    .quiz-question { margin: 10px 0 14px; }
    .quiz-options { margin-left: 18px; }
    .quiz-option { margin: 3px 0; }
    .quiz-matching { display: flex; gap: 60px; }
    .quiz-match-col { padding-left: 20px; }
    .quiz-tf { margin-left: 10px; white-space: nowrap; }
    .quiz-tile { display: inline-block; border: 1px solid #999; border-radius: 6px; padding: 3px 9px; margin: 2px 3px; background: #f4f4f4; }
    .quiz-answer-line { color: #555; margin-top: 6px; }
    .answer-key { page-break-before: always; }
    .answer-key ol { padding-left: 20px; }
    .print-bar { text-align: center; margin: 20px 0; }
    .print-bar button { font-size: 14px; padding: 8px 16px; cursor: pointer; }
    @media print { .print-bar { display: none; } }
</style>
</head>
<body>
    <div class="print-bar"><button onclick="window.print()">🖨️ Drukuj / Zapisz jako PDF</button></div>
    <h1>${title}</h1>
    <p>${words.length} słówek • wygenerowano przez AI (Gemini) • ${dateTag()}</p>
    ${sectionsHtml}
    <section class="answer-key">
        <h2>Klucz odpowiedzi</h2>
        <ol>${answerKeyHtml}</ol>
    </section>
</body>
</html>`;
}

/** Render the quiz JSON as a self-contained interactive HTML page: the user
 * picks/types answers in the browser tab and clicks "Sprawdź" to grade them
 * on the spot (no printing needed). */
function buildInteractiveQuizHtml(quiz, words) {
    const title = escapeHtml(quiz.title || "Quiz językowy");
    const sectionTitles = {
        multiple_choice: "Wielokrotny wybór",
        fill_blank: "Uzupełnij luki",
        matching: "Dopasuj pary",
        translation: "Przetłumacz",
        true_false: "Prawda czy fałsz",
        word_order: "Ułóż zdanie",
        error_correction: "Znajdź i popraw błąd",
        odd_one_out: "Który wyraz nie pasuje?",
    };
    const srcLang = words[0]?.srcLang || "en";
    // Speak icon for on-page TTS (Google Translate voice) — only ever attached to visible text, never to data-answer.
    const ttsIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    const ttsBtn = (text, lang) =>
        text
            ? `<button type="button" class="tts-btn" data-tts-text="${escapeAttr(text)}" data-tts-lang="${escapeAttr(lang)}" onclick="qtSpeak(this)" title="Odczytaj na głos">${ttsIcon}</button>`
            : "";

    let qNum = 0;
    const sectionsHtml = (quiz.sections || [])
        .map((sec) => {
            const heading = sectionTitles[sec.type] || sec.type;
            let body = "";
            if (sec.type === "multiple_choice" || sec.type === "odd_one_out") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const opts = (q.options || [])
                            .map(
                                (o) =>
                                    `<span class="opt-row"><button type="button" class="opt" onclick="selectOpt(this)">${escapeHtml(o)}</button>${ttsBtn(o, srcLang)}</span>`,
                            )
                            .join("");
                        return `<div class="q" data-qtype="choice" data-answer="${escapeAttr(q.answer)}">
                            <p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.question || "")}</p>
                            <div class="opts">${opts}</div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "fill_blank") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "matching") {
                const rightOptions = (sec.pairs || []).map((p) => p.b);
                body =
                    `<div class="matching-grid">` +
                    (sec.pairs || [])
                        .map((p) => {
                            qNum++;
                            const shuffled = [...rightOptions].sort(
                                () => Math.random() - 0.5,
                            );
                            const opts = shuffled
                                .map(
                                    (b) =>
                                        `<option value="${escapeAttr(b)}">${escapeHtml(b)}</option>`,
                                )
                                .join("");
                            return `<div class="q match-row" data-qtype="select" data-answer="${escapeAttr(p.b)}">
                                <span class="match-left">${escapeHtml(p.a)}</span>${ttsBtn(p.a, srcLang)}
                                <select class="q-select" onchange="gradeQuestion(this.closest('.q'))"><option value="">— wybierz —</option>${opts}</select>
                                <span class="q-feedback"></span>
                            </div>`;
                        })
                        .join("") +
                    `</div>`;
            } else if (sec.type === "translation") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.prompt)}</p>${ttsBtn(q.prompt, "pl")}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Twoja odpowiedź… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "true_false") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="choice" data-answer="${q.answer ? "Prawda" : "Fałsz"}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.statement)}</p>${ttsBtn(q.statement, "pl")}</div>
                            <div class="opts">
                                <button type="button" class="opt" onclick="selectOpt(this)">Prawda</button>
                                <button type="button" class="opt" onclick="selectOpt(this)">Fałsz</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "word_order") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        const shuffled = [...(q.words || [])].sort(
                            () => Math.random() - 0.5,
                        );
                        const tiles = shuffled
                            .map(
                                (w) =>
                                    `<span class="tile">${escapeHtml(w)}</span>`,
                            )
                            .join(" ");
                        return `<div class="q" data-qtype="text" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${tiles}</p>${ttsBtn(shuffled.join(" "), srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Ułóż zdanie… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            } else if (sec.type === "error_correction") {
                body = (sec.questions || [])
                    .map((q) => {
                        qNum++;
                        return `<div class="q" data-qtype="text" data-answer="${escapeAttr(q.answer)}">
                            <div class="q-text-row"><p class="q-text"><b>${qNum}.</b> ${escapeHtml(q.sentence)}</p>${ttsBtn(q.sentence, srcLang)}</div>
                            <div class="input-row">
                                <input type="text" class="q-input" placeholder="Popraw zdanie… (Enter = sprawdź)" onkeydown="if(event.key==='Enter'){event.preventDefault();gradeQuestion(this.closest('.q'));}">
                                <button type="button" class="btn-mini" onclick="gradeQuestion(this.closest('.q'))">✓</button>
                            </div>
                            <div class="q-feedback"></div>
                        </div>`;
                    })
                    .join("");
            }
            return `<section class="quiz-section"><h2>${escapeHtml(heading)}</h2><p class="instructions">${escapeHtml(sec.instructions || "")}</p>${body}</section>`;
        })
        .join("");

    return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
    :root { --bg: #f7f7f8; --card: #ffffff; --border: #e2e2e6; --text: #1f2126; --muted: #74767d; --accent: #6d28d9; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 760px; margin: 0 auto; padding: 30px 20px 60px; background: var(--bg); color: var(--text); line-height: 1.5; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    .subtitle { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
    h2 { font-size: 16px; margin: 0 0 4px; color: var(--accent); }
    .instructions { font-style: italic; color: var(--muted); font-size: 13px; margin: 0 0 14px; }
    .quiz-section { margin-bottom: 28px; }
    .q { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; transition: border-color .2s; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .q-text { margin: 0 0 10px; font-size: 14px; }
    .opts { display: flex; flex-wrap: wrap; gap: 8px; }
    .opt { background: #f1f1f4; border: 1px solid var(--border); color: var(--text); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-family: inherit; transition: all .15s; }
    .opt:hover { border-color: var(--accent); }
    .opt.selected { background: rgba(109, 40, 217, 0.1); border-color: var(--accent); color: var(--accent); }
    .q-input, .q-select { width: 100%; padding: 9px 12px; border-radius: 8px; border: 1px solid var(--border); background: #f1f1f4; color: var(--text); font-size: 13px; font-family: inherit; }
    .match-row { display: flex; align-items: center; gap: 12px; }
    .match-left { flex: 1; font-size: 14px; }
    .match-row .q-select { flex: 1; }
    .tile { display: inline-block; border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; margin: 2px 3px; background: #f1f1f4; font-size: 13px; }
    .input-row { display: flex; gap: 8px; }
    .input-row .q-input { flex: 1; }
    .btn-mini { flex: 0 0 auto; background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 0 16px; font-size: 14px; font-weight: 700; cursor: pointer; }
    .opt.opt-correct { background: rgba(22, 163, 74, 0.15) !important; border-color: #16a34a !important; color: #16a34a !important; }
    .opt.opt-incorrect { background: rgba(220, 38, 38, 0.15) !important; border-color: #dc2626 !important; color: #dc2626 !important; }
    .q-feedback { margin-top: 8px; font-size: 12.5px; font-weight: 600; }
    .q.correct { border-color: #16a34a; }
    .q.correct .q-feedback { color: #16a34a; }
    .q.incorrect { border-color: #dc2626; }
    .q.incorrect .q-feedback { color: #dc2626; }
    .actions { display: flex; gap: 10px; margin: 24px 0; }
    .actions button { font-size: 14px; font-weight: 700; padding: 12px 22px; border-radius: 10px; border: none; cursor: pointer; font-family: inherit; }
    .btn-check { background: var(--accent); color: #ffffff; }
    .btn-reset { background: #ffffff; color: var(--text); border: 1px solid var(--border) !important; }
    .score-box { padding: 16px; border-radius: 12px; font-size: 16px; font-weight: 700; text-align: center; }
    .score-box.good { background: rgba(22, 163, 74, 0.1); color: #16a34a; }
    .score-box.mid { background: rgba(217, 119, 6, 0.1); color: #d97706; }
    .score-box.bad { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
    .q-text-row { display: flex; align-items: flex-start; gap: 6px; }
    .q-text-row .q-text { flex: 1; }
    .opt-row { display: inline-flex; align-items: center; gap: 2px; }
    .tts-btn { flex: 0 0 auto; background: none; border: none; color: var(--accent); cursor: pointer; padding: 4px; border-radius: 6px; display: inline-flex; align-items: center; opacity: .75; }
    .tts-btn svg { width: 16px; height: 16px; }
    .tts-btn:hover { opacity: 1; background: rgba(109, 40, 217, 0.1); }
    .tts-btn.tts-loading { opacity: 1; animation: tts-pulse 1s ease-in-out infinite; }
    @keyframes tts-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
</style>
</head>
<body>
    <h1>${title}</h1>
    <p class="subtitle">${words.length} słówek • quiz interaktywny AI (Gemini) • ${dateTag()}</p>
    ${sectionsHtml}
    <div class="actions">
        <button type="button" class="btn-check" onclick="checkAllAnswers()">✅ Sprawdź wszystko i pokaż wynik</button>
        <button type="button" class="btn-reset" onclick="resetQuiz()">🔄 Zacznij od nowa</button>
    </div>
    <div id="scoreBox" class="score-box" style="display:none;"></div>
    <script>
    function selectOpt(btn) {
        var q = btn.closest('.q');
        var opts = q.querySelectorAll('.opt');
        for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected'); }
        btn.classList.add('selected');
        q.dataset.selected = btn.textContent.trim();
        gradeQuestion(q); // instant feedback the moment an option is picked
    }
    function qtSpeak(btn) {
        var text = btn.getAttribute('data-tts-text');
        var lang = btn.getAttribute('data-tts-lang') || 'en';
        if (!text) return;
        btn.classList.add('tts-loading');
        var url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(text);
        var audio = new Audio(url);
        var stop = function () { btn.classList.remove('tts-loading'); };
        audio.addEventListener('ended', stop);
        audio.addEventListener('error', stop);
        audio.play().catch(stop);
    }
    function normalize(s) {
        return (s || '').toString().trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/, '');
    }
    // Grades a single .q element on the spot (called from per-question
    // Enter/✓-button/auto-select triggers as well as the global "check all").
    function gradeQuestion(q) {
        if (!q) return false;
        var type = q.dataset.qtype;
        var answer = q.dataset.answer;
        var userVal = '';
        if (type === 'choice') {
            userVal = q.dataset.selected || '';
        } else if (type === 'text') {
            var input = q.querySelector('.q-input');
            userVal = input ? input.value : '';
        } else if (type === 'select') {
            var sel = q.querySelector('.q-select');
            userVal = sel ? sel.value : '';
        }
        var isCorrect = normalize(userVal) === normalize(answer);
        q.classList.remove('correct', 'incorrect');
        q.classList.add(isCorrect ? 'correct' : 'incorrect');
        var fb = q.querySelector('.q-feedback');
        if (fb) fb.textContent = isCorrect ? '✓ Poprawnie' : ('✗ Poprawna odpowiedź: ' + answer);
        if (type === 'choice') {
            var opts = q.querySelectorAll('.opt');
            for (var i = 0; i < opts.length; i++) {
                opts[i].classList.remove('opt-correct', 'opt-incorrect');
                var optText = opts[i].textContent.trim();
                if (optText === userVal) opts[i].classList.add(isCorrect ? 'opt-correct' : 'opt-incorrect');
                else if (!isCorrect && normalize(optText) === normalize(answer)) opts[i].classList.add('opt-correct');
            }
        }
        return isCorrect;
    }
    function checkAllAnswers() {
        var qs = document.querySelectorAll('.q');
        var total = 0, correct = 0;
        for (var i = 0; i < qs.length; i++) {
            total++;
            if (gradeQuestion(qs[i])) correct++;
        }
        var box = document.getElementById('scoreBox');
        var pct = total ? Math.round((correct / total) * 100) : 0;
        box.style.display = 'block';
        box.textContent = 'Wynik: ' + correct + ' / ' + total + ' (' + pct + '%)';
        box.className = 'score-box ' + (pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'bad');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function resetQuiz() {
        var opts = document.querySelectorAll('.opt');
        for (var i = 0; i < opts.length; i++) { opts[i].classList.remove('selected', 'opt-correct', 'opt-incorrect'); }
        var inputs = document.querySelectorAll('.q-input');
        for (var j = 0; j < inputs.length; j++) { inputs[j].value = ''; }
        var selects = document.querySelectorAll('.q-select');
        for (var k = 0; k < selects.length; k++) { selects[k].value = ''; }
        var qs = document.querySelectorAll('.q');
        for (var m = 0; m < qs.length; m++) {
            qs[m].classList.remove('correct', 'incorrect');
            qs[m].dataset.selected = '';
            var fb = qs[m].querySelector('.q-feedback');
            if (fb) fb.textContent = '';
        }
        document.getElementById('scoreBox').style.display = 'none';
    }
    </script>
</body>
</html>`;
}

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
            loadWords();
            // Delete from Firestore in batch
            if (visibleWords.length > 0) {
                chrome.runtime.sendMessage({
                    type: "QT_FIRESTORE_DELETE_BATCH",
                    words: visibleWords.map((w) => ({
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
    chrome.storage.local.set({ savedWords: updated }, loadWords);
}

// ── Download helper ───────────────────────────────────────────────
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Utils ─────────────────────────────────────────────────────────
function dateTag() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function csvCell(str) {
    if (str.includes(";") || str.includes('"') || str.includes("\n")) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function buildReviewSpeakText(word, sentence) {
    if (!word) return "";
    return sentence ? `${word}. ${sentence}` : word;
}

function highlightReviewSentence(sentence, word, className) {
    if (!sentence) return "";
    const escapedSentence = escapeHtml(sentence);
    const escapedWord = escapeHtml(word || "");
    if (!escapedWord) return escapedSentence;
    const regex = new RegExp(
        `(${escapedWord.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")})`,
        "i",
    );
    return escapedSentence.replace(
        regex,
        `<span class="${className}">$1</span>`,
    );
}

// Only speak automatically when the user is actually looking at the
// Review tab. Without this guard, any background refresh of the review
// queue (e.g. after a Firebase sync completes on the Sync tab) would
// still render the next due card and read it aloud, even though the
// user never opened the Review tab.
function isReviewTabActive() {
    return !!document
        .getElementById("tab-review")
        ?.classList.contains("active");
}

function autoSpeakReviewCard(w, answerVisible = false) {
    if (!w || !isReviewTabActive()) return;
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";
    if (!answerVisible) {
        const questionWord = isReverse ? w.translated : w.original;
        const questionSentence = isReverse
            ? w.sentenceTranslated || ""
            : w.sentence || "";
        const questionLang = isReverse ? tgtL : srcL;
        popupSpeak(
            buildReviewSpeakText(questionWord, questionSentence),
            questionLang,
        ).catch(() => {});
    } else {
        const answerWord = isReverse ? w.original : w.translated;
        const answerSentence = isReverse
            ? w.sentence || ""
            : w.sentenceTranslated || "";
        const answerLang = isReverse ? srcL : tgtL;
        popupSpeak(
            buildReviewSpeakText(answerWord, answerSentence),
            answerLang,
        ).catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════════
//  SPACED REPETITION  –  Anki SM-2 Algorithm (4 grades)
// ═══════════════════════════════════════════════════════════════════

/**
 * Anki SM-2 implementation.
 * Grade 1: Powtórz (Again)
 * Grade 2: Trudne (Hard)
 * Grade 3: Dobre (Good)
 * Grade 4: Łatwe (Easy)
 */
function srUpdate(sr, grade) {
    let { interval = 0, reps = 0, easeFactor = 2.5 } = sr;

    if (grade === 1) {
        reps = 0;
        interval = 1 / (24 * 60); // 1 minute
        easeFactor = Math.max(1.3, easeFactor - 0.2);
    } else if (grade === 2) {
        interval = reps === 0 ? 10 / (24 * 60) : interval * 1.2; // 10 minutes if new, else 20% increase
        easeFactor = Math.max(1.3, easeFactor - 0.15);
    } else if (grade === 3) {
        if (reps === 0)
            interval = 10 / (24 * 60); // 10 mins
        else if (reps === 1)
            interval = 1; // 1 day
        else interval = interval * easeFactor;
        reps++;
    } else if (grade === 4) {
        // Easy always graduates immediately (like grade 3 does at reps 0/1),
        // never falls back to interval*easeFactor while still in early
        // learning steps — otherwise it could yield a *shorter* interval than
        // "Dobre" when the stored interval from a prior review was still tiny.
        if (reps <= 1)
            interval = 4; // 4 days
        else interval = interval * easeFactor * 1.3;
        easeFactor += 0.15;
        reps++;
    }

    return {
        interval,
        reps,
        easeFactor,
        nextReview: Date.now() + interval * 24 * 60 * 60 * 1000,
        lastReview: Date.now(),
    };
}

/** Preview what the next review time label will be for a given grade */
function previewLabel(sr, grade) {
    const nextSr = srUpdate(sr, grade);
    const days = nextSr.interval;
    const mins = Math.round(days * 24 * 60);
    if (mins < 60) return formatIntervalMinutes(mins);
    return formatIntervalDays(days);
}

function formatIntervalDays(days) {
    if (days < 1) {
        const h = Math.round(days * 24);
        return `${h}h`;
    }
    if (days <= 1) return "1 dzień";
    if (days < 7) return `${days} dni`;
    if (days === 7) return "1 tydz.";
    if (days < 30) {
        const w = Math.round(days / 7);
        return w === 1 ? "1 tydz." : `${w} tyg.`;
    }
    if (days === 30) return "1 mies.";
    const m = Math.round(days / 30);
    return m === 1 ? "1 mies." : `${m} mies.`;
}

function formatIntervalMinutes(mins) {
    if (mins < 60) return `${mins} min`;
    const h = Math.round(mins / 60);
    return h === 1 ? "1 godz." : `${h} godz.`;
}

// ── Review state ──────────────────────────────────────────────────
let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswerShown = false;
let reviewTotalDue = 0;
let _reviewSaving = false; // guard: skip storage listener while rating
let _reviewQueueStale = false; // set when a background sync happens mid-session

// ── Default SR data for words that don't have it ──────────────────
function ensureSR(word) {
    if (!word.sr) {
        word.sr = {
            interval: 0,
            reps: 0,
            easeFactor: 2.5,
            nextReview: 0,
            lastReview: null,
        };
    }
    // Migrate old step-based format → Anki SM-2 format
    if (word.sr.step !== undefined) {
        const oldIntervalDays = word.sr.interval || 0;
        word.sr = {
            interval: oldIntervalDays,
            reps: oldIntervalDays > 0 ? 1 : 0, // Roughly guess reps
            easeFactor: 2.5,
            nextReview: word.sr.nextReview || 0,
            lastReview: word.sr.lastReview || null,
        };
    }
    return word;
}

// ── Review direction: "normal" = show original, guess translation
//                      "reverse" = show translation, guess original
let reviewDirection = "normal";

// Load saved direction from storage
chrome.storage.sync.get({ reviewDirection: "normal" }, (data) => {
    reviewDirection = data.reviewDirection;
    updateDirBtnLabel();
});

// ── Direction toggle button ───────────────────────────────────────
function updateDirBtnLabel() {
    const btn = document.getElementById("reviewDirBtn");
    if (!btn) return;
    if (reviewDirection === "normal") {
        btn.innerHTML = 'EN <span class="dir-arrow">→</span> PL';
    } else {
        btn.innerHTML = 'PL <span class="dir-arrow">→</span> EN';
    }
}

document.getElementById("reviewDirBtn")?.addEventListener("click", () => {
    reviewDirection = reviewDirection === "normal" ? "reverse" : "normal";
    chrome.storage.sync.set({ reviewDirection }, flashSaved);
    updateDirBtnLabel();
    // Restart current card without changing queue position
    reviewAnswerShown = false;
    renderReview();
});

// ── Delete all reviews button ─────────────────────────────────────
document.getElementById("reviewDeleteAll")?.addEventListener("click", () => {
    deleteAllReviews();
});

// ── Load due reviews ──────────────────────────────────────────────
function loadReviewQueue() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const now = Date.now();

        reviewQueue = words.filter((w) => isDueForReview(w, now)).map(ensureSR);

        // Shuffle
        for (let i = reviewQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reviewQueue[i], reviewQueue[j]] = [reviewQueue[j], reviewQueue[i]];
        }

        reviewTotalDue = reviewQueue.length;
        reviewIndex = 0;
        reviewAnswerShown = false;
        _reviewQueueStale = false;
        renderReview();
    });
}

// ── Refresh the review queue without interrupting an active session ──
// Background/Firebase sync can update `savedWords` at any time (every few
// seconds after rating a card, or on a periodic timer). If we naively
// reload+reshuffle the queue on every such change, the card the user is
// currently reading gets yanked out from under them. Instead, defer the
// reload until it's actually safe: when the review tab isn't open, or the
// current session has already finished.
function maybeRefreshReviewQueue() {
    const reviewTabActive = document
        .getElementById("tab-review")
        ?.classList.contains("active");
    const sessionInProgress =
        reviewTabActive &&
        reviewQueue.length > 0 &&
        reviewIndex < reviewQueue.length;

    if (sessionInProgress) {
        _reviewQueueStale = true;
        return;
    }
    loadReviewQueue();
}

// ── Badge on review tab ───────────────────────────────────────────
function updateReviewTabBadge(count) {
    const tab = document.getElementById("tabReview");
    if (!tab) return;
    if (count > 0) {
        tab.innerHTML = `🧠 Powtórki <span class="tab-badge">${count}</span>`;
    } else {
        tab.textContent = "🧠 Powtórki";
    }
}

// ── On popup open → load badge count ──────────────────────────────
function initReviewBadge() {
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = countDueWords(words, now);
        updateReviewTabBadge(dueCount);
    });
}
initReviewBadge();

// ── SVG icons for review TTS buttons ──────────────────────────────
const SPEAK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;

// ── TTS for popup (respects user settings: Browser / ElevenLabs) ──
let popupElAudio = null;

function cleanTextForPopupTTS(text) {
    return text
        .replace(/#/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function pickPopupVoice(savedVoiceName, lang) {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    if (savedVoiceName) {
        const exact = voices.find((v) => v.name === savedVoiceName);
        if (exact) return exact;
    }
    const baseLang = (lang || "en").split("-")[0].toLowerCase();
    const langVoices = voices.filter((v) =>
        v.lang.toLowerCase().startsWith(baseLang),
    );
    if (!langVoices.length) return null;
    const patterns = [
        /microsoft\s+(aria|jenny).*natural/i,
        /microsoft\s+(aria|jenny)/i,
        /natural/i,
        /neural/i,
        /online/i,
        /enhanced/i,
        /premium/i,
        /microsoft.*(guy|ana|christopher|eric|michelle|steffan)/i,
        /google\s+u[sk]/i,
        /google/i,
    ];
    for (const p of patterns) {
        const m = langVoices.find((v) => p.test(v.name));
        if (m) return m;
    }
    return langVoices.find((v) => !v.localService) || langVoices[0];
}

// Monotonic token: lets an in-flight (async) popupSpeak call detect that a
// newer call has superseded it, so a stale card's audio never starts after
// the user already moved on to a different card.
let popupSpeakSeq = 0;

/** Immediately stop any in-progress popup TTS (utterance or audio). */
function stopPopupSpeak() {
    popupSpeakSeq++;
    window.speechSynthesis.cancel();
    if (popupElAudio) {
        popupElAudio.pause();
        popupElAudio = null;
    }
}

/**
 * Speak text using the same engine & voice configured in settings.
 * Returns a Promise that resolves with { type: 'utter'|'audio', obj } for end-tracking.
 */
function popupSpeak(text, lang) {
    const mySeq = ++popupSpeakSeq;
    window.speechSynthesis.cancel();
    if (popupElAudio) {
        popupElAudio.pause();
        popupElAudio = null;
    }

    return new Promise((resolve) => {
        chrome.storage.sync.get(
            {
                ttsMode: "browser",
                elApiKey: "",
                elVoiceId: "",
                speechVoice: "",
                ttsVolume: 1,
            },
            async (data) => {
                if (mySeq !== popupSpeakSeq) {
                    resolve({ type: "none", obj: null });
                    return;
                }
                const volume =
                    data.ttsVolume !== undefined ? data.ttsVolume : 1;

                // ElevenLabs path
                if (
                    data.ttsMode === "elevenlabs" &&
                    data.elApiKey &&
                    data.elVoiceId
                ) {
                    try {
                        const res = await fetch(
                            `https://api.elevenlabs.io/v1/text-to-speech/${data.elVoiceId}`,
                            {
                                method: "POST",
                                headers: {
                                    "xi-api-key": data.elApiKey,
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    text: cleanTextForPopupTTS(text),
                                    model_id: "eleven_multilingual_v2",
                                    voice_settings: {
                                        stability: 0.5,
                                        similarity_boost: 0.75,
                                    },
                                }),
                            },
                        );
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        const blob = await res.blob();
                        if (mySeq !== popupSpeakSeq) {
                            resolve({ type: "none", obj: null });
                            return;
                        }
                        const url = URL.createObjectURL(blob);
                        popupElAudio = new Audio(url);
                        popupElAudio.volume = volume;
                        popupElAudio.play();
                        resolve({ type: "audio", obj: popupElAudio });
                    } catch (err) {
                        console.warn(
                            "[Lectoro] ElevenLabs popup TTS failed:",
                            err,
                        );
                        resolve({ type: "none", obj: null });
                    }
                    return;
                }
                // Browser SpeechSynthesis path
                const utter = new SpeechSynthesisUtterance(
                    cleanTextForPopupTTS(text),
                );
                utter.lang = lang || "en";
                // Review TTS always speaks at normal speed, regardless of the rate setting
                utter.rate = 1;
                utter.volume = volume;
                const voice = pickPopupVoice(data.speechVoice, lang);
                if (voice) utter.voice = voice;
                window.speechSynthesis.speak(utter);
                resolve({ type: "utter", obj: utter });
            },
        );
    });
}

// ── Attach TTS handlers to all .review-speak-btn in card ──────────
function attachReviewSpeakHandlers(card) {
    card.querySelectorAll(".review-speak-btn").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            btn.classList.add("speaking");
            const done = () => btn.classList.remove("speaking");
            try {
                const result = await popupSpeak(
                    btn.dataset.text,
                    btn.dataset.lang,
                );
                if (result.type === "utter") {
                    result.obj.onend = done;
                    result.obj.onerror = done;
                } else if (result.type === "audio") {
                    result.obj.onended = done;
                    result.obj.onerror = done;
                } else {
                    done();
                }
            } catch {
                done();
            }
            setTimeout(done, 8000); // safety fallback
        });
    });
}

// ── Render review card ────────────────────────────────────────────
function renderReview() {
    const card = document.getElementById("reviewCard");
    const countEl = document.getElementById("reviewCount");
    const progressBar = document.getElementById("reviewProgressBar");
    const deleteAllBtn = document.getElementById("reviewDeleteAll");

    if (reviewQueue.length === 0) {
        countEl.textContent = "";
        progressBar.style.width = "100%";
        if (deleteAllBtn) deleteAllBtn.style.display = "none";
        card.innerHTML = `
            <div class="review-empty">
                <div class="review-empty-icon">✅</div>
                <div class="review-empty-text">Brak słów do powtórki!</div>
                <div class="review-empty-sub">Dodaj nowe słowa lub wróć później.</div>
            </div>`;
        updateReviewTabBadge(0);
        return;
    }

    if (deleteAllBtn) deleteAllBtn.style.display = "";

    if (reviewIndex >= reviewQueue.length) {
        // Session just finished – now it's safe to pull in any words that
        // synced in while the user was reviewing, without disrupting them.
        if (_reviewQueueStale) {
            _reviewQueueStale = false;
            loadReviewQueue();
            return;
        }
        countEl.textContent = `${reviewTotalDue}/${reviewTotalDue}`;
        progressBar.style.width = "100%";
        card.innerHTML = `
            <div class="review-done">
                <div class="review-done-icon">🎉</div>
                <div class="review-done-text">Gratulacje!</div>
                <div class="review-done-sub">Wykonałeś wszystkie ${reviewTotalDue} powtórek na teraz!</div>
            </div>`;
        updateReviewTabBadge(0);
        return;
    }

    const w = reviewQueue[reviewIndex];
    countEl.textContent = `${reviewIndex + 1}/${reviewTotalDue}`;
    progressBar.style.width = `${Math.round((reviewIndex / reviewTotalDue) * 100)}%`;

    if (!reviewAnswerShown) {
        const srcL = w.srcLang || "en";
        const tgtL = w.tgtLang || "pl";
        const isReverse = reviewDirection === "reverse";
        const showWord = isReverse ? w.translated : w.original;
        const showLang = isReverse ? tgtL : srcL;
        const showSentence = isReverse
            ? w.sentenceTranslated || ""
            : w.sentence || "";
        const wordClass = isReverse ? "__qt_translated" : "__qt_original";
        const sentenceHtml = showSentence
            ? `
                <div class="review-context-row">
                    <span class="review-context">"${highlightReviewSentence(
                        showSentence,
                        showWord,
                        wordClass,
                    )}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(
                        showSentence,
                    )}" data-lang="${escapeAttr(showLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
            : "";
        card.innerHTML = `
            <div class="review-flashcard">
                <div class="review-question">
                    <div class="review-word-row">
                        <span class="review-word ${wordClass}">${escapeHtml(showWord)}</span>
                        <button class="review-speak-btn" data-text="${escapeAttr(
                            buildReviewSpeakText(showWord, showSentence),
                        )}" data-lang="${escapeAttr(showLang)}" title="Odczytaj">${SPEAK_SVG}</button>
                    </div>
                    ${sentenceHtml}
                    ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
                </div>
            </div>
            <button class="review-reveal-btn" id="revealBtn">▸ Pokaż odpowiedź</button>
            <div class="review-hint">Naciśnij <kbd>Spacja</kbd> aby odsłonić</div>`;

        attachReviewSpeakHandlers(card);
        autoSpeakReviewCard(w, false);
        document
            .getElementById("revealBtn")
            .addEventListener("click", revealAnswer);
    } else {
        renderAnswer(w);
    }
}

function revealAnswer() {
    reviewAnswerShown = true;
    renderAnswer(reviewQueue[reviewIndex]);
}

function renderAnswer(w) {
    const card = document.getElementById("reviewCard");
    const sr = w.sr || { step: 0, interval: 0 };
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";

    // In reverse mode: question=translated, answer=original
    const qWord = isReverse ? w.translated : w.original;
    const qLang = isReverse ? tgtL : srcL;
    const qSentence = isReverse ? w.sentenceTranslated || "" : w.sentence || "";
    const aWord = isReverse ? w.original : w.translated;
    const aLang = isReverse ? srcL : tgtL;
    const aSentence = isReverse ? w.sentence || "" : w.sentenceTranslated || "";
    const qWordClass = isReverse ? "__qt_translated" : "__qt_original";
    const aWordClass = isReverse ? "__qt_original" : "__qt_translated";

    // Preview labels for each grade
    const labels = [1, 2, 3, 4].map((g) => previewLabel(sr, g));

    card.innerHTML = `
        <div class="review-flashcard">
            <div class="review-question">
                <div class="review-word-row">
                    <span class="review-word ${qWordClass}">${escapeHtml(qWord)}</span>
                    <button class="review-speak-btn" data-text="${escapeAttr(
                        buildReviewSpeakText(qWord, qSentence),
                    )}" data-lang="${escapeAttr(qLang)}" title="Odczytaj">${SPEAK_SVG}</button>
                </div>
                ${
                    qSentence
                        ? `
                <div class="review-context-row">
                    <span class="review-context">"${highlightReviewSentence(
                        qSentence,
                        qWord,
                        qWordClass,
                    )}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(qSentence)}" data-lang="${escapeAttr(qLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
                        : ""
                }
                ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
            </div>
            <div class="review-divider-main"></div>
            <div class="review-answer-inline">
                <div class="review-translation-row">
                    <span class="review-translation ${aWordClass}">${escapeHtml(aWord)}</span>
                    <button class="review-speak-btn" data-text="${escapeAttr(
                        buildReviewSpeakText(aWord, aSentence),
                    )}" data-lang="${escapeAttr(aLang)}" title="Odczytaj tłumaczenie">${SPEAK_SVG}</button>
                </div>
                ${
                    aSentence
                        ? `
                <div class="review-divider"></div>
                <div class="review-sentence-trans-row">
                    <span class="review-sentence-trans">"${highlightReviewSentence(
                        aSentence,
                        aWord,
                        aWordClass,
                    )}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(aSentence)}" data-lang="${escapeAttr(aLang)}" title="Odczytaj tłumaczenie zdania">${SPEAK_SVG}</button>
                </div>`
                        : ""
                }
            </div>
        </div>
        <div class="review-rating">
            <div class="review-rating-label">Jak dobrze zrozumiałeś?</div>
            <div class="review-rating-buttons">
                <button class="review-rate-btn rate-1" data-grade="1" title="Powtórz (Again)">
                    <span class="rate-key">1</span>
                    <span class="rate-label">Powtórz</span>
                    <span class="review-next-info">${labels[0]}</span>
                </button>
                <button class="review-rate-btn rate-2" data-grade="2" title="Trudne (Hard)">
                    <span class="rate-key">2</span>
                    <span class="rate-label">Trudne</span>
                    <span class="review-next-info">${labels[1]}</span>
                </button>
                <button class="review-rate-btn rate-3" data-grade="3" title="Dobre (Good)">
                    <span class="rate-key">3</span>
                    <span class="rate-label">Dobre</span>
                    <span class="review-next-info">${labels[2]}</span>
                </button>
                <button class="review-rate-btn rate-4" data-grade="4" title="Łatwe (Easy)">
                    <span class="rate-key">4</span>
                    <span class="rate-label">Łatwe</span>
                    <span class="review-next-info">${labels[3]}</span>
                </button>
            </div>
            <div class="review-hint">Klawisze od <kbd>1</kbd>-<kbd>4</kbd> = ocena</div>
        </div>
        <div class="review-actions-row">
            <button class="review-edit-btn" id="reviewEditBtn">✏️ Edytuj</button>
            <button class="review-delete-btn" id="reviewDeleteBtn">🗑 Usuń</button>
        </div>`;

    // Attach TTS handlers
    attachReviewSpeakHandlers(card);
    autoSpeakReviewCard(w, true);

    // Scroll straight to the answer so it's visible even when a screenshot
    // pushes it below the fold (re-run once the screenshot finishes loading,
    // since its height isn't known until then).
    const scrollToAnswer = () => {
        const answerEl = card.querySelector(".review-answer-inline");
        if (answerEl)
            answerEl.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    requestAnimationFrame(scrollToAnswer);
    const shotImg = card.querySelector(".review-screenshot-img");
    if (shotImg && !shotImg.complete) {
        shotImg.addEventListener("load", scrollToAnswer, { once: true });
    }

    // Attach rating handlers
    card.querySelectorAll(".review-rate-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            rateWord(parseInt(btn.dataset.grade));
        });
    });

    // Edit button
    document.getElementById("reviewEditBtn").addEventListener("click", () => {
        showReviewEditForm(w);
    });

    // Delete button
    document.getElementById("reviewDeleteBtn").addEventListener("click", () => {
        deleteReviewWord(w);
    });
}

// ── Edit form in review ───────────────────────────────────────────
function showReviewEditForm(w) {
    const card = document.getElementById("reviewCard");
    card.innerHTML = `
        <div class="review-edit-form">
            <label>Oryginał</label>
            <input type="text" id="editOriginal" value="${escapeAttr(w.original)}">
            <label>Tłumaczenie</label>
            <input type="text" id="editTranslated" value="${escapeAttr(w.translated)}">
            <label>Zdanie (oryginał)</label>
            <input type="text" id="editSentence" value="${escapeAttr(w.sentence || "")}">
            <label>Zdanie (tłumaczenie)</label>
            <input type="text" id="editSentenceTr" value="${escapeAttr(w.sentenceTranslated || "")}">
            <div class="review-edit-actions">
                <button class="review-edit-cancel" id="editCancel">Anuluj</button>
                <button class="review-edit-save" id="editSave">💾 Zapisz</button>
            </div>
        </div>`;

    document.getElementById("editCancel").addEventListener("click", () => {
        renderAnswer(w);
    });

    document.getElementById("editSave").addEventListener("click", () => {
        const newOriginal = document
            .getElementById("editOriginal")
            .value.trim();
        const newTranslated = document
            .getElementById("editTranslated")
            .value.trim();
        const newSentence = document
            .getElementById("editSentence")
            .value.trim();
        const newSentenceTr = document
            .getElementById("editSentenceTr")
            .value.trim();
        if (!newOriginal || !newTranslated) return;

        // Keep old keys for finding in storage
        const oldOriginal = w.original;
        const oldTranslated = w.translated;

        // Update queue object in-place
        w.original = newOriginal;
        w.translated = newTranslated;
        w.sentence = newSentence;
        w.sentenceTranslated = newSentenceTr;

        // Persist to storage (updates word list too)
        chrome.storage.local.get({ savedWords: [] }, (data) => {
            const words = data.savedWords || [];
            const idx = words.findIndex(
                (x) =>
                    x.original === oldOriginal &&
                    x.translated === oldTranslated,
            );
            if (idx !== -1) {
                words[idx].original = newOriginal;
                words[idx].translated = newTranslated;
                words[idx].sentence = newSentence;
                words[idx].sentenceTranslated = newSentenceTr;
                words[idx].updatedAt = Date.now();
                chrome.storage.local.set({ savedWords: words }, () => {
                    renderAnswer(w);
                });
            } else {
                renderAnswer(w);
            }
        });
    });

    // Focus first field
    document.getElementById("editOriginal").focus();
}

// ── Rate word & update storage ────────────────────────────────────
function rateWord(grade) {
    stopPopupSpeak(); // cut off any card audio immediately, don't wait for the save round-trip
    const w = reviewQueue[reviewIndex];
    ensureSR(w);

    // Apply SR update
    w.sr = srUpdate(w.sr, grade);

    // Track session attempts per word (max 3 views, then move on)
    w._sessionAttempts = (w._sessionAttempts || 0) + 1;

    // Persist
    _reviewSaving = true;
    chrome.storage.local.get({ savedWords: [] }, (data) => {
        const words = data.savedWords || [];
        const idx = words.findIndex(
            (x) => x.original === w.original && x.translated === w.translated,
        );
        if (idx !== -1) {
            words[idx].sr = w.sr;
            words[idx].updatedAt = Date.now();
            chrome.storage.local.set({ savedWords: words }, () => {
                _reviewSaving = false;
                if (grade === 1 && w._sessionAttempts < 3) {
                    // Grade 1 (Again): re-insert word later in the queue
                    // so it comes back again in this session (max 3 attempts)
                    reviewQueue.splice(reviewIndex, 1);
                    // Insert a few cards later (or at end if queue is short)
                    const insertAt = Math.min(
                        reviewIndex + 2 + Math.floor(Math.random() * 3),
                        reviewQueue.length,
                    );
                    reviewQueue.splice(insertAt, 0, w);
                    // Don't increment reviewIndex – current index now has next word
                    reviewTotalDue = reviewQueue.length;
                } else {
                    // Grade 2-4 or max attempts reached: word is done, advance
                    reviewIndex++;
                }
                reviewAnswerShown = false;
                renderReview();
            });
        } else {
            // word may have been deleted – just advance
            _reviewSaving = false;
            reviewIndex++;
            reviewAnswerShown = false;
            renderReview();
        }
    });
}

// ── Keyboard shortcuts for review (1-4 = rate, Space = reveal) ───
document.addEventListener("keydown", (e) => {
    const reviewTab = document.getElementById("tab-review");
    if (!reviewTab || !reviewTab.classList.contains("active")) return;
    if (reviewIndex >= reviewQueue.length || reviewQueue.length === 0) return;

    if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (!reviewAnswerShown) {
            revealAnswer();
        } else {
            const w = reviewQueue[reviewIndex];
            const srcL = w.srcLang || "en";
            const tgtL = w.tgtLang || "pl";
            const isReverse = reviewDirection === "reverse";
            const aWord = isReverse ? w.original : w.translated;
            const aSentence = isReverse
                ? w.sentence || ""
                : w.sentenceTranslated || "";
            const aLang = isReverse ? srcL : tgtL;
            const text = buildReviewSpeakText(aWord, aSentence);
            if (text) {
                popupSpeak(text, aLang).catch(() => {});
            }
        }
    }

    if (reviewAnswerShown && e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        rateWord(parseInt(e.key));
    }

    if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        autoSpeakReviewCard(reviewQueue[reviewIndex], reviewAnswerShown);
    }
});
