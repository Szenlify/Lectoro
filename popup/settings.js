// ── Settings: load & save language ────────────────────────────────
chrome.storage.local.get(
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
    chrome.storage.local.set({ targetLang: select.value }, flashSaved);
});

// ── Subtitle reading modes ───────────────────────────────────────
const subtitleTTSToggle = document.getElementById("subtitleTTS");
const wordCloudModeToggle = document.getElementById("wordCloudMode");

function syncSubtitleModeUI() {
    chrome.storage.local.get(
        { subtitleTTS: false, wordCloudMode: true },
        (data) => {
            subtitleTTSToggle.checked = !!data.subtitleTTS;
            wordCloudModeToggle.checked = !!data.wordCloudMode;
        },
    );
}

syncSubtitleModeUI();

subtitleTTSToggle.addEventListener("change", () => {
    chrome.storage.local.set(
        { subtitleTTS: subtitleTTSToggle.checked },
        flashSaved,
    );
});

wordCloudModeToggle.addEventListener("change", () => {
    chrome.storage.local.set(
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
    chrome.storage.local.get({ speechVoice: "" }, (data) => {
        loadVoices(data.speechVoice);
    });
};

voiceSelect.addEventListener("change", () => {
    chrome.storage.local.set({ speechVoice: voiceSelect.value }, flashSaved);
});

// ── Rate slider ───────────────────────────────────────────────────
rateRange.addEventListener("input", () => {
    rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
});
rateRange.addEventListener("change", () => {
    chrome.storage.local.set(
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
        chrome.storage.local.set(
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
    chrome.storage.local.set({ ttsMode: mode }, flashSaved);
}

modeBrowserBtn.addEventListener("click", () => setTtsMode("browser"));
modeELBtn.addEventListener("click", () => setTtsMode("elevenlabs"));

// Load saved mode
chrome.storage.local.get(
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
        chrome.storage.local.set({ elApiKey: key }, flashSaved);
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
    chrome.storage.local.set({ elVoiceId: elVoiceSelect.value }, flashSaved);
});

// ── Gemini AI – zużycie (info) ────────────────────────────────────
// Klucz Gemini API jest zarządzany przez serwer – użytkownicy nie muszą
// go wpisywać. Tutaj pokazujemy tylko informację o zużyciu z odpowiedzi proxy.
async function refreshAiUsageUI() {
    const info = document.getElementById("aiUsageInfo");
    if (!info || typeof GeminiProxy === "undefined") return;

    const usageSection = document.getElementById("aiUsageSection");
    const plansSection = document.getElementById("aiPlansSection");
    const user =
        typeof FirebaseSync !== "undefined"
            ? await FirebaseSync.getUser().catch(() => null)
            : null;
    const signedIn = !!user;
    if (usageSection) usageSection.hidden = !signedIn;
    if (plansSection) plansSection.hidden = !signedIn;
    if (!signedIn) return;

    const usage = await GeminiProxy.getCachedUsage();
    const card = document.getElementById("aiUsageCard");
    const plan = document.getElementById("aiUsagePlan");
    const title = document.getElementById("aiUsageTitle");
    const value = document.getElementById("aiUsageValue");
    const remaining = document.getElementById("aiUsageRemaining");
    const track = document.getElementById("aiUsageTrack");
    const fill = document.getElementById("aiUsageFill");
    const upgradeButton = document.getElementById("aiUpgradeButton");
    const limitReached = !!(usage?.limit > 0 && usage.used >= usage.limit);

    card?.classList.remove("is-warning", "is-empty");
    fill?.classList.remove("is-loading");
    if (usage) {
        const used = Math.max(0, Number(usage.used || 0));
        const limit = Math.max(0, Number(usage.limit || 0));
        const left = Math.max(0, limit - used);
        const percentage = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

        if (plan) plan.textContent = `PLAN ${(usage.plan || "free").toUpperCase()}`;
        if (value) value.textContent = `${used} / ${limit}`;
        if (fill) fill.style.width = `${percentage}%`;
        if (track) {
            track.setAttribute("aria-valuenow", String(percentage));
            track.setAttribute("aria-valuetext", `${used} z ${limit} kredytów wykorzystanych`);
        }

        if (limitReached) {
            card?.classList.add("is-empty");
            if (title) title.textContent = "Kredyty zostały wykorzystane";
            info.textContent = "Funkcje AI są chwilowo wstrzymane";
            if (remaining) remaining.textContent = "0 pozostało";
            if (upgradeButton) upgradeButton.hidden = false;
        } else {
            if (percentage >= 80) card?.classList.add("is-warning");
            if (title) title.textContent = "Miesięczne wykorzystanie";
            info.textContent = "Limit odnawia się co miesiąc";
            if (remaining) remaining.textContent = `${left} pozostało`;
            if (upgradeButton) upgradeButton.hidden = true;
        }
    } else {
        if (plan) plan.textContent = "KREDYTY AI";
        if (title) title.textContent = "Zaloguj się, aby sprawdzić limit";
        if (value) value.textContent = "— / —";
        if (fill) {
            fill.style.width = "38%";
            fill.classList.add("is-loading");
        }
        info.textContent = "Zużycie pojawi się po zalogowaniu";
        if (remaining) remaining.textContent = "Brak danych";
        if (upgradeButton) upgradeButton.hidden = true;
    }

    const quizButton = document.getElementById("exportQuiz");
    if (quizButton) {
        quizButton.classList.toggle("credits-empty", limitReached);
        quizButton.setAttribute("aria-disabled", String(limitReached));
        quizButton.innerHTML = limitReached ? "✦ Brak kredytów AI" : "✨ Generuj quiz";
        quizButton.title = limitReached
            ? "Miesięczny limit AI został wykorzystany — zobacz dostępne plany"
            : "Wygeneruj quiz za pomocą AI";
    }

    await GeminiProxy.applyLocalLimitToUI();
}

function showAiPlans() {
    document.querySelector('.tab[data-tab="settings"]')?.click();
    const plans = document.getElementById("aiPlansSection");
    plans?.scrollIntoView({ behavior: "smooth", block: "center" });
    plans?.classList.add("is-highlighted");
    setTimeout(() => plans?.classList.remove("is-highlighted"), 2200);
}

document.getElementById("aiUpgradeButton")?.addEventListener("click", showAiPlans);

if (location.hash === "#plans") {
    setTimeout(showAiPlans, 80);
}

refreshAiUsageUI();
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.aiUsageCache || changes.firebaseAuth)) {
        refreshAiUsageUI();
    }
});
