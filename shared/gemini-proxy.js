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

        const res = await fetch(PROXY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ prompt, temperature, maxOutputTokens }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            const msg = data?.error || `Błąd serwera AI (${res.status})`;

            if (res.status === 429) {
                const plan = data?.plan || "free";
                const limit = data?.limit || "?";
                throw new Error(
                    `Przekroczono limit AI (${limit} zapytań/mc dla planu ${plan.toUpperCase()}). Ulepsz plan aby kontynuować.`
                );
            }
            if (res.status === 401) {
                throw new Error(
                    "Sesja wygasła. Zaloguj się ponownie."
                );
            }

            throw new Error(msg);
        }

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
    return { request, requestJSON };
})();

// Udostępnij globalnie (content scripts + popup + background)
if (typeof window !== "undefined") {
    window.GeminiProxy = GeminiProxy;
}
if (typeof self !== "undefined" && typeof window === "undefined") {
    // Service Worker (background.js)
    self.GeminiProxy = GeminiProxy;
}
