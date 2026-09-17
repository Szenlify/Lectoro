// ── Settings: load & save language ────────────────────────────────
const learningLangSelect = document.getElementById("learningLang");
const swapLanguagesButton = document.getElementById("swapLanguages");

function getPopupLang() {
    return select?.value || popupState?.targetLang || "en";
}

function applyPopupTranslations(lang = null) {
    const activeLang = lang || getPopupLang();
    if (typeof SharedI18n !== "undefined") {
        SharedI18n.applyToDOM(document, activeLang);
    }
    const grid = document.getElementById("subscriptionPlansGrid");
    if (grid) {
        grid.dataset.renderedKey = "";
    }
    void refreshSubscriptionUi();
}

async function swapTranslationLanguages() {
    if (swapLanguagesButton.disabled) return;
    swapLanguagesButton.disabled = true;
    const learningLang = select.value;
    const targetLang = learningLangSelect.value;
    try {
        await chrome.storage.local.set({ learningLang, targetLang });
        learningLangSelect.value = learningLang;
        select.value = targetLang;
        applyPopupTranslations(targetLang);
        flashSaved();
    } catch (error) {
        swapLanguagesButton.title = "Could not swap languages. Try again.";
    } finally {
        swapLanguagesButton.disabled = false;
    }
}
swapLanguagesButton.addEventListener("click", swapTranslationLanguages);
learningLangSelect.replaceChildren(...Array.from(select.options, (option) => option.cloneNode(true)));
whenPopupReady((data) => {
    const defaults = LectoroConstants.DEFAULT_READING_SETTINGS;
    const targetLang = LectoroConstants.normalizeSupportedLanguage(data.targetLang, defaults.targetLang);
    const learningLang = LectoroConstants.normalizeSupportedLanguage(data.learningLang, defaults.learningLang);
    select.value = targetLang;
    learningLangSelect.value = learningLang;
    applyPopupTranslations(targetLang);
    // Retired languages and existing installs receive usable settings immediately.
    if (data.targetLang !== targetLang || data.learningLang !== learningLang) {
        chrome.storage.local.set({ targetLang, learningLang });
    }
    rateRange.value = data.speechRate || 1.1;
    rateValue.textContent = parseFloat(data.speechRate || 1.1).toFixed(2);
    if (data.ttsVolume !== undefined && volumeRange) {
        volumeRange.value = data.ttsVolume;
        volumeValue.textContent = Math.round(data.ttsVolume * 100) + "%";
    }
    const defaultSubBg = LectoroConstants.DEFAULT_SUBTITLE_SETTINGS.BG_OPACITY;


    const subBg = data.subtitleBgOpacity !== undefined ? data.subtitleBgOpacity : defaultSubBg;
    if (subBgRange) {
        subBgRange.value = subBg;
        if (subBgValue) subBgValue.textContent = `${subBg}%`;
    }
    const voice = data.speechVoice || "";
    if (voice === "random") {
        chrome.storage.local.set({ speechVoice: "" });
    }

    if (doubleSubtitlesToggle) {
        doubleSubtitlesToggle.checked = data.doubleSubtitles !== undefined ? !!data.doubleSubtitles : true;
    }
});

select.addEventListener("change", () => {
    const newLang = select.value;
    chrome.storage.local.set({ targetLang: newLang }, flashSaved);
    applyPopupTranslations(newLang);
});

learningLangSelect.addEventListener("change", () => {
    chrome.storage.local.set({ learningLang: learningLangSelect.value }, flashSaved);
});

// ── Subtitle reading modes ───────────────────────────────────────
const doubleSubtitlesToggle = document.getElementById("doubleSubtitles");

if (doubleSubtitlesToggle) {
    doubleSubtitlesToggle.addEventListener("change", () => {
        chrome.storage.local.set(
            { doubleSubtitles: doubleSubtitlesToggle.checked },
            flashSaved,
        );
    });
}

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

// ── Subtitle position & background sliders (DRY) ──────────────────
function bindPercentageSlider(rangeEl, valueEl, storageKey, fallback = 0) {
    if (!rangeEl) return;
    let saveTimeout = null;
    const save = () => {
        const parsed = parseInt(rangeEl.value, 10);
        const val = isNaN(parsed) ? fallback : Math.max(0, Math.min(100, parsed));
        if (typeof popupState === "object" && popupState !== null) {
            popupState[storageKey] = val;
        }
        chrome.storage.local.set({ [storageKey]: val }, flashSaved);
    };

    rangeEl.addEventListener("input", () => {
        if (valueEl) valueEl.textContent = `${rangeEl.value}%`;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(save, 150);
    });
    rangeEl.addEventListener("change", () => {
        clearTimeout(saveTimeout);
        save();
    });
}

const subBgStorageKey = LectoroConstants.STORAGE_KEYS.SUBTITLE_BG_OPACITY;

bindPercentageSlider(subBgRange, subBgValue, subBgStorageKey, 0);

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

    const lang = getPopupLang();
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
    const renderKey = `${activePlan}:${signedIn}:${hasPaidPlan}:${trialEligible}:${isTrialing}:${lang}`;
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
            const localizedPrice = typeof SharedI18n !== "undefined" && SharedI18n.getLocalizedPrice
                ? SharedI18n.getLocalizedPrice(planId, lang)
                : null;
            const price = localizedPrice
                ? localizedPrice.formatted
                : (limits.priceMonthly.amount === 0
                    ? (lang === "pl" ? "0 zł" : "$0")
                    : `$${limits.priceMonthly.amount}`);
            const tts = limits.elevenLabs.enabled
                ? `${limits.elevenLabs.charactersPerMonth.toLocaleString(lang)} ElevenLabs`
                : t("basic_voice");
            let action =
                `<span class="subscription-plan-current">${t("plan_current")}</span>`;
            if (!isCurrent) {
                if (planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE) {
                    action = hasPaidPlan
                        ? `<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">${t("manage_on_stripe")}</span></button>`
                        : "";
                } else if (hasPaidPlan) {
                    action =
                        `<button type="button" class="subscription-plan-button" data-billing-action="portal"><span class="subscription-button-label">${t("change_plan")}</span><span aria-hidden="true">→</span></button>`;
                } else {
                    const btnLabel = hasTrialOffer ? t("start_trial") : t("choose_plan", { name: limits.displayName });
                    action = `<button type="button" class="subscription-plan-button ${hasTrialOffer ? "is-trial" : ""}" data-billing-action="checkout" data-plan="${planId}"><span class="subscription-button-label">${btnLabel}</span><span aria-hidden="true">→</span></button>`;
                }
            } else if (hasPaidPlan) {
                action =
                    `<button type="button" class="subscription-plan-button is-secondary" data-billing-action="portal"><span class="subscription-button-label">${t("manage_plan")}</span><span aria-hidden="true">→</span></button>`;
            }
            const billingNote = hasTrialOffer
                ? `<span class="subscription-trial-note">${t("billing_note_trial", { price })}</span>`
                : "";

            const subtitleLimitText = Number.isFinite(limits.subtitles?.charactersPerHour)
                ? t("chars_per_hour", { count: limits.subtitles.charactersPerHour.toLocaleString(lang) })
                : t("unlimited");
            const aiUsesText = planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE
                ? t("feature_ai_uses")
                : t("feature_ai_uses_mo");

            return `<article class="subscription-plan-card ${isCurrent ? "is-current" : ""} ${isRecommended ? "is-recommended" : ""} ${hasTrialOffer ? "has-trial-offer" : ""}">
                <div class="subscription-plan-topline">
                    <strong>${limits.displayName}</strong>
                    ${isCurrent && isTrialing
                    ? `<span class="subscription-plan-badge is-trialing">${t("badge_trial")}</span>`
                    : isCurrent
                        ? `<span class="subscription-plan-badge is-active">${t("badge_active")}</span>`
                        : isRecommended
                            ? `<span class="subscription-plan-badge">${t("badge_popular")}</span>`
                            : ""
                }
                </div>
                ${hasTrialOffer ? `<div class="subscription-plan-trial-kicker">${t("trial_kicker")}</div>` : ""}
                <div class="subscription-plan-price"><b>${price}</b><span>${limits.priceMonthly.amount === 0 ? t("price_forever") : t("price_per_month")}</span></div>
                <div class="subscription-plan-features">
                    <span>
    <i aria-hidden="true">✓</i>
    <b>${subtitleLimitText}</b> ${t("feature_translate")}
</span>
                    <span>
    <i aria-hidden="true">✓</i>
    <b>${limits.ai.usesPerMonth.toLocaleString(lang)}</b>
    ${aiUsesText}
</span>
                    <span><i aria-hidden="true">✓</i><b>${limits.srs.maxSavedCards.toLocaleString(lang)}</b> ${t("feature_srs_flashcards")}</span>
                    <span><i aria-hidden="true">✓</i><b>${planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE ? "3/mo" : t("unlimited")}</b> ${t("feature_export")}</span>
                    ${limits.elevenLabs.enabled
                    ? `<span><i aria-hidden="true">✓</i><b>${t("feature_natural_voices")}</b></span>`
                    : ""
                }
                    ${limits.elevenLabs.enabled
                    ? `<span><i aria-hidden="true">✓</i><b>${t("feature_unlimited_practice")}</b></span>`
                    : ""
                }
                    <span class="${limits.elevenLabs.enabled ? "" : "is-muted"}"><i aria-hidden="true">${limits.elevenLabs.enabled ? "✓" : "—"}</i>${tts}</span>
                </div>
                <div class="subscription-plan-action">${action}${billingNote}</div>
            </article>`;
        })
        .join("");

    initSubscriptionCarousel(grid);
}

/* Subscription Carousel Navigation */
function initSubscriptionCarousel(grid) {
    if (!grid) return;
    const cards = grid.querySelectorAll(".subscription-plan-card");
    if (cards.length === 0) return;

    const btn = document.getElementById("carouselNext");
    if (!btn) return;

    let scrolledToEnd = false;

    function updateArrow() {
        const maxScroll = grid.scrollWidth - grid.clientWidth;
        scrolledToEnd = grid.scrollLeft >= maxScroll - 4;
        btn.classList.toggle("is-scrolled-end", scrolledToEnd);
        const carousel = document.getElementById("subscriptionCarousel");
        if (carousel) carousel.classList.toggle("is-scrolled-end", scrolledToEnd);
    }

    btn.addEventListener("click", () => {
        if (scrolledToEnd) {
            grid.scrollTo({ left: 0, behavior: "smooth" });
        } else {
            grid.scrollBy({ left: grid.clientWidth * 0.55, behavior: "smooth" });
        }
    });

    grid.addEventListener("scroll", updateArrow, { passive: true });
    updateArrow();
}

function renderElevenLabsUsage(subscription) {
    const card = document.getElementById("elevenLabsUsageCard");
    const title = document.getElementById("elevenLabsUsageTitle");
    const value = document.getElementById("elevenLabsUsageValue");
    const info = document.getElementById("elevenLabsUsageInfo");
    const track = document.getElementById("elevenLabsUsageTrack");
    const fill = document.getElementById("elevenLabsUsageFill");
    if (!card || !subscription) return;

    const lang = getPopupLang();
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
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
        if (title) title.textContent = t("elevenlabs_unavailable");
        if (value) value.textContent = t("status_unavailable");
        if (fill) fill.style.width = "0%";
        if (info) info.textContent = t("elevenlabs_from_basic");
        return;
    }

    if (value) value.textContent = `${used} / ${limit}`;
    if (fill) fill.style.width = `${percentage}%`;
    if (limitReached) {
        card.classList.add("is-empty");
        if (title) title.textContent = t("elevenlabs_limit_reached");
        if (info) info.textContent = `ElevenLabs: ${t("elevenlabs_chars_left", { left: 0 })}`;
    } else {
        if (percentage >= 80) card.classList.add("is-warning");
        const formattedLeft = left.toLocaleString(lang === "pl" ? "pl-PL" : "en-US");
        if (title)
            title.textContent = t("elevenlabs_chars_left", { left: formattedLeft });
        if (info)
            info.textContent = `ElevenLabs: ${t("elevenlabs_chars_left", { left: formattedLeft })}`;
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
    const planBadge = document.getElementById("aiPlanBadge");
    const upgradeBtn = document.getElementById("usageUpgradeBtn");

    const user =
        typeof FirebaseSync !== "undefined"
            ? await FirebaseSync.getUser().catch(() => null)
            : null;
    const signedIn = !!user;

    if (usageSection) usageSection.hidden = false;
    if (plansSection) plansSection.hidden = false;

    const subscription = await SubscriptionService.effectiveProfile(false);

    // Don't re-render subscription plans DOM if a checkout/portal click is currently processing
    if (!isBillingBusy) {
        renderSubscriptionPlans(subscription, signedIn);
    }

    renderElevenLabsUsage(subscription);

    let usage = null;
    if (signedIn) {
        usage = await GeminiProxy.refreshUsage(false).catch(() =>
            GeminiProxy.getCachedUsage(),
        );

        if (
            usage &&
            SubscriptionConfig.normalizePlan(usage.plan) !==
            SubscriptionConfig.normalizePlan(subscription.plan)
        ) {
            usage = await GeminiProxy.refreshUsage(true).catch(() => usage);
        }
    } else {
        usage = await GeminiProxy.getCachedUsage().catch(() => null);
        if (!usage) {
            const freeLimit = SubscriptionConfig.getPlanLimits("free")?.ai?.usesPerMonth || 15;
            usage = {
                plan: "free",
                used: 0,
                limit: freeLimit,
                remaining: freeLimit,
            };
        }
    }

    const usageCardContainer = document.getElementById("aiUsageCard");
    const card = document.getElementById("aiUsageMeter");
    const title = document.getElementById("aiUsageTitle");
    const value = document.getElementById("aiUsageValue");
    const track = document.getElementById("aiUsageTrack");
    const fill = document.getElementById("aiUsageFill");
    const limitReached = !!(usage?.limit > 0 && usage.used >= usage.limit);

    usageCardContainer?.classList.remove("is-warning", "is-empty");
    card?.classList.remove("is-warning", "is-empty");
    fill?.classList.remove("is-loading");

    const currentPlan = SubscriptionConfig.normalizePlan(
        subscription?.plan || usage?.plan,
    );
    const isPaidPlan = currentPlan !== "free";

    const lang = getPopupLang();
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);

    if (planBadge) {
        if (isPaidPlan) {
            planBadge.textContent = `${currentPlan.toUpperCase()} ${t("badge_plan")}`;
            planBadge.className = "ai-plan-badge is-pro";
        } else if (signedIn) {
            planBadge.textContent = t("plan_free");
            planBadge.className = "ai-plan-badge";
        } else {
            planBadge.textContent = t("guest_mode");
            planBadge.className = "ai-plan-badge is-guest";
        }
    }

    if (upgradeBtn) {
        if (isPaidPlan) {
            upgradeBtn.textContent = t("manage_plan");
            upgradeBtn.dataset.billingAction = "portal";
        } else {
            upgradeBtn.textContent = t("unlock_pro_trial");
            delete upgradeBtn.dataset.billingAction;
        }
    }

    if (usage) {
        const used = Math.max(0, Number(usage.used || 0));
        const limit = Math.max(0, Number(usage.limit || 0)) || 15;
        const left = Math.max(0, limit - used);
        const percentage = limit
            ? Math.min(100, Math.round((used / limit) * 100))
            : 0;

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

        if (value) value.textContent = `${used} / ${limit}`;
        if (fill) fill.style.width = `${percentage}%`;
        if (track) {
            track.setAttribute("aria-valuenow", String(percentage));
            track.setAttribute(
                "aria-valuetext",
                `${used} of ${limit} AI credits used`,
            );
        }

        if (limitReached) {
            usageCardContainer?.classList.add("is-empty");
            card?.classList.add("is-empty");
            if (title) title.textContent = t("credits_limit_reached");
            if (isPaidPlan) {
                info.textContent = t("credits_renewal_prefix");
            } else {
                info.textContent = t("credits_renew_monthly");
            }
        } else {
            if (percentage >= 80) {
                usageCardContainer?.classList.add("is-warning");
                card?.classList.add("is-warning");
            }
            if (title)
                title.textContent = t("credits_remaining", { left });
            if (isPaidPlan) {
                info.textContent = t("credits_renewal_prefix");
            } else if (signedIn) {
                info.textContent = t("credits_renew_monthly");
            } else {
                info.textContent = t("sign_in_to_sync");
            }
        }
    } else {
        if (title) title.textContent = t("data_unavailable");
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
    .getElementById("usageUpgradeBtn")
    ?.addEventListener("click", (e) => {
        if (e.currentTarget?.dataset?.billingAction === "portal") {
            SubscriptionService.openBillingPortal().catch(() => showAiPlans());
        } else {
            showAiPlans();
        }
    });

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
            '<span class="ai-loader-label review-ai-loader-label">✨ Processing</span>';
        grid?.setAttribute("aria-busy", "true");

        if (status) {
            status.className = "stripe-billing-status is-loading";
            status.innerHTML =
                '<span class="ai-loader-label review-ai-loader-label">✨ Opening secure checkout...</span>';
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
                        '<span class="ai-loader-label review-ai-loader-label">✨ Signing in with Google...</span>';
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
        } catch (_) { }
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
    if (area === "local") {
        if (changes[subBgStorageKey] && subBgRange && document.activeElement !== subBgRange) {
            const val = changes[subBgStorageKey].newValue ?? 0;
            subBgRange.value = val;
            if (subBgValue) subBgValue.textContent = `${val}%`;
        }
        if (
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
    }
});
