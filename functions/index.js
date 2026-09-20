const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { consolidateAll, consolidatePair } = require("./consolidate-dictionary");
const {
    SUBSCRIPTION_PLANS,
    SUBSCRIPTION_LIMITS,
    currentMonth,
    normalizePlan,
    getPlanLimits,
    checkAiLimit,
    checkGeminiTtsLimit,
} = require("./subscription-config");
const { isReviewContext } = require("./gemini-policy");
const { VOICES, normalizeLanguage, synthesizeSpeech } = require("./gemini-tts");
const {
    getCachedAudio,
    saveCachedAudio,
    saveCardImage,
    deleteCardImage,
    deleteCardImages,
    deleteAllUserImages,
} = require("./r2-storage");

let adminInstance = null;
function getAdmin() {
    if (!adminInstance) {
        adminInstance = require("firebase-admin");
        if (!adminInstance.apps.length) {
            adminInstance.initializeApp();
        }
    }
    return adminInstance;
}

// Secret Manager is used strictly for sensitive private keys
const geminiApiKey = defineSecret("LECTORO_GEMINI_API_KEY");
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY");

function getGeminiApiKey() {
    return geminiApiKey.value() || process.env.LECTORO_GEMINI_API_KEY || "";
}

function getR2SecretAccessKey() {
    return r2SecretAccessKey.value() || process.env.R2_SECRET_ACCESS_KEY || "";
}

function getR2Config() {
    return {
        accountId: process.env.R2_ACCOUNT_ID || "94b9a2de404c8e3f8efa532d0607b5f1",
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: getR2SecretAccessKey(),
        bucketName: process.env.R2_BUCKET_NAME || "lectoro-media",
        publicUrl: process.env.R2_PUBLIC_URL || "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev",
    };
}

// In-memory sliding window rate limiter per UID (anti-abuse / DDoS protection)
const userRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_MINUTE = 50;

function isUserRateLimited(uid) {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const timestamps = (userRateLimits.get(uid) || []).filter((t) => t > windowStart);
    if (timestamps.length >= MAX_REQUESTS_PER_MINUTE) {
        userRateLimits.set(uid, timestamps);
        return true;
    }
    timestamps.push(now);
    userRateLimits.set(uid, timestamps);

    if (userRateLimits.size > 5000) {
        for (const [k, ts] of userRateLimits.entries()) {
            const valid = ts.filter((t) => t > windowStart);
            if (valid.length === 0) userRateLimits.delete(k);
            else userRateLimits.set(k, valid);
        }
    }
    return false;
}

// Stripe endpoints live in a separate module so the AI/TTS proxy remains easy
// to audit.
Object.assign(exports, require("./stripe-billing"));

function setCorsHeaders(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set(
        "Access-Control-Expose-Headers",
        "X-Lectoro-Plan, X-Lectoro-TTS-Used, X-Lectoro-Cache",
    );
}

function usageForMonth(value, resetDate, month) {
    return resetDate === month ? Math.max(0, Number(value) || 0) : 0;
}

// Legacy elevenLabs* usage fields remain server-owned to preserve quotas across migration.
function subscriptionProfile(uid, plan, data = {}, month = currentMonth()) {
    return {
        uid,
        plan: normalizePlan(plan),
        subscriptionStatus: data.subscriptionStatus || "active",
        stripeCurrentPeriodEnd: data.stripeCurrentPeriodEnd || null,
        stripeCancelAtPeriodEnd: !!data.stripeCancelAtPeriodEnd,
        stripeTrialEnd: data.stripeTrialEnd || null,
        trialEligible: !data.stripeTrialUsed && !data.stripeHasSubscribed,
        usage: {
            ai: {
                month,
                used: usageForMonth(data.aiCallsThisMonth, data.aiCallsResetDate, month),
            },
            elevenLabsCharacters: {
                month,
                used: usageForMonth(
                    data.elevenLabsCharactersThisMonth,
                    data.elevenLabsResetDate,
                    month,
                ),
            },
        },
    };
}

function limitHttpStatus(validation) {
    if (validation.code === "GEMINI_TTS_REQUEST_TOO_LONG") return 413;
    if (validation.code === "GEMINI_TTS_NOT_INCLUDED") return 403;
    return 429;
}

async function rollbackAiReservation(db, userRef, month) {
    try {
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(userRef);
            if (!snapshot.exists) return;
            const data = snapshot.data() || {};
            if (data.aiCallsResetDate !== month) return;
            const used = Math.max(0, Number(data.aiCallsThisMonth) || 0);
            if (used > 0) {
                transaction.set(userRef, { aiCallsThisMonth: used - 1 }, { merge: true });
            }
        });
    } catch (error) {
        console.error("[geminiProxy] AI reservation rollback error:", error);
    }
}

async function rollbackGeminiTtsReservation(db, userRef, month, characters) {
    try {
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(userRef);
            if (!snapshot.exists) return;
            const data = snapshot.data() || {};
            if (data.elevenLabsResetDate !== month) return;
            const used = Math.max(0, Number(data.elevenLabsCharactersThisMonth) || 0);
            transaction.set(
                userRef,
                { elevenLabsCharactersThisMonth: Math.max(0, used - characters) },
                { merge: true },
            );
        });
    } catch (error) {
        console.error("[subscriptionProxy] Gemini TTS rollback error:", error);
    }
}

async function fetchGeminiWithRetry(geminiKey, payload, maxRetries = 2, timeoutMs) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`;
    let lastError = null;
    let lastStatus = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
            const delayMs = 500 * Math.pow(2, attempt - 1) + Math.random() * 200;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(timeoutMs ?? (payload.generationConfig?.responseMimeType === "text/plain" ? 12000 : 25000)),
            });

            if (response.ok) {
                return await response.json();
            }

            lastStatus = response.status;
            const details = await response.json().catch(() => ({}));
            const msg = details?.error?.message || `Gemini HTTP ${response.status}`;
            lastError = Object.assign(new Error(msg), { status: response.status });

            // Only retry on transient rate limit or server errors
            if (response.status !== 429 && response.status !== 503 && response.status !== 500) {
                throw lastError;
            }
        } catch (err) {
            lastError = err;
            if (attempt === maxRetries) throw lastError;
        }
    }
    throw lastError || new Error(`Gemini failed with status ${lastStatus}`);
}

exports.geminiProxy = onRequest(
    {
        region: "europe-west1",
        cors: false,
        timeoutSeconds: 60,
        maxInstances: 10,
        concurrency: 80,
        memory: "256MiB",
        secrets: [
            geminiApiKey,
            r2SecretAccessKey,
        ],
    },
    async (req, res) => {
        setCorsHeaders(res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        const authHeader = req.headers.authorization || "";
        const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!idToken) return res.status(401).json({ error: "Authorization token missing. Please sign in." });

        let decodedToken;
        try {
            decodedToken = await getAdmin().auth().verifyIdToken(idToken);
        } catch (error) {
            console.error("[geminiProxy] Invalid token:", error.message);
            return res.status(401).json({ error: "Invalid token. Please sign in again." });
        }

        const uid = decodedToken.uid;
        if (isUserRateLimited(uid)) {
            return res.status(429).json({
                error: "Too many requests. Please wait a moment.",
                code: "RATE_LIMIT_EXCEEDED",
            });
        }
        const db = getAdmin().firestore();
        const userRef = db.collection("users").doc(uid);
        const month = currentMonth();
        let userData = {};

        try {
            const snapshot = await userRef.get();
            if (snapshot.exists) userData = snapshot.data() || {};
        } catch (error) {
            console.error("[geminiProxy] Firestore read error:", error);
            return res.status(503).json({ error: "Failed to verify user subscription plan." });
        }

        // The Firestore user record is updated immediately in real time by the
        // Stripe webhook, whereas decodedToken.plan from client JWT claims can
        // lag until the client refreshes its token. Use authoritative plan from Firestore/claims.
        const authoritativePlan = normalizePlan(
            userData.plan !== undefined ? userData.plan : decodedToken.plan,
        );

        const profile = subscriptionProfile(uid, authoritativePlan, userData, month);
        const plan = profile.plan || SUBSCRIPTION_PLANS.FREE;
        const aiLimit = getPlanLimits(plan).ai.usesPerMonth;
        const aiUsed = profile.usage.ai.used;

        // Compatibility with the existing AI usage UI plus a complete profile
        // for all current/future entitlement checks.
        if (req.body?.action === "usage" || req.body?.action === "subscription") {
            return res.status(200).json({
                profile,
                usage: {
                    plan,
                    used: aiUsed,
                    limit: aiLimit,
                    remaining: Math.max(0, aiLimit - aiUsed),
                },
            });
        }

        if (req.body?.action === "liveTranslation") {
            const { handleLiveTranslation, translationError } = require("./live-translation");
            const { getTranslationJson, putTranslationJson } = require("./r2-storage");
            const etags = new Map();
            try {
                const result = await handleLiveTranslation(req.body, {
                    uid, db,
                    usage: { plan, used: aiUsed, limit: aiLimit, remaining: Math.max(0, aiLimit - aiUsed) },
                    read: async key => {
                        const record = await getTranslationJson(getR2Config(), key, { withMetadata: true });
                        etags.set(key, record?.etag);
                        return record?.value ?? null;
                    },
                    write: (key, value) => putTranslationJson(getR2Config(), key, value, { etag: etags.get(key) }),
                    generate: payload => fetchGeminiWithRetry(getGeminiApiKey(), payload, 0, req.body.kind === "sentence" ? 25000 : 12000),
                    rollback: () => req.body?.kind === "word" ? Promise.resolve() : rollbackAiReservation(db, userRef, month),
                    reserve: () => db.runTransaction(async tx => {
                        const snap = await tx.get(userRef);
                        const data = snap.data() || {};
                        const used = usageForMonth(data.aiCallsThisMonth, data.aiCallsResetDate, month);
                        const isWordLookup = req.body?.kind === "word";
                        if (!isWordLookup) {
                            const validation = checkAiLimit({ plan, used });
                            if (!validation.allowed) throw Object.assign(new Error(validation.message), { status: 429, code: validation.code,
                                usage: { plan, used, limit: aiLimit, remaining: 0 } });
                            tx.set(userRef, { aiCallsThisMonth: used + 1, aiCallsResetDate: month }, { merge: true });
                            return { plan, used: used + 1, limit: aiLimit, remaining: Math.max(0, aiLimit - used - 1) };
                        }
                        // Word lookups enrich the shared R2 dictionary and are unlimited for all plans (Free & Pro)
                        return { plan, used, limit: aiLimit, remaining: Math.max(0, aiLimit - used) };
                    }),
                });
                return res.status(200).json(result);
            } catch (error) {
                console.warn("[liveTranslation]", error.stage || "request", error.message, "input:", JSON.stringify(req.body?.text));
                const { status, ...failure } = translationError(error);
                return res.status(status).json(failure);
            }
        }

        if (req.body?.action === "consolidateDictionary") {
            const pair = req.body?.pair || "all";
            const force = req.body?.force === true;
            const config = getR2Config();
            try {
                if (pair === "all") {
                    const results = await consolidateAll(config, { forceUpload: force });
                    return res.status(200).json({ success: true, results });
                } else {
                    const result = await consolidatePair(config, pair, { forceUpload: force });
                    return res.status(200).json({ success: true, result });
                }
            } catch (error) {
                console.warn("[consolidateDictionary]", error.message);
                return res.status(500).json({ error: error.message });
            }
        }

        if (req.body?.action === "uploadCardImage") {
            const { wordId, imageBase64, contentType = "image/webp" } = req.body || {};
            if (!imageBase64 || typeof imageBase64 !== "string") {
                return res.status(400).json({ error: "Missing image data." });
            }
            const base64Data = imageBase64.includes(",")
                ? imageBase64.split(",")[1]
                : imageBase64;
            const buffer = Buffer.from(base64Data, "base64");
            if (buffer.length > 5 * 1024 * 1024) {
                return res.status(413).json({ error: "Image is too large (max 5MB)." });
            }
            const r2Config = getR2Config();
            const result = await saveCardImage(r2Config, uid, wordId, buffer, contentType);
            if (!result) {
                return res.status(503).json({
                    error: "Cloudflare R2 storage is not configured.",
                });
            }
            return res.status(200).json({
                ok: true,
                key: result.key,
                relativePath: result.relativePath,
                path: result.relativePath,
                url: result.publicUrl,
            });
        }

        if (req.body?.action === "deleteCardImage") {
            const { wordId, wordIds } = req.body || {};
            const r2Config = getR2Config();
            if (Array.isArray(wordIds) && wordIds.length > 0) {
                const count = await deleteCardImages(r2Config, uid, wordIds);
                return res.status(200).json({ ok: true, deleted: count });
            }
            if (wordId) {
                const ok = await deleteCardImage(r2Config, uid, wordId);
                return res.status(200).json({ ok });
            }
            return res.status(400).json({ error: "Brak wordId lub wordIds." });
        }

        if (req.body?.action === "deleteAllUserImages") {
            const r2Config = getR2Config();
            const count = await deleteAllUserImages(r2Config, uid);
            return res.status(200).json({ ok: true, deletedCount: count });
        }

        if (req.body?.action === "deleteUserAccount") {
            const r2Config = getR2Config();

            // 1. Usunięcie wszystkich grafik użytkownika z Cloudflare R2
            try {
                await deleteAllUserImages(r2Config, uid);
            } catch (r2Err) {
                console.warn("[geminiProxy] deleteUserAccount R2 cleanup warning:", r2Err.message);
            }

            // 2. Usunięcie wszystkich dokumentów z subkolekcji słówek w Firestore
            try {
                const wordsSnapshot = await userRef.collection("words").get();
                const batchSize = 400;
                const docs = wordsSnapshot.docs;
                for (let i = 0; i < docs.length; i += batchSize) {
                    const batch = db.batch();
                    docs.slice(i, i + batchSize).forEach((doc) => batch.delete(doc.ref));
                    await batch.commit();
                }
            } catch (fsErr) {
                console.warn("[geminiProxy] deleteUserAccount Firestore words cleanup warning:", fsErr.message);
            }

            // 3. Usunięcie dokumentu profilu użytkownika w Firestore
            try {
                await userRef.delete();
            } catch (docErr) {
                console.warn("[geminiProxy] deleteUserAccount Firestore userRef delete warning:", docErr.message);
            }

            // 4. Usunięcie konta użytkownika z Firebase Authentication
            try {
                await getAdmin().auth().deleteUser(uid);
            } catch (authErr) {
                console.warn("[geminiProxy] deleteUserAccount Firebase Auth deleteUser warning:", authErr.message);
            }

            return res.status(200).json({ ok: true, message: "Account and data permanently deleted." });
        }

        if (req.body?.action === "geminiTtsVoices") {
            if (!isReviewContext(req.body?.context)) {
                return res.status(403).json({
                    error: "Gemini TTS voices are only available in review mode.",
                    code: "GEMINI_TTS_REVIEW_ONLY",
                });
            }
            if (!getPlanLimits(plan).geminiTts.enabled) {
                return res.status(403).json({
                    error: "Gemini TTS is not included in the FREE plan.",
                    code: "GEMINI_TTS_NOT_INCLUDED",
                });
            }
            return res.status(200).json({ voices: VOICES });
        }

        if (req.body?.action === "synthesizeGeminiTts") {
            if (!isReviewContext(req.body?.context)) {
                return res.status(403).json({
                    error: "Gemini TTS is only available in review mode.",
                    code: "GEMINI_TTS_REVIEW_ONLY",
                });
            }
            const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
            const voiceId = typeof req.body.voiceId === "string" ? req.body.voiceId : "";
            if (!VOICES.some((voice) => voice.voice_id === voiceId)) {
                return res.status(400).json({ error: "Invalid Gemini TTS voice identifier." });
            }

            let language;
            try {
                language = normalizeLanguage(req.body.language);
            } catch (_) {
                return res.status(400).json({ error: "Invalid speech language." });
            }
            if (!text) return res.status(400).json({ error: "Speech text is empty." });
            const entitlement = checkGeminiTtsLimit({ plan, text, usedCharacters: 0 });
            if (!entitlement.allowed) {
                return res.status(limitHttpStatus(entitlement)).json({ error: entitlement.message, limit: entitlement });
            }

            // Reserve characters for user in transaction (R2 downloads and Gemini synthesis both count towards character usage)
            let reservation = null;
            try {
                reservation = await db.runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(userRef);
                    const data = snapshot.exists ? snapshot.data() || {} : {};
                    const used = usageForMonth(
                        data.elevenLabsCharactersThisMonth,
                        data.elevenLabsResetDate,
                        month,
                    );
                    const validation = checkGeminiTtsLimit({
                        plan,
                        text,
                        usedCharacters: used,
                    });
                    if (!validation.allowed) return { validation, data };

                    const nextData = {
                        ...data,
                        elevenLabsCharactersThisMonth: used + validation.requested,
                        elevenLabsResetDate: month,
                    };
                    transaction.set(
                        userRef,
                        {
                            elevenLabsCharactersThisMonth: nextData.elevenLabsCharactersThisMonth,
                            elevenLabsResetDate: month,
                        },
                        { merge: true },
                    );
                    return { validation, data: nextData };
                });

                if (!reservation.validation.allowed) {
                    return res.status(limitHttpStatus(reservation.validation)).json({
                        error: reservation.validation.message,
                        limit: reservation.validation,
                        profile: subscriptionProfile(uid, plan, reservation.data, month),
                    });
                }

                // 1. Central R2 Cache Check (if skipCacheCheck is not requested)
                const r2Config = getR2Config();
                if (!req.body?.skipCacheCheck) {
                    try {
                        const cached = await getCachedAudio(r2Config, voiceId, text, language);
                        if (cached && cached.buffer && cached.buffer.length > 0) {
                            res.set("Content-Type", cached.contentType || "audio/wav");
                            res.set("Cache-Control", "private, no-store");
                            res.set("X-Lectoro-Plan", plan);
                            res.set("X-Lectoro-Cache", "HIT");
                            res.set(
                                "X-Lectoro-TTS-Used",
                                String(reservation.data.elevenLabsCharactersThisMonth),
                            );
                            return res.status(200).send(cached.buffer);
                        }
                    } catch (cacheError) {
                        console.warn("[geminiProxy] R2 cache check warning:", cacheError.message);
                    }
                }

                // If only checking cache (e.g. hover), roll back reservation and return 404
                if (req.body?.onlyIfCached || req.body?.context === "hover") {
                    await rollbackGeminiTtsReservation(
                        db,
                        userRef,
                        month,
                        reservation.validation.requested,
                    );
                    return res.status(404).json({
                        error: "Audio not cached in R2.",
                        code: "GEMINI_TTS_NOT_CACHED",
                        cached: false,
                    });
                }

                // 2. Cache Miss in Review mode: synthesize with Gemini
                const audio = await synthesizeSpeech({
                    apiKey: getGeminiApiKey(), text, voiceId, language,
                });

                // Asynchronously save to Cloudflare R2 cache so the client receives audio without waiting
                saveCachedAudio(r2Config, voiceId, text, audio, language).catch((err) =>
                    console.warn("[geminiProxy] Async R2 save error:", err.message),
                );

                res.set("Content-Type", "audio/wav");
                res.set("Cache-Control", "private, no-store");
                res.set("X-Lectoro-Plan", plan);
                res.set("X-Lectoro-Cache", "MISS");
                res.set(
                    "X-Lectoro-TTS-Used",
                    String(
                        reservation.data.elevenLabsCharactersThisMonth ||
                            reservation.validation.requested,
                    ),
                );
                return res.status(200).send(audio);
            } catch (error) {
                console.error("[subscriptionProxy] Gemini TTS request error:", error);
                if (reservation?.validation?.allowed) {
                    await rollbackGeminiTtsReservation(
                        db,
                        userRef,
                        month,
                        reservation.validation.requested,
                    );
                }
                return res.status(503).json({
                    error: "Gemini TTS is temporarily unavailable. System voice will be used.",
                    code: error.code || "GEMINI_TTS_SYNTHESIS_FAILED",
                });
            }
        }

        const { prompt, temperature = 0.8, maxOutputTokens = 500, responseFormat = "json" } = req.body || {};
        if (!["json", "text"].includes(responseFormat)) {
            return res.status(400).json({ error: "Unsupported response format." });
        }
        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "Missing 'prompt' field in request body." });
        }
        if (prompt.length > 32000) {
            return res.status(400).json({ error: "Prompt too long (max 32,000 characters)." });
        }

        // Reserve atomically before calling Gemini so parallel requests cannot
        // overshoot the configured monthly quota.
        let aiReservation;
        try {
            aiReservation = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(userRef);
                const data = snapshot.exists ? snapshot.data() || {} : {};
                const used = usageForMonth(data.aiCallsThisMonth, data.aiCallsResetDate, month);
                const validation = checkAiLimit({ plan, used });
                if (!validation.allowed) return validation;
                transaction.set(
                    userRef,
                    { aiCallsThisMonth: used + 1, aiCallsResetDate: month },
                    { merge: true },
                );
                return { ...validation, plan, usedAfter: used + 1 };
            });
        } catch (error) {
            console.error("[geminiProxy] AI reservation error:", error);
            return res.status(503).json({ error: "Failed to check AI limit." });
        }

        if (!aiReservation.allowed) {
            return res.status(429).json({
                error: aiReservation.message,
                code: aiReservation.code,
                plan: aiReservation.plan,
                used: aiReservation.used,
                limit: aiReservation.limit,
            });
        }

        const geminiKey = getGeminiApiKey();
        if (!geminiKey) {
            console.error("[geminiProxy] LECTORO_GEMINI_API_KEY is not configured");
            await rollbackAiReservation(db, userRef, month);
            return res.status(500).json({ error: "Server configuration error." });
        }

        let text;
        try {
            const { generationConfig, readJsonResponse, readTextResponse } = require("./ai-response");
            const geminiPayload = {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: generationConfig(temperature, maxOutputTokens, responseFormat),
            };
            const geminiResponse = await fetchGeminiWithRetry(geminiKey, geminiPayload, responseFormat === "text" ? 0 : 2);
            text = responseFormat === "text" ? readTextResponse(geminiResponse) : readJsonResponse(geminiResponse);
        } catch (error) {
            console.error("[geminiProxy] Gemini fetch error:", error);
            await rollbackAiReservation(db, userRef, month);
            return res.status(502).json({
                error: error.message || "Failed to connect to Gemini API.",
                code: [429, 503].includes(error.status) ? "RATE_LIMITED" : "AI_REQUEST_FAILED",
            });
        }

        const activeAiLimit = getPlanLimits(aiReservation.plan).ai.usesPerMonth;
        return res.status(200).json({
            text,
            usage: {
                plan: aiReservation.plan,
                used: aiReservation.usedAfter,
                limit: activeAiLimit,
                remaining: Math.max(0, activeAiLimit - aiReservation.usedAfter),
            },
        });
    },
);

exports.consolidateDictionaryDaily = onSchedule(
    {
        region: "europe-west1",
        schedule: "0 3 * * *",
        retryCount: 3,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 300,
        timeZone: "Europe/Warsaw",
        memory: "1GiB",
        timeoutSeconds: 540,
        secrets: [r2SecretAccessKey],
    },
    async () => {
        const config = getR2Config();
        console.log("[consolidateDictionaryDaily] Starting daily consolidation...");
        const results = await consolidateAll(config);
        console.log("[consolidateDictionaryDaily] Finished daily consolidation:", JSON.stringify(results));
    },
);

