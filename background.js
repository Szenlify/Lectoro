// background.js – Badge updates, review notifications & cross-device sync

// ── Load Firebase modules (graceful fallback if missing) ──────────
try {
    importScripts(
        "shared/utils.js",
        "firebase/firebase-config.js",
        "firebase/firebase-sync.js",
    );
} catch (e) {
    console.warn("[Lectoro] Firebase modules not loaded:", e);
}

const { wordKey, countDueWords, isDueForReview, generateId } = SharedUtils;

// ══════════════════════════════════════════════════════════════════
//  Cross-device sync (chrome.storage.sync, chunked) – FALLBACK
// ══════════════════════════════════════════════════════════════════
const SYNC_CHUNK_MAX = 7000; // chars per chunk (under QUOTA_BYTES_PER_ITEM 8192)
let _skipSyncPush = false; // flag to prevent push→pull→push loop

/** Compare and save words if changed */
async function mergeAndSaveIfChanged(oldWords, newWords) {
    if (
        newWords.length !== oldWords.length ||
        JSON.stringify(newWords) !== JSON.stringify(oldWords)
    ) {
        _skipSyncPush = true;
        await chrome.storage.local.set({ savedWords: newWords });
        _skipSyncPush = false;
        return true;
    }
    return false;
}

/** Helper to get Firebase user and token */
async function getFirebaseContext() {
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured())
        return null;
    const user = await FirebaseSync.getUser();
    if (!user) return null;
    const token = await FirebaseSync.getValidToken();
    if (!token) return null;
    return { user, token };
}

/** Push local savedWords → sync (chunked strings) */
async function pushWordsToSync(words) {
    try {
        // Remove old chunks first
        const old = await chrome.storage.sync.get(null);
        const oldKeys = Object.keys(old).filter((k) => k.startsWith("sw_"));
        if (oldKeys.length) await chrome.storage.sync.remove(oldKeys);

        // Serialize & chunk
        const json = JSON.stringify(
            words.map((w) => ({
                id: w.id || "",
                o: w.original,
                t: w.translated,
                s: w.sentence || "",
                st: w.sentenceTranslated || "",
                sl: w.srcLang || "",
                tl: w.tgtLang || "",
                ts: w.timestamp || 0,
                dl: w.downloaded || false,
                sr: w.sr || null,
            })),
        );

        const chunks = {};
        let i = 0;
        for (let pos = 0; pos < json.length; pos += SYNC_CHUNK_MAX) {
            chunks[`sw_${i}`] = json.slice(pos, pos + SYNC_CHUNK_MAX);
            i++;
        }
        chunks.sw_n = i;
        chunks.sw_ts = Date.now();

        await chrome.storage.sync.set(chunks);
    } catch (err) {
        // Quota exceeded or other error – non-fatal
        console.warn(
            "[Lectoro] Sync push failed (quota?):",
            err.message || err,
        );
    }
}

/** Pull words from sync storage → array (or null on failure) */
async function pullWordsFromSync() {
    try {
        const data = await chrome.storage.sync.get(null);
        const count = data.sw_n || 0;
        if (count === 0) return null;

        let json = "";
        for (let i = 0; i < count; i++) {
            json += data[`sw_${i}`] || "";
        }
        const arr = JSON.parse(json);
        return arr.map((c) => ({
            id: c.id || "",
            original: c.o,
            translated: c.t,
            sentence: c.s || "",
            sentenceTranslated: c.st || "",
            srcLang: c.sl || "",
            tgtLang: c.tl || "",
            timestamp: c.ts || 0,
            downloaded: c.dl || false,
            sr: c.sr || null,
        }));
    } catch (err) {
        console.warn("[Lectoro] Sync pull failed:", err);
        return null;
    }
}

/**
 * Merge two word arrays. Union by key, most-recent SR wins.
 * Returns merged array.
 */
function mergeWords(localWords, syncWords) {
    const map = new Map();

    for (const w of localWords) {
        map.set(wordKey(w), { ...w });
    }

    for (const sw of syncWords) {
        const key = wordKey(sw);
        const existing = map.get(key);
        if (!existing) {
            map.set(key, sw); // new word from other device
        } else {
            // Keep the SR data that is more recent
            const eLR = existing.sr?.lastReview || 0;
            const sLR = sw.sr?.lastReview || 0;
            if (sLR > eLR) {
                existing.sr = sw.sr;
            }
            // Also fill in missing fields
            if (!existing.sentence && sw.sentence)
                existing.sentence = sw.sentence;
            if (!existing.sentenceTranslated && sw.sentenceTranslated)
                existing.sentenceTranslated = sw.sentenceTranslated;
        }
    }
    return Array.from(map.values());
}

// Debounce push to avoid hammering sync API
let _pushTimer = null;
function debouncedPushToSync(words) {
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(async () => {
        // Prefer Firebase if configured and signed in
        if (
            typeof FirebaseSync !== "undefined" &&
            FirebaseSync.isConfigured()
        ) {
            const user = await FirebaseSync.getUser();
            if (user) {
                firebasePushWords(words);
                return;
            }
        }
        // Fallback to chrome.storage.sync
        pushWordsToSync(words);
    }, 2000);
}

/** Handle incoming sync changes from another device */
async function onSyncChanged(changes) {
    // Only react to our word-sync keys
    if (!changes.sw_n && !changes.sw_ts) return;

    const syncWords = await pullWordsFromSync();
    if (!syncWords) return;

    const localData = await chrome.storage.local.get({ savedWords: [] });
    const localWords = localData.savedWords || [];

    const merged = mergeWords(localWords, syncWords);

    // Only write if something actually changed
    await mergeAndSaveIfChanged(localWords, merged);
}

// ══════════════════════════════════════════════════════════════════
//  Initial sync on startup
// ══════════════════════════════════════════════════════════════════
async function initialSync() {
    // Try Firebase first
    if (typeof FirebaseSync !== "undefined" && FirebaseSync.isConfigured()) {
        const user = await FirebaseSync.getUser();
        if (user) {
            await firebaseFullSync();
            return;
        }
    }

    // Fallback: chrome.storage.sync (chunked)
    const syncWords = await pullWordsFromSync();
    const localData = await chrome.storage.local.get({ savedWords: [] });
    const localWords = localData.savedWords || [];

    if (syncWords && syncWords.length > 0) {
        const merged = mergeWords(localWords, syncWords);
        await mergeAndSaveIfChanged(localWords, merged);
    } else if (localWords.length > 0) {
        await pushWordsToSync(localWords);
    }
}

// ══════════════════════════════════════════════════════════════════
//  Firebase Firestore sync
// ══════════════════════════════════════════════════════════════════

/** Full two-way sync with Firestore */
async function firebaseFullSync() {
    const ctx = await getFirebaseContext();
    if (!ctx) return;
    const { user, token } = ctx;

    try {
        const remoteWords = await FirebaseSync.pullWords(user.uid, token);
        if (!remoteWords) return; // pull failed

        const localData = await chrome.storage.local.get({ savedWords: [] });
        const localWords = localData.savedWords || [];
        const localWordsBefore = JSON.parse(JSON.stringify(localWords));

        // ── One-time migration for words saved before stable ids existed ──
        // Legacy Firestore docs were keyed by a hash of original+translated,
        // so editing a word left the pre-edit doc behind forever (new
        // content -> new hash -> new doc, old doc never removed) and it
        // resurrected as a "new" word on the next sync. Give every such word
        // a permanent id now, reconciling with any still-legacy remote doc
        // for the same content instead of creating a second copy, then
        // delete the old content-keyed doc so it can't come back.
        const remoteLegacyByContent = new Map();
        for (const rw of remoteWords) {
            if (!rw.id) remoteLegacyByContent.set(wordKey(rw), rw);
        }
        const legacyDocsToDelete = [];
        for (const lw of localWords) {
            if (lw.id) continue;
            const contentKey = wordKey(lw);
            const remoteMatch = remoteLegacyByContent.get(contentKey);
            if (remoteMatch) {
                const lt =
                    lw.updatedAt || lw.sr?.lastReview || lw.timestamp || 0;
                const rt =
                    remoteMatch.updatedAt ||
                    remoteMatch.sr?.lastReview ||
                    remoteMatch.timestamp ||
                    0;
                if (rt > lt) Object.assign(lw, remoteMatch);
                remoteLegacyByContent.delete(contentKey);
            }
            legacyDocsToDelete.push({
                original: lw.original,
                translated: lw.translated,
            });
            lw.id = generateId();
        }
        // Any remaining legacy remote-only entries (another device, or a
        // stale pre-edit duplicate from before this fix) become normal local
        // words too, so they stop resurrecting on every future sync.
        for (const rw of remoteLegacyByContent.values()) {
            legacyDocsToDelete.push({
                original: rw.original,
                translated: rw.translated,
            });
            rw.id = generateId();
            localWords.push(rw);
        }

        // Build maps for merge (every word now carries a stable id)
        const localMap = new Map();
        for (const w of localWords) localMap.set(wordKey(w), w);

        const remoteMap = new Map();
        for (const w of remoteWords) {
            if (w.id) remoteMap.set(wordKey(w), w);
        }

        const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
        const merged = [];
        const toPush = [];

        for (const key of allKeys) {
            const local = localMap.get(key);
            const remote = remoteMap.get(key);

            if (local && !remote) {
                merged.push(local);
                toPush.push(local);
            } else if (!local && remote) {
                merged.push(remote);
            } else {
                // Both exist – keep whichever was updated more recently
                const lt =
                    local.updatedAt ||
                    local.sr?.lastReview ||
                    local.timestamp ||
                    0;
                const rt =
                    remote.updatedAt ||
                    remote.sr?.lastReview ||
                    remote.timestamp ||
                    0;
                if (lt >= rt) {
                    merged.push(local);
                    if (lt > rt) toPush.push(local);
                } else {
                    merged.push(remote);
                }
            }
        }

        // Update local storage if anything changed
        await mergeAndSaveIfChanged(localWordsBefore, merged);

        // Push local-only / updated words to Firestore
        if (toPush.length > 0) {
            await FirebaseSync.pushWords(user.uid, token, toPush);
        }

        // Clean up now-orphaned legacy (content-hash) docs so they don't
        // resurrect as duplicates on a future sync
        for (const legacy of legacyDocsToDelete) {
            await FirebaseSync.deleteWordDoc(user.uid, token, legacy);
        }

        // Store last sync timestamp
        await chrome.storage.local.set({
            lastFirebaseSync: Date.now(),
        });
    } catch (err) {
        console.warn("[Lectoro] Firebase full sync error:", err);
    }
}

/** Push all words to Firestore */
async function firebasePushWords(words) {
    const ctx = await getFirebaseContext();
    if (!ctx) return;
    const { user, token } = ctx;

    try {
        await FirebaseSync.pushWords(user.uid, token, words);
        await chrome.storage.local.set({
            lastFirebaseSync: Date.now(),
        });
    } catch (err) {
        console.warn("[Lectoro] Firebase push error:", err);
    }
}

/** Delete a single word from Firestore */
async function firebaseDeleteWord(word) {
    const ctx = await getFirebaseContext();
    if (!ctx) return;
    const { user, token } = ctx;

    try {
        await FirebaseSync.deleteWordDoc(user.uid, token, word);
    } catch (err) {
        console.warn("[Lectoro] Firebase delete error:", err);
    }
}

// ══════════════════════════════════════════════════════════════════
//  Badge updates
// ══════════════════════════════════════════════════════════════════
async function updateBadge() {
    try {
        const data = await chrome.storage.local.get({ savedWords: [] });
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = countDueWords(words, now);

        if (dueCount > 0) {
            chrome.action.setBadgeText({ text: String(dueCount) });
            chrome.action.setBadgeBackgroundColor({ color: "#4a6cf7" });
        } else {
            chrome.action.setBadgeText({ text: "" });
        }
        // Always schedule alarm for the next word that becomes due
        scheduleNextDueAlarm(words, now);
    } catch (err) {
        console.warn("[Lectoro] Badge update error:", err);
    }
}

// ── Schedule alarm for the exact moment the next review is due ────
async function scheduleNextDueAlarm(words, now) {
    // Find the soonest future nextReview
    let soonest = Infinity;
    for (const w of words) {
        if (w.sr && w.sr.nextReview > now && w.sr.nextReview < soonest) {
            soonest = w.sr.nextReview;
        }
    }

    // Clear old precise alarm
    await chrome.alarms.clear("nextDueReview");

    if (soonest < Infinity) {
        const delayMs = soonest - now;
        // Chrome alarms minimum is ~0.5 min, so use at least that
        const delayMinutes = Math.max(delayMs / 60000, 0.5);
        chrome.alarms.create("nextDueReview", { delayInMinutes: delayMinutes });
    }
}

// ── Notification for reviews ──────────────────────────────────────
async function checkAndNotify() {
    try {
        const data = await chrome.storage.local.get({ savedWords: [] });
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = countDueWords(words, now);

        if (dueCount > 0) {
            chrome.notifications.create("reviewReminder", {
                type: "basic",
                iconUrl: "icon48.png",
                title: "Lectoro Powtórki",
                message: `Masz ${dueCount} powtórki!`,
                priority: 1,
            });
        }
    } catch (err) {
        console.warn("[Lectoro] Notification error:", err);
    }
}

// ── Alarms ────────────────────────────────────────────────────────
chrome.alarms.create("updateBadge", { periodInMinutes: 5 });
chrome.alarms.create("reviewNotification", { periodInMinutes: 360 }); // every 6h
chrome.alarms.create("firestoreSync", { periodInMinutes: 5 }); // periodic Firestore pull

/** Notify all tabs that reviews just became due */
async function notifyTabsReviewDue(dueCount) {
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.id) {
                chrome.tabs
                    .sendMessage(tab.id, {
                        type: "QT_REVIEW_DUE",
                        count: dueCount,
                    })
                    .catch(() => {}); // tab may not have content script
            }
        }
    } catch (e) {
        // ignore
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "updateBadge") updateBadge();
    if (alarm.name === "firestoreSync") firebaseFullSync();
    if (alarm.name === "nextDueReview") {
        // This alarm fires exactly when a review becomes due
        const data = await chrome.storage.local.get({ savedWords: [] });
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = words.filter((w) => {
            if (!w.sr) return false; // new words without SR – don't notify
            return w.sr.nextReview <= now;
        }).length;
        if (dueCount > 0) {
            notifyTabsReviewDue(dueCount);
        }
        updateBadge();
    }
    if (alarm.name === "reviewNotification") checkAndNotify();
});

// ── Lifecycle events ──────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
    initialSync().then(updateBadge);
});
chrome.runtime.onStartup.addListener(() => {
    initialSync().then(updateBadge);
});

// ── Refresh badge & push sync when storage changes ────────────────
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.savedWords) {
        updateBadge();
        // Push to sync (unless we just merged from sync)
        if (!_skipSyncPush) {
            const newWords = changes.savedWords.newValue || [];
            debouncedPushToSync(newWords);
        }
    }
    if (area === "local" && changes.firebaseAuth) {
        // User just logged in → trigger full sync
        const auth = changes.firebaseAuth?.newValue;
        if (auth?.uid) {
            setTimeout(() => firebaseFullSync(), 500);
        }
    }
    if (area === "sync") {
        // Only use chrome.storage.sync fallback when not on Firebase
        if (
            typeof FirebaseSync !== "undefined" &&
            FirebaseSync.isConfigured()
        ) {
            FirebaseSync.getUser().then((user) => {
                if (!user) onSyncChanged(changes);
            });
        } else {
            onSyncChanged(changes);
        }
    }
});

// ── Message handling (popup commands) ─────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "QT_FIREBASE_SIGN_IN") {
        // Run sign-in in service worker so popup closing doesn't kill the flow
        FirebaseSync.signIn()
            .then((auth) => {
                sendResponse({ ok: true, email: auth.email || "" });
                // Full sync right after sign-in
                firebaseFullSync();
            })
            .catch((e) => sendResponse({ error: e.message }));
        return true; // async response
    }
    if (msg.type === "QT_FIREBASE_SIGN_OUT") {
        FirebaseSync.signOut()
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ error: e.message }));
        return true;
    }
    if (msg.type === "QT_FIREBASE_SYNC") {
        firebaseFullSync()
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ error: e.message }));
        return true; // async response
    }
    if (msg.type === "QT_FIRESTORE_DELETE" && msg.word) {
        firebaseDeleteWord(msg.word)
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ error: e.message }));
        return true; // keep service worker alive until delete completes
    }
    if (msg.type === "QT_FIRESTORE_DELETE_BATCH" && msg.words) {
        Promise.all(msg.words.map((w) => firebaseDeleteWord(w)))
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ error: e.message }));
        return true;
    }
});
