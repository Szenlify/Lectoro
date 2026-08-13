/**
 * Lectoro – Gemini API Proxy (Firebase Cloud Function)
 *
 * Bezpieczne proxy między rozszerzeniem Chrome a Gemini API.
 * Klucz Gemini API jest przechowywany TYLKO w zmiennych środowiskowych
 * serwera – nigdy nie trafia do kodu rozszerzenia.
 *
 * Przepływ:
 *   1. Rozszerzenie wysyła Firebase ID Token w nagłówku Authorization
 *   2. Funkcja weryfikuje token (Admin SDK)
 *   3. Sprawdza plan użytkownika i limit AI w Firestore
 *   4. Wywołuje Gemini API z kluczem z .env
 *   5. Zwiększa licznik zużycia i zwraca odpowiedź
 */

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();

// Deploy w Europie (bliżej PL = mniejsze opóźnienia)
setGlobalOptions({ region: "europe-west1" });

// ── Limity AI dla każdego planu (zapytania na miesiąc) ──────────────
const PLAN_LIMITS = {
    free: 3,
    basic: 500,
    pro: 5000,
};

// ── CORS helper ──────────────────────────────────────────────────────
function setCorsHeaders(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ── Główna funkcja proxy ─────────────────────────────────────────────
exports.geminiProxy = onRequest(
    {
        cors: false, // obsługujemy ręcznie
        timeoutSeconds: 60,
        memory: "256MiB",
    },
    async (req, res) => {
        setCorsHeaders(res);

        // Preflight (OPTIONS) dla CORS
        if (req.method === "OPTIONS") {
            return res.status(204).send("");
        }

        // Tylko POST
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Method not allowed" });
        }

        // ── 1. Weryfikacja Firebase Auth Token ───────────────────────
        const authHeader = req.headers.authorization || "";
        const idToken = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!idToken) {
            return res
                .status(401)
                .json({ error: "Brak tokenu autoryzacji. Zaloguj się." });
        }

        let decodedToken;
        try {
            decodedToken = await admin.auth().verifyIdToken(idToken);
        } catch (err) {
            console.error("[geminiProxy] Token invalid:", err.message);
            return res
                .status(401)
                .json({ error: "Nieprawidłowy token. Zaloguj się ponownie." });
        }

        const uid = decodedToken.uid;

        // ── 2. Sprawdzenie planu i limitu w Firestore ─────────────────
        const db = admin.firestore();
        const userRef = db.collection("users").doc(uid);

        let plan = "free";
        let aiCallsThisMonth = 0;
        let aiCallsResetDate = "";

        try {
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const data = userDoc.data();
                plan = data.plan || "free";
                aiCallsThisMonth = data.aiCallsThisMonth || 0;
                aiCallsResetDate = data.aiCallsResetDate || "";
            }
        } catch (err) {
            console.error("[geminiProxy] Firestore read error:", err);
            // Przy błędzie odczytu – nie blokujemy, ale logujemy
        }

        // Reset licznika jeśli nowy miesiąc
        const currentMonth = new Date().toISOString().slice(0, 7); // "2026-08"
        if (aiCallsResetDate !== currentMonth) {
            aiCallsThisMonth = 0;
        }

        const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

        // One lightweight initialization call lets the extension cache usage
        // locally. Normal UI checks do not need additional Firestore reads.
        if (req.body?.action === "usage") {
            return res.status(200).json({
                usage: {
                    plan,
                    used: aiCallsThisMonth,
                    limit,
                    remaining: Math.max(0, limit - aiCallsThisMonth),
                },
            });
        }

        if (aiCallsThisMonth >= limit) {
            return res.status(429).json({
                error: "Przekroczono miesięczny limit AI dla Twojego planu.",
                plan,
                used: aiCallsThisMonth,
                limit,
            });
        }

        // ── 3. Walidacja żądania ──────────────────────────────────────
        const { prompt, temperature = 0.8, maxOutputTokens = 500 } = req.body;

        if (!prompt || typeof prompt !== "string") {
            return res
                .status(400)
                .json({ error: "Brak pola 'prompt' w ciele żądania." });
        }

        if (prompt.length > 50000) {
            return res
                .status(400)
                .json({ error: "Prompt zbyt długi (max 50 000 znaków)." });
        }

        // ── 4. Wywołanie Gemini API ───────────────────────────────────
        const geminiApiKey = process.env.GEMINI_API_KEY;

        if (!geminiApiKey) {
            console.error("[geminiProxy] GEMINI_API_KEY not set in .env");
            return res
                .status(500)
                .json({ error: "Błąd konfiguracji serwera." });
        }

        let geminiResponse;
        try {
            const geminiRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: Math.min(
                                Math.max(Number(temperature), 0),
                                2,
                            ),
                            maxOutputTokens: Math.min(
                                Math.max(Number(maxOutputTokens), 1),
                                8192,
                            ),
                        },
                    }),
                },
            );

            if (!geminiRes.ok) {
                const errData = await geminiRes.json().catch(() => ({}));
                const msg =
                    errData?.error?.message ||
                    `Gemini HTTP ${geminiRes.status}`;
                console.error("[geminiProxy] Gemini API error:", msg);
                return res.status(502).json({ error: msg });
            }

            geminiResponse = await geminiRes.json();
        } catch (err) {
            console.error("[geminiProxy] Gemini fetch error:", err);
            return res
                .status(502)
                .json({ error: "Błąd połączenia z Gemini API." });
        }

        // ── 5. Aktualizacja licznika zużycia ──────────────────────────
        try {
            await userRef.set(
                {
                    aiCallsThisMonth: aiCallsThisMonth + 1,
                    aiCallsResetDate: currentMonth,
                    // Nie nadpisujemy plan – tylko serwer może go zmienić
                },
                { merge: true },
            );
        } catch (err) {
            // Nie przerywamy – odpowiedź już mamy, licznik to sprawa drugorzędna
            console.error("[geminiProxy] Counter update error:", err);
        }

        // ── 6. Zwrot odpowiedzi ───────────────────────────────────────
        const text =
            geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        return res.status(200).json({
            text,
            usage: {
                plan,
                used: aiCallsThisMonth + 1,
                limit,
                remaining: limit - (aiCallsThisMonth + 1),
            },
        });
    },
);
