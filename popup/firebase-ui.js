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
    const accountDeletion = document.getElementById("accountDeletion");
    if (accountDeletion) {
        accountDeletion.hidden = true;
        accountDeletion.innerHTML = "";
    }

    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-ghost); padding:4px 0; line-height:1.6;">
                ${escapeSyncHtml(SharedI18n.t("ui_cloud_unavailable"))}
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
                ${escapeSyncHtml(SharedI18n.errorMessage(error, "sync_failed"))}
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

    const lang = (typeof SharedI18n !== "undefined" && SharedI18n.getLang) ? SharedI18n.getLang() : "en";
    const t = (k, p) => (typeof SharedI18n !== "undefined" ? SharedI18n.t(k, lang, p) : k);

    if (!user) {
        const signingIn = firebaseUiAction === "sign-in";
        const signedOutStatusHtml = firebaseUiFeedback
            ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
            : "";
        container.innerHTML = `
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                ${t("cloud_sync_desc")}
            </div>
            <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;" ${signingIn ? "disabled" : ""}>
                ${signingIn ? t("signing_in") : t("sign_in_google")}
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
                        t("signed_in_feedback"),
                    );
                } catch (error) {
                    firebaseUiAction = null;
                    showFirebaseFeedback(
                        "error",
                        SharedI18n.errorMessage(error, "sign_in_error"),
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
              ? new Date(data.lastFirebaseSync).toLocaleTimeString(lang)
              : t("never_synced");
    const syncing =
        firebaseUiAction === "sync" || firebaseUiAction === "sign-in";
    const signingOut = firebaseUiAction === "sign-out";
    const deletingAccount = firebaseUiAction === "delete-account";
    const syncButtonText = syncing
        ? t("syncing")
        : firebaseUiFeedback?.type === "success"
          ? t("sync_done")
          : firebaseUiFeedback?.type === "error"
            ? t("sync_retry")
            : t("sync_now");
    const statusHtml = firebaseUiFeedback
        ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
        : data.lastFirebaseSyncError
          ? `<div class="sync-status sync-status-error">${escapeSyncHtml(SharedI18n.errorMessage(data.lastFirebaseSyncError, "sync_failed"))}</div>`
          : "";

    container.innerHTML = `
        <div class="sync-account-row">
            <div class="sync-account-details">
                <div class="sync-account-email"><span class="sync-account-check" aria-hidden="true">✓</span><span>${escapeSyncHtml(user.email)}</span></div>
                <div class="sync-last-updated">${t("last_synced", { time: lastSyncText })}</div>
            </div>
            <div class="sync-actions">
                <button id="firebaseSyncNow" class="sync-btn sync-primary" ${syncing || signingOut || deletingAccount ? "disabled" : ""}>${syncButtonText}</button>
                <button id="firebaseSignOut" class="sync-btn" ${firebaseUiAction ? "disabled" : ""}>
                    ${signingOut ? t("signing_out") : t("sign_out")}
                </button>
            </div>
        </div>
        ${statusHtml}`;

    if (accountDeletion) {
        accountDeletion.hidden = false;
        accountDeletion.innerHTML = `
            <p id="accountDeletionDescription">${t("delete_account_desc")}</p>
            ${firebaseUiFeedback?.type === "error" ? `<div class="sync-status sync-status-error" role="alert">${escapeSyncHtml(firebaseUiFeedback.message)}</div>` : ""}<button id="firebaseDeleteAccount" class="account-delete-btn" ${firebaseUiAction ? "disabled" : ""} aria-describedby="accountDeletionDescription">
                ${deletingAccount ? t("deleting_account") : t("delete_account")}
            </button>`;
    }

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
                        ? t("sync_done_summary", { sent, pulled })
                        : t("sync_all_synced");
                showFirebaseFeedback("success", message);
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback(
                    "error",
                    SharedI18n.errorMessage(error, "sync_failed"),
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
                    SharedI18n.errorMessage(error, "failed_sign_out"),
                    0,
                );
            }
        });

    document
        .getElementById("firebaseDeleteAccount")
        ?.addEventListener("click", async () => {
            if (firebaseUiAction) return;
            const confirmed = confirm(
                t("delete_account_confirm"),
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
                    t("account_deleted_feedback"),
                );
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback(
                    "error",
                    SharedI18n.errorMessage(error, "account_delete_failed"),
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

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.targetLang) {
        firebaseUiFeedback = null;
        void renderSyncUI();
    }
});
