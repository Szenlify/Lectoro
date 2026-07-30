/**
 * FirebaseSync – REST API wrapper for Firebase Auth + Firestore
 *
 * Works in both popup (window) and service worker (self) contexts.
 * No external dependencies – uses only fetch + chrome.identity + chrome.storage.
 *
 * Requires firebase-config.js to be loaded first (FIREBASE_CONFIG global).
 */
const FirebaseSync = (() => {
    "use strict";

    // ── Helpers ──────────────────────────────────────────────────

    function isConfigured() {
        return !!(
            typeof FIREBASE_CONFIG !== "undefined" &&
            FIREBASE_CONFIG.apiKey &&
            FIREBASE_CONFIG.projectId &&
            FIREBASE_CONFIG.clientId
        );
    }

    /** Deterministic Firestore document ID from word content (SHA-256 hash) */
    async function wordDocId(word) {
        const key = `${word.original || ""}|${word.translated || ""}`;
        const data = new TextEncoder().encode(key);
        const hashBuf = await crypto.subtle.digest("SHA-256", data);
        const arr = new Uint8Array(hashBuf);
        // 16 bytes = 32 hex chars – unique enough for any reasonable word count
        return Array.from(arr.slice(0, 16))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    }

    function wordKey(w) {
        return (w.original || "") + "|" + (w.translated || "");
    }

    // ── Auth Storage ─────────────────────────────────────────────

    function getAuthData() {
        return new Promise((resolve) => {
            chrome.storage.local.get({ firebaseAuth: null }, (data) => {
                resolve(data.firebaseAuth);
            });
        });
    }

    function setAuthData(auth) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ firebaseAuth: auth }, resolve);
        });
    }

    function clearAuthData() {
        return new Promise((resolve) => {
            chrome.storage.local.remove("firebaseAuth", resolve);
        });
    }

    // ── User Info ────────────────────────────────────────────────

    async function getUser() {
        if (!isConfigured()) return null;
        const auth = await getAuthData();
        if (!auth?.uid) return null;
        return {
            uid: auth.uid,
            email: auth.email || "",
            displayName: auth.displayName || "",
        };
    }

    // ── Token Management ─────────────────────────────────────────

    /** Get a valid Firebase ID token, auto-refreshing if expired */
    async function getValidToken() {
        if (!isConfigured()) return null;
        const auth = await getAuthData();
        if (!auth?.idToken) return null;

        // Still valid? (5 min buffer)
        if (auth.expiresAt && Date.now() < auth.expiresAt - 300_000) {
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
                console.warn("[QT] Token refresh failed:", res.status);
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
            console.warn("[QT] Token refresh error:", err);
            return null;
        }
    }

    // ── Sign In (Google OAuth → Firebase) ────────────────────────

    async function signIn() {
        if (!isConfigured()) {
            throw new Error(
                "Firebase nie skonfigurowany. Uzupełnij firebase-config.js",
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
            expiresAt: Date.now() + parseInt(data.expiresIn || "3600") * 1000,
        };

        await setAuthData(auth);
        return auth;
    }

    async function signOut() {
        await clearAuthData();
    }

    // ── Firestore Data Conversion ────────────────────────────────

    function toFirestoreFields(word) {
        const f = {};
        f.original = { stringValue: word.original || "" };
        f.translated = { stringValue: word.translated || "" };
        f.sentence = { stringValue: word.sentence || "" };
        f.sentenceTranslated = {
            stringValue: word.sentenceTranslated || "",
        };
        f.srcLang = { stringValue: word.srcLang || "" };
        f.tgtLang = { stringValue: word.tgtLang || "" };
        f.timestamp = { integerValue: String(word.timestamp || 0) };
        f.url = { stringValue: word.url || "" };
        f.downloaded = { booleanValue: !!word.downloaded };
        f.updatedAt = {
            integerValue: String(word.updatedAt || word.timestamp || 0),
        };

        // SR data (flattened for simpler REST handling)
        if (word.sr) {
            f.sr_step = { integerValue: String(word.sr.step ?? 0) };
            f.sr_interval = { doubleValue: word.sr.interval ?? 0 };
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
            original: fields.original?.stringValue || "",
            translated: fields.translated?.stringValue || "",
            sentence: fields.sentence?.stringValue || "",
            sentenceTranslated: fields.sentenceTranslated?.stringValue || "",
            srcLang: fields.srcLang?.stringValue || "",
            tgtLang: fields.tgtLang?.stringValue || "",
            timestamp: parseInt(fields.timestamp?.integerValue || "0"),
            url: fields.url?.stringValue || "",
            downloaded: fields.downloaded?.booleanValue || false,
            updatedAt: parseInt(fields.updatedAt?.integerValue || "0"),
        };

        if (fields.sr_step || fields.sr_nextReview) {
            word.sr = {
                step: parseInt(fields.sr_step?.integerValue || "0"),
                interval:
                    fields.sr_interval?.doubleValue ??
                    parseFloat(fields.sr_interval?.integerValue || "0"),
                nextReview: parseInt(fields.sr_nextReview?.integerValue || "0"),
                lastReview: parseInt(fields.sr_lastReview?.integerValue || "0"),
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
                console.warn("[QT] Firestore pull failed:", res.status, err);
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

    /** Batch upsert words to Firestore (max 500 per commit) */
    async function pushWords(uid, token, words) {
        if (!words.length) return;

        // Resource path (NOT the full URL) for document name fields
        const docBase = `${firestoreDocPath()}/users/${uid}/words`;

        // Process in batches of 500 (Firestore commit limit)
        for (let i = 0; i < words.length; i += 500) {
            const batch = words.slice(i, i + 500);
            const writes = [];

            for (const word of batch) {
                const docId = await wordDocId(word);
                writes.push({
                    update: {
                        name: `${docBase}/${docId}`,
                        fields: toFirestoreFields(word),
                    },
                });
            }

            try {
                const res = await fetch(`${firestoreBase()}:commit`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ writes }),
                });

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    console.warn(
                        "[QT] Firestore batch write failed:",
                        res.status,
                        err,
                    );
                }
            } catch (err) {
                console.warn("[QT] Firestore batch write error:", err);
            }
        }
    }

    /** Delete a single word document from Firestore */
    async function deleteWordDoc(uid, token, word) {
        const docId = await wordDocId(word);
        const url = `${firestoreBase()}/users/${uid}/words/${docId}`;

        try {
            const res = await fetch(url, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok && res.status !== 404) {
                console.warn("[QT] Firestore delete failed:", res.status);
            }
        } catch (err) {
            console.warn("[QT] Firestore delete error:", err);
        }
    }

    // ── Public API ───────────────────────────────────────────────

    return {
        isConfigured,
        wordKey,
        wordDocId,

        // Auth
        signIn,
        signOut,
        getUser,
        getValidToken,

        // Firestore CRUD
        pullWords,
        pushWords,
        deleteWordDoc,
    };
})();
