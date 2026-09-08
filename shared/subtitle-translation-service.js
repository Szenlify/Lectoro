/** Worker-owned subtitle quota transaction. Failed requests never consume characters. */
(function (root) {
    "use strict";
    let transaction = Promise.resolve();

    async function translate(text, targetLang, sourceLang = null) {
        text = String(text || "").trim();
        if (!text) throw new Error("No subtitle to translate.");
        // Serialize cache check, quota check and commit across all tabs.
        const operation = transaction
            .catch(() => {})
            .then(async () => {
                const translator = root.SharedTranslatorService;
                const learningLang = sourceLang || await translator.getLearningLang();
                const subscriptions = root.SubscriptionService;
                const cached = await translator.getCachedTranslation(
                    text,
                    targetLang,
                    learningLang,
                );
                if (cached) return { status: "success", ...cached, targetLang };
                const quota = await subscriptions.getSubtitleQuotaStatus(
                    text.length,
                );
                if (!quota.allowed)
                    return { status: "limit", quota, targetLang };
                const result = await translator.translate(text, targetLang, learningLang);
                const committed = await subscriptions.consumeSubtitleQuota(
                    text.length,
                );
                if (!committed.allowed)
                    return { status: "limit", quota: committed, targetLang };
                return { status: "success", ...result, targetLang };
            });
        transaction = operation;
        return operation;
    }

    root.SharedSubtitleTranslationService = Object.freeze({ translate });
})(globalThis);
