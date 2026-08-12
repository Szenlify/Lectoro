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