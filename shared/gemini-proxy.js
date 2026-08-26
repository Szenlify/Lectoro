/**
 * Lectoro – Secure Gemini Proxy (Client-Side)
 *
 * Instead of calling Gemini directly (which requires client-side API keys),
 * all AI requests route through the secure Cloud Run / Cloud Functions proxy.
 *
 * The Gemini API key is securely stored ONLY on the server.
 *
 * Usage:
 *   const result = await GeminiProxy.request(prompt, { temperature: 0.8, maxOutputTokens: 300 });
 *   // result.text – raw response text
 *   // result.usage – { plan, used, limit, remaining }
 */
const GeminiProxy = (() => {
    "use strict";

    // URL Cloud Function (region europe-west1, projekt extension-eng)
    const PROXY_URL =
        "https://geminiproxy-gyagzflbra-ew.a.run.app";
    const USAGE_KEY = "aiUsageCache";
    const MAX_AI_CACHE_SIZE = 200;
    const aiResponseCache = new Map();

    function getAiCacheKey(prompt, temperature, maxOutputTokens) {
        return `${prompt}__${temperature}__${maxOutputTokens}`;
    }

    function currentMonth() {
        return typeof SharedUtils !== "undefined" && SharedUtils.currentMonth
            ? SharedUtils.currentMonth()
            : new Date().toISOString().slice(0, 7);
    }

    function matchesConfiguredAiLimit(usage) {
        if (!usage || typeof SubscriptionConfig === "undefined") return true;
        const plan = SubscriptionConfig.normalizePlan(usage.plan);
        const configuredLimit = Number(
            SubscriptionConfig.getPlanLimits(plan)?.ai?.usesPerMonth,
        );
        return (
            !Number.isFinite(configuredLimit) ||
            Number(usage.limit) === configuredLimit
        );
    }

    function normalizeUsage(usage, uid = "") {
        if (!usage) return null;
        const used = Math.max(0, Number(usage.used) || 0);
        const limit = Math.max(0, Number(usage.limit) || 0);
        return {
            uid: uid || usage.uid || "",
            month: currentMonth(),
            plan: usage.plan || "free",
            used,
            limit,
            remaining: Math.max(
                0,
                Number(usage.remaining ?? limit - used),
            ),
            updatedAt: Date.now(),
        };
    }

    async function getCachedUsage() {
        const data = await chrome.storage.local.get({ [USAGE_KEY]: null });
        return data[USAGE_KEY];
    }

    async function setCachedUsage(usage) {
        if (!usage) return null;
        const user = await FirebaseSync.getUser();
        const normalized = normalizeUsage(
            usage,
            user?.uid || usage.uid || "",
        );
        await chrome.storage.local.set({ [USAGE_KEY]: normalized });
        if (typeof SubscriptionService !== "undefined") {
            await SubscriptionService.updateAiUsage(normalized);
        }
        return normalized;
    }

    function isContentScriptEnvironment() {
        return (
            typeof window !== "undefined" &&
            window.location?.protocol !== "chrome-extension:" &&
            typeof chrome !== "undefined" &&
            typeof chrome.runtime?.sendMessage === "function"
        );
    }

    /** Fetch once at initialization/month change or after 1h; later checks are local. */
    async function refreshUsage(force = false) {
        const user = await FirebaseSync.getUser();
        if (!user) return null;
        const cached = await getCachedUsage();
        const CACHE_TTL_MS = 60 * 60 * 1000;
        if (
            !force &&
            cached?.uid === user.uid &&
            cached?.month === currentMonth() &&
            matchesConfiguredAiLimit(cached) &&
            Date.now() - Number(cached?.updatedAt || 0) < CACHE_TTL_MS
        ) {
            return cached;
        }

        if (isContentScriptEnvironment()) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { type: "QT_GEMINI_REFRESH_USAGE", force },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            return resolve(cached || null);
                        }
                        if (response?.error) {
                            return reject(new Error(response.error));
                        }
                        resolve(response?.usage || null);
                    },
                );
            });
        }

        const token = await getToken(force);
        if (!token) return null;
        const response = await fetch(PROXY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ action: "usage" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error || `Failed to fetch AI limit (${response.status})`);
        }
        if (data.profile && typeof SubscriptionService !== "undefined") {
            await SubscriptionService.setCachedProfile(data.profile);
        }
        return setCachedUsage(data.usage);
    }

    async function requireAvailableUsage() {
        const usage = (await refreshUsage(false)) || (await getCachedUsage());
        const validation =
            typeof SubscriptionConfig !== "undefined"
                ? SubscriptionConfig.checkAiLimit({
                      plan: usage?.plan,
                      used: usage?.used || 0,
                  })
                : null;
        if (validation ? !validation.allowed : usage?.limit > 0 && usage.used >= usage.limit) {
            const error = new Error(
                `Monthly AI limit reached (${usage.limit} requests/mo for plan ${(usage.plan || "free").toUpperCase()}). Upgrade your plan to continue.`,
            );
            error.code = "AI_LIMIT_REACHED";
            error.validation = validation;
            showUpgradePrompt(usage);
            throw error;
        }
        return usage;
    }

    function isLimitError(error) {
        return (
            error?.code === "AI_LIMIT_REACHED" ||
            /limit AI|ai limit|credits used|credit limit/i.test(error?.message || "")
        );
    }

    function openPlans() {
        if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.openPlans === "function") {
            SubscriptionService.openPlans();
            return;
        }
        const localPlans =
            typeof document !== "undefined"
                ? document.getElementById("aiPlansSection")
                : null;
        if (localPlans) {
            document.querySelector?.('.tab[data-tab="settings"]')?.click();
            localPlans.scrollIntoView({ behavior: "smooth", block: "center" });
            localPlans.classList.add("is-highlighted");
            setTimeout(() => localPlans.classList.remove("is-highlighted"), 2200);
            return;
        }
        chrome.runtime
            .sendMessage({ type: "QT_OPEN_PLANS" })
            .catch(() => {});
    }

    function showUpgradePrompt(usage) {
        if (typeof SubscriptionService !== "undefined" && typeof SubscriptionService.showUpgradePrompt === "function") {
            SubscriptionService.showUpgradePrompt({
                feature: "ai",
                plan: usage?.plan,
                message: `This month ${Number(usage?.used || usage?.limit || 0)} of ${Number(usage?.limit || 0)} credits have been used.`,
            });
            return;
        }
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
                <strong>AI Credits used up</strong>
                <span>This month ${Number(usage?.used || usage?.limit || 0)} of ${Number(usage?.limit || 0)} credits have been used.</span>
            </div>
            <button type="button" class="__qt_ai_upgrade_link">View plans</button>
            <button type="button" class="__qt_ai_limit_close" aria-label="Close">×</button>
            <div class="__qt_ai_limit_timer"></div>`;
        document.documentElement.appendChild(toast);
        toast.querySelector(".__qt_ai_upgrade_link")?.addEventListener("click", () => {
            toast.remove();
            openPlans();
        });
        toast.querySelector(".__qt_ai_limit_close")?.addEventListener("click", () => toast.remove());
        requestAnimationFrame(() => toast.classList.add("visible"));
        setTimeout(() => {
            toast.classList.remove("visible");
            setTimeout(() => toast.remove(), 250);
        }, 8000);
    }

    async function applyLocalLimitToUI() {
        if (typeof document === "undefined") return;
        const [usage, user] = await Promise.all([
            getCachedUsage(),
            FirebaseSync.getUser().catch(() => null),
        ]);
        const reached = !!(
            user &&
            usage?.uid === user.uid &&
            usage?.limit > 0 &&
            usage.used >= usage.limit
        );
        document.documentElement.toggleAttribute(
            "data-lectoro-ai-limit-reached",
            reached,
        );
        document
            .querySelectorAll("#__qt_icon .__qt_tb-ai, .__qt_save-ai-btn, #exportQuiz")
            .forEach((button) => {
                if (!button.dataset.aiOriginalTitle) {
                    button.dataset.aiOriginalTitle = button.title || "";
                }
                button.setAttribute("aria-disabled", String(reached));
                button.classList.toggle("ai-credits-empty", reached);
                if (reached) {
                    button.title = "AI limit reached — click to view plans";
                } else {
                    button.title = button.dataset.aiOriginalTitle;
                }
            });
    }

    /**
     * Retrieves a valid Firebase ID token from FirebaseSync.
     * Returns null if user is not signed in.
     */
    async function getToken(forceRefresh = false) {
        if (
            typeof FirebaseSync === "undefined" ||
            typeof FirebaseSync.getValidToken !== "function"
        ) {
            return null;
        }
        try {
            return await FirebaseSync.getValidToken(forceRefresh);
        } catch {
            return null;
        }
    }

    /**
     * Sends prompt to Gemini via secure proxy.
     *
     * @param {string} prompt - Prompt content
     * @param {object} [opts]
     * @param {number} [opts.temperature=0.8] - Temperature (0–2)
     * @param {number} [opts.maxOutputTokens=500] - Max output tokens
     * @param {boolean} [opts.cache=true] - Whether to use AI response cache
     * @returns {Promise<{text: string, usage: object, cached?: boolean}>}
     * @throws {Error} if user not signed in, limit reached, or server error
     */
    async function request(prompt, { temperature = 0.8, maxOutputTokens = 500, cache = true } = {}) {
        const cacheKey = getAiCacheKey(prompt, temperature, maxOutputTokens);
        if (cache && aiResponseCache.has(cacheKey)) {
            const cachedEntry = aiResponseCache.get(cacheKey);
            const cachedUsage = (await getCachedUsage()) || {};
            return {
                text: cachedEntry.text,
                usage: cachedUsage,
                cached: true,
            };
        }

        if (isContentScriptEnvironment()) {
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    {
                        type: "QT_GEMINI_REQUEST",
                        prompt,
                        opts: { temperature, maxOutputTokens, cache },
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            return reject(
                                new Error(
                                    chrome.runtime.lastError.message ||
                                        "Extension communication error.",
                                ),
                            );
                        }
                        if (!response) {
                            return reject(new Error("No response from AI service."));
                        }
                        if (response.error) {
                            const err = new Error(response.error);
                            if (response.code) err.code = response.code;
                            if (response.validation) err.validation = response.validation;
                            if (isLimitError(err)) {
                                showUpgradePrompt(err.validation || response.usage || {});
                            }
                            return reject(err);
                        }
                        if (cache && response.result?.text) {
                            aiResponseCache.set(cacheKey, { text: response.result.text });
                            if (aiResponseCache.size > MAX_AI_CACHE_SIZE) {
                                aiResponseCache.delete(aiResponseCache.keys().next().value);
                            }
                        }
                        resolve(response.result);
                    },
                );
            });
        }

        const token = await getToken();

        if (!token) {
            throw new Error(
                "Sign in to use AI features."
            );
        }

        const previousUsage = await requireAvailableUsage();
        // Optimistic local reservation blocks parallel UI actions immediately.
        if (previousUsage) {
            await setCachedUsage({
                ...previousUsage,
                used: previousUsage.used + 1,
                remaining: Math.max(0, previousUsage.limit - previousUsage.used - 1),
            });
        }

        let res;
        try {
            res = await fetch(PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ prompt, temperature, maxOutputTokens }),
            });
        } catch (error) {
            if (previousUsage) await setCachedUsage(previousUsage);
            throw error;
        }

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.error || `AI server error (${res.status})`;

            if (res.status === 429) {
                const plan = data?.plan || "free";
                const limit = data?.limit || "?";
                await setCachedUsage({
                    plan,
                    used: Number(data?.used || limit || 0),
                    limit: Number(data?.limit || 0),
                    remaining: 0,
                });
                const error = new Error(
                    `Monthly AI limit reached (${limit} requests/mo for plan ${plan.toUpperCase()}). Upgrade your plan to continue.`
                );
                error.code = "AI_LIMIT_REACHED";
                showUpgradePrompt({ plan, used: Number(data?.used || limit || 0), limit: Number(data?.limit || 0) });
                throw error;
            }
            if (previousUsage) await setCachedUsage(previousUsage);
            if (res.status === 401) {
                throw new Error(
                    "Session expired. Please sign in again."
                );
            }

            throw new Error(msg);
        }

        const finalUsage = await setCachedUsage(data.usage || {
            ...previousUsage,
            used: (previousUsage?.used || 0) + 1,
        });

        if (cache) {
            aiResponseCache.set(cacheKey, { text: data.text || "" });
            if (aiResponseCache.size > MAX_AI_CACHE_SIZE) {
                aiResponseCache.delete(aiResponseCache.keys().next().value);
            }
        }

        return {
            text: data.text || "",
            usage: finalUsage || data.usage || {},
            cached: false,
        };
    }

    /**
     * Helper: sends prompt and parses response as JSON.
     *
     * @param {string} prompt
     * @param {object} [opts]
     * @returns {Promise<object>} - Parsed JSON object from response
     */
    async function requestJSON(prompt, opts = {}) {
        const { text } = await request(prompt, opts);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Gemini: missing JSON response");
        }
        return JSON.parse(jsonMatch[0]);
    }

    /**
     * Upload user review card screenshot to Cloudflare R2 via geminiProxy.
     *
     * @param {string} wordId - ID of the flashcard
     * @param {string} imageBase64 - Base64 data URL or pure base64
     * @param {string} [contentType="image/webp"] - MIME type
     * @returns {Promise<{key: string, url: string}|null>}
     */
    async function uploadCardImage(wordId, imageBase64, contentType = "image/webp") {
        if (!imageBase64 || typeof imageBase64 !== "string") {
            return null;
        }

        if (isContentScriptEnvironment()) {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    {
                        type: "QT_GEMINI_UPLOAD_CARD_IMAGE",
                        wordId,
                        imageBase64,
                        contentType,
                    },
                    (response) => {
                        if (chrome.runtime.lastError || !response || response.error) {
                            return resolve(null);
                        }
                        resolve(response.result || null);
                    },
                );
            });
        }

        const effectiveWordId =
            wordId ||
            (typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString(36));
        let token = await getToken();
        if (!token) {
            return null;
        }

        let resolvedContentType = contentType;
        if (imageBase64.startsWith("data:")) {
            const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.-]+);base64,/);
            if (match) {
                resolvedContentType = match[1];
            }
        }

        const payload = JSON.stringify({
            action: "uploadCardImage",
            wordId: effectiveWordId,
            imageBase64,
            contentType: resolvedContentType,
        });

        try {
            let res = await fetch(PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: payload,
            });

            if (res.status === 401) {
                token = await getToken(true);
                if (token) {
                    res = await fetch(PROXY_URL, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: payload,
                    });
                }
            }

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                console.warn("[GeminiProxy] R2 uploadCardImage failed:", res.status, data?.error);
                return null;
            }

            const data = await res.json();
            if (data?.ok && (data?.path || data?.relativePath || data?.key || data?.url)) {
                const relativePath =
                    data.path ||
                    data.relativePath ||
                    (data.key ? data.key.replace(/^images\//, "") : "") ||
                    (data.url ? data.url.replace(/^https?:\/\/[^/]+\/(?:images\/)?/, "") : "");
                return {
                    key: data.key,
                    relativePath,
                    path: relativePath,
                    url: data.url,
                };
            }
            return null;
        } catch (error) {
            console.warn("[GeminiProxy] R2 uploadCardImage network error:", error.message);
            return null;
        }
    }

    /**
     * Delete one or multiple card images from Cloudflare R2 via geminiProxy.
     *
     * @param {string|string[]} wordIdOrIds - Word ID or array of Word IDs
     * @returns {Promise<boolean>}
     */
    async function deleteCardImage(wordIdOrIds) {
        if (!wordIdOrIds) return false;

        if (isContentScriptEnvironment()) {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    {
                        type: "QT_GEMINI_DELETE_CARD_IMAGES",
                        wordIds: Array.isArray(wordIdOrIds) ? wordIdOrIds : [String(wordIdOrIds)],
                    },
                    (response) => {
                        if (chrome.runtime.lastError || !response || response.error) {
                            return resolve(false);
                        }
                        resolve(!!response.ok);
                    },
                );
            });
        }

        const token = await getToken();
        if (!token) return false;

        const payload = {
            action: "deleteCardImage",
        };
        if (Array.isArray(wordIdOrIds)) {
            if (wordIdOrIds.length === 0) return true;
            payload.wordIds = wordIdOrIds;
        } else {
            payload.wordId = String(wordIdOrIds);
        }

        try {
            const res = await fetch(PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(payload),
            });
            return res.ok;
        } catch (error) {
            console.warn("[GeminiProxy] R2 deleteCardImage network error:", error.message);
            return false;
        }
    }

    /**
     * Delete all images belonging to the current user from Cloudflare R2.
     *
     * @returns {Promise<number>} - Count of deleted images
     */
    async function deleteAllUserImages() {
        if (isContentScriptEnvironment()) {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { type: "QT_GEMINI_DELETE_ALL_USER_IMAGES" },
                    (response) => {
                        if (chrome.runtime.lastError || !response || response.error) {
                            return resolve(0);
                        }
                        resolve(Number(response.deletedCount) || 0);
                    },
                );
            });
        }

        const token = await getToken();
        if (!token) return 0;

        try {
            const res = await fetch(PROXY_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "deleteAllUserImages" }),
            });
            if (!res.ok) return 0;
            const data = await res.json();
            return data?.deletedCount || 0;
        } catch (error) {
            console.warn("[GeminiProxy] R2 deleteAllUserImages network error:", error.message);
            return 0;
        }
    }

    // Export
    return {
        endpoint: () => PROXY_URL,
        request,
        requestJSON,
        uploadCardImage,
        deleteCardImage,
        deleteCardImages: deleteCardImage,
        deleteAllUserImages,
        refreshUsage,
        getCachedUsage,
        normalizeUsage,
        applyLocalLimitToUI,
        isLimitError,
        showUpgradePrompt,
        openPlans,
        clearAiCache: () => aiResponseCache.clear(),
        isLimitReached: async () => {
            const usage = await getCachedUsage();
            return !!(usage?.limit > 0 && usage.used >= usage.limit);
        },
    };
})();

// Expose globally (content scripts + popup + background)
if (typeof window !== "undefined") {
    window.GeminiProxy = GeminiProxy;
    GeminiProxy.applyLocalLimitToUI();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.aiUsageCache) {
            GeminiProxy.applyLocalLimitToUI();
        }
    });
}
if (typeof self !== "undefined" && typeof window === "undefined") {
    // Service Worker (background.js)
    self.GeminiProxy = GeminiProxy;
}
if (typeof module !== "undefined" && module.exports) {
    module.exports = GeminiProxy;
}
