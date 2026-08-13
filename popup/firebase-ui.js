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

function renderSyncUI() {
    const container = document.getElementById("syncContent");
    if (!container) return;

    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-ghost); padding:4px 0; line-height:1.6;">
                Skonfiguruj Firebase w <code style="font-size:10px; background:var(--glass-strong); padding:2px 5px; border-radius:4px;">firebase-config.js</code>, aby synchronizować słowa między urządzeniami.
            </div>`;
        return;
    }

    FirebaseSync.getUser().then((user) => {
        if (!user) {
            container.innerHTML = `
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                    Dane i ustawienia pozostają lokalne, dopóki nie uruchomisz synchronizacji Firebase.
                </div>
                <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;">
                    🔑 Zaloguj się przez Google
                </button>`;
            document.getElementById("firebaseSignIn")?.addEventListener("click", async () => {
                const button = document.getElementById("firebaseSignIn");
                button.textContent = "⏳ Logowanie...";
                button.disabled = true;
                try {
                    await sendBackgroundMessage({ type: "QT_FIREBASE_SIGN_IN" });
                    renderSyncUI();
                    loadWords();
                    maybeRefreshReviewQueue();
                    initReviewBadge();
                } catch (error) {
                    button.textContent = `✕ ${error.message || "Błąd logowania"}`;
                    button.disabled = false;
                    setTimeout(renderSyncUI, 3000);
                }
            });
            return;
        }

        chrome.storage.local.get(
            { lastFirebaseSync: null, pendingFirebaseChanges: {} },
            (data) => {
                const lastSyncText = data.lastFirebaseSync
                    ? new Date(data.lastFirebaseSync).toLocaleTimeString("pl-PL", {
                          hour: "2-digit",
                          minute: "2-digit",
                      })
                    : "nigdy";
                const pendingCount = Object.keys(data.pendingFirebaseChanges || {}).length;

                container.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <span style="color:var(--mint); font-size:13px;">✓</span>
                        <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${escapeHtml(user.email)}</span>
                    </div>
                    <div style="font-size:10px; color:var(--text-ghost); margin-bottom:10px;">
                        Ostatnia synchronizacja: ${lastSyncText}
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span class="sync-button-wrap">
                            <button id="firebaseSyncNow" class="sync-btn sync-primary">🔄 Synchronizuj</button>
                            <span class="sync-pending-dot${pendingCount ? " visible" : ""}"
                                  title="${pendingCount} niezsynchronizowanych zmian"
                                  aria-label="Niezsynchronizowane zmiany"></span>
                        </span>
                        <button id="firebaseSignOut" class="sync-btn sync-danger">Wyloguj</button>
                    </div>`;

                document.getElementById("firebaseSyncNow")?.addEventListener("click", async () => {
                    const button = document.getElementById("firebaseSyncNow");
                    button.textContent = "⏳ Synchronizuję...";
                    button.disabled = true;
                    try {
                        await sendBackgroundMessage({ type: "QT_FIREBASE_SYNC" });
                        button.textContent = "✓ Gotowe!";
                        setTimeout(() => {
                            renderSyncUI();
                            loadWords();
                            maybeRefreshReviewQueue();
                            initReviewBadge();
                        }, 700);
                    } catch (error) {
                        button.textContent = "✕ Błąd";
                        button.title = error.message;
                        button.disabled = false;
                    }
                });

                document.getElementById("firebaseSignOut")?.addEventListener("click", async () => {
                    const button = document.getElementById("firebaseSignOut");
                    button.textContent = "⏳ Synchronizuję...";
                    button.disabled = true;
                    try {
                        // The background signs out and clears local data only
                        // after Firebase confirms the complete pending batch.
                        await sendBackgroundMessage({ type: "QT_FIREBASE_SIGN_OUT" });
                        renderSyncUI();
                    } catch (error) {
                        button.textContent = "✕ Nie wylogowano";
                        button.title = error.message;
                        button.disabled = false;
                    }
                });
            },
        );
    });
}

renderSyncUI();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (
        changes.firebaseAuth ||
        changes.lastFirebaseSync ||
        changes.pendingFirebaseChanges
    ) {
        renderSyncUI();
    }
    if (changes.lastFirebaseSync) {
        loadWords();
        maybeRefreshReviewQueue();
        initReviewBadge();
    }
    if (changes.savedWords) {
        if (!_reviewSaving) maybeRefreshReviewQueue();
        initReviewBadge();
    }
});
