// ── Firebase Cloud Sync UI ────────────────────────────────────────
function renderSyncUI() {
    const container = document.getElementById("syncContent");
    if (!container) return;

    // Not configured
    if (typeof FirebaseSync === "undefined" || !FirebaseSync.isConfigured()) {
        container.innerHTML = `
            <div style="font-size:11px; color:var(--text-ghost); padding:4px 0; line-height:1.6;">
                Skonfiguruj Firebase w <code style="font-size:10px; background:var(--glass-strong); padding:2px 5px; border-radius:4px;">firebase-config.js</code> aby synchronizować słowa między urządzeniami.
            </div>`;
        return;
    }

    FirebaseSync.getUser().then((user) => {
        if (user) {
            // Signed in
            chrome.storage.local.get({ lastFirebaseSync: null }, (data) => {
                const lastSync = data.lastFirebaseSync;
                const lastSyncText = lastSync
                    ? new Date(lastSync).toLocaleTimeString("pl-PL", {
                          hour: "2-digit",
                          minute: "2-digit",
                      })
                    : "nigdy";

                container.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                        <span style="color:var(--mint); font-size:13px;">✓</span>
                        <span style="font-size:12px; color:var(--text-secondary); font-weight:500;">${escapeHtml(user.email)}</span>
                    </div>
                    <div style="font-size:10px; color:var(--text-ghost); margin-bottom:10px;">
                        Ostatnia synchronizacja: ${lastSyncText}
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button id="firebaseSyncNow" class="sync-btn sync-primary">🔄 Synchronizuj</button>
                        <button id="firebaseSignOut" class="sync-btn sync-danger">Wyloguj</button>
                    </div>`;

                document
                    .getElementById("firebaseSyncNow")
                    ?.addEventListener("click", async () => {
                        const btn = document.getElementById("firebaseSyncNow");
                        btn.textContent = "⏳ Synchronizuję...";
                        btn.disabled = true;
                        try {
                            await chrome.runtime.sendMessage({
                                type: "QT_FIREBASE_SYNC",
                            });
                            btn.textContent = "✓ Gotowe!";
                            setTimeout(() => {
                                renderSyncUI();
                                loadWords();
                                maybeRefreshReviewQueue();
                                initReviewBadge();
                            }, 1200);
                        } catch (e) {
                            btn.textContent = "✗ Błąd";
                            setTimeout(() => renderSyncUI(), 2000);
                        }
                    });

                document
                    .getElementById("firebaseSignOut")
                    ?.addEventListener("click", async () => {
                        chrome.runtime.sendMessage({
                            type: "QT_FIREBASE_SIGN_OUT",
                        });
                        // Clear local auth too so UI updates instantly
                        await FirebaseSync.signOut();
                        renderSyncUI();
                    });
            });
        } else {
            // Not signed in
            container.innerHTML = `
                <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px; line-height:1.5;">
                    Synchronizuj słowa i powtórki między urządzeniami.
                </div>
                <button id="firebaseSignIn" class="sync-btn sync-primary" style="width:100%;">
                    🔑 Zaloguj się przez Google
                </button>`;

            document
                .getElementById("firebaseSignIn")
                ?.addEventListener("click", async () => {
                    const btn = document.getElementById("firebaseSignIn");
                    btn.textContent = "⏳ Logowanie...";
                    btn.disabled = true;
                    try {
                        // Send sign-in to background service worker.
                        // The popup may close when the OAuth window opens –
                        // the service worker keeps running and saves auth data.
                        chrome.runtime.sendMessage(
                            { type: "QT_FIREBASE_SIGN_IN" },
                            (response) => {
                                // This callback runs ONLY if popup stayed open
                                if (chrome.runtime.lastError) return;
                                if (response?.ok) {
                                    renderSyncUI();
                                    loadWords();
                                    maybeRefreshReviewQueue();
                                    initReviewBadge();
                                } else if (response?.error) {
                                    btn.textContent = "✗ " + response.error;
                                    btn.disabled = false;
                                    setTimeout(() => renderSyncUI(), 3000);
                                }
                            },
                        );
                    } catch (e) {
                        console.error("[Lectoro] Sign in error:", e);
                        btn.textContent =
                            "✗ " + (e.message || "Błąd logowania");
                        btn.disabled = false;
                        setTimeout(() => renderSyncUI(), 3000);
                    }
                });
        }
    });
}

// Render sync UI on popup load (handles case where user completed auth
// while popup was closed – will show logged-in state immediately)
renderSyncUI();

// Also listen for auth changes while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.firebaseAuth) {
        renderSyncUI();
    }
    if (area === "local" && changes.lastFirebaseSync) {
        renderSyncUI();
        loadWords();
        maybeRefreshReviewQueue();
        initReviewBadge();
    }
    if (area === "local" && changes.savedWords) {
        // Refresh review queue whenever words change (e.g. synced SR data)
        // But skip if the change came from rating a word in the current session
        if (!_reviewSaving) {
            maybeRefreshReviewQueue();
        }
        initReviewBadge();
    }
});