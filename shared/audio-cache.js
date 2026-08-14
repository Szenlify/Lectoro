/**
 * Lectoro - Audio Cache
 * Wraps IndexedDB to persistently store generated ElevenLabs audio blobs.
 */
const AudioCache = (() => {
    const DB_NAME = "LectoroAudioDB";
    const STORE_NAME = "audioBlobs";
    const META_STORE_NAME = "audioMeta";
    const TEXT_INDEX_NAME = "text";
    const DB_VERSION = 2;

    let dbPromise = null;

    function initDB() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME);
                    }
                    if (!db.objectStoreNames.contains(META_STORE_NAME)) {
                        const metaStore = db.createObjectStore(META_STORE_NAME);
                        metaStore.createIndex(TEXT_INDEX_NAME, "text", {
                            unique: false,
                        });
                    }
                };

                request.onsuccess = (event) => {
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    console.error("[Lectoro] IndexedDB open error:", event.target.error);
                    reject(event.target.error);
                };
            });
        }
        return dbPromise;
    }

    return {
        async get(key, { notBefore = 0 } = {}) {
            try {
                const db = await initDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(
                        [STORE_NAME, META_STORE_NAME],
                        "readonly",
                    );
                    const blobRequest = transaction
                        .objectStore(STORE_NAME)
                        .get(key);
                    const metaRequest = transaction
                        .objectStore(META_STORE_NAME)
                        .get(key);

                    transaction.oncomplete = () => {
                        const createdAt = Number(
                            metaRequest.result?.createdAt || 0,
                        );
                        resolve(
                            createdAt >= Number(notBefore || 0)
                                ? blobRequest.result || null
                                : null,
                        );
                    };
                    transaction.onerror = () => reject(transaction.error);
                });
            } catch (err) {
                console.error("[Lectoro] AudioCache get error:", err);
                return null;
            }
        },

        async set(key, blob) {
            try {
                const db = await initDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(
                        [STORE_NAME, META_STORE_NAME],
                        "readwrite",
                    );
                    const separator = key.lastIndexOf("|");
                    const text = separator >= 0 ? key.slice(0, separator) : key;
                    const voiceId =
                        separator >= 0 ? key.slice(separator + 1) : "";
                    transaction.objectStore(STORE_NAME).put(blob, key);
                    transaction.objectStore(META_STORE_NAME).put(
                        { text, voiceId, createdAt: Date.now() },
                        key,
                    );

                    transaction.oncomplete = () => resolve();
                    transaction.onerror = () => reject(transaction.error);
                });
            } catch (err) {
                console.error("[Lectoro] AudioCache set error:", err);
            }
        },

        /** Return the newest cached ElevenLabs recording for this exact text,
         * regardless of which voice is currently selected. */
        async findByText(text, { notBefore = 0 } = {}) {
            try {
                const db = await initDB();
                const candidates = await new Promise((resolve, reject) => {
                    const transaction = db.transaction(
                        META_STORE_NAME,
                        "readonly",
                    );
                    const index = transaction
                        .objectStore(META_STORE_NAME)
                        .index(TEXT_INDEX_NAME);
                    const request = index.getAll(IDBKeyRange.only(text));
                    const keysRequest = index.getAllKeys(
                        IDBKeyRange.only(text),
                    );
                    transaction.oncomplete = () => {
                        resolve(
                            (request.result || []).map((meta, index) => ({
                                key: keysRequest.result?.[index],
                                ...meta,
                            })),
                        );
                    };
                    transaction.onerror = () => reject(transaction.error);
                });

                const newest = candidates
                    .filter(
                        (entry) =>
                            entry.key &&
                            Number(entry.createdAt || 0) >=
                                Number(notBefore || 0),
                    )
                    .sort(
                        (a, b) =>
                            Number(b.createdAt || 0) -
                            Number(a.createdAt || 0),
                    )[0];
                if (newest) {
                    const blob = await this.get(newest.key, { notBefore });
                    if (blob) return { blob, voiceId: newest.voiceId || "" };
                }

                // Backward compatibility for blobs saved before metadata was
                // introduced. They are eligible only for unedited cards.
                if (Number(notBefore || 0) > 0) return null;
                const prefix = `${text}|`;
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME, "readonly");
                    const request = transaction
                        .objectStore(STORE_NAME)
                        .openCursor();
                    request.onsuccess = () => {
                        const cursor = request.result;
                        if (!cursor) {
                            resolve(null);
                            return;
                        }
                        const key = String(cursor.key || "");
                        if (key.startsWith(prefix)) {
                            resolve({
                                blob: cursor.value,
                                voiceId: key.slice(prefix.length),
                            });
                            return;
                        }
                        cursor.continue();
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error("[Lectoro] AudioCache findByText error:", err);
                return null;
            }
        },
    };
})();
