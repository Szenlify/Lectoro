// ── Settings: load & save language ────────────────────────────────
whenPopupReady((data) => {
    select.value = data.targetLang || "pl";
    rateRange.value = data.speechRate || 1.1;
    rateValue.textContent = parseFloat(data.speechRate || 1.1).toFixed(2);
    if (data.ttsVolume !== undefined && volumeRange) {
        volumeRange.value = data.ttsVolume;
        volumeValue.textContent = Math.round(data.ttsVolume * 100) + "%";
    }
    let voice = data.speechVoice || "";
    if (voice === "random") {
        voice = "";
        chrome.storage.local.set({ speechVoice: "" });
    }
    loadVoices(voice);

    if (subtitleTTSToggle) subtitleTTSToggle.checked = !!data.subtitleTTS;
    if (wordCloudModeToggle) wordCloudModeToggle.checked = !!data.wordCloudMode;
});

select.addEventListener("change", () => {
    chrome.storage.local.set({ targetLang: select.value }, flashSaved);
});

// ── Subtitle reading modes ───────────────────────────────────────
const subtitleTTSToggle = document.getElementById("subtitleTTS");
const wordCloudModeToggle = document.getElementById("wordCloudMode");

function syncSubtitleModeUI() {
    whenPopupReady((data) => {
        if (subtitleTTSToggle) subtitleTTSToggle.checked = !!data.subtitleTTS;
        if (wordCloudModeToggle)
            wordCloudModeToggle.checked = !!data.wordCloudMode;
    });
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

// ── Populate voices ───────────────────────────────────────────────
function loadVoices(selectedVoice) {
    const voices = window.speechSynthesis.getVoices();
    voiceSelect.innerHTML = `
        <option value="">🔊 Default</option>`;
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
        loadVoices(data.speechVoice === "random" ? "" : data.speechVoice);
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

// ── Subscription & AI Usage ──────────────────────────────────────
function renderSubscriptionPlans(subscription, signedIn = true) {
    const grid = document.getElementById("subscriptionPlansGrid");
    if (!grid) return;
    const activePlan = signedIn
        ? SubscriptionConfig.normalizePlan(subscription?.plan)
        : SubscriptionConfig.SUBSCRIPTION_PLANS.FREE;
    const hasPaidPlan =
        signedIn && activePlan !== SubscriptionConfig.SUBSCRIPTION_PLANS.FREE;
    const trialEligible = !signedIn || subscription?.trialEligible !== false;
    const isTrialing =
        signedIn && subscription?.subscriptionStatus === "trialing";
    const trialBanner = document.getElementById("subscriptionTrialBanner");
    if (trialBanner) trialBanner.hidden = hasPaidPlan || !trialEligible;

    const renderKey = `${activePlan}:${signedIn}:${hasPaidPlan}:${trialEligible}:${isTrialing}`;
    if (grid.dataset.renderedKey === renderKey && grid.children.length > 0) {
        return;
    }
    grid.dataset.renderedKey = renderKey;

    grid.innerHTML = Object.entries(SubscriptionConfig.SUBSCRIPTION_LIMITS)
        .map(([planId, limits]) => {
            const isCurrent = signedIn && planId === activePlan;
            const isRecommended =
                planId === SubscriptionConfig.SUBSCRIPTION_PLANS.BASIC;
            const hasTrialOffer =
                planId !== SubscriptionConfig.SUBSCRIPTION_PLANS.FREE &&
                !hasPaidPlan &&
                trialEligible;
            const price =
                limits.priceMonthly.amount === 0
                    ? "$0"
                    : new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: limits.priceMonthly.currency || "USD",
                      }).format(limits.priceMonthly.amount);
            const tts = limits.elevenLabs.enabled
                ? `${limits.elevenLabs.charactersPerMonth.toLocaleString("en-US")} ElevenLabs characters`
                : "Basic voice";
            let action =
                '<span class="subscription-plan-current">Current plan</span>';
            if (!isCurrent) {
                if (planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE) {
                    action = hasPaidPlan
                        ? '<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">Manage on Stripe</span></button>'
                        : "";
                } else if (hasPaidPlan) {
                    action =
                        '<button type="button" class="subscription-plan-button" data-billing-action="portal"><span class="subscription-button-label">Change plan</span><span aria-hidden="true">→</span></button>';
                } else {
                    action = `<button type="button" class="subscription-plan-button ${hasTrialOffer ? "is-trial" : ""}" data-billing-action="checkout" data-plan="${planId}"><span class="subscription-button-label">${hasTrialOffer ? "Start 3-day trial" : `Choose ${limits.displayName}`}</span><span aria-hidden="true">→</span></button>`;
                }
            } else if (hasPaidPlan) {
                action =
                    '<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">Manage plan</span><span aria-hidden="true">→</span></button>';
            }
            const billingNote = hasTrialOffer
                ? `<span class="subscription-trial-note"><b>$0 today</b> · then ${price}/mo.<br>Cancel anytime.</span>`
                : "";
            return `<article class="subscription-plan-card ${isCurrent ? "is-current" : ""} ${isRecommended ? "is-recommended" : ""} ${hasTrialOffer ? "has-trial-offer" : ""}">
                <div class="subscription-plan-topline">
                    <strong>${limits.displayName}</strong>
                    ${
                        isCurrent && isTrialing
                            ? '<span class="subscription-plan-badge is-trialing">Trial</span>'
                            : isCurrent
                              ? '<span class="subscription-plan-badge is-active">Active</span>'
                              : isRecommended
                                ? '<span class="subscription-plan-badge">Popular</span>'
                                : ""
                    }
                </div>
                ${hasTrialOffer ? `<div class="subscription-plan-trial-kicker">3 days free</div>` : ""}
                <div class="subscription-plan-price"><b>${price}</b><span>${limits.priceMonthly.amount === 0 ? "forever" : "/ month"}</span></div>
                <div class="subscription-plan-features">
                    <span>
    <i aria-hidden="true">✓</i>
    <b>${Number.isFinite(limits.subtitles?.charactersPerHour) ? `${limits.subtitles.charactersPerHour.toLocaleString("en-US")} chars/h` : "Unlimited"}</b> translate
</span>
                    <span>
    <i aria-hidden="true">✓</i>
    <b>${limits.ai.usesPerMonth.toLocaleString("en-US")}</b>
    ${planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE ? "AI uses" : "AI uses / mo"}
</span>
                    <span><i aria-hidden="true">✓</i><b>${limits.srs.maxSavedCards.toLocaleString("en-US")}</b> SRS flashcards</span>
                    ${
                        limits.elevenLabs.enabled
                            ? '<span><i aria-hidden="true">✓</i><b>Natural voices</b></span>'
                            : ""
                    }
                    ${
                        limits.elevenLabs.enabled
                            ? '<span><i aria-hidden="true">✓</i><b>Unlimited AI practice</b></span>'
                            : ""
                    }
                    <span class="${limits.elevenLabs.enabled ? "" : "is-muted"}"><i aria-hidden="true">${limits.elevenLabs.enabled ? "✓" : "—"}</i>${tts}</span>
                </div>
                <div class="subscription-plan-action">${action}${billingNote}</div>
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
            `${used} of ${limit} characters used`,
        );
    }

    if (!limits.enabled) {
        card.classList.add("is-unavailable");
        if (title) title.textContent = "Natural voices in reviews";
        if (value) value.textContent = "Unavailable";
        if (fill) fill.style.width = "0%";
        if (info) info.textContent = "ElevenLabs from BASIC plan";
        return;
    }

    if (value) value.textContent = `${used} / ${limit}`;
    if (fill) fill.style.width = `${percentage}%`;
    if (limitReached) {
        card.classList.add("is-empty");
        if (title) title.textContent = "ElevenLabs limit reached";
        if (info) info.textContent = "ElevenLabs: 0 characters left";
    } else {
        if (percentage >= 80) card.classList.add("is-warning");
        if (title)
            title.textContent = `${left.toLocaleString("en-US")} characters left`;
        if (info)
            info.textContent = `ElevenLabs: ${left.toLocaleString("en-US")} characters left`;
    }
}

function formatNextUsageRenewalDate(month) {
    return typeof SharedUtils !== "undefined" &&
        SharedUtils.formatNextUsageRenewalDate
        ? SharedUtils.formatNextUsageRenewalDate(month)
        : "";
}

let isBillingBusy = false;
let _refreshAiUsageTimeout = null;

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
    if (plansSection) plansSection.hidden = false;

    const subscription = await SubscriptionService.effectiveProfile(false);

    // Don't re-render subscription plans DOM if a checkout/portal click is currently processing
    if (!isBillingBusy) {
        renderSubscriptionPlans(subscription, signedIn);
    }

    if (!signedIn) {
        renderElevenLabsUsage(subscription);
        await GeminiProxy.applyLocalLimitToUI();
        return;
    }

    let usage = await GeminiProxy.refreshUsage(false).catch(() =>
        GeminiProxy.getCachedUsage(),
    );

    if (
        usage &&
        SubscriptionConfig.normalizePlan(usage.plan) !==
            SubscriptionConfig.normalizePlan(subscription.plan)
    ) {
        usage = await GeminiProxy.refreshUsage(true).catch(() => usage);
    }

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

        const currentPlan = SubscriptionConfig.normalizePlan(
            subscription?.plan || usage?.plan,
        );
        const isPaidPlan = currentPlan !== "free";

        if (renewalDate) {
            if (isPaidPlan) {
                const renewalTimestamp =
                    subscription?.stripeCurrentPeriodEnd ||
                    usage?.month ||
                    subscription?.usage?.ai?.month ||
                    null;
                renewalDate.textContent =
                    formatNextUsageRenewalDate(renewalTimestamp);
            } else {
                renewalDate.textContent = "";
            }
        }

        if (plan) plan.textContent = `PLAN ${currentPlan.toUpperCase()}`;
        if (value) value.textContent = `${used} / ${limit}`;
        if (fill) fill.style.width = `${percentage}%`;
        if (track) {
            track.setAttribute("aria-valuenow", String(percentage));
            track.setAttribute(
                "aria-valuetext",
                `${used} of ${limit} credits used`,
            );
        }

        if (limitReached) {
            card?.classList.add("is-empty");
            if (title) title.textContent = "Credits used up";
            if (isPaidPlan) {
                info.textContent = "Limit renews:";
            } else {
                info.textContent = "Free plan limit does not renew";
            }
        } else {
            if (percentage >= 80) card?.classList.add("is-warning");
            if (title)
                title.textContent = `${left.toLocaleString("en-US")} credits remaining`;
            if (isPaidPlan) {
                info.textContent = "Limit renews:";
            } else {
                info.textContent = "One-time starter pack (Free plan)";
            }
        }
    } else {
        if (title) title.textContent = "Data temporarily unavailable";
        if (value) value.textContent = "— / —";
        if (fill) {
            fill.style.width = "38%";
            fill.classList.add("is-loading");
        }
        info.textContent = "Could not refresh AI usage";
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
        const labelEl = quizButton.querySelector(".quiz-btn-label");
        if (labelEl) {
            labelEl.textContent = limitReached ? "✦ Out of AI" : "✨ AI Quiz";
        } else {
            quizButton.textContent = limitReached
                ? "✦ Out of AI"
                : "✨ AI Quiz";
        }
        quizButton.title = limitReached
            ? "Monthly AI limit reached — view available plans"
            : "Generate interactive quiz using AI";
    }

    await GeminiProxy.applyLocalLimitToUI();
}

function showAiPlans() {
    if (typeof switchTab === "function") {
        switchTab("settings");
    } else {
        document.querySelector('.tab[data-tab="settings"]')?.click();
    }
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
        if (!button || isBillingBusy) return;

        const status = document.getElementById("stripeBillingStatus");
        const grid = document.getElementById("subscriptionPlansGrid");
        const action = button.dataset.billingAction;
        const targetPlan = button.dataset.plan;

        isBillingBusy = true;
        const originalButtonContent = button.innerHTML;

        const allButtons = grid
            ? grid.querySelectorAll("[data-billing-action]")
            : [];
        allButtons.forEach((item) => {
            item.disabled = true;
        });
        button.classList.add("is-loading");
        button.setAttribute("aria-busy", "true");
        button.innerHTML =
            '<span class="stripe-spinner" aria-hidden="true"></span><span>Connecting to Stripe...</span>';
        grid?.setAttribute("aria-busy", "true");

        if (status) {
            status.className = "stripe-billing-status is-loading";
            status.innerHTML =
                '<span class="stripe-spinner" aria-hidden="true"></span><span>Opening secure checkout...</span>';
        }

        try {
            let user =
                typeof FirebaseSync !== "undefined"
                    ? await FirebaseSync.getUser().catch(() => null)
                    : null;

            if (
                !user &&
                (action === "checkout" || action === "sign-in-and-checkout")
            ) {
                if (status) {
                    status.className = "stripe-billing-status is-loading";
                    status.innerHTML =
                        '<span class="stripe-spinner" aria-hidden="true"></span><span>Signing in with Google...</span>';
                }
                if (typeof sendBackgroundMessage === "function") {
                    await sendBackgroundMessage({
                        type: "QT_FIREBASE_SIGN_IN",
                    });
                    user = await FirebaseSync.getUser().catch(() => null);
                }
                if (!user) {
                    throw new Error("Sign in with Google to manage your plan.");
                }
                if (typeof renderSyncUI === "function") renderSyncUI();
            }

            const result =
                action === "portal"
                    ? await SubscriptionService.openBillingPortal()
                    : await SubscriptionService.startCheckout(targetPlan);

            if (status) {
                status.className = "stripe-billing-status is-success";
                status.textContent = result?.redirectedToPortal
                    ? "You already have a subscription — opened plan management."
                    : result?.trialDays > 0
                      ? "On Stripe add your card — $0 charged today."
                      : "Stripe opened in a new tab.";
            }
            startBillingPolling();
        } catch (error) {
            if (status) {
                status.className = "stripe-billing-status is-error";
                status.textContent = error.message || "Failed to open Stripe.";
            }
        } finally {
            isBillingBusy = false;
            button.innerHTML = originalButtonContent;
            button.classList.remove("is-loading");
            button.removeAttribute("aria-busy");
            if (grid) {
                grid.removeAttribute("aria-busy");
                grid.querySelectorAll("[data-billing-action]").forEach(
                    (item) => {
                        item.disabled = false;
                    },
                );
            }
            await refreshAiUsageUI();
        }
    });

let _billingPollInterval = null;
function startBillingPolling() {
    if (_billingPollInterval) clearInterval(_billingPollInterval);
    let attempts = 0;
    const maxAttempts = 12; // Poll every 3s for up to 36 seconds
    _billingPollInterval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(_billingPollInterval);
            _billingPollInterval = null;
            return;
        }
        try {
            const previous = await SubscriptionService.getCachedProfile();
            const updated = await SubscriptionService.refreshProfile(true);
            if (previous && updated && previous.plan !== updated.plan) {
                clearInterval(_billingPollInterval);
                _billingPollInterval = null;
                await SubscriptionService.applyPlanToUI();
                await refreshAiUsageUI();
                const status = document.getElementById("stripeBillingStatus");
                if (status) {
                    status.className = "stripe-billing-status is-success";
                    status.textContent = `Plan updated: ${SubscriptionConfig.getPlanLimits(updated.plan).displayName}!`;
                }
            }
        } catch (_) {}
    }, 3000);
}

if (location.hash === "#plans") {
    setTimeout(showAiPlans, 80);
}

let _subscriptionUiRefreshPromise = null;
let _subscriptionUiLastRefresh = 0;

function refreshSubscriptionUi() {
    if (_subscriptionUiRefreshPromise) return _subscriptionUiRefreshPromise;
    if (Date.now() - _subscriptionUiLastRefresh < 1000) {
        return Promise.resolve();
    }
    _subscriptionUiLastRefresh = Date.now();
    _subscriptionUiRefreshPromise = (async () => {
        await refreshAiUsageUI();
        await SubscriptionService.applyPlanToUI();
    })()
        .catch((error) => {
            console.warn("[Lectoro] Plan UI initialization:", error);
        })
        .finally(() => {
            _subscriptionUiRefreshPromise = null;
        });
    return _subscriptionUiRefreshPromise;
}

// One startup refresh. Focus, visibility and storage events reuse this same flight.
void refreshSubscriptionUi();

window.addEventListener("focus", () => {
    void refreshSubscriptionUi();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshSubscriptionUi();
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (
        area === "local" &&
        !isBillingBusy &&
        (changes.aiUsageCache ||
            changes.firebaseAuth ||
            changes.subscriptionProfileCache)
    ) {
        clearTimeout(_refreshAiUsageTimeout);
        _refreshAiUsageTimeout = setTimeout(() => {
            void refreshSubscriptionUi();
        }, 50);
    }
});
