// popup.js – Settings, saved words list, filtering & export (Anki / CSV)

const { escapeHtml, escapeAttr, isDueForReview, countDueWords } = SharedUtils;
const {
    update: srUpdate,
    previewLabel,
    formatIntervalDays,
    formatIntervalMinutes,
    ensure: ensureSR,
} = SRS; // shared/srs.js

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
        if (tab.dataset.tab === "library") renderLibraryGrid();
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

        // Czyszczenie i dodanie opcji losowania
        elVoiceSelect.innerHTML =
            '<option value="random">🎲 Losowy głos</option>';

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
let wordSearchQuery = "";

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

const wordSearchInput = document.getElementById("wordSearch");
wordSearchInput?.addEventListener("input", (e) => {
    wordSearchQuery = e.target.value;
    loadWords();
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
    let result;
    switch (currentFilter) {
        case "today":
            result = words.filter((w) => w.timestamp >= startOfDay());
            break;
        case "week":
            result = words.filter((w) => w.timestamp >= startOfWeek());
            break;
        case "month":
            result = words.filter((w) => w.timestamp >= startOfMonth());
            break;
        case "new":
            result = words.filter((w) => !w.downloaded);
            break;
        default:
            result = words;
    }

    const q = wordSearchQuery.trim().toLowerCase();
    if (q) {
        result = result.filter((w) => {
            return (
                (w.original || "").toLowerCase().includes(q) ||
                (w.translated || "").toLowerCase().includes(q) ||
                (w.sentence || "").toLowerCase().includes(q) ||
                (w.sentenceTranslated || "").toLowerCase().includes(q)
            );
        });
    }

    return result;
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
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słowa:",
                    chrome.runtime.lastError.message,
                );
            }
            loadWords();
            // Delete from Firestore (fire-and-forget via background)
            if (wordToDelete) {
                chrome.runtime.sendMessage({
                    type: "QT_FIRESTORE_DELETE",
                    word: {
                        id: wordToDelete.id,
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
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słowa:",
                    chrome.runtime.lastError.message,
                );
            }
            // Delete from Firestore
            chrome.runtime.sendMessage({
                type: "QT_FIRESTORE_DELETE",
                word: {
                    id: w.id,
                    original: w.original,
                    translated: w.translated,
                },
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
            if (chrome.runtime.lastError) {
                console.error(
                    "[Lectoro] Nie udało się usunąć słów:",
                    chrome.runtime.lastError.message,
                );
            }
            // Delete from Firestore in batch
            chrome.runtime.sendMessage({
                type: "QT_FIRESTORE_DELETE_BATCH",
                words: dueWords.map((w) => ({
                    id: w.id,
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
//  SPACED REPETITION  –  see shared/srs.js for the Anki SM-2 algorithm
// ═══════════════════════════════════════════════════════════════════

// ── Review state ──────────────────────────────────────────────────
let reviewQueue = [];
let reviewIndex = 0;
let reviewAnswerShown = false;
let reviewTotalDue = 0;
let _reviewSaving = false; // guard: skip storage listener while rating
let _reviewQueueStale = false; // set when a background sync happens mid-session

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
    const badge =
        count > 0
            ? `<span class="tab-badge">${count > 99 ? "99+" : count}</span>`
            : "";
    tab.innerHTML = `<span class="tab-icon">🧠</span><span class="tab-label">Powtórki</span>${badge}`;
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

// Mirrors core.js's pickBestVoice: the settings UI (voiceSelect) only ever
// lists Google voices, so the fallback here must also be restricted to
// Google voices — otherwise, if the saved name doesn't match (e.g. voices
// not loaded yet on this page) or "Domyślny" is selected, this used to fall
// back to whatever random system/Microsoft voice was installed, which
// sounded completely different from the Google voice heard during video
// playback and in the settings preview.
function pickPopupVoice(savedVoiceName, lang) {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    const googleVoices = voices.filter((v) => /google/i.test(v.name));

    if (savedVoiceName) {
        const exact = googleVoices.find((v) => v.name === savedVoiceName);
        if (exact) return exact;
    }

    const baseLang = (lang || "en").split("-")[0].toLowerCase();
    const langVoices = googleVoices.filter((v) =>
        v.lang.toLowerCase().startsWith(baseLang),
    );
    if (!langVoices.length) return null;

    return langVoices[0];
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
                let elFailed = false;
                if (
                    data.ttsMode === "elevenlabs" &&
                    data.elApiKey &&
                    data.elVoiceId
                ) {
                    try {
                        let targetVoiceId = data.elVoiceId;

                        // Pobierz listę głosów i wylosuj jeden, jeśli wybrano tryb losowy
                        if (targetVoiceId === "random") {
                            const voicesRes = await fetch(
                                "https://api.elevenlabs.io/v1/voices",
                                {
                                    headers: { "xi-api-key": data.elApiKey },
                                },
                            );
                            if (voicesRes.ok) {
                                const voicesData = await voicesRes.json();
                                const voices = voicesData.voices || [];
                                if (voices.length > 0) {
                                    const randomVoice =
                                        voices[
                                            Math.floor(
                                                Math.random() * voices.length,
                                            )
                                        ];
                                    targetVoiceId = randomVoice.voice_id;
                                }
                            }
                        }

                        if (mySeq !== popupSpeakSeq) {
                            resolve({ type: "none", obj: null });
                            return;
                        }

                        const res = await fetch(
                            `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`,
                            {
                                method: "POST",
                                headers: {
                                    "xi-api-key": data.elApiKey,
                                    "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                    text: cleanTextForPopupTTS(text),
                                    model_id: "eleven_flash_v2_5",
                                    voice_settings: {
                                        stability: 0.5,
                                        similarity_boost: 0.75,
                                    },
                                }),
                            },
                        );
                        if (!res.ok) {
                            let reason = `HTTP ${res.status}`;
                            try {
                                const errData = await res.json();
                                const detail = errData?.detail;
                                const status =
                                    typeof detail === "object"
                                        ? detail?.status
                                        : undefined;
                                if (status === "quota_exceeded")
                                    reason = "skończyły się kredyty";
                                else if (res.status === 401)
                                    reason = "nieprawidłowy klucz API";
                                else if (
                                    typeof detail === "object" &&
                                    detail?.message
                                )
                                    reason = detail.message;
                            } catch {
                                /* keep default reason */
                            }
                            throw new Error(reason);
                        }
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
                        return;
                    } catch (err) {
                        console.warn(
                            "[Lectoro] ElevenLabs popup TTS failed:",
                            err.message || err,
                        );
                        if (elStatusEl) {
                            elStatusEl.textContent = `✗ ElevenLabs: ${err.message}`;
                            elStatusEl.className = "el-status err";
                        }
                        elFailed = true;
                    }
                }
                // Browser SpeechSynthesis path (default, or fallback when
                // ElevenLabs failed above — never leaves playback silent).
                if (elFailed) void 0; // fallthrough intentional
                const utter = new SpeechSynthesisUtterance(
                    cleanTextForPopupTTS(text),
                );
                utter.lang = lang || "en";
                // Review TTS always speaks at normal speed (1.0), regardless
                // of the Settings speed slider — that slider only affects
                // in-video subtitle TTS. Voice and volume still follow
                // Settings so the review card sounds like the same voice
                // the user picked, just always at a natural pace.
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
        renderQuestion(w);
    } else {
        renderAnswer(w);
    }
}

// ── Question (front) side ──────────────────────────────────────────
function renderQuestion(w) {
    const card = document.getElementById("reviewCard");
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
            <div class="review-hint"><kbd>↓</kbd>/<kbd>S</kbd> odwróć &nbsp; <kbd>↑</kbd>/<kbd>W</kbd> czytaj &nbsp; <kbd>←</kbd>/<kbd>A</kbd> nie znam &nbsp; <kbd>→</kbd>/<kbd>D</kbd> znam &nbsp; <kbd>Enter</kbd> tłumacz AI</div>`;

    attachReviewSpeakHandlers(card);
    autoSpeakReviewCard(w, false);
    document.getElementById("revealBtn").addEventListener("click", flipCard);

    // Every new card must always start fully scrolled to the top — force
    // the scrollable card container itself back to 0 rather than relying
    // on scrollIntoView, which (due to the flex "safe center" alignment)
    // could leave a small residual offset instead of a true top position.
    const scrollToTop = () => {
        card.scrollTop = 0;
    };
    scrollToTop();
    requestAnimationFrame(scrollToTop);
    const qShotImg = card.querySelector(".review-screenshot-img");
    if (qShotImg && !qShotImg.complete) {
        qShotImg.addEventListener("load", scrollToTop, { once: true });
    }
}

/**
 * Flip the flashcard in place — toggles between question (front) and
 * answer (back) every time it's called, exactly like flipping a real
 * paper flashcard back and forth as many times as you want, instead of
 * only ever revealing the answer once.
 */
function flipCard() {
    const card = document.getElementById("reviewCard");
    const flashcard = card?.querySelector(".review-flashcard");
    const w = reviewQueue[reviewIndex];
    if (!w) return;

    const showNext = () => {
        reviewAnswerShown = !reviewAnswerShown;
        if (reviewAnswerShown) {
            renderAnswer(w);
        } else {
            renderQuestion(w);
        }
        const newFlashcard = card.querySelector(".review-flashcard");
        newFlashcard?.classList.add("qt-flip-in");
    };

    // Real flashcard "flip" feel: rotate the current face away, then swap
    // in the other side's content rotated in from the opposite direction.
    if (flashcard) {
        flashcard.classList.add("qt-flip-out");
        setTimeout(showNext, 150);
    } else {
        showNext();
    }
}

// Backwards-compatible alias (kept in case anything still calls it by name).
function revealAnswer() {
    flipCard();
}

/** Swipe the current card off-screen (like a real flashcard being tossed
 * left/right) before applying the grade and loading the next card. */
function animateSwipeAndRate(grade) {
    const card = document.getElementById("reviewCard");
    const flashcard = card?.querySelector(".review-flashcard");
    const rating = card?.querySelector(".review-rating");
    const actions = card?.querySelector(".review-actions-row");

    if (flashcard) {
        flashcard.classList.add(
            grade === 1 ? "qt-swipe-left" : "qt-swipe-right",
        );
        rating?.classList.add("qt-fade-out");
        actions?.classList.add("qt-fade-out");
        setTimeout(() => rateWord(grade), 200);
    } else {
        rateWord(grade);
    }
}

/**
 * On-demand AI translate ('Enter' shortcut) — fetches a fresh, plain/accurate
 * translation of the currently shown word + sentence via Gemini and shows it
 * inline, without flipping or rating the card. Independent of reveal state.
 */
async function aiTranslateReviewCard() {
    const card = document.getElementById("reviewCard");
    if (!card || reviewIndex >= reviewQueue.length) return;
    const w = reviewQueue[reviewIndex];
    if (!w) return;

    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";
    const qWord = isReverse ? w.translated : w.original;
    const qLang = isReverse ? tgtL : srcL;
    const qSentence = isReverse ? w.sentenceTranslated || "" : w.sentence || "";
    const aLang = isReverse ? srcL : tgtL;
    if (!qWord) return;

    const flashcard = card.querySelector(".review-flashcard");
    let panel = card.querySelector("#reviewAiTranslate");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "reviewAiTranslate";
        panel.className = "review-ai-translate";
        (flashcard || card).appendChild(panel);
    }
    panel.innerHTML = `<div class="review-ai-translate-loading"><span class="review-ai-spinner"></span>Tłumaczę (AI)…</div>`;

    const { geminiApiKey } = await new Promise((r) =>
        chrome.storage.sync.get({ geminiApiKey: "" }, r),
    );
    if (!geminiApiKey) {
        panel.innerHTML = `<div class="review-ai-translate-error">Ustaw klucz Gemini API w zakładce ⚙️ Ustawienia.</div>`;
        return;
    }

    try {
        const prompt = AIPrompts.standardTranslate(
            qWord,
            qSentence,
            qLang,
            aLang,
        );
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 300,
                    },
                }),
            },
        );
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(
                errData?.error?.message || `Gemini HTTP ${res.status}`,
            );
        }
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
        const wordTr = parsed.word_translation || "";
        const sentTr = parsed.sentence_translation || "";

        // Bail out silently if the user already moved to a different card
        // while the request was in flight.
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;

        panel.innerHTML = `
            <div class="review-ai-translate-label">Tłumaczenie AI</div>
            <div class="review-ai-translate-word">${escapeHtml(wordTr || "—")}</div>
            ${sentTr ? `<div class="review-ai-translate-sentence">"${escapeHtml(sentTr)}"</div>` : ""}
        `;

        // Read the AI translation aloud too, just like every other card
        // face — cuts off whatever was speaking before (question/answer
        // auto-speak) so the two don't overlap.
        const speakText = buildReviewSpeakText(wordTr, sentTr);
        if (speakText) {
            stopPopupSpeak();
            popupSpeak(speakText, aLang).catch(() => {});
        }
    } catch (err) {
        if (reviewQueue[reviewIndex] !== w) return;
        if (!document.body.contains(panel)) return;
        panel.innerHTML = `<div class="review-ai-translate-error">Błąd AI: ${escapeHtml(err.message)}</div>`;
    }
}

function renderAnswer(w) {
    const card = document.getElementById("reviewCard");
    const sr = w.sr || { step: 0, interval: 0 };
    const srcL = w.srcLang || "en";
    const tgtL = w.tgtLang || "pl";
    const isReverse = reviewDirection === "reverse";

    // In reverse mode: question=translated, answer=original
    const aWord = isReverse ? w.original : w.translated;
    const aLang = isReverse ? srcL : tgtL;
    const aSentence = isReverse ? w.sentence || "" : w.sentenceTranslated || "";
    const aWordClass = isReverse ? "__qt_original" : "__qt_translated";

    // Preview labels for each grade (1 = Nie znam, 2 = Znam)
    const labels = [1, 2].map((g) => previewLabel(sr, g));

    // Same layout as the question side (review-word-row / review-context-row
    // / screenshot) so the answer visually *replaces* the original word in
    // the exact same spot — true flashcard flip — instead of stacking a
    // second "translation" block below it.
    card.innerHTML = `
        <div class="review-flashcard">
            <div class="review-question">
                <div class="review-word-row">
                    <span class="review-word ${aWordClass}">${escapeHtml(aWord)}</span>
                    <button class="review-speak-btn" data-text="${escapeAttr(
                        buildReviewSpeakText(aWord, aSentence),
                    )}" data-lang="${escapeAttr(aLang)}" title="Odczytaj">${SPEAK_SVG}</button>
                </div>
                ${
                    aSentence
                        ? `
                <div class="review-context-row">
                    <span class="review-context">"${highlightReviewSentence(
                        aSentence,
                        aWord,
                        aWordClass,
                    )}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(aSentence)}" data-lang="${escapeAttr(aLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
                        : ""
                }
                ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
            </div>
        </div>
        <div class="review-rating">
            <div class="review-rating-label">Znałeś odpowiedź?</div>
            <div class="review-rating-buttons review-rating-buttons-2">
                <button class="review-rate-btn rate-no" data-grade="1" title="Nie znam (←)">
                    <span class="rate-key">←</span>
                    <span class="rate-label">Nie znam</span>
                    <span class="review-next-info">${labels[0]}</span>
                </button>
                <button class="review-rate-btn rate-yes" data-grade="2" title="Znam (→)">
                    <span class="rate-key">→</span>
                    <span class="rate-label">Znam</span>
                    <span class="review-next-info">${labels[1]}</span>
                </button>
            </div>
            <div class="review-hint"><kbd>←</kbd>/<kbd>A</kbd> nie znam &nbsp; <kbd>→</kbd>/<kbd>D</kbd> znam &nbsp; <kbd>↑</kbd>/<kbd>W</kbd> czytaj &nbsp; <kbd>↓</kbd>/<kbd>S</kbd> odwróć &nbsp; <kbd>Enter</kbd> tłumacz AI</div>
        </div>
        <div class="review-actions-row">
            <button class="review-edit-btn" id="reviewEditBtn">✏️ Edytuj</button>
            <button class="review-delete-btn" id="reviewDeleteBtn">🗑 Usuń</button>
        </div>`;

    // Attach TTS handlers
    attachReviewSpeakHandlers(card);
    autoSpeakReviewCard(w, true);

    // Same as the question side: always force a full scroll back to the
    // top of the card container (re-run once the screenshot finishes
    // loading, since its height isn't known until then and could push
    // the container's scroll position back down).
    const scrollToTop = () => {
        card.scrollTop = 0;
    };
    scrollToTop();
    requestAnimationFrame(scrollToTop);
    const shotImg = card.querySelector(".review-screenshot-img");
    if (shotImg && !shotImg.complete) {
        shotImg.addEventListener("load", scrollToTop, { once: true });
    }

    // Attach rating handlers
    card.querySelectorAll(".review-rate-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            animateSwipeAndRate(parseInt(btn.dataset.grade));
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
                // Assign a stable id on first edit so this doc's identity in
                // Firestore never changes again, even though its content just did
                if (!words[idx].id) words[idx].id = SharedUtils.generateId();
                words[idx].original = newOriginal;
                words[idx].translated = newTranslated;
                words[idx].sentence = newSentence;
                words[idx].sentenceTranslated = newSentenceTr;
                words[idx].updatedAt = Date.now();
                w.id = words[idx].id;
                chrome.storage.local.set({ savedWords: words }, () => {
                    if (chrome.runtime.lastError) {
                        console.error(
                            "[Lectoro] Nie udało się zapisać edycji:",
                            chrome.runtime.lastError.message,
                        );
                    }
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
                if (chrome.runtime.lastError) {
                    console.error(
                        "[Lectoro] Nie udało się zapisać powtórki:",
                        chrome.runtime.lastError.message,
                    );
                }
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
                    // Grade 2 (Good) or max attempts reached: word is done, advance
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

// ── Keyboard shortcuts for review — flashcard-style controls ──────
//   ↑ / W   → read word + sentence aloud (current side)
//   ↓ / S   → flip the card in place to reveal the answer
//   ← / A   → "Nie znam" (Again) — works from either side, front or back
//   → / D   → "Znam" (Good)      — works from either side, front or back
//   Enter   → fetch a fresh, on-demand standard AI translation
document.addEventListener("keydown", (e) => {
    const reviewTab = document.getElementById("tab-review");
    if (!reviewTab || !reviewTab.classList.contains("active")) return;
    if (reviewIndex >= reviewQueue.length || reviewQueue.length === 0) return;

    // Don't hijack WASD/arrows/Enter while the user is typing in the
    // inline edit form (e.g. editing the word's spelling).
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;

    const key = e.key;
    const lowerKey = key.length === 1 ? key.toLowerCase() : key;

    if (key === "ArrowUp" || lowerKey === "w") {
        e.preventDefault();
        autoSpeakReviewCard(reviewQueue[reviewIndex], reviewAnswerShown);
        return;
    }

    if (key === "ArrowDown" || lowerKey === "s") {
        e.preventDefault();
        flipCard();
        return;
    }

    if (key === "ArrowLeft" || lowerKey === "a") {
        e.preventDefault();
        animateSwipeAndRate(1);
        return;
    }

    if (key === "ArrowRight" || lowerKey === "d") {
        e.preventDefault();
        animateSwipeAndRate(2);
        return;
    }

    if (key === "Enter" || key === "NumpadEnter") {
        e.preventDefault();
        aiTranslateReviewCard();
        return;
    }
});

// ── Library tab: curated titles well-suited for learning English ──
// Static, hand-picked list (title / difficulty / short note), stored
// in shared/library-items.json and loaded once when the popup opens.
// No content is scraped or downloaded from any streaming site – the "Szukaj"
// button simply opens a web search so the user can find the title themselves.
let LIBRARY_ITEMS = [];
let libraryItemsLoaded = false;

function loadLibraryItems() {
    if (libraryItemsLoaded) return Promise.resolve(LIBRARY_ITEMS);
    return fetch(chrome.runtime.getURL("shared/library-items.json"))
        .then((res) => res.json())
        .then((items) => {
            LIBRARY_ITEMS = items || [];
            libraryItemsLoaded = true;
            return LIBRARY_ITEMS;
        })
        .catch((err) => {
            console.error("[Lectoro] Failed to load library-items.json:", err);
            LIBRARY_ITEMS = [];
            return LIBRARY_ITEMS;
        });
}

let libraryLevelFilter = "all";
let librarySearchQuery = "";

function libraryOpenSearch(title) {
    // Opens lookmovie2.to's own search results page for the title — no
    // scraping/downloading of any third-party site's catalog or images
    // happens here, this just navigates the user's browser like a normal link.
    const q = encodeURIComponent(title);
    window.open(`https://www.lookmovie2.to/movies/search/?q=${q}`, "_blank");
}

/** Opens the item's own direct "link" (from library-items.json) if one has
 * been filled in for that title; otherwise falls back to the generic
 * lookmovie2.to search-by-title behaviour used before this field existed. */
function libraryOpenItem(title, link) {
    const trimmed = (link || "").trim();
    if (trimmed) {
        window.open(trimmed, "_blank");
        return;
    }
    libraryOpenSearch(title);
}

function renderLibraryGrid() {
    const grid = document.getElementById("libraryGrid");
    if (!grid) return;

    if (!libraryItemsLoaded) {
        grid.innerHTML = `<div class="library-empty"><div class="library-empty-icon">⏳</div><div class="library-empty-title">Wczytywanie…</div></div>`;
        loadLibraryItems().then(() => renderLibraryGrid());
        return;
    }

    const q = librarySearchQuery.trim().toLowerCase();
    const items = LIBRARY_ITEMS.filter((item) => {
        if (libraryLevelFilter !== "all" && item.level !== libraryLevelFilter)
            return false;
        if (!q) return true;
        return (
            item.title.toLowerCase().includes(q) ||
            item.note.toLowerCase().includes(q)
        );
    });

    if (items.length === 0) {
        const queryLabel = librarySearchQuery.trim();
        grid.innerHTML = `
        <div class="library-empty">
            <div class="library-empty-icon">🔍</div>
            <div class="library-empty-title">Brak wyników w bibliotece</div>
            <div class="library-empty-sub">${
                queryLabel
                    ? `Nie znaleziono „${escapeHtml(queryLabel)}” wśród polecanych tytułów.`
                    : "Żaden z polecanych tytułów nie pasuje do wybranych filtrów."
            }</div>
            ${
                queryLabel
                    ? `<button class="library-open-btn library-empty-search-btn" id="libraryEmptySearchBtn" data-title="${escapeAttr(queryLabel)}">🔎 Szukaj „${escapeHtml(queryLabel)}” na lookmovie2.to</button>`
                    : ""
            }
        </div>`;
        document
            .getElementById("libraryEmptySearchBtn")
            ?.addEventListener("click", (e) => {
                libraryOpenSearch(e.currentTarget.dataset.title);
            });
        return;
    }
    const levelLabel = {
        beginner: "A1/A2",
        intermediate: "B1/B2",
        advanced: "C1/C2",
    };
    const levelIcon = { beginner: "🟢", intermediate: "🟡", advanced: "🔴" };

    grid.innerHTML = items
        .map((item) => {
            const hasImage = !!(item.image && item.image.trim());
            const posterImg = hasImage
                ? `<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.title)}" loading="lazy" onerror="this.remove(); this.parentElement.classList.add('no-image');">`
                : "";
            return `
        <div class="library-card" data-title="${escapeAttr(item.title)}" data-link="${escapeAttr(item.link || "")}">
            <div class="library-poster${hasImage ? "" : " no-image"}">
                ${posterImg}
                <span class="library-poster-fallback">${levelIcon[item.level]}</span>
            </div>
            <span class="library-level-badge lvl-${item.level}">${levelIcon[item.level]} ${levelLabel[item.level]}</span>
            <div class="library-card-info">
                <div class="library-card-title">${escapeHtml(item.title)}</div>
                <div class="library-card-note">${escapeHtml(item.note)}</div>
            </div>
            <div class="library-poster-overlay"><span>▶ Oglądaj</span></div>
        </div>`;
        })
        .join("");

    grid.querySelectorAll(".library-card[data-title]").forEach((card) => {
        card.addEventListener("click", () => {
            libraryOpenItem(card.dataset.title, card.dataset.link);
        });
    });
}

const librarySearchInput = document.getElementById("librarySearch");
librarySearchInput?.addEventListener("input", (e) => {
    librarySearchQuery = e.target.value;
    renderLibraryGrid();
});
librarySearchInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = librarySearchInput.value.trim();
    if (q) libraryOpenSearch(q);
});

document.querySelectorAll(".library-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        document
            .querySelectorAll(".library-filter-btn")
            .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        libraryLevelFilter = btn.dataset.level;
        renderLibraryGrid();
    });
});
