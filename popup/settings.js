// ── Settings: load & save language ────────────────────────────────
chrome.storage.local.get(
    { targetLang: "pl", speechVoice: "", speechRate: 1.1, ttsVolume: 1 },
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
    voiceSelect.innerHTML = `
        <option value="">🔊 Domyślny</option>
        <option value="random">✦ Losowy głos systemowy</option>`;
    voices
        .filter((v) => /google/i.test(v.name))
        .forEach((v) => {
            const opt = document.createElement("option");
            opt.value = v.name;
            opt.textContent = `${v.name} (${v.lang})`;
            if (v.name === selectedVoice) opt.selected = true;
            voiceSelect.appendChild(opt);
        });
    if (
        [...voiceSelect.options].some(
            (option) => option.value === selectedVoice,
        )
    ) {
        voiceSelect.value = selectedVoice;
    }
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
// Wybór ElevenLabs jest celowo dostępny przy fiszkach w zakładce Powtórki.

// ── Gemini AI – zużycie (info) ────────────────────────────────────
// Klucz Gemini API jest zarządzany przez serwer – użytkownicy nie muszą
// go wpisywać. Tutaj pokazujemy tylko informację o zużyciu z odpowiedzi proxy.
function renderSubscriptionPlans(subscription) {
    const grid = document.getElementById("subscriptionPlansGrid");
    if (!grid) return;
    const activePlan = SubscriptionConfig.normalizePlan(subscription?.plan);
    const hasPaidPlan =
        activePlan !== SubscriptionConfig.SUBSCRIPTION_PLANS.FREE;
    grid.innerHTML = Object.entries(SubscriptionConfig.SUBSCRIPTION_LIMITS)
        .map(([planId, limits]) => {
            const isCurrent = planId === activePlan;
            const isRecommended =
                planId === SubscriptionConfig.SUBSCRIPTION_PLANS.BASIC;
            const price =
                limits.priceMonthly.amount === 0
                    ? "0 zł"
                    : new Intl.NumberFormat("pl-PL", {
                          style: "currency",
                          currency: limits.priceMonthly.currency,
                      }).format(limits.priceMonthly.amount);
            const tts = limits.elevenLabs.enabled
                ? `${limits.elevenLabs.charactersPerMonth.toLocaleString("pl-PL")} znaków z ElevenLabs`
                : "Głos systemowy";
            let action =
                '<span class="subscription-plan-current">Obecny plan</span>';
            if (!isCurrent) {
                if (planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE) {
                    action = hasPaidPlan
                        ? '<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">Zmień w Stripe</span></button>'
                        : "";
                } else if (hasPaidPlan) {
                    action =
                        '<button type="button" class="subscription-plan-button" data-billing-action="portal"><span class="subscription-button-label">Zmień plan</span><span aria-hidden="true">→</span></button>';
                } else {
                    action = `<button type="button" class="subscription-plan-button" data-billing-action="checkout" data-plan="${planId}"><span class="subscription-button-label">Wybierz ${limits.displayName}</span><span aria-hidden="true">→</span></button>`;
                }
            } else if (hasPaidPlan) {
                action =
                    '<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">Zarządzaj planem</span><span aria-hidden="true">→</span></button>';
            }
            return `<article class="subscription-plan-card ${isCurrent ? "is-current" : ""} ${isRecommended ? "is-recommended" : ""}">
                <div class="subscription-plan-topline">
                    <strong>${limits.displayName}</strong>
                    ${
                        isCurrent
                            ? '<span class="subscription-plan-badge is-active">Aktywny</span>'
                            : isRecommended
                              ? '<span class="subscription-plan-badge">Popularny</span>'
                              : ""
                    }
                </div>
                <div class="subscription-plan-price"><b>${price}</b><span>${limits.priceMonthly.amount === 0 ? "na zawsze" : "/ miesiąc"}</span></div>
                <div class="subscription-plan-features">
                    <span><i aria-hidden="true">✓</i><b>${limits.ai.usesPerMonth.toLocaleString("pl-PL")}</b> użyć AI / mies.</span>
                    <span><i aria-hidden="true">✓</i><b>${limits.srs.maxSavedCards.toLocaleString("pl-PL")}</b> fiszek SRS</span>
                    ${
                        limits.elevenLabs.enabled
                            ? '<span><i aria-hidden="true">✓</i>Naturalne głosy</span>'
                            : ""
                    }
                    ${
                        limits.elevenLabs.enabled
                            ? '<span><i aria-hidden="true">✓</i>Cwiczenia <b>AI</b></span>'
                            : ""
                    }
                    <span class="${limits.elevenLabs.enabled ? "" : "is-muted"}"><i aria-hidden="true">${limits.elevenLabs.enabled ? "✓" : "—"}</i>${tts}</span>
                </div>
                <div class="subscription-plan-action">${action}</div>
            </article>`;
        })
        .join("");
}

function renderElevenLabsUsage(subscription) {
    const card = document.getElementById("elevenLabsUsageCard");
    const title = document.getElementById("elevenLabsUsageTitle");
    const value = document.getElementById("elevenLabsUsageValue");
    const info = document.getElementById("elevenLabsUsageInfo");
    const track = document.getElementById("elevenLabsUsageTrack");
    const fill = document.getElementById("elevenLabsUsageFill");
    if (!card || !subscription) return;

    const plan = SubscriptionConfig.normalizePlan(subscription.plan);
    const limits = SubscriptionConfig.getPlanLimits(plan).elevenLabs;
    const used = Math.max(
        0,
        Number(subscription.usage?.elevenLabsCharacters?.used) || 0,
    );
    const limit = Math.max(0, Number(limits.charactersPerMonth) || 0);
    const left = Math.max(0, limit - used);
    const percentage = limit
        ? Math.min(100, Math.round((used / limit) * 100))
        : 0;
    const limitReached = limits.enabled && used >= limit;

    card.classList.remove("is-warning", "is-empty", "is-unavailable");
    fill?.classList.remove("is-loading");
    if (track) {
        track.setAttribute("aria-valuenow", String(percentage));
        track.setAttribute(
            "aria-valuetext",
            `${used} z ${limit} znaków wykorzystanych`,
        );
    }

    if (!limits.enabled) {
        card.classList.add("is-unavailable");
        if (title) title.textContent = "Naturalne głosy w powtórkach";
        if (value) value.textContent = "Niedostępne";
        if (fill) fill.style.width = "0%";
        if (info) info.textContent = "ElevenLabs od planu BASIC";
        return;
    }

    if (value) value.textContent = `${used} / ${limit}`;
    if (fill) fill.style.width = `${percentage}%`;
    if (limitReached) {
        card.classList.add("is-empty");
        if (title) title.textContent = "Limit ElevenLabs wykorzystany";
        if (info) info.textContent = "ElevenLabs: 0 znaków zostało";
    } else {
        if (percentage >= 80) card.classList.add("is-warning");
        if (title)
            title.textContent = `${left.toLocaleString("pl-PL")} znaków pozostało`;
        if (info)
            info.textContent = `ElevenLabs: ${left.toLocaleString("pl-PL")} znaków zostało`;
    }
}

function formatNextUsageRenewalDate(month) {
    const match = /^(\d{4})-(\d{2})$/.exec(month || "");
    const now = new Date();
    const year = match ? Number(match[1]) : now.getUTCFullYear();
    const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
    const renewalDate = new Date(Date.UTC(year, monthIndex + 1, 1));

    return new Intl.DateTimeFormat("pl-PL", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    }).format(renewalDate);
}

async function refreshAiUsageUI() {
    const info = document.getElementById("aiUsageInfo");
    const renewalDate = document.getElementById("aiUsageRenewalDate");
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

    const subscription = await SubscriptionService.effectiveProfile(false);
    let usage = await GeminiProxy.refreshUsage(false).catch(() =>
        GeminiProxy.getCachedUsage(),
    );
    // Defensive reconciliation for an older extension cache created before
    // plan-change invalidation was introduced.
    if (
        usage &&
        SubscriptionConfig.normalizePlan(usage.plan) !==
            SubscriptionConfig.normalizePlan(subscription.plan)
    ) {
        usage = await GeminiProxy.refreshUsage(true).catch(() => usage);
    }
    renderSubscriptionPlans(subscription);
    renderElevenLabsUsage(subscription);
    const card = document.getElementById("aiUsageMeter");
    const plan = document.getElementById("aiUsagePlan");
    const title = document.getElementById("aiUsageTitle");
    const value = document.getElementById("aiUsageValue");
    const track = document.getElementById("aiUsageTrack");
    const fill = document.getElementById("aiUsageFill");
    const limitReached = !!(usage?.limit > 0 && usage.used >= usage.limit);

    card?.classList.remove("is-warning", "is-empty");
    fill?.classList.remove("is-loading");
    if (plan)
        plan.textContent = `PLAN ${SubscriptionConfig.normalizePlan(subscription.plan).toUpperCase()}`;
    if (usage) {
        const used = Math.max(0, Number(usage.used || 0));
        const limit = Math.max(0, Number(usage.limit || 0));
        const left = Math.max(0, limit - used);
        const percentage = limit
            ? Math.min(100, Math.round((used / limit) * 100))
            : 0;

        if (renewalDate) {
            renewalDate.textContent = formatNextUsageRenewalDate(usage.month);
        }

        if (plan)
            plan.textContent = `PLAN ${(usage.plan || "free").toUpperCase()}`;
        if (value) value.textContent = `${used} / ${limit}`;
        if (fill) fill.style.width = `${percentage}%`;
        if (track) {
            track.setAttribute("aria-valuenow", String(percentage));
            track.setAttribute(
                "aria-valuetext",
                `${used} z ${limit} kredytów wykorzystanych`,
            );
        }

        if (limitReached) {
            card?.classList.add("is-empty");
            if (title) title.textContent = "Kredyty zostały wykorzystane";
            info.textContent = "Funkcje AI są chwilowo wstrzymane";
        } else {
            if (percentage >= 80) card?.classList.add("is-warning");
            if (title)
                title.textContent = `${left.toLocaleString("pl-PL")} kredytów pozostało`;
            info.textContent = "Limit odnawia się co miesiąc";
        }
    } else {
        if (title) title.textContent = "Dane chwilowo niedostępne";
        if (value) value.textContent = "— / —";
        if (fill) {
            fill.style.width = "38%";
            fill.classList.add("is-loading");
        }
        info.textContent = "Nie udało się odświeżyć użycia AI";
        if (renewalDate) renewalDate.textContent = "";
    }

    const usageUpgradeButton = document.getElementById("usageUpgradeButton");
    if (usageUpgradeButton) {
        const elevenLabsCard = document.getElementById("elevenLabsUsageCard");
        usageUpgradeButton.hidden = !(
            limitReached ||
            elevenLabsCard?.classList.contains("is-empty") ||
            elevenLabsCard?.classList.contains("is-unavailable")
        );
    }

    const quizButton = document.getElementById("exportQuiz");
    if (quizButton) {
        quizButton.classList.toggle("credits-empty", limitReached);
        quizButton.setAttribute("aria-disabled", String(limitReached));
        quizButton.innerHTML = limitReached
            ? "✦ Brak kredytów AI"
            : "✨ Generuj quiz";
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

document
    .getElementById("usageUpgradeButton")
    ?.addEventListener("click", showAiPlans);

document
    .getElementById("subscriptionPlansGrid")
    ?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-billing-action]");
        if (!button) return;
        const status = document.getElementById("stripeBillingStatus");
        const grid = document.getElementById("subscriptionPlansGrid");
        const buttons = document.querySelectorAll("[data-billing-action]");
        const originalButtonContent = button.innerHTML;
        buttons.forEach((item) => {
            item.disabled = true;
        });
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.innerHTML =
            '<span class="stripe-spinner" aria-hidden="true"></span><span>Łączenie ze Stripe...</span>';
        grid?.setAttribute("aria-busy", "true");
        if (status) {
            status.className = "stripe-billing-status is-loading";
            status.innerHTML =
                '<span class="stripe-spinner" aria-hidden="true"></span><span>Otwieram bezpieczną stronę płatności...</span>';
        }
        try {
            const result =
                button.dataset.billingAction === "checkout"
                    ? await SubscriptionService.startCheckout(
                          button.dataset.plan,
                      )
                    : await SubscriptionService.openBillingPortal();
            if (status) {
                status.className = "stripe-billing-status is-success";
                status.textContent = result.redirectedToPortal
                    ? "Masz już subskrypcję — otwarto panel zmiany planu."
                    : "Stripe został otwarty w nowej karcie.";
            }
        } catch (error) {
            if (status) {
                status.className = "stripe-billing-status is-error";
                status.textContent =
                    error.message || "Nie udało się otworzyć Stripe.";
            }
        } finally {
            button.innerHTML = originalButtonContent;
            button.classList.remove("is-loading");
            button.removeAttribute("aria-busy");
            grid?.removeAttribute("aria-busy");
            buttons.forEach((item) => {
                item.disabled = false;
            });
        }
    });

if (location.hash === "#plans") {
    setTimeout(showAiPlans, 80);
}

SubscriptionService.refreshProfile(true)
    .catch((error) =>
        console.warn("[Lectoro] Nie udało się odświeżyć planu:", error),
    )
    .finally(async () => {
        await SubscriptionService.applyPlanToUI();
        await refreshAiUsageUI();
    })
    .catch((error) =>
        console.warn("[Lectoro] Nie udało się odświeżyć UI planu:", error),
    );
chrome.storage.onChanged.addListener((changes, area) => {
    if (
        area === "local" &&
        (changes.aiUsageCache ||
            changes.firebaseAuth ||
            changes.subscriptionProfileCache)
    ) {
        SubscriptionService.applyPlanToUI().catch((error) =>
            console.warn(
                "[Lectoro] Aktualizacja blokad planu nie powiodła się:",
                error,
            ),
        );
        refreshAiUsageUI().catch((error) =>
            console.warn(
                "[Lectoro] Aktualizacja wykorzystania nie powiodła się:",
                error,
            ),
        );
    }
});
