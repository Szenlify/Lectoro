// background.js - offline-first reviews, batched Firebase sync and reminders (MV3 service worker)

importScripts(
    "shared/constants.js",
    "shared/subscription-config.js",
    "shared/utils.js",
    "shared/srs.js",
    "shared/word-repository.js",
    "shared/translator-service.js",
    "firebase/firebase-config.js",
    "firebase/firebase-sync.js",
    "shared/subscription-service.js",
    "shared/gemini-proxy.js",
);

const { wordKey, countDueWords, bytesToBase64 } = SharedUtils;
const MSG = LectoroConstants.MESSAGE_TYPES;
const KEYS = LectoroConstants.STORAGE_KEYS;
const PENDING_CHANGES_KEY = KEYS.PENDING_FIREBASE_CHANGES;

const ALARMS = Object.freeze({
    UPDATE_BADGE: "updateBadge",
    AUTO_SYNC: "firebaseAutoSync",
    NEXT_DUE_REVIEW: "nextDueReview",
});
const AUTO_SYNC_DELAY_MS = 60_000;
const BADGE_COLOR = "#4a6cf7";

// ═══════════════════════════════════════════════════════════════
//  In-flight state
//  All of it is a harmless cache: the durable source of truth is chrome.storage
//  (savedWords + pendingFirebaseChanges journal), so losing it when the service
//  worker is suspended only costs a redundant retry, never data.
// ═══════════════════════════════════════════════════════════════

let skipPendingCapture = false;
let ignoredSavedWordsSnapshot;
let queueMutation = Promise.resolve();
let syncInFlight = null;
let tokenRefreshPromise = null;

function wordIdentity(word) {
    return word?.id || wordKey(word || {});
}

function wordTimestamp(word) {
    return word?.updatedAt || word?.sr?.lastReview || word?.timestamp || 0;
}

function wordsEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

/** Skip journaling the next savedWords write when it is our own merge result. */
function ignoreNextSavedWordsValue(words) {
    const snapshot = JSON.stringify(words);
    ignoredSavedWordsSnapshot = snapshot;
    setTimeout(() => {
        if (ignoredSavedWordsSnapshot === snapshot) {
            ignoredSavedWordsSnapshot = undefined;
        }
    }, 5_000);
}

/** Serialize read-modify-write operations on the pending-changes journal. */
function enqueueJournalMutation(mutate) {
    const operation = queueMutation.then(mutate);
    queueMutation = operation.catch(() => {});
    return operation;
}

async function readPendingChanges() {
    const data = await chrome.storage.local.get({ [PENDING_CHANGES_KEY]: {} });
    return { ...(data[PENDING_CHANGES_KEY] || {}) };
}

// ═══════════════════════════════════════════════════════════════
//  Firebase auth context
// ═══════════════════════════════════════════════════════════════

async function getSingleFlightToken(forceRefresh = false) {
    if (!FirebaseSync.isConfigured()) return null;
    if (!tokenRefreshPromise || forceRefresh) {
        tokenRefreshPromise = FirebaseSync.getValidToken(forceRefresh).finally(() => {
            tokenRefreshPromise = null;
        });
    }
    return tokenRefreshPromise;
}

async function getFirebaseContext() {
    if (!FirebaseSync.isConfigured()) return null;
    const user = await FirebaseSync.getUser();
    if (!user) return null;
    const token = await getSingleFlightToken();
    if (!token) return null;
    return { user, token };
}

function scheduleAutoSync() {
    chrome.alarms.create(ALARMS.AUTO_SYNC, {
        when: Date.now() + AUTO_SYNC_DELAY_MS,
    });
}

// ═══════════════════════════════════════════════════════════════
//  Offline journal (last-operation-wins) in chrome.storage.local
// ═══════════════════════════════════════════════════════════════

function captureLocalWordChanges(oldWords = [], newWords = []) {
    if (skipPendingCapture) return;

    enqueueJournalMutation(async () => {
        const pending = await readPendingChanges();
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
                    createdLocally: pending[id]?.createdLocally || !previous,
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
            await chrome.alarms.clear(ALARMS.AUTO_SYNC);
        }
    }).catch((error) => {
        console.warn("[Lectoro] Could not update offline sync queue:", error);
    });
}

function enqueueDeletes(words) {
    return enqueueJournalMutation(async () => {
        const pending = await readPendingChanges();
        const queuedAt = Date.now();
        for (const word of words) {
            pending[wordIdentity(word)] = { type: "delete", word, queuedAt };
        }
        await chrome.storage.local.set({ [PENDING_CHANGES_KEY]: pending });
        scheduleAutoSync();
    });
}

/**
 * Move inline base64 screenshots to Cloudflare R2 before the words reach Firestore
 * (Firestore documents must stay small). Mutates `word.screenshot` / `word.id` in place.
 */
async function uploadPendingScreenshots(words, logLabel) {
    for (const word of words) {
        if (typeof word?.screenshot !== "string" || !word.screenshot.startsWith("data:")) continue;
        try {
            const targetWordId = word.id || (await FirebaseSync.wordDocId(word));
            word.id = targetWordId;
            const uploaded = await GeminiProxy.uploadCardImage(targetWordId, word.screenshot);
            const savedPath = uploaded?.relativePath || uploaded?.path || uploaded?.url;
            if (savedPath) {
                word.screenshot = savedPath;
                await SharedWordRepository.updateWord(targetWordId, { screenshot: savedPath });
            }
        } catch (uploadError) {
            console.warn(`[Lectoro] R2 upload during ${logLabel} error:`, uploadError);
        }
    }
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

        const snapshot = await readPendingChanges();
        const entries = Object.values(snapshot);

        if (entries.length > 0) {
            const upsertEntries = entries.filter((entry) => entry.type === "upsert");
            const deleteEntries = entries.filter((entry) => entry.type === "delete");

            await uploadPendingScreenshots(upsertEntries.map((entry) => entry.word), "sync");

            const deleteWordIds = deleteEntries.map((entry) => entry.word?.id).filter(Boolean);
            if (deleteWordIds.length > 0) {
                GeminiProxy.deleteCardImage(deleteWordIds).catch((err) => {
                    console.warn("[Lectoro] R2 delete during sync error:", err);
                });
            }

            await FirebaseSync.writeBatch(context.user.uid, context.token, {
                upserts: upsertEntries.map((entry) => entry.word),
                deletes: deleteEntries.map((entry) => entry.word),
            });
        }

        // Do not discard edits which arrived while the network request ran.
        const latest = await readPendingChanges();
        for (const [id, sentEntry] of Object.entries(snapshot)) {
            if (JSON.stringify(latest[id]) === JSON.stringify(sentEntry)) {
                delete latest[id];
            }
        }

        await chrome.storage.local.set({
            [PENDING_CHANGES_KEY]: latest,
            [KEYS.LAST_FIREBASE_SYNC]: Date.now(),
            [KEYS.LAST_FIREBASE_SYNC_ERROR]: null,
        });
        if (Object.keys(latest).length === 0) {
            await chrome.alarms.clear(ALARMS.AUTO_SYNC);
        } else {
            scheduleAutoSync();
        }
        return { sent: entries.length, pending: Object.keys(latest).length };
    })();

    try {
        return await syncInFlight;
    } catch (error) {
        await chrome.storage.local.set({
            [KEYS.LAST_FIREBASE_SYNC_ERROR]: error.message || String(error),
        });
        const [user, pending] = await Promise.all([
            FirebaseSync.getUser().catch(() => null),
            readPendingChanges(),
        ]);
        if (user && Object.keys(pending).length > 0) {
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
    const remoteWords = await FirebaseSync.pullWords(context.user.uid, context.token);
    if (!remoteWords) throw new Error("Failed to fetch data from Firebase.");

    const localData = await chrome.storage.local.get({ [KEYS.SAVED_WORDS]: [] });
    const localWords = localData[KEYS.SAVED_WORDS] || [];
    // Legacy entries without ids retain their deterministic content-hash id.
    // New entries already receive a stable id when they are created.
    const remoteMap = new Map(remoteWords.map((word) => [wordIdentity(word), word]));
    const localToPush = localWords.filter((word) => {
        const remote = remoteMap.get(wordIdentity(word));
        return !remote || wordTimestamp(word) > wordTimestamp(remote);
    });
    if (localToPush.length > 0) {
        await uploadPendingScreenshots(localToPush, "syncAll");
        await FirebaseSync.writeBatch(context.user.uid, context.token, {
            upserts: localToPush,
        });
    }

    const merged = mergeWords(localWords, remoteWords);
    if (!wordsEqual(localWords, merged)) {
        ignoreNextSavedWordsValue(merged);
        skipPendingCapture = true;
        try {
            await chrome.storage.local.set({ [KEYS.SAVED_WORDS]: merged });
        } finally {
            // onChanged is dispatched before the storage promise resolves.
            skipPendingCapture = false;
        }
    }
    await chrome.storage.local.set({ [KEYS.LAST_FIREBASE_SYNC]: Date.now() });
    return { ...flushResult, pulled: remoteWords.length };
}

async function initializeAiUsage(force = false) {
    try {
        await SubscriptionService.refreshProfile(force);
        await GeminiProxy.refreshUsage(force);
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
    await chrome.alarms.clear(ALARMS.AUTO_SYNC);
}

// ═══════════════════════════════════════════════════════════════
//  Review badge & due-review reminders
// ═══════════════════════════════════════════════════════════════

async function getSavedWords() {
    const data = await chrome.storage.local.get({ [KEYS.SAVED_WORDS]: [] });
    return data[KEYS.SAVED_WORDS] || [];
}

async function updateBadge() {
    try {
        const words = await getSavedWords();
        const now = Date.now();
        const dueCount = countDueWords(words, now);
        await chrome.action.setBadgeText({ text: dueCount ? String(dueCount) : "" });
        if (dueCount) {
            await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
        }
        scheduleNextDueAlarm(words, now);
    } catch (error) {
        console.warn("[Lectoro] Badge update error:", error);
    }
}

function scheduleNextDueAlarm(words, now) {
    let soonest = Infinity;
    for (const word of words) {
        const next = word.sr?.nextReview;
        if (next && next > now && next < soonest) soonest = next;
    }
    if (soonest < Infinity) {
        chrome.alarms.create(ALARMS.NEXT_DUE_REVIEW, { when: soonest });
    } else {
        chrome.alarms.clear(ALARMS.NEXT_DUE_REVIEW);
    }
}

async function notifyTabsReviewDue(dueCount) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) {
            chrome.tabs
                .sendMessage(tab.id, { type: MSG.REVIEW_DUE, count: dueCount })
                .catch(() => {});
        }
    }
}

chrome.alarms.create(ALARMS.UPDATE_BADGE, { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARMS.UPDATE_BADGE) updateBadge();
    if (alarm.name === ALARMS.AUTO_SYNC) {
        flushPendingChanges().catch((error) =>
            console.warn("[Lectoro] Auto-sync postponed:", error.message),
        );
    }
    if (alarm.name === ALARMS.NEXT_DUE_REVIEW) {
        const words = await getSavedWords();
        const dueCount = words.filter((word) => word.sr && word.sr.nextReview <= Date.now()).length;
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
    readPendingChanges().then((pending) => {
        if (Object.keys(pending).length > 0) scheduleAutoSync();
    });
    initializeAiUsage();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const savedWordsChange = changes[KEYS.SAVED_WORDS];
    if (!savedWordsChange) return;

    updateBadge();
    const newWords = savedWordsChange.newValue || [];
    const isIgnoredSnapshot =
        ignoredSavedWordsSnapshot !== undefined &&
        ignoredSavedWordsSnapshot === JSON.stringify(newWords);
    if (isIgnoredSnapshot) ignoredSavedWordsSnapshot = undefined;
    const authChange = changes[KEYS.FIREBASE_AUTH];
    const isConfirmedSignOutClear =
        authChange?.oldValue?.uid &&
        authChange?.newValue === undefined &&
        savedWordsChange.newValue === undefined;
    if (!isConfirmedSignOutClear && !isIgnoredSnapshot) {
        captureLocalWordChanges(savedWordsChange.oldValue || [], newWords);
    }
});

// ═══════════════════════════════════════════════════════════════
//  Privileged network helpers (content scripts can't fetch cross-origin)
// ═══════════════════════════════════════════════════════════════

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

/** Sniff the image MIME type from magic bytes, then the URL extension; default to JPEG. */
function detectImageContentType(bytes, url) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
        return "image/webp";
    }
    const extension = url.pathname.match(/\.(jpe?g|png|webp|avif)($|\?)/i)?.[1]?.toLowerCase();
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    if (extension === "png") return "image/png";
    if (extension === "webp") return "image/webp";
    if (extension === "avif") return "image/avif";
    return "image/jpeg";
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
        contentType = detectImageContentType(bytes, url);
    }

    return `data:${contentType};base64,${bytesToBase64(bytes)}`;
}

function isAllowedNetflixMediaHost(hostname) {
    const normalized = hostname.toLowerCase();
    return NETFLIX_MEDIA_HOSTS.some(
        (suffix) => normalized === suffix || normalized.endsWith("." + suffix),
    );
}

const netflixTimedTextCache = new Map();
const MAX_NETFLIX_CACHE_ENTRIES = 25;
const netflixTimedTextRequests = new Map();
const netflixTimedTextFailures = new Map();
const MAX_NETFLIX_FAILURE_ENTRIES = 100;
const NETFLIX_TIMED_TEXT_FAILURE_TTL_MS = 30_000;

function evictOldest(map, maxEntries) {
    if (map.size >= maxEntries) {
        const oldestKey = map.keys().next().value;
        if (oldestKey) map.delete(oldestKey);
    }
}

async function downloadNetflixTimedText(rawUrl) {
    if (netflixTimedTextCache.has(rawUrl)) {
        return netflixTimedTextCache.get(rawUrl);
    }

    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !isAllowedNetflixMediaHost(url.hostname)) {
        throw new Error("Unsupported Netflix subtitle URL.");
    }

    const response = await fetch(url.href, {
        credentials: "omit",
        redirect: "follow",
        referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (finalUrl.protocol !== "https:" || !isAllowedNetflixMediaHost(finalUrl.hostname)) {
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

    evictOldest(netflixTimedTextCache, MAX_NETFLIX_CACHE_ENTRIES);
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
            evictOldest(netflixTimedTextFailures, MAX_NETFLIX_FAILURE_ENTRIES);
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

function captureVisibleTab(windowId) {
    const captureOptions = { format: "jpeg", quality: 85 };
    return new Promise((resolve, reject) => {
        const callback = (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) {
                reject(chrome.runtime.lastError || new Error("No tab image available."));
            } else {
                resolve(dataUrl);
            }
        };
        try {
            if (Number.isInteger(windowId)) {
                chrome.tabs.captureVisibleTab(windowId, captureOptions, callback);
            } else {
                chrome.tabs.captureVisibleTab(captureOptions, callback);
            }
        } catch (err) {
            reject(err);
        }
    });
}

async function deleteUserAccount() {
    const token = await getSingleFlightToken(true);
    if (!token) throw new Error("No active session.");

    const res = await SharedUtils.postJson(
        LectoroConstants.ENDPOINTS.GEMINI_PROXY,
        { action: "deleteUserAccount" },
        { token },
    );
    if (!res.ok) {
        const details = await res.json().catch(() => ({}));
        throw new Error(details.error || `Account deletion error (${res.status})`);
    }

    await clearLocalUserDataAfterSignOut();
    await FirebaseSync.signOut();
    return { ok: true };
}

/** Inject the full content-script bundle into a cross-origin <video> iframe on request. */
async function enableVideoFrame(sender) {
    const target = { tabId: sender.tab.id, frameIds: [sender.frameId] };
    const manifestScripts = chrome.runtime.getManifest()?.content_scripts || [];
    const mainContentEntry = manifestScripts.find(
        (cs) => Array.isArray(cs.matches) && cs.matches.includes("*://*/*") && !cs.all_frames,
    );
    const cssFiles = mainContentEntry?.css || ["styles.css"];
    const jsFiles = mainContentEntry?.js || [];

    await chrome.scripting.insertCSS({ target, files: cssFiles });
    if (jsFiles.length) {
        await chrome.scripting.executeScript({ target, files: jsFiles });
    }
    return { ok: true };
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

// ═══════════════════════════════════════════════════════════════
//  Message router
//  Every handler is `async (message, sender) => responsePayload`.
//  A thrown error is delivered to the caller as `{ error, code?, validation? }`.
// ═══════════════════════════════════════════════════════════════

function serializeError(error) {
    const payload = { error: error?.message || String(error) };
    if (error?.code) payload.code = error.code;
    if (error?.validation) payload.validation = error.validation;
    return payload;
}

const MESSAGE_HANDLERS = Object.freeze({
    [MSG.CAPTURE_VISIBLE_TAB]: async (message, sender) => {
        const windowId = Number.isInteger(sender.tab?.windowId) ? sender.tab.windowId : null;
        const dataUrl = await captureVisibleTab(windowId)
            .catch(() => captureVisibleTab(null))
            .catch(() => null);
        return { dataUrl: dataUrl || null };
    },

    [MSG.FETCH_NETFLIX_TIMED_TEXT]: async (message, sender) => {
        if (
            !sender.tab?.url ||
            !/^https:\/\/www\.netflix\.com\//i.test(sender.tab.url) ||
            !/^\d+$/.test(String(message.movieId || ""))
        ) {
            throw new Error("Request is not from a Netflix tab.");
        }
        return fetchNetflixTimedText(message.url);
    },

    [MSG.FETCH_CONTEXT_IMAGE]: async (message) => ({
        dataUrl: await fetchContextImageDataUrl(message.url),
    }),

    [MSG.ENABLE_VIDEO_FRAME]: async (message, sender) => {
        if (!sender.tab?.id || !Number.isInteger(sender.frameId) || sender.frameId === 0) {
            throw new Error("Missing target video frame.");
        }
        return enableVideoFrame(sender);
    },

    [MSG.OPEN_PLANS]: async () => {
        await chrome.windows.create({
            url: chrome.runtime.getURL("popup.html#plans"),
            type: "popup",
            width: 520,
            height: 700,
            focused: true,
        });
        return { ok: true };
    },

    [MSG.FIREBASE_SIGN_IN]: async () => {
        const auth = await FirebaseSync.signIn();
        await fullSync();
        await initializeAiUsage(true);
        return { ok: true, email: auth.email || "" };
    },

    [MSG.FIREBASE_SIGN_OUT]: async () => {
        await fullSync({ pull: false });
        await clearLocalUserDataAfterSignOut();
        return { ok: true };
    },

    [MSG.FIREBASE_DELETE_ACCOUNT]: () => deleteUserAccount(),

    [MSG.GET_FIREBASE_TOKEN]: async (message) => {
        try {
            return { token: await getSingleFlightToken(!!message.forceRefresh) };
        } catch (error) {
            return { token: null, error: error.message };
        }
    },

    [MSG.GET_FIREBASE_USER]: async () => {
        try {
            return { user: await FirebaseSync.getUser() };
        } catch (error) {
            return { user: null, error: error.message };
        }
    },

    [MSG.FIREBASE_SYNC]: async () => ({ ok: true, ...(await fullSync()) }),

    // Deletes are journaled instead of touching Firestore immediately;
    // the next manual/automatic sync batches them.
    [MSG.FIRESTORE_DELETE]: async (message) => {
        if (!message.word) throw new Error("Missing word payload.");
        await enqueueDeletes([message.word]);
        return { ok: true, queued: true };
    },

    [MSG.FIRESTORE_DELETE_BATCH]: async (message) => {
        if (!Array.isArray(message.words)) throw new Error("Missing words payload.");
        await enqueueDeletes(message.words);
        return { ok: true, queued: true };
    },

    [MSG.GEMINI_REQUEST]: async (message) => ({
        ok: true,
        result: await GeminiProxy.request(message.prompt, message.opts),
    }),

    [MSG.GEMINI_REFRESH_USAGE]: async (message) => ({
        ok: true,
        usage: await GeminiProxy.refreshUsage(!!message.force),
    }),

    [MSG.GEMINI_UPLOAD_CARD_IMAGE]: async (message) => ({
        ok: true,
        result: await GeminiProxy.uploadCardImage(message.wordId, message.imageBase64, message.contentType),
    }),

    [MSG.GEMINI_DELETE_CARD_IMAGES]: async (message) => ({
        ok: !!(await GeminiProxy.deleteCardImage(message.wordIds)),
    }),

    [MSG.GEMINI_DELETE_ALL_USER_IMAGES]: async () => ({
        ok: true,
        deletedCount: await GeminiProxy.deleteAllUserImages(),
    }),

    [MSG.GOOGLE_TRANSLATE]: async (message) => ({
        ok: true,
        result: await SharedTranslatorService.translate(message.text, message.targetLang),
    }),

    [MSG.SUBSCRIPTION_REFRESH_PROFILE]: async (message) => ({
        ok: true,
        profile: await SubscriptionService.refreshProfile(!!message.force),
    }),

    [MSG.ELEVENLABS_SYNTHESIZE]: async (message) => {
        const blob = await SubscriptionService.synthesizeElevenLabs(
            message.text,
            message.voiceId,
            message.context || "review",
        );
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return {
            ok: true,
            base64: bytesToBase64(bytes),
            mimeType: blob.type || "audio/mpeg",
        };
    },

    [MSG.ELEVENLABS_VOICES]: async (message) => ({
        ok: true,
        voices: await SubscriptionService.getElevenLabsVoices(message.context || "review"),
    }),
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = MESSAGE_HANDLERS[message?.type];
    if (!handler) return false;

    Promise.resolve()
        .then(() => handler(message, sender))
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse(serializeError(error)));
    // Keep the message port open for the async response (MV3 requirement).
    return true;
});

updateBadge();
