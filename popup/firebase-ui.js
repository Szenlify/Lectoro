// Firebase cloud sync UI
function sendBackgroundMessage(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (response?.error) {
                reject(new Error(response.error));
                return;
            }
            resolve(response || {});
        });
    });
}

const FIREBASE_SYNC_STATE_DEFAULTS = Object.freeze({
    lastFirebaseSync: null,
    lastFirebaseSyncError: null,
    pendingFirebaseChanges: {},
});

let firebaseUiRenderRevision = 0;
let firebaseUiAction = null;
let firebaseUiFeedback = null;
let firebaseUiFeedbackTimer = null;

function escapeSyncHtml(value) {
    return typeof SharedUtils !== "undefined" && SharedUtils.escapeHtml
        ? SharedUtils.escapeHtml(value)
        : String(value || "");
}

function refreshViewsAfterSync() {
    if (typeof loadWords === "function") loadWords();
    if (typeof maybeRefreshReviewQueue === "function")
        maybeRefreshReviewQueue();
    if (typeof initReviewBadge === "function") initReviewBadge();
}

function showFirebaseFeedback(type, message, duration = 2200) {
    clearTimeout(firebaseUiFeedbackTimer);
    firebaseUiFeedback = { type, message };
    renderSyncUI();
    if (duration > 0) {
        firebaseUiFeedbackTimer = setTimeout(() => {
            firebaseUiFeedback = null;
            renderSyncUI();
        }, duration);
    }
}

async function renderSyncUI() {
    const container = document.getElementById("syncContent");
    if (!container) return;
    const renderRevision = ++firebaseUiRenderRevision;

    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-ghost); padding:4px 0; line-height:1.6;">
                Configure Firebase in <code style="font-size:10px; background:var(--glass-strong); padding:2px 5px; border-radius:4px;">firebase-config.js</code> to sync words across devices.
            </div>`;
        return;
    }

    let user;
    let data;
    try {
        [user, data] = await Promise.all([
            FirebaseSync.getUser(),
            chrome.storage.local.get(FIREBASE_SYNC_STATE_DEFAULTS),
        ]);
    } catch (error) {
        if (renderRevision !== firebaseUiRenderRevision) return;
        container.innerHTML = `
            <div class="sync-status sync-status-error">
                Failed to read sync state: ${escapeSyncHtml(error.message)}
            </div>
            <button id="firebaseSyncRetry" class="sync-btn sync-primary" style="width:100%;">
                Retry
            </button>`;
        document
            .getElementById("firebaseSyncRetry")
            ?.addEventListener("click", renderSyncUI);
        return;
    }

    if (renderRevision !== firebaseUiRenderRevision || !container.isConnected)
        return;

    if (!user) {
        const signingIn = firebaseUiAction === "sign-in";
        const signedOutStatusHtml = firebaseUiFeedback
            ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
            : "";
        container.innerHTML = `
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                Data and settings remain local until you sign in with Firebase.
            </div>
            <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;" ${signingIn ? "disabled" : ""}>
                ${signingIn ? "⏳ Signing in..." : "🔑 Sign in with Google"}
            </button>
            ${signedOutStatusHtml}`;
        document
            .getElementById("firebaseSignIn")
            ?.addEventListener("click", async () => {
                if (firebaseUiAction) return;
                firebaseUiAction = "sign-in";
                firebaseUiFeedback = null;
                renderSyncUI();
                try {
                    await sendBackgroundMessage({
                        type: "QT_FIREBASE_SIGN_IN",
                    });
                    firebaseUiAction = null;
                    refreshViewsAfterSync();
                    showFirebaseFeedback(
                        "success",
                        "Signed in and data synced.",
                    );
                } catch (error) {
                    firebaseUiAction = null;
                    showFirebaseFeedback(
                        "error",
                        error.message || "Sign in error",
                        0,
                    );
                }
            });
        return;
    }

    const lastSyncText =
        typeof SharedUtils !== "undefined" && SharedUtils.formatTime
            ? SharedUtils.formatTime(data.lastFirebaseSync)
            : data.lastFirebaseSync
              ? new Date(data.lastFirebaseSync).toLocaleTimeString("en-US")
              : "never";
    const syncing =
        firebaseUiAction === "sync" || firebaseUiAction === "sign-in";
    const signingOut = firebaseUiAction === "sign-out";
    const deletingAccount = firebaseUiAction === "delete-account";
    const syncButtonText = syncing
        ? "⏳ Syncing..."
        : firebaseUiFeedback?.type === "success"
          ? "✓ Done!"
          : firebaseUiFeedback?.type === "error"
            ? "↻ Retry"
            : "🔄 Sync";
    const statusHtml = firebaseUiFeedback
        ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
        : data.lastFirebaseSyncError
          ? `<div class="sync-status sync-status-error">Last error: ${escapeSyncHtml(data.lastFirebaseSyncError)}</div>`
          : "";

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="color:var(--mint); font-size:13px;">✓</span>
            <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${escapeSyncHtml(user.email)}</span>
        </div>
        <div style="font-size:10px; color:var(--text-ghost); margin-bottom:10px;">
            Last synced: ${lastSyncText}
        </div>
        <div class="sync-actions">
            <span class="sync-button-wrap">
                <button id="firebaseSyncNow" class="sync-btn sync-primary" ${syncing || signingOut || deletingAccount ? "disabled" : ""}>${syncButtonText}</button>
            </span>
            <button id="firebaseSignOut" class="sync-btn" ${firebaseUiAction ? "disabled" : ""}>
                ${signingOut ? "⏳ Signing out..." : "Sign out"}
            </button>
            <button id="firebaseDeleteAccount" class="sync-btn sync-danger" ${firebaseUiAction ? "disabled" : ""} title="Permanently delete account and all cloud data">
                ${deletingAccount ? "⏳ Deleting..." : "Delete account"}
            </button>
        </div>
        ${statusHtml}`;

    document
        .getElementById("firebaseSyncNow")
        ?.addEventListener("click", async () => {
            if (firebaseUiAction) return;
            firebaseUiAction = "sync";
            firebaseUiFeedback = null;
            clearTimeout(firebaseUiFeedbackTimer);
            renderSyncUI();
            try {
                const result = await sendBackgroundMessage({
                    type: "QT_FIREBASE_SYNC",
                });
                firebaseUiAction = null;
                refreshViewsAfterSync();
                const sent = Number(result.sent || 0);
                const pulled = Number(result.pulled || 0);
                const message =
                    sent || pulled
                        ? `Done — uploaded ${sent}, downloaded ${pulled}.`
                        : "All data is already in sync.";
                showFirebaseFeedback("success", message);
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback(
                    "error",
                    error.message || "Sync failed.",
                    0,
                );
            }
        });

    document
        .getElementById("firebaseSignOut")
        ?.addEventListener("click", async () => {
            if (firebaseUiAction) return;
            firebaseUiAction = "sign-out";
            firebaseUiFeedback = null;
            clearTimeout(firebaseUiFeedbackTimer);
            renderSyncUI();
            try {
                await sendBackgroundMessage({ type: "QT_FIREBASE_SIGN_OUT" });
                firebaseUiAction = null;
                renderSyncUI();
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback(
                    "error",
                    error.message || "Failed to sign out.",
                    0,
                );
            }
        });

    document
        .getElementById("firebaseDeleteAccount")
        ?.addEventListener("click", async () => {
            if (firebaseUiAction) return;
            const confirmed = confirm(
                "Are you sure you want to permanently delete your Lectoro account and all synced words and screenshots in the cloud?\n\nThis action cannot be undone.",
            );
            if (!confirmed) return;

            firebaseUiAction = "delete-account";
            firebaseUiFeedback = null;
            clearTimeout(firebaseUiFeedbackTimer);
            renderSyncUI();
            try {
                await sendBackgroundMessage({
                    type: "QT_FIREBASE_DELETE_ACCOUNT",
                });
                firebaseUiAction = null;
                renderSyncUI();
                refreshViewsAfterSync();
                showFirebaseFeedback(
                    "success",
                    "Account and cloud data have been permanently deleted.",
                );
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback(
                    "error",
                    error.message || "Failed to delete account.",
                    0,
                );
            }
        });
}

renderSyncUI();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
        changes.firebaseAuth ||
        changes.lastFirebaseSync ||
        changes.lastFirebaseSyncError ||
        changes.pendingFirebaseChanges
    ) {
        renderSyncUI();
    }
    if (changes.lastFirebaseSync) {
        const wordsTabActive = document
            .getElementById("tab-words")
            ?.classList.contains("active");
        if (wordsTabActive && typeof loadWords === "function") loadWords();
        if (typeof maybeRefreshReviewQueue === "function")
            maybeRefreshReviewQueue();
        if (typeof initReviewBadge === "function") initReviewBadge();
    }
    if (changes.savedWords) {
        if (
            typeof _reviewSaving !== "undefined" &&
            !_reviewSaving &&
            typeof maybeRefreshReviewQueue === "function"
        ) {
            maybeRefreshReviewQueue();
        }
        if (typeof initReviewBadge === "function") initReviewBadge();
    }
});
