/**
 * Lectoro – Gemini API via Secure Proxy
 *
 * Zamiast wywoływać Gemini bezpośrednio (co wymaga klucza API po stronie klienta),
 * wszystkie zapytania AI trafiają przez Firebase Cloud Function "geminiProxy".
 *
 * Klucz Gemini API jest bezpiecznie przechowywany WYŁĄCZNIE na serwerze.
 *
 * Użycie:
 *   const result = await GeminiProxy.request(prompt, { temperature: 0.8, maxOutputTokens: 300 });
 *   // result.text – surowy tekst odpowiedzi
 *   // result.usage – { plan, used, limit, remaining }
 */
const GeminiProxy = (() => {
    "use strict";

    // URL Cloud Function (region europe-west1, projekt extension-eng)
    const PROXY_URL =
        "https://geminiproxy-gyagzflbra-ew.a.run.app";
    const USAGE_KEY = "aiUsageCache";

    function currentMonth() {
        return new Date().toISOString().slice(0, 7);
    }

    async function getCachedUsage() {
        const data = await chrome.storage.local.get({ [USAGE_KEY]: null });
        return data[USAGE_KEY];
    }

    async function setCachedUsage(usage) {
        if (!usage) return null;
        const user = await FirebaseSync.getUser();
        const normalized = {
            uid: user?.uid || usage.uid || "",
            month: currentMonth(),
            plan: usage.plan || "free",
            used: Number(usage.used || 0),
            limit: Number(usage.limit || 0),
            remaining: Math.max(
                0,
                Number(usage.remaining ?? Number(usage.limit || 0) - Number(usage.used || 0)),
            ),
            updatedAt: Date.now(),
        };
        await chrome.storage.local.set({ [USAGE_KEY]: normalized });
        return normalized;
    }

    /** Fetch once at initialization/month change; later checks are local. */
    async function refreshUsage(force = false) {
        const user = await FirebaseSync.getUser();
        if (!user) return null;
        const cached = await getCachedUsage();
        if (!force && cached?.uid === user.uid && cached?.month === currentMonth()) {
            return cached;
        }

        const token = await getToken();
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
            throw new Error(data?.error || `Błąd pobierania limitu AI (${response.status})`);
        }
        return setCachedUsage(data.usage);
    }

    async function requireAvailableUsage() {
        const usage = (await refreshUsage(false)) || (await getCachedUsage());
        if (usage?.limit > 0 && usage.used >= usage.limit) {
            const error = new Error(
                `Przekroczono limit AI (${usage.limit} zapytań/mc dla planu ${(usage.plan || "free").toUpperCase()}). Ulepsz plan aby kontynuować.`,
            );
            error.code = "AI_LIMIT_REACHED";
            showUpgradePrompt(usage);
            throw error;
        }
        return usage;
    }

    function isLimitError(error) {
        return (
            error?.code === "AI_LIMIT_REACHED" ||
            /limit AI|brak kredytów|kredyty zostały/i.test(error?.message || "")
        );
    }

    function openPlans() {
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
        if (typeof document === "undefined") return;
        // Inside the extension popup the plans section is already available:
        // navigate to it directly instead of covering the popup with a toast.
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
                <strong>Wykorzystano kredyty AI</strong>
                <span>W tym miesiącu użyto ${Number(usage?.used || usage?.limit || 0)} z ${Number(usage?.limit || 0)} kredytów.</span>
            </div>
            <button type="button" class="__qt_ai_upgrade_link">Zobacz plany</button>
            <button type="button" class="__qt_ai_limit_close" aria-label="Zamknij">×</button>
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
                    button.title = "Brak kredytów AI — kliknij, aby zobaczyć plany";
                } else {
                    button.title = button.dataset.aiOriginalTitle;
                }
            });
    }

    /**
     * Pobiera ważny Firebase ID token z FirebaseSync.
     * Zwraca null jeśli użytkownik nie jest zalogowany.
     */
    async function getToken() {
        if (
            typeof FirebaseSync === "undefined" ||
            typeof FirebaseSync.getValidToken !== "function"
        ) {
            return null;
        }
        try {
            return await FirebaseSync.getValidToken();
        } catch {
            return null;
        }
    }

    /**
     * Wysyła prompt do Gemini przez bezpieczne proxy.
     *
     * @param {string} prompt - Treść promptu
     * @param {object} [opts]
     * @param {number} [opts.temperature=0.8] - Temperatura (0–2)
     * @param {number} [opts.maxOutputTokens=500] - Max tokenów wyjściowych
     * @returns {Promise<{text: string, usage: object}>}
     * @throws {Error} jeśli użytkownik niezalogowany, limit przekroczony lub błąd serwera
     */
    async function request(prompt, { temperature = 0.8, maxOutputTokens = 500 } = {}) {
        const token = await getToken();

        if (!token) {
            throw new Error(
                "Zaloguj się, aby korzystać z funkcji AI."
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
            const msg = data?.error || `Błąd serwera AI (${res.status})`;

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
                    `Przekroczono limit AI (${limit} zapytań/mc dla planu ${plan.toUpperCase()}). Ulepsz plan aby kontynuować.`
                );
                error.code = "AI_LIMIT_REACHED";
                showUpgradePrompt({ plan, used: Number(data?.used || limit || 0), limit: Number(data?.limit || 0) });
                throw error;
            }
            if (previousUsage) await setCachedUsage(previousUsage);
            if (res.status === 401) {
                throw new Error(
                    "Sesja wygasła. Zaloguj się ponownie."
                );
            }

            throw new Error(msg);
        }

        await setCachedUsage(data.usage || {
            ...previousUsage,
            used: (previousUsage?.used || 0) + 1,
        });

        return {
            text: data.text || "",
            usage: data.usage || {},
        };
    }

    /**
     * Pomocnik: wysyła prompt i parsuje odpowiedź jako JSON.
     * Odpowiednik geminiRequest() z core.js.
     *
     * @param {string} prompt
     * @param {object} [opts]
     * @returns {Promise<object>} - Sparsowany obiekt JSON z odpowiedzi
     */
    async function requestJSON(prompt, opts = {}) {
        const { text } = await request(prompt, opts);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Gemini: brak odpowiedzi JSON");
        }
        return JSON.parse(jsonMatch[0]);
    }

    // Eksport
    return {
        request,
        requestJSON,
        refreshUsage,
        getCachedUsage,
        applyLocalLimitToUI,
        isLimitError,
        showUpgradePrompt,
        openPlans,
        isLimitReached: async () => {
            const usage = await getCachedUsage();
            return !!(usage?.limit > 0 && usage.used >= usage.limit);
        },
    };
})();

// Udostępnij globalnie (content scripts + popup + background)
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
