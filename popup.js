// popup.js – Settings, saved words list, filtering & export (Anki / CSV)

// ── Elements ──────────────────────────────────────────────────────
const select = document.getElementById("targetLang");
const savedMsg = document.getElementById("saved");
const wordListEl = document.getElementById("wordList");
const statsEl = document.getElementById("stats");

// ── Tab switching ─────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
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
    const dueCount = words.filter((w) => {
        if (!w.sr) return true;
        return w.sr.nextReview <= now;
    }).length;
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
                                loadReviewQueue();
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
                                    loadReviewQueue();
                                    initReviewBadge();
                                } else if (response?.error) {
                                    btn.textContent = "✗ " + response.error;
                                    btn.disabled = false;
                                    setTimeout(() => renderSyncUI(), 3000);
                                }
                            },
                        );
                    } catch (e) {
                        console.error("[QT] Sign in error:", e);
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
        loadReviewQueue();
        initReviewBadge();
    }
    if (area === "local" && changes.savedWords) {
        // Refresh review queue whenever words change (e.g. synced SR data)
        // But skip if the change came from rating a word in the current session
        if (!_reviewSaving) {
            loadReviewQueue();
        }
        initReviewBadge();
    }
});

// ── Settings: load & save language ────────────────────────────────
chrome.storage.sync.get(
    { targetLang: "pl", speechVoice: "", speechRate: 0.95, ttsVolume: 1 },
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

// ── Hover Translate toggle ────────────────────────────────────────
const hoverToggle = document.getElementById("hoverTranslate");

chrome.storage.sync.get({ hoverTranslate: false }, (data) => {
    hoverToggle.checked = data.hoverTranslate;
});

hoverToggle.addEventListener("change", () => {
    chrome.storage.sync.set(
        { hoverTranslate: hoverToggle.checked },
        flashSaved,
    );
});

// ── Subtitle reading modes (mutually exclusive) ──────────────────
const subtitleTTSToggle = document.getElementById("subtitleTTS");
const wordCloudModeToggle = document.getElementById("wordCloudMode");

function syncSubtitleModeUI() {
    chrome.storage.sync.get(
        { subtitleTTS: false, wordCloudMode: false },
        (data) => {
            subtitleTTSToggle.checked = !!data.subtitleTTS;
            wordCloudModeToggle.checked = !!data.wordCloudMode;
        },
    );
}

function setSubtitleMode(mode) {
    const next = mode || "none";
    const payload = {
        subtitleTTS: next === "subtitleTTS",
        wordCloudMode: next === "wordCloudMode",
    };
    chrome.storage.sync.set(payload, flashSaved);
}

syncSubtitleModeUI();

subtitleTTSToggle.addEventListener("change", () => {
    if (subtitleTTSToggle.checked) {
        setSubtitleMode("subtitleTTS");
    } else {
        setSubtitleMode("none");
    }
});

wordCloudModeToggle.addEventListener("change", () => {
    if (wordCloudModeToggle.checked) {
        setSubtitleMode("wordCloudMode");
    } else {
        setSubtitleMode("none");
    }
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
        const dueWords = allWords.filter((w) => {
            if (!w.sr) return true;
            return w.sr.nextReview <= now;
        });
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

function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function escapeAttr(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// ═══════════════════════════════════════════════════════════════════
//  SPACED REPETITION  –  Step-based intervals (1d→3d→7d→14d→30d→90d)
// ═══════════════════════════════════════════════════════════════════

// ── Interval steps (in days): 12h → 3d → 7d → 14d → 30d → 90d ──
const SR_STEPS = [0.5, 3, 7, 14, 30, 90];

// ── In-session delays (in minutes) for grades 1-4 ────────────────
const SESSION_DELAYS = {
    1: 1, // Nie wiem  → 1 minuta
    2: 3, // Źle       → 3 minuty
    3: 10, // Trudne    → 10 minut
    4: 60, // OK        → 1 godzina
};

/**
 * Calculate new SR data after rating.
 *
 * Grades 1-4 → short in-session delay (minutes), step goes DOWN or stays.
 *   1 (Nie wiem)  → reset step to 0, come back in 1 min
 *   2 (Źle)       → step - 2 (min 0), come back in 3 min
 *   3 (Trudne)    → step - 1 (min 0), come back in 10 min
 *   4 (OK)        → stay at same step, come back in 1 hour
 *
 * Grade 5 (Łatwe) → advance step, next review in days (1d→3d→7d→…)
 */
function srUpdate(sr, grade) {
    let step = sr.step;

    if (grade === 5) {
        // Use current step for interval, then advance for next time
        const intervalDays = getIntervalForStep(step);
        step = step + 1;
        return {
            step,
            interval: intervalDays,
            nextReview: Date.now() + intervalDays * 24 * 60 * 60 * 1000,
            lastReview: Date.now(),
        };
    }

    // Grades 1-4: short delay, adjust step downward
    if (grade === 1) {
        step = 0;
    } else if (grade === 2) {
        step = Math.max(0, step - 2);
    } else if (grade === 3) {
        step = Math.max(0, step - 1);
    }
    // grade 4: step stays

    const delayMinutes = SESSION_DELAYS[grade];
    return {
        step,
        interval: sr.interval, // keep last long-term interval for reference
        nextReview: Date.now() + delayMinutes * 60 * 1000,
        lastReview: Date.now(),
    };
}

/** Get interval in days for a given step */
function getIntervalForStep(step) {
    if (step < SR_STEPS.length) return SR_STEPS[step];
    // Beyond last step: keep growing (90 * 1.5^n)
    const extra = step - SR_STEPS.length + 1;
    return Math.round(SR_STEPS[SR_STEPS.length - 1] * Math.pow(1.5, extra));
}

/** Preview what the next review time label will be for a given grade */
function previewLabel(sr, grade) {
    if (grade === 5) {
        const step = sr.step; // current step (not +1, interval is taken before advancing)
        const days = getIntervalForStep(step);
        return formatIntervalDays(days);
    }
    const mins = SESSION_DELAYS[grade];
    return formatIntervalMinutes(mins);
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

// ── Default SR data for words that don't have it ──────────────────
function ensureSR(word) {
    if (!word.sr) {
        word.sr = {
            step: 0,
            interval: 0,
            nextReview: 0,
            lastReview: null,
        };
    }
    // Migrate old SM-2 format → new step format
    if (word.sr.step === undefined) {
        // Try to guess step from old interval
        const oldInterval = word.sr.interval || 0;
        let step = 0;
        for (let i = SR_STEPS.length - 1; i >= 0; i--) {
            if (oldInterval >= SR_STEPS[i]) {
                step = i;
                break;
            }
        }
        word.sr = {
            step,
            interval: word.sr.interval || 0,
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

        reviewQueue = words
            .filter((w) => {
                if (!w.sr) return true;
                return w.sr.nextReview <= now;
            })
            .map(ensureSR);

        // Shuffle
        for (let i = reviewQueue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [reviewQueue[i], reviewQueue[j]] = [reviewQueue[j], reviewQueue[i]];
        }

        reviewTotalDue = reviewQueue.length;
        reviewIndex = 0;
        reviewAnswerShown = false;
        renderReview();
    });
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
        const dueCount = words.filter((w) => {
            if (!w.sr) return true;
            return w.sr.nextReview <= now;
        }).length;
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

/**
 * Speak text using the same engine & voice configured in settings.
 * Returns a Promise that resolves with { type: 'utter'|'audio', obj } for end-tracking.
 */
function popupSpeak(text, lang) {
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
                speechRate: 0.95,
                ttsVolume: 1,
            },
            async (data) => {
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
                        const url = URL.createObjectURL(blob);
                        popupElAudio = new Audio(url);
                        popupElAudio.volume =
                            data.ttsVolume !== undefined ? data.ttsVolume : 1;
                        popupElAudio.play();
                        resolve({ type: "audio", obj: popupElAudio });
                    } catch (err) {
                        console.warn("[QT] ElevenLabs popup TTS failed:", err);
                        resolve({ type: "none", obj: null });
                    }
                    return;
                }
                // Browser SpeechSynthesis path
                const utter = new SpeechSynthesisUtterance(
                    cleanTextForPopupTTS(text),
                );
                utter.lang = lang || "en";
                utter.rate = data.speechRate;
                utter.volume =
                    data.ttsVolume !== undefined ? data.ttsVolume : 1;
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
        const dirLabel = isReverse
            ? `${(w.tgtLang || "?").toUpperCase()} → ${(w.srcLang || "?").toUpperCase()}`
            : `${(w.srcLang || "?").toUpperCase()} → ${(w.tgtLang || "?").toUpperCase()}`;
        card.innerHTML = `
            <div class="review-question">
                <div class="review-word-row">
                    <span class="review-word">${escapeHtml(showWord)}</span>
                    <button class="review-speak-btn" data-text="${escapeAttr(showWord)}" data-lang="${escapeAttr(showLang)}" title="Odczytaj">${SPEAK_SVG}</button>
                </div>
                ${
                    showSentence
                        ? `
                <div class="review-context-row">
                    <span class="review-context">"${escapeHtml(showSentence)}"</span>
                    <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(showSentence)}" data-lang="${escapeAttr(showLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
                </div>`
                        : ""
                }
                ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
                <div class="review-meta">${dirLabel}</div>
            </div>
            <button class="review-reveal-btn" id="revealBtn">▸ Pokaż odpowiedź</button>
            <div class="review-hint">Naciśnij <kbd>Spacja</kbd> aby odsłonić</div>`;

        attachReviewSpeakHandlers(card);
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

    // Preview labels for each grade
    const labels = [1, 2, 3, 4, 5].map((g) => previewLabel(sr, g));

    card.innerHTML = `
        <div class="review-question">
            <div class="review-word-row">
                <span class="review-word">${escapeHtml(qWord)}</span>
                <button class="review-speak-btn" data-text="${escapeAttr(qWord)}" data-lang="${escapeAttr(qLang)}" title="Odczytaj">${SPEAK_SVG}</button>
            </div>
            ${
                qSentence
                    ? `
            <div class="review-context-row">
                <span class="review-context">"${escapeHtml(qSentence)}"</span>
                <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(qSentence)}" data-lang="${escapeAttr(qLang)}" title="Odczytaj zdanie">${SPEAK_SVG}</button>
            </div>`
                    : ""
            }
            ${w.screenshot ? `<div class="review-screenshot"><img src="${w.screenshot}" alt="Screenshot" class="review-screenshot-img"></div>` : ""}
        </div>
        <div class="review-answer">
            <div class="review-translation-row">
                <span class="review-translation">${escapeHtml(aWord)}</span>
                <button class="review-speak-btn" data-text="${escapeAttr(aWord)}" data-lang="${escapeAttr(aLang)}" title="Odczytaj tłumaczenie">${SPEAK_SVG}</button>
            </div>
            ${
                aSentence
                    ? `
            <div class="review-divider"></div>
            <div class="review-sentence-trans-row">
                <span class="review-sentence-trans">"${escapeHtml(aSentence)}"</span>
                <button class="review-speak-btn review-speak-sm" data-text="${escapeAttr(aSentence)}" data-lang="${escapeAttr(aLang)}" title="Odczytaj tłumaczenie zdania">${SPEAK_SVG}</button>
            </div>`
                    : ""
            }
        </div>
        <div class="review-rating">
            <div class="review-rating-label">Jak dobrze znałeś?</div>
            <div class="review-rating-buttons">
                <button class="review-rate-btn rate-1" data-grade="1" title="Nie pamiętam">
                    <span class="rate-key">1</span>
                    <span class="rate-label">Nie wiem</span>
                    <span class="review-next-info">${labels[0]}</span>
                </button>
                <button class="review-rate-btn rate-2" data-grade="2" title="Źle">
                    <span class="rate-key">2</span>
                    <span class="rate-label">Źle</span>
                    <span class="review-next-info">${labels[1]}</span>
                </button>
                <button class="review-rate-btn rate-3" data-grade="3" title="Trudne">
                    <span class="rate-key">3</span>
                    <span class="rate-label">Trudne</span>
                    <span class="review-next-info">${labels[2]}</span>
                </button>
                <button class="review-rate-btn rate-4" data-grade="4" title="OK">
                    <span class="rate-key">4</span>
                    <span class="rate-label">OK</span>
                    <span class="review-next-info">${labels[3]}</span>
                </button>
                <button class="review-rate-btn rate-5" data-grade="5" title="Łatwe">
                    <span class="rate-key">5</span>
                    <span class="rate-label">Łatwe</span>
                    <span class="review-next-info">${labels[4]}</span>
                </button>
            </div>
            <div class="review-hint">Klawisze <kbd>1</kbd>-<kbd>5</kbd> = ocena</div>
        </div>
        <div class="review-actions-row">
            <button class="review-edit-btn" id="reviewEditBtn">✏️ Edytuj</button>
            <button class="review-delete-btn" id="reviewDeleteBtn">🗑 Usuń</button>
        </div>`;

    // Attach TTS handlers
    attachReviewSpeakHandlers(card);

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
                if (grade < 5 && w._sessionAttempts < 3) {
                    // Grades 1-4: re-insert word later in the queue
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
                    // Grade 5 or max attempts reached: word is done, advance
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

// ── Keyboard shortcuts for review (1-5 = rate, Space = reveal) ───
document.addEventListener("keydown", (e) => {
    const reviewTab = document.getElementById("tab-review");
    if (!reviewTab || !reviewTab.classList.contains("active")) return;
    if (reviewIndex >= reviewQueue.length || reviewQueue.length === 0) return;

    if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        if (!reviewAnswerShown) revealAnswer();
    }

    if (reviewAnswerShown && e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        rateWord(parseInt(e.key));
    }
});
