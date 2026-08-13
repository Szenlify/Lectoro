// background.js - offline-first reviews, batched Firebase sync and reminders

try {
    importScripts(
        "shared/utils.js",
        "firebase/firebase-config.js",
        "firebase/firebase-sync.js",
        "shared/gemini-proxy.js",
    );
} catch (error) {
    console.warn("[Lectoro] Background modules not loaded:", error);
}

const { wordKey, countDueWords } = SharedUtils;
const PENDING_CHANGES_KEY = "pendingFirebaseChanges";
const AUTO_SYNC_ALARM = "firebaseAutoSync";
const AUTO_SYNC_DELAY_MS = 60_000;

let skipPendingCapture = false;
let ignoredSavedWordsSnapshot;
let queueMutation = Promise.resolve();
let syncInFlight = null;

function wordIdentity(word) {
    return word?.id || wordKey(word || {});
}

function wordTimestamp(word) {
    return word?.updatedAt || word?.sr?.lastReview || word?.timestamp || 0;
}

function wordsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function ignoreNextSavedWordsValue(words) {
    const snapshot = JSON.stringify(words);
    ignoredSavedWordsSnapshot = snapshot;
    setTimeout(() => {
        if (ignoredSavedWordsSnapshot === snapshot) {
            ignoredSavedWordsSnapshot = undefined;
        }
    }, 5_000);
}

async function getFirebaseContext() {
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        return null;
    }
    const user = await FirebaseSync.getUser();
    if (!user) return null;
    const token = await FirebaseSync.getValidToken();
    if (!token) return null;
    return { user, token };
}

function scheduleAutoSync() {
    chrome.alarms.create(AUTO_SYNC_ALARM, {
        when: Date.now() + AUTO_SYNC_DELAY_MS,
    });
}

/** Persist a compact last-operation-wins journal in chrome.storage.local. */
function captureLocalWordChanges(oldWords = [], newWords = []) {
    if (skipPendingCapture) return;

    queueMutation = queueMutation
        .then(async () => {
            const data = await chrome.storage.local.get({
                [PENDING_CHANGES_KEY]: {},
            });
            const pending = { ...(data[PENDING_CHANGES_KEY] || {}) };
            const oldMap = new Map(oldWords.map((word) => [wordIdentity(word), word]));
            const newMap = new Map(newWords.map((word) => [wordIdentity(word), word]));
            const queuedAt = Date.now();

            for (const [id, word] of newMap) {
                const previous = oldMap.get(id);
                if (!previous || !wordsEqual(previous, word)) {
                    pending[id] = {
                        type: "upsert",
                        word: {
                            ...word,
                            updatedAt: Math.max(word.updatedAt || 0, queuedAt),
                        },
                        queuedAt,
                        createdLocally:
                            pending[id]?.createdLocally || !previous,
                    };
                }
            }

            for (const [id, word] of oldMap) {
                if (!newMap.has(id)) {
                    // Add + delete before any sync cancels out completely.
                    if (pending[id]?.type === "upsert" && pending[id].createdLocally) {
                        delete pending[id];
                    } else {
                        pending[id] = { type: "delete", word, queuedAt };
                    }
                }
            }

            if (Object.keys(pending).length > 0) {
                await chrome.storage.local.set({ [PENDING_CHANGES_KEY]: pending });
                scheduleAutoSync();
            } else {
                await chrome.storage.local.remove(PENDING_CHANGES_KEY);
                await chrome.alarms.clear(AUTO_SYNC_ALARM);
            }
        })
        .catch((error) => {
            console.warn("[Lectoro] Could not update offline sync queue:", error);
        });
}

async function enqueueDeletes(words) {
    queueMutation = queueMutation.then(async () => {
        const data = await chrome.storage.local.get({
            [PENDING_CHANGES_KEY]: {},
        });
        const pending = { ...(data[PENDING_CHANGES_KEY] || {}) };
        const queuedAt = Date.now();
        for (const word of words) {
            pending[wordIdentity(word)] = { type: "delete", word, queuedAt };
        }
        await chrome.storage.local.set({ [PENDING_CHANGES_KEY]: pending });
        scheduleAutoSync();
    });
    return queueMutation;
}

/** Flush only the local mutation journal. This operation performs no reads. */
async function flushPendingChanges() {
    // Let a just-completed chrome.storage.local.set dispatch onChanged first
    // (important when the user clicks Sync/Logout immediately after a review).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await queueMutation;
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
        const context = await getFirebaseContext();
        if (!context) throw new Error("Zaloguj się, aby zsynchronizować dane.");

        const data = await chrome.storage.local.get({
            [PENDING_CHANGES_KEY]: {},
        });
        const snapshot = data[PENDING_CHANGES_KEY] || {};
        const entries = Object.values(snapshot);

        if (entries.length > 0) {
            await FirebaseSync.writeBatch(context.user.uid, context.token, {
                upserts: entries
                    .filter((entry) => entry.type === "upsert")
                    .map((entry) => entry.word),
                deletes: entries
                    .filter((entry) => entry.type === "delete")
                    .map((entry) => entry.word),
            });
        }

        // Do not discard edits which arrived while the network request ran.
        const latestData = await chrome.storage.local.get({
            [PENDING_CHANGES_KEY]: {},
        });
        const latest = { ...(latestData[PENDING_CHANGES_KEY] || {}) };
        for (const [id, sentEntry] of Object.entries(snapshot)) {
            if (JSON.stringify(latest[id]) === JSON.stringify(sentEntry)) {
                delete latest[id];
            }
        }

        await chrome.storage.local.set({
            [PENDING_CHANGES_KEY]: latest,
            lastFirebaseSync: Date.now(),
            lastFirebaseSyncError: null,
        });
        if (Object.keys(latest).length === 0) {
            await chrome.alarms.clear(AUTO_SYNC_ALARM);
        } else {
            scheduleAutoSync();
        }
        return { sent: entries.length, pending: Object.keys(latest).length };
    })();

    try {
        return await syncInFlight;
    } catch (error) {
        await chrome.storage.local.set({
            lastFirebaseSyncError: error.message || String(error),
        });
        const [user, pendingData] = await Promise.all([
            typeof FirebaseSync === "undefined"
                ? Promise.resolve(null)
                : FirebaseSync.getUser().catch(() => null),
            chrome.storage.local.get({ [PENDING_CHANGES_KEY]: {} }),
        ]);
        if (
            user &&
            Object.keys(pendingData[PENDING_CHANGES_KEY] || {}).length > 0
        ) {
            scheduleAutoSync();
        }
        throw error;
    } finally {
        syncInFlight = null;
    }
}

function mergeWords(localWords, remoteWords) {
    const merged = new Map(localWords.map((word) => [wordIdentity(word), word]));
    for (const remote of remoteWords) {
        const id = wordIdentity(remote);
        const local = merged.get(id);
        if (!local || wordTimestamp(remote) > wordTimestamp(local)) {
            merged.set(id, remote);
        }
    }
    return Array.from(merged.values());
}

/**
 * User-requested/full sync: first commits local changes, then performs the
 * comparatively expensive cross-device pull and resolves conflicts by LWW.
 */
async function fullSync({ pull = true } = {}) {
    const flushResult = await flushPendingChanges();
    if (!pull) return flushResult;

    const context = await getFirebaseContext();
    if (!context) throw new Error("Zaloguj się, aby zsynchronizować dane.");
    const remoteWords = await FirebaseSync.pullWords(
        context.user.uid,
        context.token,
    );
    if (!remoteWords) throw new Error("Nie udało się pobrać danych z Firebase.");

    const localData = await chrome.storage.local.get({ savedWords: [] });
    const localWords = localData.savedWords || [];
    // Legacy entries without ids retain their deterministic content-hash id.
    // New entries already receive a stable id when they are created.
    const normalizedRemote = remoteWords;
    const remoteMap = new Map(
        normalizedRemote.map((word) => [wordIdentity(word), word]),
    );
    const localToPush = localWords.filter((word) => {
        const remote = remoteMap.get(wordIdentity(word));
        return !remote || wordTimestamp(word) > wordTimestamp(remote);
    });
    if (localToPush.length > 0) {
        await FirebaseSync.writeBatch(context.user.uid, context.token, {
            upserts: localToPush,
        });
    }

    const merged = mergeWords(localWords, normalizedRemote);
    if (!wordsEqual(localData.savedWords || [], merged)) {
        ignoreNextSavedWordsValue(merged);
        skipPendingCapture = true;
        try {
            await chrome.storage.local.set({ savedWords: merged });
        } finally {
            // onChanged is dispatched before the storage promise resolves.
            skipPendingCapture = false;
        }
    }
    await chrome.storage.local.set({ lastFirebaseSync: Date.now() });
    return { ...flushResult, pulled: remoteWords.length };
}

async function initializeAiUsage(force = false) {
    if (typeof self.GeminiProxy?.refreshUsage !== "function") return;
    try {
        await self.GeminiProxy.refreshUsage(force);
    } catch (error) {
        console.warn("[Lectoro] AI usage initialization failed:", error);
    }
}

async function clearLocalUserDataAfterSignOut() {
    ignoreNextSavedWordsValue([]);
    skipPendingCapture = true;
    try {
        await chrome.storage.local.clear();
    } finally {
        skipPendingCapture = false;
    }
    await chrome.alarms.clear(AUTO_SYNC_ALARM);
}

async function updateBadge() {
    try {
        const data = await chrome.storage.local.get({ savedWords: [] });
        const words = data.savedWords || [];
        const now = Date.now();
        const dueCount = countDueWords(words, now);
        await chrome.action.setBadgeText({ text: dueCount ? String(dueCount) : "" });
        if (dueCount) {
            await chrome.action.setBadgeBackgroundColor({ color: "#4a6cf7" });
        }
        scheduleNextDueAlarm(words, now);
    } catch (error) {
        console.warn("[Lectoro] Badge update error:", error);
    }
}

async function scheduleNextDueAlarm(words, now) {
    let soonest = Infinity;
    for (const word of words) {
        const next = word.sr?.nextReview;
        if (next && next > now && next < soonest) soonest = next;
    }
    if (soonest < Infinity) {
        chrome.alarms.create("nextDueReview", { when: soonest });
    } else {
        chrome.alarms.clear("nextDueReview");
    }
}

async function checkAndNotify() {
    const data = await chrome.storage.local.get({ savedWords: [] });
    const dueCount = countDueWords(data.savedWords || [], Date.now());
    if (dueCount > 0) {
        chrome.notifications.create("reviewReminder", {
            type: "basic",
            iconUrl: "icon48.png",
            title: "Lectoro Powtórki",
            message: `Masz ${dueCount} powtórki!`,
            priority: 1,
        });
    }
}

async function notifyTabsReviewDue(dueCount) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            chrome.tabs
                .sendMessage(tab.id, { type: "QT_REVIEW_DUE", count: dueCount })
                .catch(() => {});
        }
    }
}

chrome.alarms.create("updateBadge", { periodInMinutes: 5 });
chrome.alarms.create("reviewNotification", { periodInMinutes: 360 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "updateBadge") updateBadge();
    if (alarm.name === AUTO_SYNC_ALARM) {
        flushPendingChanges().catch((error) =>
            console.warn("[Lectoro] Auto-sync postponed:", error.message),
        );
    }
    if (alarm.name === "nextDueReview") {
        const data = await chrome.storage.local.get({ savedWords: [] });
        const dueCount = (data.savedWords || []).filter(
            (word) => word.sr && word.sr.nextReview <= Date.now(),
        ).length;
        if (dueCount > 0) notifyTabsReviewDue(dueCount);
        updateBadge();
    }
    if (alarm.name === "reviewNotification") checkAndNotify();
});

chrome.runtime.onInstalled.addListener(() => {
    updateBadge();
    initializeAiUsage();
});
chrome.runtime.onStartup.addListener(() => {
    updateBadge();
    chrome.storage.local.get({ [PENDING_CHANGES_KEY]: {} }).then((data) => {
        if (Object.keys(data[PENDING_CHANGES_KEY] || {}).length > 0) {
            scheduleAutoSync();
        }
    });
    initializeAiUsage();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.savedWords) {
        updateBadge();
        const newWords = changes.savedWords.newValue || [];
        const isIgnoredSnapshot =
            ignoredSavedWordsSnapshot !== undefined &&
            ignoredSavedWordsSnapshot === JSON.stringify(newWords);
        if (isIgnoredSnapshot) ignoredSavedWordsSnapshot = undefined;
        const isConfirmedSignOutClear =
            changes.firebaseAuth?.oldValue?.uid &&
            changes.firebaseAuth?.newValue === undefined &&
            changes.savedWords.newValue === undefined;
        if (!isConfirmedSignOutClear && !isIgnoredSnapshot) {
            captureLocalWordChanges(
                changes.savedWords.oldValue || [],
                newWords,
            );
        }
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "QT_OPEN_PLANS") {
        chrome.windows
            .create({
                url: chrome.runtime.getURL("popup.html#plans"),
                type: "popup",
                width: 520,
                height: 700,
                focused: true,
            })
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === "QT_FIREBASE_SIGN_IN") {
        FirebaseSync.signIn()
            .then(async (auth) => {
                await fullSync();
                await initializeAiUsage(true);
                sendResponse({ ok: true, email: auth.email || "" });
            })
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === "QT_FIREBASE_SIGN_OUT") {
        fullSync({ pull: false })
            .then(() => clearLocalUserDataAfterSignOut())
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === "QT_FIREBASE_SYNC") {
        fullSync()
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    // Backward-compatible callers now enqueue deletes instead of touching
    // Firestore immediately. The next manual/automatic sync batches them.
    if (message.type === "QT_FIRESTORE_DELETE" && message.word) {
        enqueueDeletes([message.word])
            .then(() => sendResponse({ ok: true, queued: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }
    if (message.type === "QT_FIRESTORE_DELETE_BATCH" && message.words) {
        enqueueDeletes(message.words)
            .then(() => sendResponse({ ok: true, queued: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }
});

updateBadge();
