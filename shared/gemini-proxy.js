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
(function initGeminiProxy(root, factory) {
    const isNode = typeof module !== "undefined" && !!module.exports;
    const resolve = (name, path) =>
        (root && root[name]) || (isNode ? require(path) : undefined);
    const api = factory({
        Utils: resolve("SharedUtils", "./utils"),
        Constants: resolve("LectoroConstants", "./constants"),
    });
    if (isNode) module.exports = api;
    if (root) root.GeminiProxy = api;

    // Popup & content scripts: reflect the cached AI quota in the UI and keep it in sync.
    if (typeof window !== "undefined") {
        api.applyLocalLimitToUI();
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === "local" && changes.aiUsageCache) {
                api.applyLocalLimitToUI();
            }
        });
    }
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createGeminiProxy(deps) {
        "use strict";

        const { Utils, Constants } = deps;
        const MSG = Constants.MESSAGE_TYPES;
        // Cloud Run proxy (region europe-west1, project extension-eng)
        const PROXY_URL = Constants.ENDPOINTS.GEMINI_PROXY;
        const USAGE_KEY = Constants.STORAGE_KEYS.AI_USAGE_CACHE;
        const MAX_AI_CACHE_SIZE = 200;
        const aiResponseCache = new Map();

        function getAiCacheKey(prompt, temperature, maxOutputTokens, responseFormat = "json") {
            return `${prompt}__${temperature}__${maxOutputTokens}__${responseFormat}`;
        }

        function rememberAiResponse(cacheKey, text) {
            aiResponseCache.set(cacheKey, { text });
            if (aiResponseCache.size > MAX_AI_CACHE_SIZE) {
                aiResponseCache.delete(aiResponseCache.keys().next().value);
            }
        }

        /** SubscriptionService is loaded before this module in every extension context; tests may omit it. */
        function subscriptionService() {
            return typeof SubscriptionService !== "undefined"
                ? SubscriptionService
                : null;
        }

        function matchesConfiguredAiLimit(usage) {
            if (!usage || typeof SubscriptionConfig === "undefined")
                return true;
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
                month: Utils.currentMonth(),
                plan: usage.plan || "free",
                used,
                limit,
                remaining: Math.max(0, Number(usage.remaining ?? limit - used)),
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
            await subscriptionService()?.updateAiUsage(normalized);
            return normalized;
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
                cached?.month === Utils.currentMonth() &&
                matchesConfiguredAiLimit(cached) &&
                Date.now() - Number(cached?.updatedAt || 0) < CACHE_TTL_MS
            ) {
                return cached;
            }

            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.GEMINI_REFRESH_USAGE,
                        force,
                    });
                    return response?.usage || null;
                } catch (error) {
                    if (error.runtimeError) return cached || null;
                    throw error;
                }
            }

            const token = await getToken(force);
            if (!token) return null;
            const response = await Utils.postJson(
                PROXY_URL,
                { action: "usage" },
                { token },
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(
                    data?.error ||
                        `Failed to fetch AI limit (${response.status})`,
                );
            }
            if (data.profile) {
                await subscriptionService()?.setCachedProfile(data.profile);
            }
            return setCachedUsage(data.usage);
        }

        async function requireAvailableUsage(localOnly = false) {
            const user = await FirebaseSync.getUser();
            const cached = localOnly ? await getCachedUsage() : await refreshUsage(false);
            const usage = cached?.uid === user?.uid && cached?.month === Utils.currentMonth()
                ? cached : null;
            if (!usage) return null; // The generate request checks the authoritative server quota.
            const validation =
                typeof SubscriptionConfig !== "undefined"
                    ? SubscriptionConfig.checkAiLimit({
                          plan: usage?.plan,
                          used: usage?.used || 0,
                      })
                    : null;
            if (
                validation
                    ? !validation.allowed
                    : usage?.limit > 0 && usage.used >= usage.limit
            ) {
                const error = new Error(
                    `Monthly AI limit reached (${usage.limit} requests/mo for plan ${(usage.plan || "free").toUpperCase()}). Upgrade your plan to continue.`,
                );
                error.code = "AI_LIMIT_REACHED";
                error.validation = validation;
                if (!localOnly) showUpgradePrompt(usage);
                throw error;
            }
            return usage;
        }

        function isLimitError(error) {
            return (
                error?.code === "AI_LIMIT_REACHED" ||
                /limit AI|ai limit|credits used|credit limit/i.test(
                    error?.message || "",
                )
            );
        }

        function openPlans() {
            subscriptionService()?.openPlans();
        }

        function showUpgradePrompt(usage) {
            subscriptionService()?.showUpgradePrompt({
                feature: "ai",
                plan: usage?.plan,
                message: `This month ${Number(usage?.used || usage?.limit || 0)} of ${Number(usage?.limit || 0)} credits have been used.`,
            });
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
                .querySelectorAll(
                    `.${Constants.PREFIX}save-ai-btn, #exportQuiz`,
                )
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
        const pendingRequests = new Map();
        function request(prompt, opts = {}) {
            if (opts.cache === false) return performRequest(prompt, opts);
            const key = getAiCacheKey(prompt, opts.temperature ?? 0.8, opts.maxOutputTokens ?? 500, opts.responseFormat);
            if (pendingRequests.has(key)) return pendingRequests.get(key);
            const pending = performRequest(prompt, opts).finally(() => pendingRequests.delete(key));
            pendingRequests.set(key, pending);
            return pending;
        }

        async function performRequest(
            prompt,
            { temperature = 0.8, maxOutputTokens = 500, cache = true, responseFormat = "json" } = {},
        ) {
            const cacheKey = getAiCacheKey(
                prompt,
                temperature,
                maxOutputTokens,
                responseFormat,
            );
            if (cache && aiResponseCache.has(cacheKey)) {
                const cachedEntry = aiResponseCache.get(cacheKey);
                const cachedUsage = (await getCachedUsage()) || {};
                return {
                    text: cachedEntry.text,
                    usage: cachedUsage,
                    cached: true,
                };
            }

            if (Utils.isContentScriptEnvironment()) {
                let response;
                try {
                    response = await Utils.sendRuntimeMessage({
                        type: MSG.GEMINI_REQUEST,
                        prompt,
                        opts: { temperature, maxOutputTokens, cache, responseFormat },
                    });
                } catch (err) {
                    if (!err.runtimeError && isLimitError(err)) {
                        showUpgradePrompt(err.validation || {});
                    }
                    throw err;
                }
                if (!response) {
                    throw new Error("No response from AI service.");
                }
                if (cache && response.result?.text) {
                    rememberAiResponse(cacheKey, response.result.text);
                }
                return response.result;
            }

            const token = await getToken();

            if (!token) {
                throw Object.assign(new Error("Sign in to use AI features."), { code: "AUTH_REQUIRED" });
            }

            const previousUsage = await requireAvailableUsage(responseFormat === "text");
            // Optimistic local reservation blocks parallel UI actions immediately.
            if (previousUsage) {
                await setCachedUsage({
                    ...previousUsage,
                    used: previousUsage.used + 1,
                    remaining: Math.max(
                        0,
                        previousUsage.limit - previousUsage.used - 1,
                    ),
                });
            }

            let res;
            try {
                res = await Utils.postJson(
                    PROXY_URL,
                    { prompt, temperature, maxOutputTokens, responseFormat },
                    { token },
                );
            } catch (error) {
                if (previousUsage) await setCachedUsage(previousUsage);
                throw error;
            }

            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                const msg = data?.error || `AI server error (${res.status})`;

                if (res.status === 429 && (data?.code === "AI_LIMIT_REACHED" || Number.isFinite(Number(data?.limit)))) {
                    const plan = data?.plan || "free";
                    const limit = data?.limit || "?";
                    await setCachedUsage({
                        plan,
                        used: Number(data?.used || limit || 0),
                        limit: Number(data?.limit || 0),
                        remaining: 0,
                    });
                    const error = new Error(
                        `Monthly AI limit reached (${limit} requests/mo for plan ${plan.toUpperCase()}). Upgrade your plan to continue.`,
                    );
                    error.code = "AI_LIMIT_REACHED";
                    if (responseFormat !== "text") showUpgradePrompt({
                        plan,
                        used: Number(data?.used || limit || 0),
                        limit: Number(data?.limit || 0),
                    });
                    throw error;
                }
                if (previousUsage) await setCachedUsage(previousUsage);
                if (res.status === 401) {
                    throw Object.assign(new Error("Session expired. Please sign in again."), { code: "AUTH_REQUIRED" });
                }

                throw Object.assign(new Error(msg), {
                    status: res.status,
                    code: data?.code || (res.status === 429 || res.status === 503 ? "RATE_LIMITED" : "AI_REQUEST_FAILED"),
                });
            }

            const finalUsage = await setCachedUsage(
                data.usage || {
                    ...previousUsage,
                    used: (previousUsage?.used || 0) + 1,
                },
            );

            if (cache) {
                rememberAiResponse(cacheKey, data.text || "");
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
        const rejectedJsonKeys = new Set();
        async function requestJSON(prompt, { validate, ...opts } = {}) {
            const key = getAiCacheKey(prompt, opts.temperature ?? 0.8, opts.maxOutputTokens ?? 500);
            const { text } = await request(prompt, rejectedJsonKeys.has(key) ? { ...opts, cache: false } : opts);
            // Accept legacy fenced JSON, but never salvage objects from broken prose.
            const raw = String(text || "").trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
            try {
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                    throw new Error("Gemini: invalid response object");
                }
                if (validate) validate(parsed);
                if (rejectedJsonKeys.has(key) && opts.cache !== false) rememberAiResponse(key, text);
                rejectedJsonKeys.delete(key);
                return parsed;
            } catch (error) {
                aiResponseCache.delete(key);
                // A retry also bypasses the background worker's response cache.
                rejectedJsonKeys.add(key);
                if (rejectedJsonKeys.size > MAX_AI_CACHE_SIZE) rejectedJsonKeys.delete(rejectedJsonKeys.values().next().value);
                if (error instanceof SyntaxError) throw new Error("Gemini: invalid JSON response");
                throw error;
            }
        }

        /**
         * Upload user review card screenshot to Cloudflare R2 via geminiProxy.
         *
         * @param {string} wordId - ID of the flashcard
         * @param {string} imageBase64 - Base64 data URL or pure base64
         * @param {string} [contentType="image/webp"] - MIME type
         * @returns {Promise<{key: string, url: string}|null>}
         */
        async function uploadCardImage(
            wordId,
            imageBase64,
            contentType = "image/webp",
        ) {
            if (!imageBase64 || typeof imageBase64 !== "string") {
                return null;
            }

            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.GEMINI_UPLOAD_CARD_IMAGE,
                        wordId,
                        imageBase64,
                        contentType,
                    });
                    return response?.result || null;
                } catch (error) {
                    console.warn(
                        "[GeminiProxy] R2 uploadCardImage message error:",
                        error?.message || error,
                    );
                    return null;
                }
            }

            const effectiveWordId = wordId || Utils.generateId();
            let token = await getToken();
            if (!token) {
                return null;
            }

            let resolvedContentType = contentType;
            if (imageBase64.startsWith("data:")) {
                const match = imageBase64.match(
                    /^data:(image\/[a-zA-Z0-9.-]+);base64,/,
                );
                if (match) {
                    resolvedContentType = match[1];
                }
            }

            const payload = {
                action: "uploadCardImage",
                wordId: effectiveWordId,
                imageBase64,
                contentType: resolvedContentType,
            };

            try {
                let res = await Utils.postJson(PROXY_URL, payload, { token });

                if (res.status === 401) {
                    token = await getToken(true);
                    if (token) {
                        res = await Utils.postJson(PROXY_URL, payload, {
                            token,
                        });
                    }
                }

                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    console.warn(
                        "[GeminiProxy] R2 uploadCardImage failed:",
                        res.status,
                        data?.error,
                    );
                    return null;
                }

                const data = await res.json();
                if (
                    data?.ok &&
                    (data?.path || data?.relativePath || data?.key || data?.url)
                ) {
                    const relativePath =
                        data.path ||
                        data.relativePath ||
                        (data.key ? data.key.replace(/^images\//, "") : "") ||
                        (data.url
                            ? data.url.replace(
                                  /^https?:\/\/[^/]+\/(?:images\/)?/,
                                  "",
                              )
                            : "");
                    return {
                        key: data.key,
                        relativePath,
                        path: relativePath,
                        url: data.url,
                    };
                }
                return null;
            } catch (error) {
                console.warn(
                    "[GeminiProxy] R2 uploadCardImage network error:",
                    error.message,
                );
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

            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.GEMINI_DELETE_CARD_IMAGES,
                        wordIds: Array.isArray(wordIdOrIds)
                            ? wordIdOrIds
                            : [String(wordIdOrIds)],
                    });
                    return !!response?.ok;
                } catch (_) {
                    return false;
                }
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
                const res = await Utils.postJson(PROXY_URL, payload, { token });
                return res.ok;
            } catch (error) {
                console.warn(
                    "[GeminiProxy] R2 deleteCardImage network error:",
                    error.message,
                );
                return false;
            }
        }

        /**
         * Delete all images belonging to the current user from Cloudflare R2.
         *
         * @returns {Promise<number>} - Count of deleted images
         */
        async function deleteAllUserImages() {
            if (Utils.isContentScriptEnvironment()) {
                try {
                    const response = await Utils.sendRuntimeMessage({
                        type: MSG.GEMINI_DELETE_ALL_USER_IMAGES,
                    });
                    return Number(response?.deletedCount) || 0;
                } catch (_) {
                    return 0;
                }
            }

            const token = await getToken();
            if (!token) return 0;

            try {
                const res = await Utils.postJson(
                    PROXY_URL,
                    { action: "deleteAllUserImages" },
                    { token },
                );
                if (!res.ok) return 0;
                const data = await res.json();
                return data?.deletedCount || 0;
            } catch (error) {
                console.warn(
                    "[GeminiProxy] R2 deleteAllUserImages network error:",
                    error.message,
                );
                return 0;
            }
        }

        const livePending = new Map();
        function liveTranslation(kind, text, sourceLang, targetLang, words) {
            if (kind === "word") text = text.normalize("NFKC").trim().toLowerCase();
            const key = JSON.stringify([kind, text, sourceLang, targetLang, words]);
            if (livePending.has(key)) return livePending.get(key);
            const pending = (async () => {
                const token = await getToken();
                if (!token) throw Object.assign(new Error("Sign in to generate translations."), { code: "AUTH_REQUIRED" });
                // Let the server check shared cache BEFORE quota, even when local credits are exhausted.
                const deadline = Date.now() + 45000;
                do {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
                    let response, data;
                    try {
                        response = await fetch(PROXY_URL, { method: "POST", signal: controller.signal,
                            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ action: "liveTranslation", kind, text, sourceLang, targetLang, ...(kind === "segments" ? { words } : {}) }) });
                        data = await response.json();
                    } catch (error) {
                        if (controller.signal.aborted) throw Object.assign(new Error("Translation timed out. Please try again."), { code: "TRANSLATION_TIMEOUT" });
                        if (error instanceof SyntaxError) throw Object.assign(new Error("Translation service returned an invalid response. Please try again."), { code: "INVALID_TRANSLATION_RESPONSE" });
                        throw error;
                    } finally { clearTimeout(timer); }
                    if (response.ok) {
                        if (data.usage) await setCachedUsage(data.usage);
                        return data.result;
                    }
                    if (response.status !== 409 || data.code !== "TRANSLATION_PENDING") {
                        if (data.usage) await setCachedUsage(data.usage);
                        throw Object.assign(new Error(data.error || "Translation failed."), {
                            code: data.code || (response.status === 429 ? "RATE_LIMITED" : "AI_REQUEST_FAILED"), status: response.status });
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } while (Date.now() < deadline);
                throw new Error("Translation timed out. Please try again.");
            })().finally(() => livePending.delete(key));
            livePending.set(key, pending);
            return pending;
        }

        return Object.freeze({
            liveTranslation,
            request,
            requestJSON,
            uploadCardImage,
            deleteCardImage,
            deleteAllUserImages,
            refreshUsage,
            getCachedUsage,
            normalizeUsage,
            applyLocalLimitToUI,
            isLimitError,
            showUpgradePrompt,
            openPlans,
            clearAiCache: () => aiResponseCache.clear(),
        });
    },
);
