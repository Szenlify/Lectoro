const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const {
    SUBSCRIPTION_PLANS,
    SUBSCRIPTION_LIMITS,
    currentMonth,
    normalizePlan,
    getPlanLimits,
    checkAiLimit,
    checkElevenLabsLimit,
} = require("./subscription-config");
const { isReviewContext } = require("./elevenlabs-policy");
const {
    getCachedAudio,
    saveCachedAudio,
    saveCardImage,
    deleteCardImage,
    deleteCardImages,
    deleteAllUserImages,
} = require("./r2-storage");

admin.initializeApp();
setGlobalOptions({ region: "europe-west1" });
// A distinct name allows migration from the legacy plain GEMINI_API_KEY
// environment variable without Cloud Run's env/secret name collision.
const geminiApiKey = defineSecret("LECTORO_GEMINI_API_KEY");
const elevenLabsApiKey = defineSecret("ELEVENLABS_API_KEY");
const r2AccessKeyId = defineSecret("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY");
const r2AccountId = defineSecret("R2_ACCOUNT_ID");
const r2BucketName = defineSecret("R2_BUCKET_NAME");
const r2PublicUrl = defineSecret("R2_PUBLIC_URL");

function getR2Config() {
    return {
        accountId: r2AccountId.value() || process.env.R2_ACCOUNT_ID || "",
        accessKeyId: r2AccessKeyId.value() || process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: r2SecretAccessKey.value() || process.env.R2_SECRET_ACCESS_KEY || "",
        bucketName: r2BucketName.value() || process.env.R2_BUCKET_NAME || "lectoro-media",
        publicUrl: r2PublicUrl.value() || process.env.R2_PUBLIC_URL || "",
    };
}

// Stripe endpoints live in a separate module so the AI/TTS proxy remains easy
// to audit. Firebase Admin has already been initialized above.
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

function subscriptionProfile(uid, plan, data = {}, month = currentMonth()) {
    return {
        uid,
        plan: normalizePlan(plan),
        subscriptionStatus: data.subscriptionStatus || "active",
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
    if (validation.code === "ELEVENLABS_REQUEST_TOO_LONG") return 413;
    if (validation.code === "ELEVENLABS_NOT_INCLUDED") return 403;
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

async function rollbackElevenLabsReservation(db, userRef, month, characters) {
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
        console.error("[subscriptionProxy] ElevenLabs rollback error:", error);
    }
}

function elevenLabsClientError(details) {
    const status = details?.detail?.status || details?.status || "";
    if (status === "detected_unusual_activity") {
        return {
            httpStatus: 503,
            code: "ELEVENLABS_PROVIDER_DISABLED",
            error: "Głosy ElevenLabs są chwilowo niedostępne. Administrator usługi musi aktywować konto API.",
        };
    }
    if (status === "quota_exceeded" || status === "insufficient_credits") {
        return {
            httpStatus: 503,
            code: "ELEVENLABS_PROVIDER_QUOTA",
            error: "Limit konta API ElevenLabs został wyczerpany.",
        };
    }
    if (status === "voice_not_found") {
        return {
            httpStatus: 409,
            code: "ELEVENLABS_VOICE_UNAVAILABLE",
            error: "Ten głos ElevenLabs nie jest już dostępny. Wybierz inny głos.",
        };
    }
    return {
        httpStatus: 502,
        code: "ELEVENLABS_SYNTHESIS_FAILED",
        error: "Synteza ElevenLabs nie powiodła się.",
    };
}

exports.geminiProxy = onRequest(
    {
        cors: false,
        timeoutSeconds: 60,
        memory: "256MiB",
        secrets: [
            geminiApiKey,
            elevenLabsApiKey,
            r2AccessKeyId,
            r2SecretAccessKey,
            r2AccountId,
            r2BucketName,
            r2PublicUrl,
        ],
    },
    async (req, res) => {
        setCorsHeaders(res);
        if (req.method === "OPTIONS") return res.status(204).send("");
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

        const authHeader = req.headers.authorization || "";
        const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        if (!idToken) return res.status(401).json({ error: "Brak tokenu autoryzacji. Zaloguj się." });

        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (error) {
            console.error("[geminiProxy] Invalid token:", error.message);
            return res.status(401).json({ error: "Nieprawidłowy token. Zaloguj się ponownie." });
        }

        const uid = decodedToken.uid;
        // Custom Claims are the authoritative entitlement source. Unknown or
        // missing values deliberately fall back to FREE.
        const claimedPlan = normalizePlan(decodedToken.plan);
        const db = admin.firestore();
        const userRef = db.collection("users").doc(uid);
        const month = currentMonth();
        let userData = {};

        try {
            const snapshot = await userRef.get();
            if (snapshot.exists) userData = snapshot.data() || {};
        } catch (error) {
            console.error("[geminiProxy] Firestore read error:", error);
            return res.status(503).json({ error: "Nie udało się sprawdzić planu użytkownika." });
        }

        const profile = subscriptionProfile(uid, claimedPlan, userData, month);
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

        if (req.body?.action === "uploadCardImage") {
            const { wordId, imageBase64, contentType = "image/webp" } = req.body || {};
            if (!imageBase64 || typeof imageBase64 !== "string") {
                return res.status(400).json({ error: "Brak danych obrazu." });
            }
            const base64Data = imageBase64.includes(",")
                ? imageBase64.split(",")[1]
                : imageBase64;
            const buffer = Buffer.from(base64Data, "base64");
            if (buffer.length > 5 * 1024 * 1024) {
                return res.status(413).json({ error: "Obraz jest zbyt duży (max 5MB)." });
            }
            const r2Config = getR2Config();
            const result = await saveCardImage(r2Config, uid, wordId, buffer, contentType);
            if (!result) {
                return res.status(503).json({
                    error: "Magazyn Cloudflare R2 nie jest skonfigurowany.",
                });
            }
            return res.status(200).json({
                ok: true,
                key: result.key,
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

        if (req.body?.action === "elevenLabsVoices") {
            if (!isReviewContext(req.body?.context)) {
                return res.status(403).json({
                    error: "Głosy ElevenLabs są dostępne wyłącznie w powtórkach.",
                    code: "ELEVENLABS_REVIEW_ONLY",
                });
            }
            if (!getPlanLimits(claimedPlan).elevenLabs.enabled) {
                return res.status(403).json({
                    error: "ElevenLabs nie jest dostępny w planie FREE.",
                    code: "ELEVENLABS_NOT_INCLUDED",
                });
            }
            try {
                const voicesResponse = await fetch("https://api.elevenlabs.io/v1/voices", {
                    headers: { "xi-api-key": elevenLabsApiKey.value() },
                });
                const details = await voicesResponse.json().catch(() => ({}));
                if (!voicesResponse.ok) {
                    console.error("[subscriptionProxy] ElevenLabs voices error:", details);
                    return res.status(502).json({ error: "Nie udało się pobrać głosów ElevenLabs." });
                }
                return res.status(200).json({
                    voices: (details.voices || []).map((voice) => ({
                        voice_id: voice.voice_id,
                        name: voice.name,
                        labels: voice.labels || {},
                    })),
                });
            } catch (error) {
                console.error("[subscriptionProxy] ElevenLabs voices fetch error:", error);
                return res.status(502).json({ error: "Błąd połączenia z ElevenLabs." });
            }
        }

        if (req.body?.action === "synthesizeElevenLabs") {
            if (!isReviewContext(req.body?.context)) {
                return res.status(403).json({
                    error: "ElevenLabs jest dostępny wyłącznie w powtórkach.",
                    code: "ELEVENLABS_REVIEW_ONLY",
                });
            }
            const text = typeof req.body.text === "string" ? req.body.text : "";
            const voiceId = typeof req.body.voiceId === "string" ? req.body.voiceId : "";
            if (!/^[a-zA-Z0-9_-]{10,64}$/.test(voiceId)) {
                return res.status(400).json({ error: "Nieprawidłowy identyfikator głosu ElevenLabs." });
            }

            // 1. Central R2 Cache Check: if already synthesized, serve for free without deducting quota!
            const r2Config = getR2Config();
            try {
                const cached = await getCachedAudio(r2Config, voiceId, text);
                if (cached && cached.buffer && cached.buffer.length > 0) {
                    res.set("Content-Type", cached.contentType || "audio/mpeg");
                    res.set("Cache-Control", "public, max-age=31536000, immutable");
                    res.set("X-Lectoro-Plan", claimedPlan);
                    res.set("X-Lectoro-Cache", "HIT");
                    res.set(
                        "X-Lectoro-TTS-Used",
                        String(userData.elevenLabsCharactersThisMonth || 0),
                    );
                    return res.status(200).send(cached.buffer);
                }
            } catch (cacheError) {
                console.warn("[geminiProxy] R2 cache check warning:", cacheError.message);
            }

            // 2. Cache Miss: check plan entitlements & deduct characters
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
                    const validation = checkElevenLabsLimit({
                        plan: claimedPlan,
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
                        profile: subscriptionProfile(uid, claimedPlan, reservation.data, month),
                    });
                }

                const ttsResponse = await fetch(
                    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
                    {
                        method: "POST",
                        headers: {
                            "xi-api-key": elevenLabsApiKey.value(),
                            "Content-Type": "application/json",
                            Accept: "audio/mpeg",
                        },
                        body: JSON.stringify({
                            text,
                            model_id: "eleven_flash_v2_5",
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
                        }),
                    },
                );
                if (!ttsResponse.ok) {
                    const rawDetails = await ttsResponse.text().catch(() => "");
                    let details = {};
                    try {
                        details = JSON.parse(rawDetails);
                    } catch (_) {
                        details = { detail: rawDetails };
                    }
                    console.error("[subscriptionProxy] ElevenLabs TTS error:", details);
                    await rollbackElevenLabsReservation(
                        db,
                        userRef,
                        month,
                        reservation.validation.requested,
                    );
                    const clientError = elevenLabsClientError(details);
                    return res.status(clientError.httpStatus).json({
                        error: clientError.error,
                        code: clientError.code,
                    });
                }
                const audio = Buffer.from(await ttsResponse.arrayBuffer());

                // Asynchronously cache in Cloudflare R2 for future requests
                saveCachedAudio(r2Config, voiceId, text, audio).catch((err) =>
                    console.warn("[geminiProxy] Async R2 save error:", err.message),
                );

                res.set("Content-Type", ttsResponse.headers.get("content-type") || "audio/mpeg");
                res.set("Cache-Control", "private, no-store");
                res.set("X-Lectoro-Plan", claimedPlan);
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
                console.error("[subscriptionProxy] ElevenLabs request error:", error);
                if (reservation?.validation?.allowed) {
                    await rollbackElevenLabsReservation(
                        db,
                        userRef,
                        month,
                        reservation.validation.requested,
                    );
                }
                return res.status(503).json({ error: "Nie udało się wykonać syntezy ElevenLabs." });
            }
        }

        const { prompt, temperature = 0.8, maxOutputTokens = 500 } = req.body || {};
        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ error: "Brak pola 'prompt' w ciele żądania." });
        }
        if (prompt.length > 50000) {
            return res.status(400).json({ error: "Prompt zbyt długi (max 50 000 znaków)." });
        }

        // Reserve atomically before calling Gemini so parallel requests cannot
        // overshoot the configured monthly quota.
        let aiReservation;
        try {
            aiReservation = await db.runTransaction(async (transaction) => {
                const snapshot = await transaction.get(userRef);
                const data = snapshot.exists ? snapshot.data() || {} : {};
                const used = usageForMonth(data.aiCallsThisMonth, data.aiCallsResetDate, month);
                const validation = checkAiLimit({ plan: claimedPlan, used });
                if (!validation.allowed) return validation;
                transaction.set(
                    userRef,
                    { aiCallsThisMonth: used + 1, aiCallsResetDate: month },
                    { merge: true },
                );
                return { ...validation, plan: claimedPlan, usedAfter: used + 1 };
            });
        } catch (error) {
            console.error("[geminiProxy] AI reservation error:", error);
            return res.status(503).json({ error: "Nie udało się sprawdzić limitu AI." });
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

        const geminiKey = geminiApiKey.value();
        if (!geminiKey) {
            console.error("[geminiProxy] LECTORO_GEMINI_API_KEY is not configured");
            await rollbackAiReservation(db, userRef, month);
            return res.status(500).json({ error: "Błąd konfiguracji serwera." });
        }

        let geminiResponse;
        try {
            const geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: Math.min(Math.max(Number(temperature), 0), 2),
                            maxOutputTokens: Math.min(Math.max(Number(maxOutputTokens), 1), 8192),
                        },
                    }),
                },
            );
            if (!geminiRes.ok) {
                const details = await geminiRes.json().catch(() => ({}));
                const message = details?.error?.message || `Gemini HTTP ${geminiRes.status}`;
                console.error("[geminiProxy] Gemini API error:", message);
                await rollbackAiReservation(db, userRef, month);
                return res.status(502).json({ error: message });
            }
            geminiResponse = await geminiRes.json();
        } catch (error) {
            console.error("[geminiProxy] Gemini fetch error:", error);
            await rollbackAiReservation(db, userRef, month);
            return res.status(502).json({ error: "Błąd połączenia z Gemini API." });
        }

        const text = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
