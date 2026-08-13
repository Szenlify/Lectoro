/** Client-side subscription profile cache, validation and paywall helpers. */
const SubscriptionService = (() => {
    "use strict";

    const PROFILE_KEY = "subscriptionProfileCache";
    const PROXY_URL = "https://geminiproxy-gyagzflbra-ew.a.run.app";
    const Config = SubscriptionConfig;

    function currentMonth() {
        return new Date().toISOString().slice(0, 7);
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

    async function setCachedProfile(profile) {
        if (!profile) return null;
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
        await chrome.storage.local.set({ [PROFILE_KEY]: normalized });
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
        if (
            !force &&
            cached?.uid === user.uid &&
            cached?.usage?.ai?.month === current &&
            cached?.usage?.elevenLabsCharacters?.month === current
        ) {
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
        return setCachedProfile({
            ...(data.profile || freeProfile(user.uid)),
            // UI plan comes from the signed Firebase token, never from editable
            // extension storage or a client-writable Firestore document.
            plan: claimedPlan,
        });
    }

    async function effectiveProfile(force = false) {
        const user = await FirebaseSync.getUser().catch(() => null);
        if (!user) return freeProfile();
        const cached = await getCachedProfile();
        const cacheIsFresh =
            cached?.uid === user.uid &&
            cached?.usage?.ai?.month === currentMonth() &&
            cached?.usage?.elevenLabsCharacters?.month === currentMonth() &&
            Date.now() - Number(cached?.updatedAt || 0) < 5 * 60 * 1000;
        if (!force && cacheIsFresh) return cached;
        return refreshProfile(true);
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

    async function synthesizeElevenLabs(text, voiceId) {
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
            body: JSON.stringify({ action: "synthesizeElevenLabs", text, voiceId }),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            if (data.profile) await setCachedProfile(data.profile);
            if (data.limit) throw new Config.SubscriptionLimitError(data.limit);
            throw new Error(data.error || `Błąd limitu ElevenLabs (${response.status})`);
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
        return response.blob();
    }

    async function getElevenLabsVoices() {
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
            body: JSON.stringify({ action: "elevenLabsVoices" }),
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
        if (document.getElementById("aiPlansSection")) {
            openPlans();
            return;
        }
        document.getElementById("__qt_ai_limit_toast")?.remove();
        const toast = document.createElement("div");
        toast.id = "__qt_ai_limit_toast";
        toast.innerHTML = `
            <div class="__qt_ai_limit_orb">✦</div>
            <div class="__qt_ai_limit_copy">
                <strong>Limit planu został osiągnięty</strong>
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
        const modeButton = document.getElementById("modeEL");
        if (modeButton) {
            modeButton.disabled = !enabled;
            modeButton.setAttribute("aria-disabled", String(!enabled));
            modeButton.title = enabled
                ? "Włącz ElevenLabs"
                : "ElevenLabs wymaga planu BASIC lub PRO";
            modeButton.classList.toggle("subscription-locked", !enabled);
        }
        if (!enabled) {
            const stored = await chrome.storage.local.get({ ttsMode: "browser" });
            if (stored.ttsMode === "elevenlabs") {
                await chrome.storage.local.set({ ttsMode: "browser" });
            }
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
