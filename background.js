// background.js - offline-first reviews, batched Firebase sync and reminders

try {
    importScripts(
        "shared/constants.js",
        "functions/subscription-config.js",
        "shared/utils.js",
        "shared/word-repository.js",
        "firebase/firebase-config.js",
        "firebase/firebase-sync.js",
        "shared/subscription-service.js",
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
            // Upload any pending base64 screenshots to Cloudflare R2 before syncing to Firestore
            for (const entry of entries) {
                if (
                    entry.type === "upsert" &&
                    entry.word?.screenshot &&
                    entry.word.screenshot.startsWith("data:") &&
                    typeof GeminiProxy !== "undefined" &&
                    typeof GeminiProxy.uploadCardImage === "function"
                ) {
                    try {
                        const uploaded = await GeminiProxy.uploadCardImage(
                            entry.word.id,
                            entry.word.screenshot,
                        );
                        if (uploaded?.url) {
                            entry.word.screenshot = uploaded.url;
                            if (typeof SharedWordRepository !== "undefined") {
                                await SharedWordRepository.updateWord(entry.word.id, {
                                    screenshot: uploaded.url,
                                });
                            }
                        }
                    } catch (uploadError) {
                        console.warn("[Lectoro] R2 upload during sync error:", uploadError);
                    }
                }
            }

            const deleteEntries = entries.filter((entry) => entry.type === "delete");
            const deleteWordIds = deleteEntries
                .map((entry) => entry.word?.id)
                .filter(Boolean);

            if (
                deleteWordIds.length > 0 &&
                typeof GeminiProxy !== "undefined" &&
                typeof GeminiProxy.deleteCardImage === "function"
            ) {
                GeminiProxy.deleteCardImage(deleteWordIds).catch((err) => {
                    console.warn("[Lectoro] R2 delete during sync error:", err);
                });
            }

            await FirebaseSync.writeBatch(context.user.uid, context.token, {
                upserts: entries
                    .filter((entry) => entry.type === "upsert")
                    .map((entry) => entry.word),
                deletes: deleteEntries.map((entry) => entry.word),
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
    try {
        if (typeof self.SubscriptionService?.refreshProfile === "function") {
            await self.SubscriptionService.refreshProfile(force);
        }
        if (typeof self.GeminiProxy?.refreshUsage === "function") {
            await self.GeminiProxy.refreshUsage(force);
        }
    } catch (error) {
        console.warn("[Lectoro] Subscription initialization failed:", error);
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

const MAX_CONTEXT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_NETFLIX_TIMED_TEXT_BYTES = 5 * 1024 * 1024;
const NETFLIX_MEDIA_HOSTS = [
    "netflix.com",
    "nflxvideo.net",
    "nflxso.net",
    "nflximg.net",
    "nflxext.com",
    "netflix.net",
];

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(
            ...bytes.subarray(offset, offset + chunkSize),
        );
    }
    return btoa(binary);
}

async function readResponseBytes(response) {
    if (!response.body?.getReader) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_CONTEXT_IMAGE_BYTES) {
            throw new Error("Obraz jest zbyt duży.");
        }
        return new Uint8Array(buffer);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CONTEXT_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error("Obraz jest zbyt duży.");
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function fetchContextImageDataUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Nieobsługiwany adres obrazu.");
    }

    const response = await fetch(url.href, {
        headers: {
            Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const declaredSize = Number(response.headers.get("content-length")) || 0;
    if (declaredSize > MAX_CONTEXT_IMAGE_BYTES) {
        throw new Error("Obraz jest zbyt duży.");
    }

    const bytes = await readResponseBytes(response);
    if (!bytes || bytes.length === 0) {
        throw new Error("Pobrany obraz jest pusty.");
    }

    let contentType = (response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();

    if (!contentType.startsWith("image/") || contentType === "image/svg+xml" || contentType.includes("octet-stream")) {
        if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
            contentType = "image/jpeg";
        } else if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            contentType = "image/png";
        } else if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
            contentType = "image/gif";
        } else if (
            bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
        ) {
            contentType = "image/webp";
        } else if (/\.(jpe?g)($|\?)/i.test(url.pathname)) {
            contentType = "image/jpeg";
        } else if (/\.(png)($|\?)/i.test(url.pathname)) {
            contentType = "image/png";
        } else if (/\.(webp)($|\?)/i.test(url.pathname)) {
            contentType = "image/webp";
        } else if (/\.(avif)($|\?)/i.test(url.pathname)) {
            contentType = "image/avif";
        } else if (isAllowedNetflixMediaHost(url.hostname)) {
            contentType = "image/jpeg";
        } else {
            contentType = "image/jpeg";
        }
    }

    const base64 = bytesToBase64(bytes);
    return `data:${contentType};base64,${base64}`;
}

function isAllowedNetflixMediaHost(hostname) {
    const normalized = hostname.toLowerCase();
    return NETFLIX_MEDIA_HOSTS.some(
        (suffix) =>
            normalized === suffix || normalized.endsWith("." + suffix),
    );
}

const netflixTimedTextCache = new Map();
const MAX_NETFLIX_CACHE_ENTRIES = 25;

async function fetchNetflixTimedText(rawUrl) {
    if (netflixTimedTextCache.has(rawUrl)) {
        return netflixTimedTextCache.get(rawUrl);
    }

    const url = new URL(rawUrl);
    if (
        url.protocol !== "https:" ||
        !isAllowedNetflixMediaHost(url.hostname)
    ) {
        throw new Error("Nieobsługiwany adres napisów Netflixa.");
    }

    const response = await fetch(url.href, {
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (
        finalUrl.protocol !== "https:" ||
        !isAllowedNetflixMediaHost(finalUrl.hostname)
    ) {
        throw new Error("Niedozwolone przekierowanie napisów Netflixa.");
    }

    const declaredSize = Number(response.headers.get("content-length")) || 0;
    if (declaredSize > MAX_NETFLIX_TIMED_TEXT_BYTES) {
        throw new Error("Plik napisów Netflixa jest zbyt duży.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_NETFLIX_TIMED_TEXT_BYTES) {
        throw new Error("Plik napisów Netflixa jest zbyt duży.");
    }

    const result = {
        text: new TextDecoder("utf-8").decode(buffer),
        contentType: response.headers.get("content-type") || "",
    };

    if (netflixTimedTextCache.size >= MAX_NETFLIX_CACHE_ENTRIES) {
        const oldestKey = netflixTimedTextCache.keys().next().value;
        if (oldestKey) netflixTimedTextCache.delete(oldestKey);
    }
    netflixTimedTextCache.set(rawUrl, result);

    return result;
}

// Automatically sync plan and limits when Stripe checkout or portal completes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab?.url || "";
    if (
        url.includes("stripeCheckoutResult") ||
        url.includes("checkout.stripe.com") ||
        url.includes("billing.stripe.com")
    ) {
        initializeAiUsage(true).catch(() => {});
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "QT_CAPTURE_VISIBLE_TAB") {
        const captureOptions = { format: "jpeg", quality: 85 };
        const windowId = Number.isInteger(sender.tab?.windowId)
            ? sender.tab.windowId
            : null;

        const capture = (wId) =>
            new Promise((resolve, reject) => {
                const callback = (dataUrl) => {
                    if (chrome.runtime.lastError || !dataUrl) {
                        reject(chrome.runtime.lastError || new Error("Brak obrazu karty."));
                    } else {
                        resolve(dataUrl);
                    }
                };
                try {
                    if (Number.isInteger(wId)) {
                        chrome.tabs.captureVisibleTab(wId, captureOptions, callback);
                    } else {
                        chrome.tabs.captureVisibleTab(captureOptions, callback);
                    }
                } catch (err) {
                    reject(err);
                }
            });

        capture(windowId)
            .catch(() => capture(null))
            .then((dataUrl) => sendResponse({ dataUrl }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === "QT_FETCH_NETFLIX_TIMED_TEXT") {
        if (!sender.tab?.url || !/^https:\/\/www\.netflix\.com\//i.test(sender.tab.url)) {
            sendResponse({ error: "Żądanie nie pochodzi z karty Netflixa." });
            return false;
        }
        fetchNetflixTimedText(message.url)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === "QT_FETCH_CONTEXT_IMAGE") {
        fetchContextImageDataUrl(message.url)
            .then((dataUrl) => sendResponse({ dataUrl }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === "QT_ENABLE_VIDEO_FRAME") {
        if (
            !sender.tab?.id ||
            !Number.isInteger(sender.frameId) ||
            sender.frameId === 0
        ) {
            sendResponse({ error: "Brak docelowej ramki wideo." });
            return false;
        }

        const target = {
            tabId: sender.tab.id,
            frameIds: [sender.frameId],
        };
        chrome.scripting
            .insertCSS({ target, files: ["styles.css"] })
            .then(() =>
                chrome.scripting.executeScript({
                    target,
                    files: [
                        "shared/constants.js",
                        "functions/subscription-config.js",
                        "shared/utils.js",
                        "shared/word-repository.js",
                        "shared/translator-service.js",
                        "shared/tts-service.js",
                        "shared/audio-cache.js",
                        "shared/srs.js",
                        "shared/ai-prompts.js",
                        "firebase/firebase-config.js",
                        "firebase/firebase-sync.js",
                        "shared/subscription-service.js",
                        "shared/gemini-proxy.js",
                        "shared/subtitle-service.js",
                        "core.js",
                        "adapters/base-adapter.js",
                        "adapters/youtube-adapter.js",
                        "adapters/netflix-adapter.js",
                        "adapters/lookmovie-adapter.js",
                        "adapters/generic-adapters.js",
                        "adapters/player-registry.js",
                        "video/subtitle-overlay.js",
                        "video/video-hotkeys.js",
                        "content.js",
                    ],
                }),
            )
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

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
