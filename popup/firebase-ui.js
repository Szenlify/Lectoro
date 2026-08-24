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
        ? SharedUtils.escapeHtml(String(value || ""))
        : String(value || "")
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}

function refreshViewsAfterSync() {
    if (typeof loadWords === "function") loadWords();
    if (typeof maybeRefreshReviewQueue === "function") maybeRefreshReviewQueue();
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
                Skonfiguruj Firebase w <code style="font-size:10px; background:var(--glass-strong); padding:2px 5px; border-radius:4px;">firebase-config.js</code>, aby synchronizować słowa między urządzeniami.
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
                Nie udało się odczytać stanu synchronizacji: ${escapeSyncHtml(error.message)}
            </div>
            <button id="firebaseSyncRetry" class="sync-btn sync-primary" style="width:100%;">
                Spróbuj ponownie
            </button>`;
        document.getElementById("firebaseSyncRetry")?.addEventListener("click", renderSyncUI);
        return;
    }

    if (renderRevision !== firebaseUiRenderRevision || !container.isConnected) return;

    if (!user) {
        const signingIn = firebaseUiAction === "sign-in";
        const signedOutStatusHtml = firebaseUiFeedback
            ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
            : "";
        container.innerHTML = `
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                Dane i ustawienia pozostają lokalne, dopóki nie uruchomisz synchronizacji Firebase.
            </div>
            <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;" ${signingIn ? "disabled" : ""}>
                ${signingIn ? "⏳ Logowanie..." : "🔑 Zaloguj się przez Google"}
            </button>
            ${signedOutStatusHtml}`;
        document.getElementById("firebaseSignIn")?.addEventListener("click", async () => {
            if (firebaseUiAction) return;
            firebaseUiAction = "sign-in";
            firebaseUiFeedback = null;
            renderSyncUI();
            try {
                await sendBackgroundMessage({ type: "QT_FIREBASE_SIGN_IN" });
                firebaseUiAction = null;
                refreshViewsAfterSync();
                showFirebaseFeedback("success", "Zalogowano i zsynchronizowano dane.");
            } catch (error) {
                firebaseUiAction = null;
                showFirebaseFeedback("error", error.message || "Błąd logowania", 0);
            }
        });
        return;
    }

    const lastSyncText = typeof SharedUtils !== "undefined" && SharedUtils.formatTime
        ? SharedUtils.formatTime(data.lastFirebaseSync)
        : (data.lastFirebaseSync ? new Date(data.lastFirebaseSync).toLocaleTimeString("pl-PL") : "nigdy");
    const pendingCount = Object.keys(data.pendingFirebaseChanges || {}).length;
    const syncing = firebaseUiAction === "sync" || firebaseUiAction === "sign-in";
    const signingOut = firebaseUiAction === "sign-out";
    const deletingAccount = firebaseUiAction === "delete-account";
    const syncButtonText = syncing
        ? "⏳ Synchronizuję..."
        : firebaseUiFeedback?.type === "success"
          ? "✓ Gotowe!"
          : firebaseUiFeedback?.type === "error"
            ? "↻ Spróbuj ponownie"
            : "🔄 Synchronizuj";
    const statusHtml = firebaseUiFeedback
        ? `<div class="sync-status sync-status-${firebaseUiFeedback.type}">${escapeSyncHtml(firebaseUiFeedback.message)}</div>`
        : data.lastFirebaseSyncError
          ? `<div class="sync-status sync-status-error">Ostatni błąd: ${escapeSyncHtml(data.lastFirebaseSyncError)}</div>`
          : "";

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <span style="color:var(--mint); font-size:13px;">✓</span>
            <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${escapeSyncHtml(user.email)}</span>
        </div>
        <div style="font-size:10px; color:var(--text-ghost); margin-bottom:10px;">
            Ostatnia synchronizacja: ${lastSyncText}
        </div>
        <div class="sync-actions">
            <span class="sync-button-wrap">
                <button id="firebaseSyncNow" class="sync-btn sync-primary" ${syncing || signingOut || deletingAccount ? "disabled" : ""}>${syncButtonText}</button>
                <span class="sync-pending-dot${pendingCount ? " visible" : ""}"
                      title="${pendingCount} niezsynchronizowanych zmian"
                      aria-label="Niezsynchronizowane zmiany"></span>
            </span>
            <button id="firebaseSignOut" class="sync-btn" ${firebaseUiAction ? "disabled" : ""}>
                ${signingOut ? "⏳ Wylogowuję..." : "Wyloguj"}
            </button>
            <button id="firebaseDeleteAccount" class="sync-btn sync-danger" ${firebaseUiAction ? "disabled" : ""} title="Bezpowrotnie usuń konto i wszystkie dane w chmurze">
                ${deletingAccount ? "⏳ Usuwam..." : "Usuń konto"}
            </button>
        </div>
        ${statusHtml}`;

    document.getElementById("firebaseSyncNow")?.addEventListener("click", async () => {
        if (firebaseUiAction) return;
        firebaseUiAction = "sync";
        firebaseUiFeedback = null;
        clearTimeout(firebaseUiFeedbackTimer);
        renderSyncUI();
        try {
            const result = await sendBackgroundMessage({ type: "QT_FIREBASE_SYNC" });
            firebaseUiAction = null;
            refreshViewsAfterSync();
            const sent = Number(result.sent || 0);
            const pulled = Number(result.pulled || 0);
            const message = sent || pulled
                ? `Gotowe — wysłano ${sent}, pobrano ${pulled}.`
                : "Wszystkie dane są już zsynchronizowane.";
            showFirebaseFeedback("success", message);
        } catch (error) {
            firebaseUiAction = null;
            showFirebaseFeedback("error", error.message || "Synchronizacja nie powiodła się.", 0);
        }
    });

    document.getElementById("firebaseSignOut")?.addEventListener("click", async () => {
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
            showFirebaseFeedback("error", error.message || "Nie udało się wylogować.", 0);
        }
    });

    document.getElementById("firebaseDeleteAccount")?.addEventListener("click", async () => {
        if (firebaseUiAction) return;
        const confirmed = confirm(
            "Czy na pewno chcesz bezpowrotnie usunąć swoje konto Lectoro oraz wszystkie zsynchronizowane słówka i zrzuty ekranu w chmurze?\n\nTej operacji nie można cofnąć."
        );
        if (!confirmed) return;

        firebaseUiAction = "delete-account";
        firebaseUiFeedback = null;
        clearTimeout(firebaseUiFeedbackTimer);
        renderSyncUI();
        try {
            await sendBackgroundMessage({ type: "QT_FIREBASE_DELETE_ACCOUNT" });
            firebaseUiAction = null;
            renderSyncUI();
            refreshViewsAfterSync();
            showFirebaseFeedback("success", "Konto i dane w chmurze zostały bezpowrotnie usunięte.");
        } catch (error) {
            firebaseUiAction = null;
            showFirebaseFeedback("error", error.message || "Nie udało się usunąć konta.", 0);
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
        const wordsTabActive = document.getElementById("tab-words")?.classList.contains("active");
        if (wordsTabActive && typeof loadWords === "function") loadWords();
        if (typeof maybeRefreshReviewQueue === "function") maybeRefreshReviewQueue();
        if (typeof initReviewBadge === "function") initReviewBadge();
    }
    if (changes.savedWords) {
        if (typeof _reviewSaving !== "undefined" && !_reviewSaving && typeof maybeRefreshReviewQueue === "function") {
            maybeRefreshReviewQueue();
        }
        if (typeof initReviewBadge === "function") initReviewBadge();
    }
});
