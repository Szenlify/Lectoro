/** Client-side subscription profile cache, validation and paywall helpers. */
(function initSubscriptionService(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const resolve = (name, path) =>
        (root && root[name]) || (isNode ? require(path) : undefined);
    const api = factory({
        Utils: resolve("SharedUtils", "./utils"),
        Constants: resolve("LectoroConstants", "./constants"),
        Config: resolve("SubscriptionConfig", "./subscription-config"),
    });
    if (isNode) module.exports = api;
    if (root) root.SubscriptionService = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createSubscriptionService(deps) {
        "use strict";

        const { Utils, Constants, Config } = deps;
        const MSG = Constants.MESSAGE_TYPES;
        const KEYS = Constants.STORAGE_KEYS;
        const PROFILE_KEY = KEYS.SUBSCRIPTION_PROFILE_CACHE;
        const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL to minimize Firestore reads
        const SUBTITLE_HOURLY_USAGE_KEY = KEYS.SUBTITLE_HOURLY_USAGE;
        const SUBTITLE_WINDOW_MS = 60 * 60 * 1000; // 1 hour local sliding window
        const EXPORT_USAGE_KEY = KEYS.EXPORT_USAGE;
        const QUIZ_FREE_COUNT_KEY = KEYS.QUIZ_GENERATIONS_FREE_COUNT;
        const QUIZ_PAID_HISTORY_KEY = KEYS.QUIZ_GENERATIONS_PAID_HISTORY;
        const QUIZ_PAID_WINDOW_MS = 60 * 60 * 1000;
        const QUIZ_PAID_HOURLY_MAX = 10;
        const PROXY_URL = Constants.ENDPOINTS.GEMINI_PROXY;
        const BILLING_FUNCTIONS_URL = Constants.ENDPOINTS.BILLING_FUNCTIONS;
        const AI_LIMIT_TOAST_ID = Constants.UI_IDS.AI_LIMIT_TOAST;
        const { currentMonth } = Utils;

        function hasLocalStorage() {
            return typeof chrome !== "undefined" && !!chrome?.storage?.local;
        }

        function freeProfile(uid = "") {
            const month = currentMonth();
            return {
                uid,
                plan: Config.SUBSCRIPTION_PLANS.FREE,
                subscriptionStatus: "active",
                stripeTrialEnd: null,
                trialEligible: true,
                usage: {
                    ai: { month, used: 0 },
                    elevenLabsCharacters: { month, used: 0 },
                },
                updatedAt: Date.now(),
            };
        }

        async function getCachedProfile() {
            const data = await chrome.storage.local.get({
                [PROFILE_KEY]: null,
            });
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
                            profile.usage?.elevenLabsCharacters?.month ||
                            currentMonth(),
                        used: Math.max(
                            0,
                            Number(profile.usage?.elevenLabsCharacters?.used) ||
                                0,
                        ),
                    },
                },
                updatedAt: Date.now(),
            };
            const planChanged =
                previous?.uid === normalized.uid &&
                Config.normalizePlan(previous.plan) !== normalized.plan;
            const geminiProxy =
                typeof globalThis !== "undefined"
                    ? globalThis.GeminiProxy
                    : null;
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
                    remaining: Math.max(
                        0,
                        limits.ai.usesPerMonth - currentAiUsed,
                    ),
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

        async function getSignedInUser() {
            return typeof FirebaseSync !== "undefined"
                ? await FirebaseSync.getUser().catch(() => null)
                : null;
        }

        /** Cached profile is reusable when it belongs to `uid`, covers the current month and is within TTL. */
        function isProfileFresh(cached, uid) {
            const current = currentMonth();
            return (
                cached?.uid === uid &&
                cached?.usage?.ai?.month === current &&
                cached?.usage?.elevenLabsCharacters?.month === current &&
                Date.now() - Number(cached?.updatedAt || 0) < CACHE_TTL_MS
            );
        }

        async function refreshProfile(force = false) {
            const user = await getSignedInUser();
            if (!user) return (await getCachedProfile()) || freeProfile();
            const cached = await getCachedProfile();
            if (!force && isProfileFresh(cached, user.uid)) {
                return cached;
            }

            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.SUBSCRIPTION_REFRESH_PROFILE,
                        force,
                    });
                    return response?.profile || freeProfile(user?.uid);
                } catch (error) {
                    if (error.runtimeError)
                        return cached || freeProfile(user?.uid);
                    throw error;
                }
            }

            const tokenResult = await FirebaseSync.getIdTokenResult(
                force,
            ).catch(() => null);
            const token = tokenResult?.token;
            if (!token)
                return cached?.uid === user.uid
                    ? cached
                    : freeProfile(user.uid);
            const claimedPlan = Config.normalizePlan(tokenResult.claims?.plan);
            const response = await Utils.postJson(
                PROXY_URL,
                { action: "subscription" },
                { token },
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok)
                throw new Error(
                    data.error || `Profile error (${response.status})`,
                );

            const authoritativePlan = Config.normalizePlan(
                data.profile?.plan || claimedPlan,
            );

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
            const user = await getSignedInUser();
            if (!user) return (await getCachedProfile()) || freeProfile();
            const cached = await getCachedProfile();
            if (!force && isProfileFresh(cached, user.uid)) return cached;
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
                throw new Error("ElevenLabs is only available during reviews.");
            }
            const localValidation = await checkElevenLabs(text);
            Config.assertAllowed(localValidation);

            if (Utils.isContentScriptEnvironment()) {
                const response = await Utils.sendRuntimeMessage({
                    type: MSG.ELEVENLABS_SYNTHESIZE,
                    text,
                    voiceId,
                    context,
                });
                if (response?.base64) {
                    return Utils.base64ToBlob(
                        response.base64,
                        response.mimeType || "audio/mpeg",
                    );
                }
                throw new Error("No audio data received from ElevenLabs.");
            }

            const token = await getToken();
            if (!token) {
                throw new Error("Sign in to use ElevenLabs.");
            }
            const response = await Utils.postJson(
                PROXY_URL,
                { action: "synthesizeElevenLabs", context, text, voiceId },
                { token },
            );
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data.profile) await setCachedProfile(data.profile);
                if (data.limit)
                    throw new Config.SubscriptionLimitError(data.limit);
                const error = new Error(
                    data.error ||
                        `ElevenLabs is unavailable (${response.status})`,
                );
                error.code = data.code || "ELEVENLABS_REQUEST_FAILED";
                throw error;
            }
            const profile = await effectiveProfile(false);
            profile.plan = Config.normalizePlan(
                response.headers.get("X-Lectoro-Plan") || profile.plan,
            );
            profile.usage.elevenLabsCharacters = {
                month: currentMonth(),
                used: Math.max(
                    0,
                    Number(response.headers.get("X-Lectoro-TTS-Used")) ||
                        profile.usage.elevenLabsCharacters.used +
                            localValidation.requested,
                ),
            };
            await setCachedProfile(profile);
            const limits = Config.getPlanLimits(profile.plan).elevenLabs;
            if (
                limits.enabled &&
                profile.usage.elevenLabsCharacters.used >=
                    limits.charactersPerMonth
            ) {
                showUpgradePrompt({
                    feature: "elevenLabs",
                    code: Config.LIMIT_ERROR_CODES
                        .ELEVENLABS_MONTHLY_LIMIT_REACHED,
                    message: `Monthly limit of ${limits.charactersPerMonth} ElevenLabs characters reached. System voice will be used until renewal.`,
                });
            }
            return response.blob();
        }

        async function getElevenLabsVoices(context = "") {
            if (context !== "review") {
                throw new Error(
                    "ElevenLabs voices are only available during reviews.",
                );
            }
            const profile = await effectiveProfile(false);
            if (!Config.getPlanLimits(profile.plan).elevenLabs.enabled) {
                Config.assertAllowed(
                    Config.checkElevenLabsLimit({
                        plan: profile.plan,
                        text: "a",
                    }),
                );
            }

            if (Utils.isContentScriptEnvironment()) {
                const response = await Utils.sendRuntimeMessage({
                    type: MSG.ELEVENLABS_VOICES,
                    context,
                });
                return response?.voices || [];
            }

            const token = await getToken();
            if (!token) throw new Error("Sign in to fetch ElevenLabs voices.");
            const response = await Utils.postJson(
                PROXY_URL,
                { action: "elevenLabsVoices", context },
                { token },
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok)
                throw new Error(
                    data.error || `Voice error (${response.status})`,
                );
            const allowedOrder = Constants.ALLOWED_ELEVENLABS_VOICE_KEYS;
            const rawVoices = data.voices || [];
            const filtered = rawVoices
                .filter((voice) => {
                    const name = (voice?.name || "").trim().toLowerCase();
                    return allowedOrder.some(
                        (t) => name.startsWith(t) || name.includes(t),
                    );
                })
                .sort((a, b) => {
                    const nameA = (a?.name || "").trim().toLowerCase();
                    const nameB = (b?.name || "").trim().toLowerCase();
                    const idxA = allowedOrder.findIndex(
                        (t) => nameA.startsWith(t) || nameA.includes(t),
                    );
                    const idxB = allowedOrder.findIndex(
                        (t) => nameB.startsWith(t) || nameB.includes(t),
                    );
                    return (
                        (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB)
                    );
                });
            return filtered;
        }

        async function updateAiUsage(usage) {
            if (!usage) return null;
            const user = await getSignedInUser();
            const profile =
                (await getCachedProfile()) ||
                freeProfile(user?.uid || usage.uid || "");
            profile.plan = Config.normalizePlan(usage.plan || profile.plan);
            profile.usage.ai = {
                month: currentMonth(),
                used: Math.max(0, Number(usage.used) || 0),
            };
            return setCachedProfile(profile);
        }

        async function billingRequest(functionName, body = {}) {
            const token = await getToken(true);
            if (!token) throw new Error("Sign in to manage billing.");
            const response = await Utils.postJson(
                `${BILLING_FUNCTIONS_URL}/${functionName}`,
                body,
                { token },
            );
            const data = await response.json().catch(() => ({}));
            // When a subscription already exists, the backend intentionally sends
            // the user to Stripe Portal instead of allowing a duplicate purchase.
            if (!response.ok && !(response.status === 409 && data.url)) {
                throw new Error(
                    data.error || `Billing error (${response.status})`,
                );
            }
            if (!data.url)
                throw new Error("Stripe did not return a checkout URL.");
            const url = new URL(data.url);
            if (url.protocol !== "https:")
                throw new Error("Invalid Stripe URL.");
            await chrome.tabs.create({ url: url.href });
            return {
                opened: true,
                redirectedToPortal: response.status === 409,
                trialDays: Math.max(0, Number(data.trialDays) || 0),
            };
        }

        function startCheckout(plan) {
            const normalizedPlan = Config.normalizePlan(plan);
            if (
                normalizedPlan !== Config.SUBSCRIPTION_PLANS.BASIC &&
                normalizedPlan !== Config.SUBSCRIPTION_PLANS.PRO
            ) {
                return Promise.reject(
                    new Error("Wybierz plan BASIC albo PRO."),
                );
            }
            return billingRequest("createStripeCheckoutSession", {
                plan: normalizedPlan,
            });
        }

        function openBillingPortal() {
            return billingRequest("createStripePortalSession");
        }

        function isLimitError(error) {
            return (
                error?.name === "SubscriptionLimitError" ||
                !!error?.upgradeRequired
            );
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
                setTimeout(
                    () => plans.classList.remove("is-highlighted"),
                    2200,
                );
                return;
            }
            chrome.runtime
                .sendMessage({ type: MSG.OPEN_PLANS })
                .catch(() => {});
        }

        function showUpgradePrompt(validation) {
            if (typeof document === "undefined") return;
            const isElevenLabs = validation?.feature === "elevenLabs";
            if (document.getElementById("aiPlansSection") && !isElevenLabs) {
                openPlans();
                return;
            }
            const P = Constants.PREFIX;
            const TOAST_MS = 8000;
            document.getElementById(AI_LIMIT_TOAST_ID)?.remove();
            const toast = document.createElement("div");
            toast.id = AI_LIMIT_TOAST_ID;
            toast.innerHTML = `
            <div class="${P}ai_limit_orb">✦</div>
            <div class="${P}ai_limit_copy">
                <strong>${isElevenLabs ? "ElevenLabs limit reached" : "Plan limit reached"}</strong>
                <span>${Utils.escapeHtml(String(validation?.message || "Upgrade your plan to continue."))}</span>
            </div>
            <button type="button" class="${P}ai_upgrade_link">View plans</button>
            <button type="button" class="${P}ai_limit_close" aria-label="Close">×</button>
            <div class="${P}ai_limit_timer"></div>`;
            document.documentElement.appendChild(toast);
            const dismiss = () => {
                toast.classList.remove("visible");
                setTimeout(() => toast.remove(), 250);
            };
            toast
                .querySelector(`.${P}ai_upgrade_link`)
                ?.addEventListener("click", () => {
                    toast.remove();
                    openPlans();
                });
            toast
                .querySelector(`.${P}ai_limit_close`)
                ?.addEventListener("click", () => toast.remove());
            requestAnimationFrame(() => toast.classList.add("visible"));
            setTimeout(dismiss, TOAST_MS);
        }

        async function applyPlanToUI() {
            if (typeof document === "undefined") return;
            const profile = await effectiveProfile(false);
            const enabled = Config.getPlanLimits(profile.plan).elevenLabs
                .enabled;
            if (!enabled) {
                const stored = await chrome.storage.local.get({
                    ttsMode: "browser",
                });
                if (stored.ttsMode === "elevenlabs") {
                    await chrome.storage.local.set({ ttsMode: "browser" });
                }
            }
            if (typeof updateReviewVoiceUI === "function") {
                await updateReviewVoiceUI();
            }
        }

        async function getSubtitleHourlyRecord() {
            if (!hasLocalStorage()) {
                return { windowStart: Date.now(), used: 0 };
            }
            const data = await chrome.storage.local.get({
                [SUBTITLE_HOURLY_USAGE_KEY]: null,
            });
            const now = Date.now();
            const stored = data[SUBTITLE_HOURLY_USAGE_KEY];
            if (
                !stored ||
                typeof stored.windowStart !== "number" ||
                typeof stored.used !== "number" ||
                now - stored.windowStart >= SUBTITLE_WINDOW_MS ||
                now < stored.windowStart
            ) {
                const fresh = { windowStart: now, used: 0 };
                await chrome.storage.local
                    .set({ [SUBTITLE_HOURLY_USAGE_KEY]: fresh })
                    .catch(() => {});
                return fresh;
            }
            return stored;
        }

        async function getSubtitleQuotaStatus(requestedCharacters = 0) {
            const profile = await getCachedProfile();
            const plan = Config.normalizePlan(profile?.plan);
            const limits = Config.getPlanLimits(plan);
            const limit = limits.subtitles?.charactersPerHour ?? 15000;
            const isUnlimited = !Number.isFinite(limit);

            if (isUnlimited) {
                return {
                    allowed: true,
                    code: null,
                    feature: "subtitles",
                    plan,
                    limit: Infinity,
                    used: 0,
                    requested: requestedCharacters,
                    remaining: Infinity,
                    upgradeRequired: false,
                    resetInMs: 0,
                    resetAt: 0,
                    message: "Subtitle translation is unlimited.",
                };
            }

            const record = await getSubtitleHourlyRecord();
            const validation = Config.checkSubtitleLimit({
                plan,
                usedCharacters: record.used,
                requestedCharacters,
            });

            const now = Date.now();
            const elapsed = now - record.windowStart;
            const resetInMs = Math.max(0, SUBTITLE_WINDOW_MS - elapsed);
            const resetAt = record.windowStart + SUBTITLE_WINDOW_MS;

            return {
                ...validation,
                resetInMs,
                resetAt,
            };
        }

        async function consumeSubtitleQuota(requestedCharacters = 0) {
            const status = await getSubtitleQuotaStatus(requestedCharacters);
            if (!status.allowed) {
                return status;
            }
            if (!Number.isFinite(status.limit)) {
                return status;
            }
            if (hasLocalStorage() && requestedCharacters > 0) {
                const record = await getSubtitleHourlyRecord();
                const newUsed = record.used + requestedCharacters;
                await chrome.storage.local
                    .set({
                        [SUBTITLE_HOURLY_USAGE_KEY]: {
                            windowStart: record.windowStart,
                            used: newUsed,
                        },
                    })
                    .catch(() => {});
                status.used = newUsed;
                status.remaining = Math.max(0, status.limit - newUsed);
            }
            return status;
        }

        async function getExportUsageRecord() {
            if (!hasLocalStorage()) {
                return { month: currentMonth(), anki: 0, excel: 0, quiz: 0 };
            }
            const data = await chrome.storage.local.get({
                [EXPORT_USAGE_KEY]: null,
                [QUIZ_FREE_COUNT_KEY]: 0,
            });
            const current = currentMonth();
            const stored = data[EXPORT_USAGE_KEY];
            if (stored && stored.month === current) {
                return {
                    month: current,
                    anki: Math.max(0, Number(stored.anki) || 0),
                    excel: Math.max(0, Number(stored.excel) || 0),
                    quiz: Math.max(0, Number(stored.quiz) || 0),
                };
            }
            // Month changed or fresh usage:
            // If stored is null and legacy quizGenerationsFreeCount exists, migrate it for the initial month
            const initialQuiz =
                !stored && data[QUIZ_FREE_COUNT_KEY]
                    ? Math.max(0, Number(data[QUIZ_FREE_COUNT_KEY]) || 0)
                    : 0;
            const fresh = {
                month: current,
                anki: 0,
                excel: 0,
                quiz: initialQuiz,
            };
            await chrome.storage.local
                .set({ [EXPORT_USAGE_KEY]: fresh })
                .catch(() => {});
            return fresh;
        }

        /** "csv"/"excel" share one quota bucket; other types map to themselves. */
        function normalizeExportType(type) {
            const normalizedType = String(type || "")
                .trim()
                .toLowerCase();
            return normalizedType === "csv" || normalizedType === "excel"
                ? "excel"
                : normalizedType;
        }

        async function getExportQuotaState(type) {
            const profile = await effectiveProfile(false);
            const plan = Config.normalizePlan(profile.plan);
            const isFree = plan === Config.SUBSCRIPTION_PLANS.FREE;
            const typeKey = normalizeExportType(type);

            const record = await getExportUsageRecord();
            const used = Math.max(0, Number(record[typeKey]) || 0);

            let validation = Config.checkExportLimit({
                plan,
                type: typeKey,
                used,
            });

            // Quiz in paid plans maintains an hourly limit
            let paidHistory = [];
            let paidUsed = 0;
            let paidHourlyLimit = Infinity;
            if (typeKey === "quiz" && !isFree) {
                paidHourlyLimit = QUIZ_PAID_HOURLY_MAX;
                if (hasLocalStorage()) {
                    const data = await chrome.storage.local.get({
                        [QUIZ_PAID_HISTORY_KEY]: [],
                    });
                    const now = Date.now();
                    const rawHistory = Array.isArray(
                        data[QUIZ_PAID_HISTORY_KEY],
                    )
                        ? data[QUIZ_PAID_HISTORY_KEY]
                        : [];
                    paidHistory = rawHistory.filter(
                        (ts) =>
                            typeof ts === "number" &&
                            now - ts < QUIZ_PAID_WINDOW_MS,
                    );
                    paidUsed = paidHistory.length;
                    if (paidUsed >= paidHourlyLimit) {
                        validation = {
                            ...validation,
                            allowed: false,
                            code: "QUIZ_HOURLY_LIMIT_REACHED",
                            message: `Hourly limit of ${paidHourlyLimit} quizzes reached.`,
                        };
                    }
                }
            }

            return {
                ...validation,
                plan,
                isFree,
                type: typeKey,
                used,
                paidUsed,
                paidHistory,
                paidLimit: paidHourlyLimit,
            };
        }

        async function recordExport(type) {
            const quota = await getExportQuotaState(type);
            const typeKey = normalizeExportType(type);

            if (hasLocalStorage()) {
                const record = await getExportUsageRecord();
                const newCount = (Number(record[typeKey]) || 0) + 1;
                const updated = { ...record, [typeKey]: newCount };
                const updates = { [EXPORT_USAGE_KEY]: updated };

                if (typeKey === "quiz") {
                    if (quota.isFree) {
                        updates[QUIZ_FREE_COUNT_KEY] = newCount;
                    } else {
                        updates[QUIZ_PAID_HISTORY_KEY] = [
                            ...(quota.paidHistory || []),
                            Date.now(),
                        ];
                    }
                }
                await chrome.storage.local.set(updates).catch(() => {});
            }
            return getExportQuotaState(type);
        }

        return Object.freeze({
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
            getSubtitleQuotaStatus,
            consumeSubtitleQuota,
            getExportQuotaState,
            recordExport,
        });
    },
);
