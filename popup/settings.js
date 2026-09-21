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
    const privacyLink = document.getElementById("footerPrivacyLink") || document.querySelector('a[data-i18n="footer_privacy"]');
    if (privacyLink && typeof SharedI18n !== "undefined" && typeof SharedI18n.getPrivacyUrl === "function") {
        privacyLink.href = SharedI18n.getPrivacyUrl(activeLang);
    }
    const termsLink = document.getElementById("footerTermsLink") || document.querySelector('a[data-i18n="footer_terms"]');
    if (termsLink && typeof SharedI18n !== "undefined" && typeof SharedI18n.getTermsUrl === "function") {
        termsLink.href = SharedI18n.getTermsUrl(activeLang);
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
    const defaultSubFontSize = LectoroConstants.DEFAULT_SUBTITLE_SETTINGS.FONT_SIZE || "medium";
    const subFontSize = data.subtitleFontSize || defaultSubFontSize;
    updateSubFontSizeButtons(subFontSize);
    const ytFocusModeToggle = document.getElementById("ytFocusModeToggle");
    const ytFocusColorWrap = document.getElementById("ytFocusColorWrap");
    const ytFocusColorPicker = document.getElementById("ytFocusColorPicker");
    const initialFocusColor = data.youtubeFocusColor || "#6366f1";

    function updateFocusColorSelection(activeColor) {
        const color = (activeColor || "#6366f1").toLowerCase();
        const swatches = document.querySelectorAll("#ytFocusColorPalette .color-swatch");
        let matched = false;
        swatches.forEach((btn) => {
            const c = (btn.dataset.color || "").toLowerCase();
            if (c === color) {
                btn.classList.add("active");
                matched = true;
            } else {
                btn.classList.remove("active");
            }
        });
        const pickerLabel = document.getElementById("ytFocusColorPickerLabel");
        const picker = document.getElementById("ytFocusColorPicker");
        if (picker) picker.value = color;
        if (pickerLabel) {
            if (!matched) {
                pickerLabel.classList.add("active");
                pickerLabel.style.borderColor = color;
            } else {
                pickerLabel.classList.remove("active");
                pickerLabel.style.borderColor = "";
            }
        }
    }

    if (ytFocusModeToggle) {
        const isYtFocusActive = Boolean(data.youtubeFocusMode);
        ytFocusModeToggle.checked = isYtFocusActive;
        if (ytFocusColorWrap) {
            ytFocusColorWrap.style.display = isYtFocusActive ? "block" : "none";
        }
        ytFocusModeToggle.addEventListener("change", () => {
            const checked = ytFocusModeToggle.checked;
            if (ytFocusColorWrap) {
                ytFocusColorWrap.style.display = checked ? "block" : "none";
            }
            chrome.storage.local.set(
                { youtubeFocusMode: checked },
                flashSaved,
            );
        });
    }

    updateFocusColorSelection(initialFocusColor);

    const swatches = document.querySelectorAll("#ytFocusColorPalette .color-swatch");
    swatches.forEach((btn) => {
        btn.addEventListener("click", () => {
            const color = btn.dataset.color;
            if (color) {
                updateFocusColorSelection(color);
                chrome.storage.local.set({ youtubeFocusColor: color }, flashSaved);
            }
        });
    });

    if (ytFocusColorPicker) {
        ytFocusColorPicker.addEventListener("input", (e) => {
            const color = e.target.value;
            if (color) {
                updateFocusColorSelection(color);
                chrome.storage.local.set({ youtubeFocusColor: color }, flashSaved);
            }
        });
    }
    const voice = data.speechVoice || "";
    if (voice === "random") {
        chrome.storage.local.set({ speechVoice: "" });
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
const subFontSizeStorageKey = LectoroConstants.STORAGE_KEYS.SUBTITLE_FONT_SIZE || "subtitleFontSize";

bindPercentageSlider(subBgRange, subBgValue, subBgStorageKey, 0);

function updateSubFontSizeButtons(activeSize) {
    if (!subFontSizeGroup) return;
    const size = activeSize || LectoroConstants.DEFAULT_SUBTITLE_SETTINGS.FONT_SIZE || "medium";
    const buttons = subFontSizeGroup.querySelectorAll(".font-size-btn");
    buttons.forEach((btn) => {
        const isMatch = btn.dataset.size === size;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
    });
}

if (subFontSizeGroup) {
    subFontSizeGroup.addEventListener("click", (e) => {
        const btn = e.target.closest(".font-size-btn");
        if (!btn) return;
        const selectedSize = btn.dataset.size;
        if (!selectedSize) return;

        updateSubFontSizeButtons(selectedSize);

        if (typeof popupState === "object" && popupState !== null) {
            popupState[subFontSizeStorageKey] = selectedSize;
        }
        chrome.storage.local.set({ [subFontSizeStorageKey]: selectedSize }, flashSaved);
    });
}

// ── Subscription & AI Usage ──────────────────────────────────────
function getBlikLogoSvg(planId = "") {
    const gradId = `blikGrad_${planId || "default"}`;
    return `<svg class="blik-logo" viewBox="20 19 80 42" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <defs>
            <linearGradient id="${gradId}" x1="36.4" y1="30.6" x2="44.5" y2="22.7" gradientUnits="userSpaceOnUse">
                <stop stop-color="#E52F08"/>
                <stop offset="1" stop-color="#E94F96"/>
            </linearGradient>
        </defs>
        <path d="M46.1362 26.7057C46.1565 23.574 43.6343 21.0189 40.5027 20.9986C37.3711 20.9782 34.8159 23.5004 34.7956 26.632C34.7753 29.7636 37.2975 32.3188 40.4291 32.3391C43.5607 32.3595 46.1158 29.8373 46.1362 26.7057Z" fill="url(#${gradId})"/>
        <path d="M89.7466 58.7831H97.9114L88.1018 46.1135L96.997 35.2271H89.5914L80.8562 46.1815V22.8215H74.5162V58.7831H80.8562L80.8514 46.2119L89.7466 58.7831Z" fill="#fff"/>
        <path d="M50.5937 22.8167H56.9321V58.7815H50.5937V22.8167Z" fill="#fff"/>
        <path d="M62.5569 35.2255H68.8953V58.7815H62.5569V35.2255Z" fill="#fff"/>
        <path d="M34.1145 34.9903C32.13 34.9875 30.176 35.4779 28.4281 36.4175V22.8175H22.0889V47.0111C22.0882 49.3893 22.7929 51.7143 24.1136 53.692C25.4344 55.6697 27.3119 57.2114 29.5089 58.122C31.7058 59.0326 34.1235 59.2712 36.4561 58.8078C38.7887 58.3443 40.9315 57.1996 42.6134 55.5183C44.2954 53.837 45.441 51.6946 45.9054 49.3622C46.3698 47.0298 46.1321 44.6121 45.2224 42.4148C44.3126 40.2175 42.7717 38.3393 40.7945 37.0177C38.8173 35.6962 36.4927 34.9906 34.1145 34.9903ZM34.1145 52.7983C32.9701 52.7983 31.8514 52.459 30.8998 51.8232C29.9482 51.1874 29.2066 50.2837 28.7686 49.2265C28.3306 48.1692 28.216 47.0058 28.4392 45.8833C28.6624 44.7609 29.2134 43.7299 30.0226 42.9206C30.8317 42.1113 31.8627 41.5602 32.9851 41.3368C34.1075 41.1134 35.2709 41.2279 36.3283 41.6657C37.3856 42.1036 38.2894 42.8451 38.9253 43.7966C39.5612 44.748 39.9007 45.8667 39.9009 47.0111C39.9012 47.7711 39.7517 48.5237 39.4611 49.226C39.1704 49.9282 38.7442 50.5663 38.2068 51.1037C37.6695 51.6411 37.0314 52.0674 36.3293 52.3582C35.6271 52.649 34.8745 52.7985 34.1145 52.7983Z" fill="#fff"/>
    </svg>`;
}

function renderSubscriptionPlans(subscription, signedIn = true) {
    const grid = document.getElementById("subscriptionPlansGrid");
    if (!grid) return;
    const activePlan = signedIn
        ? SubscriptionConfig.normalizePlan(subscription?.plan)
        : SubscriptionConfig.SUBSCRIPTION_PLANS.FREE;
    const hasPaidPlan =
        signedIn && activePlan !== SubscriptionConfig.SUBSCRIPTION_PLANS.FREE;
    const isPrepaid = signedIn && subscription?.accessType === "prepaid";
    const trialEligible = !signedIn || subscription?.trialEligible !== false;
    const isTrialing =
        signedIn && subscription?.subscriptionStatus === "trialing";
    const trialBanner = document.getElementById("subscriptionTrialBanner");
    if (trialBanner) trialBanner.hidden = hasPaidPlan || !trialEligible;

    const lang = getPopupLang();
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
    const renderKey = `${activePlan}:${signedIn}:${hasPaidPlan}:${trialEligible}:${isTrialing}:${isPrepaid}:${subscription?.accessExpiresAt || 0}:${lang}`;
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
            const tts = limits.geminiTts.enabled
                ? `${limits.geminiTts.charactersPerMonth.toLocaleString(lang)} Gemini TTS`
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
            if (isPrepaid) {
                action = isCurrent
                    ? `<span class="subscription-plan-current">${t("plan_current")}</span>`
                    : `<span class="subscription-trial-note">${t("blik_change_after_expiry")}</span>`;
            }
            let blikAction = "";
            const showBlik = limits.prepaid && (lang === "pl" || isPrepaid) &&
                (!hasPaidPlan || (isPrepaid && isCurrent));
            if (showBlik) {
                const blikPrice = (limits.prepaid.amountMinor / 100).toLocaleString("pl-PL", {
                    style: "currency", currency: "PLN",
                });
                const blikBtnContent = isPrepaid
                    ? `<span class="blik-brand-group">
                        ${getBlikLogoSvg(planId)}
                        <span class="blik-extend-text">${t("blik_extend")}</span>
                    </span>
                    <span class="blik-price-pill">${blikPrice}</span>`
                    : `<span class="blik-lead">${t("blik_pay_lead")}</span>
                    ${getBlikLogoSvg(planId)}
                    <span class="blik-price-strong">· ${blikPrice}</span>`;

                blikAction = `<div class="subscription-blik-option">
                    <button type="button" class="subscription-plan-button is-blik ${isPrepaid ? "is-extend" : ""}" data-billing-action="blik" data-plan="${planId}" aria-label="${t(isPrepaid ? "blik_extend" : "blik_pay")}: ${blikPrice}">
                        ${blikBtnContent}
                    </button>
                    <span class="subscription-trial-note">${t("blik_terms")}</span>
                    ${isPrepaid ? `<span class="subscription-trial-note">${t("blik_access_until", {
                        date: new Date(Number(subscription.accessExpiresAt)).toLocaleDateString(lang),
                    })}</span>` : ""}
                </div>`;
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
    <b>${Number.isFinite(limits.ai.usesPerMonth) ? limits.ai.usesPerMonth.toLocaleString(lang) : t("unlimited")}</b>
    ${aiUsesText}
</span>
                    <span><i aria-hidden="true">✓</i><b>${Number.isFinite(limits.srs.maxSavedCards) ? limits.srs.maxSavedCards.toLocaleString(lang) : t("unlimited")}</b> ${t("feature_srs_flashcards")}</span>
                    <span><i aria-hidden="true">✓</i><b>${planId === SubscriptionConfig.SUBSCRIPTION_PLANS.FREE ? "3/mo" : t("unlimited")}</b> ${t("feature_export")}</span>
                    ${limits.geminiTts.enabled
                    ? `<span><i aria-hidden="true">✓</i><b>${t("feature_natural_voices")}</b></span>`
                    : ""
                }
                    ${limits.geminiTts.enabled
                    ? `<span><i aria-hidden="true">✓</i><b>${t("feature_unlimited_practice")}</b></span>`
                    : ""
                }
                    <span class="${limits.geminiTts.enabled ? "" : "is-muted"}"><i aria-hidden="true">${limits.geminiTts.enabled ? "✓" : "—"}</i>${tts}</span>
                </div>
                <div class="subscription-plan-action">${action}${billingNote}${blikAction}</div>
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

function renderGeminiTtsUsage(subscription) {
    const card = document.getElementById("geminiTtsUsageCard");
    const title = document.getElementById("geminiTtsUsageTitle");
    const value = document.getElementById("geminiTtsUsageValue");
    const info = document.getElementById("geminiTtsUsageInfo");
    const track = document.getElementById("geminiTtsUsageTrack");
    const fill = document.getElementById("geminiTtsUsageFill");
    if (!card || !subscription) return;

    const lang = getPopupLang();
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
    const plan = SubscriptionConfig.normalizePlan(subscription.plan);
    const limits = SubscriptionConfig.getPlanLimits(plan).geminiTts;
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
        if (title) title.textContent = t("gemini_unavailable");
        if (value) value.textContent = t("status_unavailable");
        if (fill) fill.style.width = "0%";
        if (info) info.textContent = t("gemini_from_basic");
        return;
    }

    if (value) value.textContent = `${used} / ${limit}`;
    if (fill) fill.style.width = `${percentage}%`;
    if (limitReached) {
        card.classList.add("is-empty");
        if (title) title.textContent = t("gemini_limit_reached");
        if (info) info.textContent = `Gemini TTS: ${t("gemini_chars_left", { left: 0 })}`;
    } else {
        if (percentage >= 80) card.classList.add("is-warning");
        const formattedLeft = left.toLocaleString(lang === "pl" ? "pl-PL" : "en-US");
        if (title)
            title.textContent = t("gemini_chars_left", { left: formattedLeft });
        if (info)
            info.textContent = `Gemini TTS: ${t("gemini_chars_left", { left: formattedLeft })}`;
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

    renderGeminiTtsUsage(subscription);

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

    usageCardContainer?.classList.remove("is-warning", "is-empty");
    card?.classList.remove("is-warning", "is-empty");
    fill?.classList.remove("is-loading");

    const currentPlan = SubscriptionConfig.normalizePlan(
        subscription?.plan || usage?.plan,
    );
    const isPaidPlan = currentPlan !== "free";
    const isUnlimited = SubscriptionConfig.getPlanLimits(currentPlan)?.ai?.usesPerMonth === Infinity;
    const limitReached = !isUnlimited && !!(usage?.limit > 0 && usage.used >= usage.limit);

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

    if (isUnlimited) {
        const used = usage ? Math.max(0, Number(usage.used || 0)) : "—";
        const label = t("credits_unlimited");
        if (title) title.textContent = label;
        if (value) value.textContent = `${used} / ∞`;
        if (fill) fill.style.width = "100%";
        if (track) {
            track.setAttribute("aria-valuenow", "100");
            track.setAttribute("aria-valuetext", label);
        }
        info.textContent = label;
        if (renewalDate) renewalDate.textContent = "";
    } else if (usage) {
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
        info.textContent = t("could_not_refresh_ai_usage");
        if (renewalDate) renewalDate.textContent = "";
    }

    const quizButton = document.getElementById("exportQuiz");
    if (quizButton) {
        quizButton.classList.toggle("credits-empty", limitReached);
        quizButton.setAttribute("aria-disabled", String(limitReached));
        const labelEl = quizButton.querySelector(".quiz-btn-label");
        if (labelEl) {
            labelEl.textContent = limitReached ? t("quiz_out_of_credits") : t("quiz_ai_btn");
        } else {
            quizButton.textContent = limitReached
                ? t("quiz_out_of_credits")
                : t("quiz_ai_btn");
        }
        quizButton.title = limitReached
            ? t("quiz_btn_out_of_ai")
            : t("quiz_ai_title");
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
            '<span class="ai-loader-label">✨ Processing</span>';
        grid?.setAttribute("aria-busy", "true");

        if (status) {
            status.className = "stripe-billing-status is-loading";
            status.innerHTML =
                '<span class="ai-loader-label">✨ Opening secure checkout...</span>';
        }

        try {
            let user =
                typeof FirebaseSync !== "undefined"
                    ? await FirebaseSync.getUser().catch(() => null)
                    : null;

            if (
                !user &&
                (action === "checkout" || action === "blik" || action === "sign-in-and-checkout")
            ) {
                if (status) {
                    status.className = "stripe-billing-status is-loading";
                    status.innerHTML =
                        '<span class="ai-loader-label">✨ Signing in with Google...</span>';
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
                    : await SubscriptionService.startCheckout(targetPlan, action === "blik" ? "blik" : "subscription");

            if (status) {
                const lang = getPopupLang();
                const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
                status.className = "stripe-billing-status is-success";
                status.textContent = result?.redirectedToPortal
                    ? t("status_portal_redirect")
                    : result?.trialDays > 0
                        ? t("status_stripe_trial")
                        : t("status_stripe_opened");
            }
            startBillingPolling();
        } catch (error) {
            if (status) {
                const lang = getPopupLang();
                const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
                status.className = "stripe-billing-status is-error";
                status.textContent = error.message || t("status_stripe_error");
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
                    const lang = getPopupLang();
                    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);
                    status.className = "stripe-billing-status is-success";
                    status.textContent = t("status_plan_updated", { plan: SubscriptionConfig.getPlanLimits(updated.plan).displayName });
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

function refreshSubscriptionUi(force = false) {
    if (_subscriptionUiRefreshPromise) return _subscriptionUiRefreshPromise;
    if (Date.now() - _subscriptionUiLastRefresh < 1000) {
        return Promise.resolve();
    }
    _subscriptionUiLastRefresh = Date.now();
    _subscriptionUiRefreshPromise = (async () => {
        if (force) await SubscriptionService.refreshProfile(true);
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

// Refresh authoritative billing state on entry; storage events reuse the cache.
void refreshSubscriptionUi(true);

window.addEventListener("focus", () => {
    void refreshSubscriptionUi(true);
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshSubscriptionUi(true);
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
        if (changes[subBgStorageKey] && subBgRange && document.activeElement !== subBgRange) {
            const val = changes[subBgStorageKey].newValue ?? 0;
            subBgRange.value = val;
            if (subBgValue) subBgValue.textContent = `${val}%`;
        }
        if (changes[subFontSizeStorageKey]) {
            const val = changes[subFontSizeStorageKey].newValue || LectoroConstants.DEFAULT_SUBTITLE_SETTINGS.FONT_SIZE || "medium";
            updateSubFontSizeButtons(val);
        }
        if (changes.youtubeFocusMode) {
            const toggle = document.getElementById("ytFocusModeToggle");
            const wrap = document.getElementById("ytFocusColorWrap");
            const isChecked = Boolean(changes.youtubeFocusMode.newValue);
            if (toggle) {
                toggle.checked = isChecked;
            }
            if (wrap) {
                wrap.style.display = isChecked ? "block" : "none";
            }
        }
        if (changes.youtubeFocusColor) {
            const swatches = document.querySelectorAll("#ytFocusColorPalette .color-swatch");
            const color = (changes.youtubeFocusColor.newValue || "#6366f1").toLowerCase();
            let matched = false;
            swatches.forEach((btn) => {
                const c = (btn.dataset.color || "").toLowerCase();
                if (c === color) {
                    btn.classList.add("active");
                    matched = true;
                } else {
                    btn.classList.remove("active");
                }
            });
            const pickerLabel = document.getElementById("ytFocusColorPickerLabel");
            const picker = document.getElementById("ytFocusColorPicker");
            if (picker) picker.value = color;
            if (pickerLabel) {
                if (!matched) {
                    pickerLabel.classList.add("active");
                    pickerLabel.style.borderColor = color;
                } else {
                    pickerLabel.classList.remove("active");
                    pickerLabel.style.borderColor = "";
                }
            }
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
