/** Versioned R2 data only. This module runs in the extension service worker. */
(function (root) {
    "use strict";
    const BASE_URL = "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/dictionaries/";
    const MAX_PACK_BYTES = 32 * 1024 * 1024;
    const MAX_CACHE_BYTES = 128 * 1024 * 1024;
    const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
    const RETRY_INTERVAL = 5 * 60 * 1000;
    const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    const validText = (value, max = 200) => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);

    function validatePack(pack, source, target, version) {
        // Compact files contain only word -> {t,d,s,e}; identity comes from the
        // checksum-verified catalog. Keep them compact in IndexedDB as well.
        if (isObject(pack) && pack.schemaVersion === undefined) {
            const terms = Object.entries(pack);
            if (!terms.length || terms.length > 200000) throw new Error("Invalid compact dictionary count");
            const single = (s) => validText(s, 80) && /^[\p{L}\p{M}]+$/u.test(s);
            for (const [word, entry] of terms) {
                const legacy = Array.isArray(entry?.e) && entry.e.every(e => typeof e === "string");
                if (!validText(word, 80) || !isObject(entry) || Object.keys(entry).sort().join() !== "d,e,s,t" ||
                    !single(entry.t) || !validText(entry.d, 300) ||
                    !Array.isArray(entry.s) || entry.s.length > (legacy ? 4 : 3) ||
                    !entry.s.every(s => validText(s, 80)) || new Set(entry.s.map(s => s.toLowerCase())).size !== entry.s.length ||
                    !Array.isArray(entry.e) || entry.e.length !== 3 || !entry.e.every(e => legacy ? validText(e, 300) :
                        isObject(e) && Object.keys(e).sort().join() === "source,target" && validText(e.source, 300) && validText(e.target, 300)) ||
                    new Set(entry.e.map(e => (legacy ? e : e.source).toLowerCase())).size !== entry.e.length) {
                    throw new Error("Invalid compact dictionary entry");
                }
            }
            return { schemaVersion: 2, sourceLanguage: source, targetLanguage: target, version, entries: pack };
        }
        if (pack?.schemaVersion === 2) {
            if (pack.sourceLanguage !== source || pack.targetLanguage !== target || pack.version !== version) throw new Error("Dictionary identity mismatch");
            if (!isObject(pack.entries) || pack.entries.schemaVersion !== undefined) throw new Error("Invalid compact dictionary data");
            return validatePack(pack.entries, source, target, version);
        }
        if (!isObject(pack) || pack.schemaVersion !== 1 || pack.sourceLanguage !== source || pack.targetLanguage !== target || pack.version !== version) {
            throw new Error("Dictionary identity mismatch");
        }
        if (!isObject(pack.entries) || !isObject(pack.forms || {})) throw new Error("Invalid dictionary data");
        const terms = Object.entries(pack.entries);
        if (!terms.length || terms.length > 200000) throw new Error("Invalid dictionary entry count");
        for (const [term, senses] of terms) {
            if (!validText(term) || !Array.isArray(senses) || !senses.length || senses.length > 32) throw new Error("Invalid dictionary entry");
            for (const sense of senses) {
                if (!isObject(sense) || !validText(sense.senseId) || !Array.isArray(sense.translations) || !sense.translations.length || sense.translations.length > 16 || !sense.translations.every((t) => validText(t, 500))) {
                    throw new Error("Invalid dictionary sense");
                }
                for (const [field, limit] of [["definition", 500], ["partOfSpeech", 50], ["reviewStatus", 200]]) {
                    if (sense[field] !== undefined && !validText(sense[field], limit)) throw new Error("Invalid dictionary sense metadata");
                }
                if (sense.examples !== undefined && (!Array.isArray(sense.examples) || sense.examples.length > 4 ||
                    !sense.examples.every((example) => isObject(example) && validText(example.source, 500) && validText(example.target, 500)))) {
                    throw new Error("Invalid dictionary examples");
                }
            }
        }
        if (pack.primaryTranslations !== undefined) {
            if (!isObject(pack.primaryTranslations) || Object.keys(pack.primaryTranslations).length > 200000) throw new Error("Invalid primary translations");
            for (const [term, value] of Object.entries(pack.primaryTranslations)) {
                if (!validText(value, 500) || !Object.hasOwn(pack.entries, term) || !pack.entries[term].some((sense) => sense.translations.includes(value))) throw new Error("Invalid primary translation");
            }
        }
        const forms = Object.entries(pack.forms || {});
        if (forms.length > 400000) throw new Error("Too many dictionary forms");
        for (const [form, lemmas] of forms) {
            if (!validText(form) || !Array.isArray(lemmas) || !lemmas.length || lemmas.length > 16 || !lemmas.every((lemma) => typeof lemma === "string" && Object.hasOwn(pack.entries, lemma))) {
                throw new Error("Invalid dictionary form");
            }
        }
        return pack;
    }

    function validateCatalog(catalog) {
        if (!isObject(catalog) || catalog.schemaVersion !== 1 || !isObject(catalog.pairs) || Object.keys(catalog.pairs).length > 500) throw new Error("Invalid dictionary catalog");
        for (const [pair, item] of Object.entries(catalog.pairs)) {
            if (!/^[a-z]{2,3}-[a-z]{2,3}$/.test(pair) || !isObject(item) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(item.version) ||
                item.path !== `releases/${item.version}/${pair}.json` || !/^[a-f0-9]{64}$/.test(item.sha256) ||
                !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > MAX_PACK_BYTES ||
                !Number.isSafeInteger(item.entryCount) || item.entryCount < 1 || item.entryCount > 200000) throw new Error("Invalid catalog package");
        }
        return catalog;
    }

    function createPersistence() {
        let opening;
        function open() {
            if (!opening) {
                opening = new Promise((resolve, reject) => {
                    if (!root.indexedDB) return reject(new Error("IndexedDB unavailable"));
                    const request = root.indexedDB.open("lectoro-dictionaries", 1);
                    request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "key" });
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        const db = request.result;
                        db.onversionchange = () => { db.close(); opening = null; };
                        resolve(db);
                    };
                }).catch((error) => { opening = null; throw error; });
            }
            return opening;
        }
        return {
            async get(key) {
                const db = await open();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction("records", "readonly");
                    const request = tx.objectStore("records").get(key);
                    tx.oncomplete = () => resolve(request.result || null);
                    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Dictionary read failed"));
                });
            },
            async put(record) {
                const db = await open();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction("records", "readwrite");
                    const store = tx.objectStore("records");
                    // Metadata only: do not clone all dictionary bodies to implement eviction.
                    const records = [];
                    const cursor = store.openCursor();
                    cursor.onsuccess = () => {
                        const current = cursor.result;
                        if (current) {
                            const { key, bytes = 0, lastUsed = 0 } = current.value;
                            if (key !== record.key && key !== "catalog") records.push({ key, bytes, lastUsed });
                            current.continue();
                            return;
                        }
                        let total = records.reduce((sum, item) => sum + item.bytes, record.bytes || 0);
                        for (const item of records.sort((a, b) => a.lastUsed - b.lastUsed)) {
                            if (total <= MAX_CACHE_BYTES) break;
                            store.delete(item.key);
                            total -= item.bytes;
                        }
                        store.put(record);
                    };
                    tx.oncomplete = () => resolve();
                    tx.onabort = tx.onerror = () => reject(tx.error || new Error("Dictionary write failed"));
                });
            },
        };
    }

    function createStore({ persistence = createPersistence(), fetcher = (...args) => root.fetch(...args), now = Date.now } = {}) {
        const active = new Map();
        let catalogPromise, catalogUntil = 0;

        async function fetchBytes(path, limit) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            try {
                const response = await fetcher(BASE_URL + path, { signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-cache" });
                if (!response.ok) throw new Error(`Dictionary HTTP ${response.status}`);
                const declared = Number(response.headers.get("content-length"));
                if (declared > limit) throw new Error("Dictionary download too large");
                const reader = response.body.getReader();
                const chunks = [];
                let length = 0;
                try {
                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;
                        length += value.byteLength;
                        if (length > limit) throw new Error("Dictionary download too large");
                        chunks.push(value);
                    }
                } catch (error) {
                    await reader.cancel().catch(() => {});
                    throw error;
                } finally { reader.releaseLock(); }
                const bytes = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
                return bytes;
            } finally { clearTimeout(timer); }
        }

        const decode = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        const read = (key) => persistence.get(key).catch(() => null);
        const save = (record) => persistence.put(record).catch(() => {
            // Quota failures must not discard a successfully verified in-memory pack.
            root.console?.warn("Dictionary could not be saved for offline use.");
        });

        async function loadCatalog() {
            if (catalogPromise && now() < catalogUntil) return catalogPromise;
            catalogUntil = now() + CHECK_INTERVAL;
            catalogPromise = (async () => {
                const saved = await read("catalog");
                let previous;
                try { if (saved?.data) previous = validateCatalog(saved.data); } catch (_) {}
                if (previous && now() - saved.checkedAt < CHECK_INTERVAL) {
                    catalogUntil = saved.checkedAt + CHECK_INTERVAL;
                    return previous;
                }
                try {
                    const data = validateCatalog(decode(await fetchBytes("catalog.json", 256 * 1024)));
                    await save({ key: "catalog", data, checkedAt: now() });
                    return data;
                } catch (_) {
                    catalogUntil = now() + RETRY_INTERVAL;
                    return previous || null;
                }
            })();
            return catalogPromise;
        }

        async function loadPair(source, target) {
            const pair = `${source}-${target}`;
            const saved = await read(pair);
            let previous = null;
            try { if (saved?.data) previous = validatePack(saved.data, source, target, saved.data.version); } catch (_) {}
            const catalog = await loadCatalog();
            const item = catalog?.pairs[pair];
            if (!item) return previous;
            if (previous && saved.sha256 === item.sha256 && previous.version === item.version) {
                await save({ ...saved, lastUsed: now() });
                return previous;
            }
            try {
                const bytes = await fetchBytes(item.path, item.bytes);
                if (bytes.length !== item.bytes) throw new Error("Dictionary size mismatch");
                const digest = await root.crypto.subtle.digest("SHA-256", bytes);
                const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
                if (sha256 !== item.sha256) throw new Error("Dictionary checksum mismatch");
                const data = validatePack(decode(bytes), source, target, item.version);
                if (Object.keys(data.entries).length !== item.entryCount) throw new Error("Dictionary count mismatch");
                await save({ key: pair, data, sha256, bytes: bytes.length, lastUsed: now() });
                return data;
            } catch (_) {
                root.console?.warn(`Dictionary ${pair} unavailable; using saved or bundled data.`);
                return previous;
            }
        }

        async function getPair(source, target) {
            const supported = root.LectoroConstants?.SUPPORTED_LANGUAGES;
            if (!supported || !Object.hasOwn(supported, source) || !Object.hasOwn(supported, target) || source === target) return null;
            const pair = `${source}-${target}`;
            const cached = active.get(pair);
            if (cached && now() < cached.until) {
                active.delete(pair); active.set(pair, cached);
                return cached.promise;
            }
            const entry = { until: now() + RETRY_INTERVAL, promise: loadPair(source, target) };
            active.delete(pair); active.set(pair, entry);
            // At most two parsed pairs in worker memory; IndexedDB retains the rest.
            while (active.size > 2) active.delete(active.keys().next().value);
            return entry.promise;
        }
        return Object.freeze({ getPair });
    }

    root.DictionaryStore = createStore();
    if (typeof module !== "undefined" && module.exports) module.exports = { createStore, createPersistence, validatePack, validateCatalog, BASE_URL };
})(globalThis);
