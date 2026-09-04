/**
 * FirebaseSync – REST API wrapper for Firebase Auth + Firestore
 *
 * Works in both popup (window) and service worker (self) contexts.
 * No external dependencies – uses only fetch + chrome.identity + chrome.storage.
 *
 * Requires firebase-config.js to be loaded first (FIREBASE_CONFIG global).
 */
(function initFirebaseSync(root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (root) root.FirebaseSync = api;
})(
    typeof globalThis !== "undefined" ? globalThis : this,
    function createFirebaseSync() {
        "use strict";

        const MSG = LectoroConstants.MESSAGE_TYPES;
        const AUTH_KEY = LectoroConstants.STORAGE_KEYS.FIREBASE_AUTH;

        // ── Helpers ──────────────────────────────────────────────────

        function isConfigured() {
            return !!(
                typeof FIREBASE_CONFIG !== "undefined" &&
                FIREBASE_CONFIG.apiKey &&
                FIREBASE_CONFIG.projectId &&
                FIREBASE_CONFIG.clientId
            );
        }

        /**
         * Firestore document ID for a word. Uses the word's stable `id` so a doc
         * never changes/duplicates when the word's content is edited. Falls back
         * to a content hash only for legacy words saved before ids existed.
         */
        async function wordDocId(word) {
            if (word.id) return word.id;
            const key = `${word.original || ""}|${word.translated || ""}`;
            const data = new TextEncoder().encode(key);
            const hashBuf = await crypto.subtle.digest("SHA-256", data);
            const arr = new Uint8Array(hashBuf);
            // 16 bytes = 32 hex chars – unique enough for any reasonable word count
            return Array.from(arr.slice(0, 16))
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("");
        }

        // ── Auth Storage ─────────────────────────────────────────────

        async function getAuthData() {
            const data = await chrome.storage.local.get({ [AUTH_KEY]: null });
            return data[AUTH_KEY];
        }

        function setAuthData(auth) {
            return chrome.storage.local.set({ [AUTH_KEY]: auth });
        }

        function clearAuthData() {
            return chrome.storage.local.remove(AUTH_KEY);
        }

        /** Content scripts ask the background for auth state so tokens are never refreshed from a web page. */
        async function askBackground(message, field) {
            try {
                const response = await SharedUtils.sendRuntimeMessage(message);
                return response?.[field] || null;
            } catch (_) {
                return null;
            }
        }

        // ── User Info ────────────────────────────────────────────────

        async function getUser() {
            if (!isConfigured()) return null;
            if (SharedUtils.isContentScriptEnvironment()) {
                const user = await askBackground(
                    { type: MSG.GET_FIREBASE_USER },
                    "user",
                );
                if (user) return user;
            }
            const auth = await getAuthData();
            if (!auth?.uid) return null;
            return {
                uid: auth.uid,
                email: auth.email || "",
                displayName: auth.displayName || "",
            };
        }

        // ── Token Management ─────────────────────────────────────────

        function decodeIdTokenClaims(idToken) {
            try {
                const payload = idToken.split(".")[1];
                if (!payload) return {};
                const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
                const padded = base64.padEnd(
                    Math.ceil(base64.length / 4) * 4,
                    "=",
                );
                const json = decodeURIComponent(
                    Array.from(atob(padded))
                        .map(
                            (char) =>
                                `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`,
                        )
                        .join(""),
                );
                return JSON.parse(json);
            } catch (error) {
                console.warn(
                    "[Lectoro] Failed to read claims from token:",
                    error,
                );
                return {};
            }
        }

        /** Get a valid Firebase ID token, auto-refreshing if expired. */
        async function getValidToken(forceRefresh = false) {
            if (!isConfigured()) return null;

            if (SharedUtils.isContentScriptEnvironment()) {
                const token = await askBackground(
                    { type: MSG.GET_FIREBASE_TOKEN, forceRefresh },
                    "token",
                );
                if (token) return token;
            }

            const auth = await getAuthData();
            if (!auth?.idToken) return null;

            // Still valid? (5 min buffer)
            if (
                !forceRefresh &&
                auth.expiresAt &&
                Date.now() < auth.expiresAt - 300_000
            ) {
                return auth.idToken;
            }

            // Expired → refresh using refreshToken
            if (!auth.refreshToken) return null;
            try {
                const res = await fetch(
                    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_CONFIG.apiKey}`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded",
                        },
                        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
                    },
                );

                if (!res.ok) {
                    console.warn("[Lectoro] Token refresh failed:", res.status);
                    if (res.status === 400 || res.status === 401) {
                        // Stale or revoked refreshToken - clear auth data to stop repeated failing API calls
                        await signOut().catch(() => {});
                    }
                    return null;
                }

                const data = await res.json();
                const updated = {
                    ...auth,
                    idToken: data.id_token,
                    refreshToken: data.refresh_token,
                    expiresAt:
                        Date.now() + parseInt(data.expires_in || "3600") * 1000,
                };

                await setAuthData(updated);
                return updated.idToken;
            } catch (err) {
                console.warn("[Lectoro] Token refresh error:", err);
                return null;
            }
        }

        // ── Sign In (Google OAuth → Firebase) ────────────────────────

        async function signIn() {
            if (!isConfigured()) {
                throw new Error(
                    "Firebase is not configured. Please fill in firebase-config.js",
                );
            }

            const redirectUrl = chrome.identity.getRedirectURL();
            const scopes = encodeURIComponent("openid email profile");

            const authUrl =
                `https://accounts.google.com/o/oauth2/v2/auth` +
                `?client_id=${encodeURIComponent(FIREBASE_CONFIG.clientId)}` +
                `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
                `&response_type=token` +
                `&scope=${scopes}` +
                `&prompt=select_account`;

            // Open Google OAuth popup
            const responseUrl = await chrome.identity.launchWebAuthFlow({
                url: authUrl,
                interactive: true,
            });

            // Extract access_token from redirect URL hash
            const fragment = responseUrl.split("#")[1] || "";
            const params = new URLSearchParams(fragment);
            const accessToken = params.get("access_token");

            if (!accessToken) {
                throw new Error("Nie otrzymano tokenu z Google");
            }

            // Exchange Google access token for Firebase ID token
            const firebaseRes = await fetch(
                `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        postBody: `access_token=${accessToken}&providerId=google.com`,
                        requestUri: redirectUrl,
                        returnSecureToken: true,
                        returnIdpCredential: true,
                    }),
                },
            );

            if (!firebaseRes.ok) {
                const error = await firebaseRes.json().catch(() => ({}));
                throw new Error(
                    error.error?.message ||
                        `Firebase auth failed (${firebaseRes.status})`,
                );
            }

            const data = await firebaseRes.json();
            const auth = {
                idToken: data.idToken,
                refreshToken: data.refreshToken,
                uid: data.localId,
                email: data.email || "",
                displayName: data.displayName || data.fullName || "",
                photoUrl: data.photoUrl || "",
                expiresAt:
                    Date.now() + parseInt(data.expiresIn || "3600") * 1000,
            };

            await setAuthData(auth);
            return auth;
        }

        async function signOut() {
            await clearAuthData();
        }

        /** REST equivalent of Firebase Auth user.getIdTokenResult(). */
        async function getIdTokenResult(forceRefresh = false) {
            const token = await getValidToken(forceRefresh);
            if (!token) return null;
            const claims = decodeIdTokenClaims(token);
            return {
                token,
                claims,
                authTime: claims.auth_time || null,
                expirationTime: claims.exp || null,
                issuedAtTime: claims.iat || null,
            };
        }

        // ── Firestore Data Conversion ────────────────────────────────

        function toFirestoreFields(word) {
            const f = {};
            f.id = { stringValue: word.id || "" };
            f.original = { stringValue: word.original || "" };
            f.translated = { stringValue: word.translated || "" };
            f.sentence = { stringValue: word.sentence || "" };
            f.sentenceTranslated = {
                stringValue: word.sentenceTranslated || "",
            };
            f.srcLang = { stringValue: word.srcLang || "" };
            f.tgtLang = { stringValue: word.tgtLang || "" };
            f.timestamp = { integerValue: String(word.timestamp || 0) };
            f.downloaded = { booleanValue: !!word.downloaded };
            f.updatedAt = {
                integerValue: String(word.updatedAt || word.timestamp || 0),
            };
            f.ttsCacheInvalidatedAt = {
                integerValue: String(word.ttsCacheInvalidatedAt || 0),
            };
            if (word.screenshot && typeof word.screenshot === "string") {
                const trimmed = word.screenshot.trim();
                if (!trimmed.startsWith("data:") && trimmed.length <= 500) {
                    f.screenshot = {
                        stringValue: SharedUtils.toRelativeImagePath(trimmed),
                    };
                }
            }

            // SR data (flattened for simpler REST handling)
            if (word.sr) {
                const reps = word.sr.reps ?? word.sr.step ?? 0;
                f.sr_step = { integerValue: String(reps) };
                f.sr_reps = { integerValue: String(reps) };
                f.sr_easeFactor = { doubleValue: word.sr.easeFactor ?? 2.5 };
                f.sr_interval = { doubleValue: word.sr.interval ?? 0 };
                f.sr_lapses = { integerValue: String(word.sr.lapses ?? 0) };
                f.sr_nextReview = {
                    integerValue: String(word.sr.nextReview ?? 0),
                };
                f.sr_lastReview = {
                    integerValue: String(word.sr.lastReview ?? 0),
                };
            }

            return f;
        }

        function fromFirestoreFields(fields) {
            if (!fields) return null;

            const word = {
                id: fields.id?.stringValue || "",
                original: fields.original?.stringValue || "",
                translated: fields.translated?.stringValue || "",
                sentence: fields.sentence?.stringValue || "",
                sentenceTranslated:
                    fields.sentenceTranslated?.stringValue || "",
                srcLang: fields.srcLang?.stringValue || "",
                tgtLang: fields.tgtLang?.stringValue || "",
                screenshot: fields.screenshot?.stringValue || "",
                timestamp: parseInt(fields.timestamp?.integerValue || "0"),
                downloaded: fields.downloaded?.booleanValue || false,
                updatedAt: parseInt(fields.updatedAt?.integerValue || "0"),
                ttsCacheInvalidatedAt: parseInt(
                    fields.ttsCacheInvalidatedAt?.integerValue || "0",
                ),
            };

            if (fields.sr_step || fields.sr_reps || fields.sr_nextReview) {
                const reps = parseInt(
                    fields.sr_reps?.integerValue ||
                        fields.sr_step?.integerValue ||
                        "0",
                );
                word.sr = {
                    reps,
                    step: reps,
                    easeFactor:
                        fields.sr_easeFactor?.doubleValue ??
                        parseFloat(fields.sr_easeFactor?.integerValue || "2.5"),
                    interval:
                        fields.sr_interval?.doubleValue ??
                        parseFloat(fields.sr_interval?.integerValue || "0"),
                    lapses: parseInt(fields.sr_lapses?.integerValue || "0"),
                    nextReview: parseInt(
                        fields.sr_nextReview?.integerValue || "0",
                    ),
                    lastReview: parseInt(
                        fields.sr_lastReview?.integerValue || "0",
                    ),
                };
            }

            return word;
        }

        // ── Firestore REST API ───────────────────────────────────────

        /** Full URL for fetch requests */
        function firestoreBase() {
            return `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
        }

        /** Resource name path for document name fields in commit writes */
        function firestoreDocPath() {
            return `projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents`;
        }

        /** Pull all words from user's Firestore collection */
        async function pullWords(uid, token) {
            const words = [];
            let pageToken = null;

            do {
                let url = `${firestoreBase()}/users/${uid}/words?pageSize=500`;
                if (pageToken) {
                    url += `&pageToken=${encodeURIComponent(pageToken)}`;
                }

                const res = await fetch(url, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    console.warn(
                        "[Lectoro] Firestore pull failed:",
                        res.status,
                        err,
                    );
                    return null;
                }

                const data = await res.json();
                for (const doc of data.documents || []) {
                    const word = fromFirestoreFields(doc.fields);
                    if (word && word.original) words.push(word);
                }

                pageToken = data.nextPageToken || null;
            } while (pageToken);

            return words;
        }

        /**
         * Firestore writeBatch equivalent over the REST commit endpoint.
         * Upserts and deletes share the same atomic commit (max 500 writes).
         * Errors are deliberately propagated so the offline queue is only cleared
         * after Firebase confirms the write.
         */
        async function writeBatch(
            uid,
            token,
            { upserts = [], deletes = [] } = {},
        ) {
            const docBase = `${firestoreDocPath()}/users/${uid}/words`;
            const writes = [];

            for (const word of upserts) {
                const docId = await wordDocId(word);
                writes.push({
                    update: {
                        name: `${docBase}/${docId}`,
                        fields: toFirestoreFields(word),
                    },
                });
            }
            for (const word of deletes) {
                const docId = await wordDocId(word);
                writes.push({ delete: `${docBase}/${docId}` });
            }

            for (let i = 0; i < writes.length; i += 500) {
                const batchWrites = writes.slice(i, i + 500);
                const res = await fetch(`${firestoreBase()}:commit`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ writes: batchWrites }),
                });
                if (!res.ok) {
                    const details = await res.json().catch(() => ({}));
                    const message =
                        details?.error?.message ||
                        `Firestore commit ${res.status}`;
                    throw new Error(message);
                }
            }

            return writes.length;
        }

        // ── Public API ───────────────────────────────────────────────

        return Object.freeze({
            isConfigured,
            wordDocId,

            // Auth
            signIn,
            signOut,
            getUser,
            getValidToken,
            getIdTokenResult,

            // Firestore CRUD
            pullWords,
            writeBatch,
        });
    },
);
