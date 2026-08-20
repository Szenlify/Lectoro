/** Client-side subscription profile cache, validation and paywall helpers. */
const SubscriptionService = (() => {
    "use strict";

    const PROFILE_KEY = "subscriptionProfileCache";
    const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL to minimize Firestore reads
    const PROXY_URL = "https://geminiproxy-gyagzflbra-ew.a.run.app";
    const BILLING_FUNCTIONS_URL =
        "https://europe-west1-extension-eng.cloudfunctions.net";
    const Config = SubscriptionConfig;

    function currentMonth() {
        return typeof SharedUtils !== "undefined" && SharedUtils.currentMonth
            ? SharedUtils.currentMonth()
            : new Date().toISOString().slice(0, 7);
    }

    function freeProfile(uid = "") {
        const month = currentMonth();
        return {
            uid,
            plan: Config.SUBSCRIPTION_PLANS.FREE,
            subscriptionStatus: "active",
            usage: {
                ai: { month, used: 0 },
                elevenLabsCharacters: { month, used: 0 },
            },
            updatedAt: Date.now(),
        };
    }

    async function getCachedProfile() {
        const data = await chrome.storage.local.get({ [PROFILE_KEY]: null });
        return data[PROFILE_KEY];
    }

    async function setCachedProfile(profile, aiUsage = null) {
        if (!profile) return null;
        const previous = await getCachedProfile();
        const normalized = {
            ...freeProfile(profile.uid || ""),
            ...profile,
            plan: Config.normalizePlan(profile.plan),
            usage: {
                ai: {
                    month: profile.usage?.ai?.month || currentMonth(),
                    used: Math.max(0, Number(profile.usage?.ai?.used) || 0),
                },
                elevenLabsCharacters: {
                    month:
                        profile.usage?.elevenLabsCharacters?.month || currentMonth(),
                    used: Math.max(
                        0,
                        Number(profile.usage?.elevenLabsCharacters?.used) || 0,
                    ),
                },
            },
            updatedAt: Date.now(),
        };
        const planChanged =
            previous?.uid === normalized.uid &&
            Config.normalizePlan(previous.plan) !== normalized.plan;
        const geminiProxy =
            typeof globalThis !== "undefined" ? globalThis.GeminiProxy : null;
        const normalizedAiUsage =
            aiUsage && typeof geminiProxy?.normalizeUsage === "function"
                ? geminiProxy.normalizeUsage(aiUsage, normalized.uid)
                : null;
        const aiUsageUpdate = {};
        if (normalizedAiUsage) {
            aiUsageUpdate.aiUsageCache = normalizedAiUsage;
        } else if (planChanged) {
            const limits = Config.getPlanLimits(normalized.plan);
            const currentAiUsed = normalized.usage?.ai?.used || 0;
            aiUsageUpdate.aiUsageCache = {
                uid: normalized.uid,
                month: currentMonth(),
                plan: normalized.plan,
                used: currentAiUsed,
                limit: limits.ai.usesPerMonth,
                remaining: Math.max(0, limits.ai.usesPerMonth - currentAiUsed),
                updatedAt: Date.now(),
            };
        }
        // AI usage contains a plan-specific limit. Store usage returned with
        // a profile refresh or immediately reset to new plan limits on change.
        await chrome.storage.local.set({
            [PROFILE_KEY]: normalized,
            ...aiUsageUpdate,
        });
        return normalized;
    }

    async function getToken(forceRefresh = false) {
        if (typeof FirebaseSync === "undefined") return null;
        return FirebaseSync.getValidToken(forceRefresh).catch(() => null);
    }

    async function refreshProfile(force = false) {
        const user = await FirebaseSync.getUser().catch(() => null);
        if (!user) return freeProfile();
        const cached = await getCachedProfile();
        const current = currentMonth();
        const cacheIsFresh =
            cached?.uid === user.uid &&
            cached?.usage?.ai?.month === current &&
            cached?.usage?.elevenLabsCharacters?.month === current &&
            Date.now() - Number(cached?.updatedAt || 0) < CACHE_TTL_MS;
        if (!force && cacheIsFresh) {
            return cached;
        }

        const tokenResult = await FirebaseSync.getIdTokenResult(force).catch(() => null);
        const token = tokenResult?.token;
        if (!token) return cached?.uid === user.uid ? cached : freeProfile(user.uid);
        const claimedPlan = Config.normalizePlan(tokenResult.claims?.plan);
        const response = await fetch(PROXY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: "subscription" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Błąd profilu (${response.status})`);

        const authoritativePlan = Config.normalizePlan(data.profile?.plan || claimedPlan);

        // If the server's Firestore-backed profile differs from the local token claim,
        // force a background refresh of the token so custom claims in Firebase Auth catch up.
        if (authoritativePlan !== claimedPlan) {
            FirebaseSync.getIdTokenResult(true).catch(() => {});
        }

        return setCachedProfile(
            {
                ...(data.profile || freeProfile(user.uid)),
                plan: authoritativePlan,
            },
            data.usage,
        );
    }

    async function effectiveProfile(force = false) {
        const user = await FirebaseSync.getUser().catch(() => null);
        if (!user) return freeProfile();
        const cached = await getCachedProfile();
        const cacheIsFresh =
            cached?.uid === user.uid &&
            cached?.usage?.ai?.month === currentMonth() &&
            cached?.usage?.elevenLabsCharacters?.month === currentMonth() &&
            Date.now() - Number(cached?.updatedAt || 0) < CACHE_TTL_MS;
        if (!force && cacheIsFresh) return cached;
        return refreshProfile(force);
    }

    async function checkSrsSave(savedCards, additionalCards = 1) {
        const profile = await effectiveProfile(false);
        return Config.checkSrsLimit({
            plan: profile.plan,
            savedCards,
            additionalCards,
        });
    }

    async function checkElevenLabs(text) {
        const profile = await effectiveProfile(false);
        return Config.checkElevenLabsLimit({
            plan: profile.plan,
            text,
            usedCharacters: profile.usage.elevenLabsCharacters.used,
        });
    }

    async function synthesizeElevenLabs(text, voiceId, context = "") {
        if (context !== "review") {
            throw new Error("ElevenLabs jest dostępny wyłącznie w powtórkach.");
        }
        const localValidation = await checkElevenLabs(text);
        Config.assertAllowed(localValidation);
        const token = await getToken();
        if (!token) {
            throw new Error("Zaloguj się, aby korzystać z ElevenLabs.");
        }
        const response = await fetch(PROXY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                action: "synthesizeElevenLabs",
                context,
                text,
                voiceId,
            }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            if (data.profile) await setCachedProfile(data.profile);
            if (data.limit) throw new Config.SubscriptionLimitError(data.limit);
            const error = new Error(
                data.error || `ElevenLabs jest niedostępny (${response.status})`,
            );
            error.code = data.code || "ELEVENLABS_REQUEST_FAILED";
            throw error;
        }
        const profile = await effectiveProfile(false);
        profile.plan = Config.normalizePlan(response.headers.get("X-Lectoro-Plan") || profile.plan);
        profile.usage.elevenLabsCharacters = {
            month: currentMonth(),
            used: Math.max(
                0,
                Number(response.headers.get("X-Lectoro-TTS-Used")) ||
                    profile.usage.elevenLabsCharacters.used + localValidation.requested,
            ),
        };
        await setCachedProfile(profile);
        const limits = Config.getPlanLimits(profile.plan).elevenLabs;
        if (
            limits.enabled &&
            profile.usage.elevenLabsCharacters.used >= limits.charactersPerMonth
        ) {
            showUpgradePrompt({
                feature: "elevenLabs",
                code: Config.LIMIT_ERROR_CODES.ELEVENLABS_MONTHLY_LIMIT_REACHED,
                message: `Wykorzystano miesięczny limit ${limits.charactersPerMonth} znaków ElevenLabs. Do odnowienia używany będzie głos systemowy.`,
            });
        }
        return response.blob();
    }

    async function getElevenLabsVoices(context = "") {
        if (context !== "review") {
            throw new Error("Głosy ElevenLabs są dostępne wyłącznie w powtórkach.");
        }
        const profile = await effectiveProfile(false);
        if (!Config.getPlanLimits(profile.plan).elevenLabs.enabled) {
            Config.assertAllowed(Config.checkElevenLabsLimit({ plan: profile.plan, text: "a" }));
        }
        const token = await getToken();
        if (!token) throw new Error("Zaloguj się, aby pobrać głosy ElevenLabs.");
        const response = await fetch(PROXY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: "elevenLabsVoices", context }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Błąd głosów (${response.status})`);
        return data.voices || [];
    }

    async function updateAiUsage(usage) {
        if (!usage) return null;
        const user = await FirebaseSync.getUser().catch(() => null);
        const profile =
            (await getCachedProfile()) || freeProfile(user?.uid || usage.uid || "");
        profile.plan = Config.normalizePlan(usage.plan || profile.plan);
        profile.usage.ai = {
            month: currentMonth(),
            used: Math.max(0, Number(usage.used) || 0),
        };
        return setCachedProfile(profile);
    }

    async function billingRequest(functionName, body = {}) {
        const token = await getToken(true);
        if (!token) throw new Error("Zaloguj się, aby zarządzać płatnością.");
        const response = await fetch(`${BILLING_FUNCTIONS_URL}/${functionName}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        // When a subscription already exists, the backend intentionally sends
        // the user to Stripe Portal instead of allowing a duplicate purchase.
        if (!response.ok && !(response.status === 409 && data.url)) {
            throw new Error(data.error || `Błąd płatności (${response.status})`);
        }
        if (!data.url) throw new Error("Stripe nie zwrócił adresu płatności.");
        const url = new URL(data.url);
        if (url.protocol !== "https:") throw new Error("Nieprawidłowy adres Stripe.");
        await chrome.tabs.create({ url: url.href });
        return { opened: true, redirectedToPortal: response.status === 409 };
    }

    function startCheckout(plan) {
        const normalizedPlan = Config.normalizePlan(plan);
        if (
            normalizedPlan !== Config.SUBSCRIPTION_PLANS.BASIC &&
            normalizedPlan !== Config.SUBSCRIPTION_PLANS.PRO
        ) {
            return Promise.reject(new Error("Wybierz plan BASIC albo PRO."));
        }
        return billingRequest("createStripeCheckoutSession", { plan: normalizedPlan });
    }

    function openBillingPortal() {
        return billingRequest("createStripePortalSession");
    }

    function isLimitError(error) {
        return error?.name === "SubscriptionLimitError" || !!error?.upgradeRequired;
    }

    function openPlans() {
        const plans =
            typeof document !== "undefined"
                ? document.getElementById("aiPlansSection")
                : null;
        if (plans) {
            document.querySelector?.('.tab[data-tab="settings"]')?.click();
            plans.scrollIntoView({ behavior: "smooth", block: "center" });
            plans.classList.add("is-highlighted");
            setTimeout(() => plans.classList.remove("is-highlighted"), 2200);
            return;
        }
        chrome.runtime.sendMessage({ type: "QT_OPEN_PLANS" }).catch(() => {});
    }

    function showUpgradePrompt(validation) {
        if (typeof document === "undefined") return;
        const isElevenLabs = validation?.feature === "elevenLabs";
        if (document.getElementById("aiPlansSection") && !isElevenLabs) {
            openPlans();
            return;
        }
        document.getElementById("__qt_ai_limit_toast")?.remove();
        const toast = document.createElement("div");
        toast.id = "__qt_ai_limit_toast";
        toast.innerHTML = `
            <div class="__qt_ai_limit_orb">✦</div>
            <div class="__qt_ai_limit_copy">
                <strong>${isElevenLabs ? "Limit ElevenLabs wykorzystany" : "Limit planu został osiągnięty"}</strong>
                <span>${String(validation?.message || "Ulepsz plan, aby kontynuować.")}</span>
            </div>
            <button type="button" class="__qt_ai_upgrade_link">Zobacz plany</button>
            <button type="button" class="__qt_ai_limit_close" aria-label="Zamknij">×</button>`;
        document.documentElement.appendChild(toast);
        toast.querySelector(".__qt_ai_upgrade_link")?.addEventListener("click", () => {
            toast.remove();
            openPlans();
        });
        toast.querySelector(".__qt_ai_limit_close")?.addEventListener("click", () => toast.remove());
        requestAnimationFrame(() => toast.classList.add("visible"));
        setTimeout(() => toast.remove(), 8000);
    }

    async function applyPlanToUI() {
        if (typeof document === "undefined") return;
        const profile = await effectiveProfile(false);
        const enabled = Config.getPlanLimits(profile.plan).elevenLabs.enabled;
        if (!enabled) {
            const stored = await chrome.storage.local.get({ ttsMode: "browser" });
            if (stored.ttsMode === "elevenlabs") {
                await chrome.storage.local.set({ ttsMode: "browser" });
            }
        }
        if (typeof updateReviewVoiceUI === "function") {
            await updateReviewVoiceUI();
        }
    }

    return {
        refreshProfile,
        getCachedProfile,
        setCachedProfile,
        effectiveProfile,
        checkSrsSave,
        checkElevenLabs,
        synthesizeElevenLabs,
        getElevenLabsVoices,
        updateAiUsage,
        startCheckout,
        openBillingPortal,
        isLimitError,
        showUpgradePrompt,
        openPlans,
        applyPlanToUI,
    };
})();

if (typeof window !== "undefined") window.SubscriptionService = SubscriptionService;
if (typeof self !== "undefined" && typeof window === "undefined") {
    self.SubscriptionService = SubscriptionService;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = SubscriptionService;
}
