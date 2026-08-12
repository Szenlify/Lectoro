/**
 * Lectoro - Audio Cache
 * Wraps IndexedDB to persistently store generated ElevenLabs audio blobs.
 */
const AudioCache = (() => {
    const DB_NAME = "LectoroAudioDB";
    const STORE_NAME = "audioBlobs";
    const DB_VERSION = 1;

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
        async get(key) {
            try {
                const db = await initDB();
                return new Promise((resolve, reject) => {
                    const transaction = db.transaction(STORE_NAME, "readonly");
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.get(key);

                    request.onsuccess = () => resolve(request.result || null);
                    request.onerror = () => reject(request.error);
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
                    const transaction = db.transaction(STORE_NAME, "readwrite");
                    const store = transaction.objectStore(STORE_NAME);
                    const request = store.put(blob, key);

                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            } catch (err) {
                console.error("[Lectoro] AudioCache set error:", err);
            }
        }
    };
})();
