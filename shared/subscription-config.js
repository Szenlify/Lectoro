/**
 * Central subscription configuration shared by the extension and Cloud Functions.
 *
 * To change a quota or displayed price, edit SUBSCRIPTION_LIMITS below. Stripe
 * Price IDs control the amount actually charged. The lower-case plan values are
 * intentionally identical to values stored in Firestore (`users.plan`).
 */
(function initSubscriptionConfig(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.SubscriptionConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createConfig() {
    "use strict";

    const SUBSCRIPTION_PLANS = Object.freeze({
        FREE: "free",
        BASIC: "basic",
        PRO: "pro",
    });

    // All numeric product limits live in this one object.
    const SUBSCRIPTION_LIMITS = Object.freeze({
        [SUBSCRIPTION_PLANS.FREE]: Object.freeze({
            displayName: "FREE",
            trialDays: 0,
            priceMonthly: Object.freeze({ amount: 0, currency: "PLN" }),
            ai: Object.freeze({ usesPerMonth: 10 }),
            srs: Object.freeze({ maxSavedCards: 50 }),
            elevenLabs: Object.freeze({
                enabled: false,
                maxCharactersPerRequest: 0,
                charactersPerMonth: 0,
            }),
        }),
        [SUBSCRIPTION_PLANS.BASIC]: Object.freeze({
            displayName: "BASIC",
            trialDays: 3,
            priceMonthly: Object.freeze({ amount: 7.99, currency: "USD" }),
            ai: Object.freeze({ usesPerMonth: 200 }),
            srs: Object.freeze({ maxSavedCards: 3000 }),
            elevenLabs: Object.freeze({
                enabled: true,
                maxCharactersPerRequest: 500,
                charactersPerMonth: 20000,
            }),
        }),
        [SUBSCRIPTION_PLANS.PRO]: Object.freeze({
            displayName: "PRO",
            trialDays: 3,
            priceMonthly: Object.freeze({ amount: 19.99, currency: "USD" }),
            ai: Object.freeze({ usesPerMonth: 1200 }),
            srs: Object.freeze({ maxSavedCards: 10000 }),
            elevenLabs: Object.freeze({
                enabled: true,
                maxCharactersPerRequest: 1000,
                charactersPerMonth: 120000,
            }),
        }),
    });

    const LIMIT_ERROR_CODES = Object.freeze({
        AI_LIMIT_REACHED: "AI_LIMIT_REACHED",
        SRS_LIMIT_REACHED: "SRS_LIMIT_REACHED",
        ELEVENLABS_NOT_INCLUDED: "ELEVENLABS_NOT_INCLUDED",
        ELEVENLABS_REQUEST_TOO_LONG: "ELEVENLABS_REQUEST_TOO_LONG",
        ELEVENLABS_MONTHLY_LIMIT_REACHED: "ELEVENLABS_MONTHLY_LIMIT_REACHED",
    });

    function normalizePlan(plan) {
        const normalized = String(plan || "").trim().toLowerCase();
        return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_LIMITS, normalized)
            ? normalized
            : SUBSCRIPTION_PLANS.FREE;
    }

    function getPlanLimits(plan) {
        return SUBSCRIPTION_LIMITS[normalizePlan(plan)];
    }

    function countCharacters(text) {
        return Array.from(String(text || "").trim()).length;
    }

    function result({ allowed, code = null, feature, plan, limit, used, requested = 1, message }) {
        return {
            allowed,
            code,
            feature,
            plan: normalizePlan(plan),
            limit,
            used,
            requested,
            remaining: Math.max(0, limit - used),
            upgradeRequired: !allowed,
            message,
        };
    }

    function checkAiLimit({ plan, used = 0, requested = 1 }) {
        const normalizedPlan = normalizePlan(plan);
        const limit = getPlanLimits(normalizedPlan).ai.usesPerMonth;
        const safeUsed = Math.max(0, Number(used) || 0);
        const safeRequested = Math.max(1, Number(requested) || 1);
        const allowed = safeUsed + safeRequested <= limit;
        return result({
            allowed,
            code: allowed ? null : LIMIT_ERROR_CODES.AI_LIMIT_REACHED,
            feature: "ai",
            plan: normalizedPlan,
            limit,
            used: safeUsed,
            requested: safeRequested,
            message: allowed
                ? "Funkcja AI jest dostępna."
                : `Wykorzystano miesięczny limit AI (${limit}) dla planu ${normalizedPlan.toUpperCase()}.`,
        });
    }

    function checkSrsLimit({ plan, savedCards = 0, additionalCards = 1 }) {
        const normalizedPlan = normalizePlan(plan);
        const limit = getPlanLimits(normalizedPlan).srs.maxSavedCards;
        const used = Math.max(0, Number(savedCards) || 0);
        const requested = Math.max(1, Number(additionalCards) || 1);
        const allowed = used + requested <= limit;
        return result({
            allowed,
            code: allowed ? null : LIMIT_ERROR_CODES.SRS_LIMIT_REACHED,
            feature: "srs",
            plan: normalizedPlan,
            limit,
            used,
            requested,
            message: allowed
                ? "Możesz zapisać fiszkę."
                : `Osiągnięto limit ${limit} zapisanych fiszek dla planu ${normalizedPlan.toUpperCase()}.`,
        });
    }

    function checkElevenLabsLimit({ plan, text, usedCharacters = 0 }) {
        const normalizedPlan = normalizePlan(plan);
        const limits = getPlanLimits(normalizedPlan).elevenLabs;
        const used = Math.max(0, Number(usedCharacters) || 0);
        const requested = countCharacters(text);

        if (!limits.enabled) {
            return result({
                allowed: false,
                code: LIMIT_ERROR_CODES.ELEVENLABS_NOT_INCLUDED,
                feature: "elevenLabs",
                plan: normalizedPlan,
                limit: 0,
                used,
                requested,
                message: "ElevenLabs nie jest dostępny w planie FREE. Ulepsz plan, aby włączyć tę funkcję.",
            });
        }
        if (requested > limits.maxCharactersPerRequest) {
            return result({
                allowed: false,
                code: LIMIT_ERROR_CODES.ELEVENLABS_REQUEST_TOO_LONG,
                feature: "elevenLabs",
                plan: normalizedPlan,
                limit: limits.maxCharactersPerRequest,
                used: 0,
                requested,
                message: `Tekst ma ${requested} znaków. Limit jednego żądania ElevenLabs w planie ${normalizedPlan.toUpperCase()} wynosi ${limits.maxCharactersPerRequest}.`,
            });
        }

        const allowed = requested > 0 && used + requested <= limits.charactersPerMonth;
        return result({
            allowed,
            code: allowed ? null : LIMIT_ERROR_CODES.ELEVENLABS_MONTHLY_LIMIT_REACHED,
            feature: "elevenLabs",
            plan: normalizedPlan,
            limit: limits.charactersPerMonth,
            used,
            requested,
            message: allowed
                ? "Synteza ElevenLabs jest dostępna."
                : `Przekroczono miesięczny limit ${limits.charactersPerMonth} znaków ElevenLabs dla planu ${normalizedPlan.toUpperCase()}.`,
        });
    }

    class SubscriptionLimitError extends Error {
        constructor(validation) {
            super(validation.message);
            this.name = "SubscriptionLimitError";
            Object.assign(this, validation);
        }
    }

    function assertAllowed(validation) {
        if (!validation.allowed) throw new SubscriptionLimitError(validation);
        return validation;
    }

    function currentMonth() {
        return new Date().toISOString().slice(0, 7);
    }

    return Object.freeze({
        SUBSCRIPTION_PLANS,
        SUBSCRIPTION_LIMITS,
        LIMIT_ERROR_CODES,
        SubscriptionLimitError,
        currentMonth,
        normalizePlan,
        getPlanLimits,
        countCharacters,
        checkAiLimit,
        checkSrsLimit,
        checkElevenLabsLimit,
        assertAllowed,
    });
});
