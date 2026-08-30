// background.js - offline-first reviews, batched Firebase sync and reminders

try {
    importScripts(
        "shared/constants.js",
        "shared/subscription-config.js",
        "shared/utils.js",
        "shared/srs.js",
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
const MSG = (typeof LectoroConstants !== "undefined" && LectoroConstants.MESSAGE_TYPES) || {};
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

let tokenRefreshPromise = null;

async function getSingleFlightToken(forceRefresh = false) {
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) return null;
    if (!tokenRefreshPromise || forceRefresh) {
        tokenRefreshPromise = FirebaseSync.getValidToken(forceRefresh).finally(() => {
            tokenRefreshPromise = null;
        });
    }
    return tokenRefreshPromise;
}

async function getFirebaseContext() {
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        return null;
    }
    const user = await FirebaseSync.getUser();
    if (!user) return null;
    const token = await getSingleFlightToken();
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
        if (!context) throw new Error("Sign in to sync data.");

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
                        const targetWordId =
                            entry.word.id ||
                            (typeof FirebaseSync !== "undefined" &&
                            typeof FirebaseSync.wordDocId === "function"
                                ? await FirebaseSync.wordDocId(entry.word)
                                : String(Date.now()));
                        entry.word.id = targetWordId;
                        const uploaded = await GeminiProxy.uploadCardImage(
                            targetWordId,
                            entry.word.screenshot,
                        );
                        const savedPath = uploaded?.relativePath || uploaded?.path || uploaded?.url;
                        if (savedPath) {
                            entry.word.screenshot = savedPath;
                            if (typeof SharedWordRepository !== "undefined") {
                                await SharedWordRepository.updateWord(targetWordId, {
                                    screenshot: savedPath,
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
    if (!context) throw new Error("Sign in to sync data.");
    const remoteWords = await FirebaseSync.pullWords(
        context.user.uid,
        context.token,
    );
    if (!remoteWords) throw new Error("Failed to fetch data from Firebase.");

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
        // Upload any pending base64 screenshots to Cloudflare R2 before syncing to Firestore
        for (const word of localToPush) {
            if (
                word?.screenshot &&
                typeof word.screenshot === "string" &&
                word.screenshot.startsWith("data:") &&
                typeof GeminiProxy !== "undefined" &&
                typeof GeminiProxy.uploadCardImage === "function"
            ) {
                try {
                    const targetWordId =
                        word.id ||
                        (typeof FirebaseSync !== "undefined" &&
                        typeof FirebaseSync.wordDocId === "function"
                            ? await FirebaseSync.wordDocId(word)
                            : String(Date.now()));
                    word.id = targetWordId;
                    const uploaded = await GeminiProxy.uploadCardImage(
                        targetWordId,
                        word.screenshot,
                    );
                    const savedPath = uploaded?.relativePath || uploaded?.path || uploaded?.url;
                    if (savedPath) {
                        word.screenshot = savedPath;
                        if (typeof SharedWordRepository !== "undefined") {
                            await SharedWordRepository.updateWord(targetWordId, {
                                screenshot: savedPath,
                            });
                        }
                    }
                } catch (uploadError) {
                    console.warn("[Lectoro] R2 upload during syncAll warning:", uploadError);
                }
            }
        }

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
            throw new Error("Image is too large.");
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
            throw new Error("Image is too large.");
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
        throw new Error("Unsupported image URL.");
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
        throw new Error("Image is too large.");
    }

    const bytes = await readResponseBytes(response);
    if (!bytes || bytes.length === 0) {
        throw new Error("Fetched image is empty.");
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
const netflixTimedTextRequests = new Map();
const netflixTimedTextFailures = new Map();
const NETFLIX_TIMED_TEXT_FAILURE_TTL_MS = 30_000;

async function downloadNetflixTimedText(rawUrl) {
    if (netflixTimedTextCache.has(rawUrl)) {
        return netflixTimedTextCache.get(rawUrl);
    }

    const url = new URL(rawUrl);
    if (
        url.protocol !== "https:" ||
        !isAllowedNetflixMediaHost(url.hostname)
    ) {
        throw new Error("Unsupported Netflix subtitle URL.");
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
        throw new Error("Disallowed Netflix subtitle redirect.");
    }

    const declaredSize = Number(response.headers.get("content-length")) || 0;
    if (declaredSize > MAX_NETFLIX_TIMED_TEXT_BYTES) {
        throw new Error("Netflix subtitle file is too large.");
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_NETFLIX_TIMED_TEXT_BYTES) {
        throw new Error("Netflix subtitle file is too large.");
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

function fetchNetflixTimedText(rawUrl) {
    if (netflixTimedTextCache.has(rawUrl)) {
        return Promise.resolve(netflixTimedTextCache.get(rawUrl));
    }

    const recentFailure = netflixTimedTextFailures.get(rawUrl);
    if (recentFailure?.expiresAt > Date.now()) {
        return Promise.reject(new Error(recentFailure.message));
    }
    if (recentFailure) netflixTimedTextFailures.delete(rawUrl);

    const existingRequest = netflixTimedTextRequests.get(rawUrl);
    if (existingRequest) return existingRequest;

    const request = downloadNetflixTimedText(rawUrl)
        .catch((error) => {
            if (netflixTimedTextFailures.size >= 100) {
                const oldestKey = netflixTimedTextFailures.keys().next().value;
                if (oldestKey) netflixTimedTextFailures.delete(oldestKey);
            }
            netflixTimedTextFailures.set(rawUrl, {
                message: error?.message || String(error),
                expiresAt: Date.now() + NETFLIX_TIMED_TEXT_FAILURE_TTL_MS,
            });
            throw error;
        })
        .finally(() => {
            if (netflixTimedTextRequests.get(rawUrl) === request) {
                netflixTimedTextRequests.delete(rawUrl);
            }
        });
    netflixTimedTextRequests.set(rawUrl, request);
    return request;
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
    if (message.type === (MSG.CAPTURE_VISIBLE_TAB || "QT_CAPTURE_VISIBLE_TAB")) {
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

    if (message.type === (MSG.FETCH_NETFLIX_TIMED_TEXT || "QT_FETCH_NETFLIX_TIMED_TEXT")) {
        if (
            !sender.tab?.url ||
            !/^https:\/\/www\.netflix\.com\//i.test(sender.tab.url) ||
            !/^\d+$/.test(String(message.movieId || ""))
        ) {
            sendResponse({ error: "Request is not from a Netflix tab." });
            return false;
        }
        fetchNetflixTimedText(message.url)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.FETCH_CONTEXT_IMAGE || "QT_FETCH_CONTEXT_IMAGE")) {
        fetchContextImageDataUrl(message.url)
            .then((dataUrl) => sendResponse({ dataUrl }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.ENABLE_VIDEO_FRAME || "QT_ENABLE_VIDEO_FRAME")) {
        if (
            !sender.tab?.id ||
            !Number.isInteger(sender.frameId) ||
            sender.frameId === 0
        ) {
            sendResponse({ error: "Missing target video frame." });
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
                        "shared/subscription-config.js",
                        "shared/utils.js",
                        "shared/word-repository.js",
                        "shared/translator-service.js",
                        "shared/tts-service.js",
                        "shared/audio-cache.js",
                        "shared/ai-prompts.js",
                        "firebase/firebase-config.js",
                        "firebase/firebase-sync.js",
                        "shared/subscription-service.js",
                        "shared/gemini-proxy.js",
                        "shared/subtitle-service.js",
                        "shared/phrase-detector.js",
                        "core.js",
                        "adapters/base-adapter.js",
                        "adapters/youtube-adapter.js",
                        "adapters/netflix-adapter.js",
                        "adapters/generic-video-adapter.js",
                        "adapters/generic-adapters.js",
                        "adapters/ted-adapter.js",
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

    if (message.type === (MSG.OPEN_PLANS || "QT_OPEN_PLANS")) {
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

    if (message.type === (MSG.FIREBASE_SIGN_IN || "QT_FIREBASE_SIGN_IN")) {
        FirebaseSync.signIn()
            .then(async (auth) => {
                await fullSync();
                await initializeAiUsage(true);
                sendResponse({ ok: true, email: auth.email || "" });
            })
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.FIREBASE_SIGN_OUT || "QT_FIREBASE_SIGN_OUT")) {
        fullSync({ pull: false })
            .then(() => clearLocalUserDataAfterSignOut())
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.FIREBASE_DELETE_ACCOUNT || "QT_FIREBASE_DELETE_ACCOUNT")) {
        (async () => {
            const token = await getSingleFlightToken(true);
            if (!token) throw new Error("No active session.");

            const endpoint = typeof GeminiProxy !== "undefined" && typeof GeminiProxy.endpoint === "function"
                ? GeminiProxy.endpoint()
                : "https://geminiproxy-gyagzflbra-ew.a.run.app";

            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ action: "deleteUserAccount" }),
            });

            if (!res.ok) {
                const details = await res.json().catch(() => ({}));
                throw new Error(details.error || `Account deletion error (${res.status})`);
            }

            await clearLocalUserDataAfterSignOut();
            if (typeof FirebaseSync !== "undefined" && typeof FirebaseSync.signOut === "function") {
                await FirebaseSync.signOut();
            }
            return { ok: true };
        })()
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.GET_FIREBASE_TOKEN || "QT_GET_FIREBASE_TOKEN")) {
        getSingleFlightToken(!!message.forceRefresh)
            .then((token) => sendResponse({ token }))
            .catch((error) => sendResponse({ token: null, error: error.message }));
        return true;
    }

    if (message.type === (MSG.GET_FIREBASE_USER || "QT_GET_FIREBASE_USER")) {
        (typeof FirebaseSync !== "undefined" ? FirebaseSync.getUser() : Promise.resolve(null))
            .then((user) => sendResponse({ user }))
            .catch((error) => sendResponse({ user: null, error: error.message }));
        return true;
    }

    if (message.type === (MSG.FIREBASE_SYNC || "QT_FIREBASE_SYNC")) {
        fullSync()
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    // Backward-compatible callers now enqueue deletes instead of touching
    // Firestore immediately. The next manual/automatic sync batches them.
    if (message.type === (MSG.FIRESTORE_DELETE || "QT_FIRESTORE_DELETE") && message.word) {
        enqueueDeletes([message.word])
            .then(() => sendResponse({ ok: true, queued: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }
    if (message.type === (MSG.FIRESTORE_DELETE_BATCH || "QT_FIRESTORE_DELETE_BATCH") && message.words) {
        enqueueDeletes(message.words)
            .then(() => sendResponse({ ok: true, queued: true }))
            .catch((error) => sendResponse({ error: error.message }));
        return true;
    }

    if (message.type === (MSG.GEMINI_REQUEST || "QT_GEMINI_REQUEST")) {
        (async () => {
            if (typeof GeminiProxy === "undefined") {
                throw new Error("GeminiProxy unavailable in background process.");
            }
            return await GeminiProxy.request(message.prompt, message.opts);
        })()
            .then((result) => sendResponse({ ok: true, result }))
            .catch((error) =>
                sendResponse({
                    error: error?.message || String(error),
                    code: error?.code,
                    validation: error?.validation,
                }),
            );
        return true;
    }

    if (message.type === (MSG.GEMINI_REFRESH_USAGE || "QT_GEMINI_REFRESH_USAGE")) {
        (async () => {
            if (typeof GeminiProxy === "undefined") {
                throw new Error("GeminiProxy unavailable in background process.");
            }
            return await GeminiProxy.refreshUsage(!!message.force);
        })()
            .then((usage) => sendResponse({ ok: true, usage }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.GEMINI_UPLOAD_CARD_IMAGE || "QT_GEMINI_UPLOAD_CARD_IMAGE")) {
        (async () => {
            if (typeof GeminiProxy === "undefined") {
                throw new Error("GeminiProxy unavailable in background process.");
            }
            return await GeminiProxy.uploadCardImage(
                message.wordId,
                message.imageBase64,
                message.contentType,
            );
        })()
            .then((result) => sendResponse({ ok: true, result }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.GEMINI_DELETE_CARD_IMAGES || "QT_GEMINI_DELETE_CARD_IMAGES")) {
        (async () => {
            if (typeof GeminiProxy === "undefined") {
                throw new Error("GeminiProxy unavailable in background process.");
            }
            return await GeminiProxy.deleteCardImage(message.wordIds);
        })()
            .then((ok) => sendResponse({ ok: !!ok }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.GEMINI_DELETE_ALL_USER_IMAGES || "QT_GEMINI_DELETE_ALL_USER_IMAGES")) {
        (async () => {
            if (typeof GeminiProxy === "undefined") {
                throw new Error("GeminiProxy unavailable in background process.");
            }
            return await GeminiProxy.deleteAllUserImages();
        })()
            .then((deletedCount) => sendResponse({ ok: true, deletedCount }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.GOOGLE_TRANSLATE || "QT_GOOGLE_TRANSLATE")) {
        (async () => {
            const url =
                "https://translate.googleapis.com/translate_a/single" +
                "?client=gtx&sl=auto&tl=" +
                encodeURIComponent(message.targetLang || "pl") +
                "&dt=t&q=" +
                encodeURIComponent(message.text || "");

            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const translated = data[0].map((s) => s[0]).join("");
            const detectedLang = data[2] || "auto";
            return { translated, detectedLang };
        })()
            .then((result) => sendResponse({ ok: true, result }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.SUBSCRIPTION_REFRESH_PROFILE || "QT_SUBSCRIPTION_REFRESH_PROFILE")) {
        (async () => {
            if (
                typeof self.SubscriptionService === "undefined" ||
                typeof self.SubscriptionService.refreshProfile !== "function"
            ) {
                throw new Error("SubscriptionService unavailable in background process.");
            }
            return await self.SubscriptionService.refreshProfile(!!message.force);
        })()
            .then((profile) => sendResponse({ ok: true, profile }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }

    if (message.type === (MSG.ELEVENLABS_SYNTHESIZE || "QT_ELEVENLABS_SYNTHESIZE")) {
        (async () => {
            if (
                typeof self.SubscriptionService === "undefined" ||
                typeof self.SubscriptionService.synthesizeElevenLabs !== "function"
            ) {
                throw new Error("SubscriptionService unavailable in background process.");
            }
            const blob = await self.SubscriptionService.synthesizeElevenLabs(
                message.text,
                message.voiceId,
                message.context || "review",
            );
            const arrayBuffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            return {
                base64: btoa(binary),
                mimeType: blob.type || "audio/mpeg",
            };
        })()
            .then((result) => sendResponse({ ok: true, ...result }))
            .catch((error) =>
                sendResponse({
                    error: error?.message || String(error),
                    code: error?.code,
                }),
            );
        return true;
    }

    if (message.type === (MSG.ELEVENLABS_VOICES || "QT_ELEVENLABS_VOICES")) {
        (async () => {
            if (
                typeof self.SubscriptionService === "undefined" ||
                typeof self.SubscriptionService.getElevenLabsVoices !== "function"
            ) {
                throw new Error("SubscriptionService unavailable in background process.");
            }
            return await self.SubscriptionService.getElevenLabsVoices(message.context || "review");
        })()
            .then((voices) => sendResponse({ ok: true, voices }))
            .catch((error) => sendResponse({ error: error?.message || String(error) }));
        return true;
    }
});

updateBadge();
