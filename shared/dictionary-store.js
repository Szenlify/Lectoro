/** Individual R2 live entries and their offline cache, owned by the service worker. */
(function (root) {
    "use strict";
    const BASE_URL = "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev/dictionaries/";
    const MAX_PACK_BYTES = 32 * 1024 * 1024;
    const MAX_CACHE_BYTES = 128 * 1024 * 1024;
    const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    const validText = (value, max = 200) => typeof value === "string" && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value);
    const validPair = (value, max) => isObject(value) && (
        Object.keys(value).sort().join() === "s,t" ? validText(value.s, max) && validText(value.t, max) :
        Object.keys(value).sort().join() === "source,target" && validText(value.source, max) && validText(value.target, max));

    function validatePack(pack, source, target, version) {
        // Compact files contain only word -> {t,d,s,e}; identity comes from the
        // checksum-verified catalog. Keep them compact in IndexedDB as well.
        if (isObject(pack) && pack.schemaVersion === undefined) {
            const terms = Object.entries(pack);
            if (!terms.length || terms.length > 200000) throw new Error("Invalid compact dictionary count");
            const single = (s) => validText(s, 80) && /^\p{L}[\p{L}\p{M}'’\-]*[\p{L}\p{M}]$|^\p{L}$/u.test(s);
            for (const [word, entry] of terms) {
                const legacy = Array.isArray(entry?.e) && entry.e.every(e => typeof e === "string");
                if (!validText(word, 80) || !isObject(entry) || Object.keys(entry).sort().join() !== "d,e,s,t" ||
                    !single(entry.t) || !(validText(entry.d, 300) || validPair(entry.d, 300)) ||
                    !Array.isArray(entry.s) || entry.s.length > (legacy ? 4 : 3) ||
                    !entry.s.every(s => validText(s, 80)) || new Set(entry.s.map(s => s.toLowerCase())).size !== entry.s.length ||
                    !Array.isArray(entry.e) || entry.e.length !== 3 || !entry.e.every(e => legacy ? validText(e, 300) :
                        validPair(e, 300)) ||
                    new Set(entry.e.map(e => (legacy ? e : e.s ?? e.source).toLowerCase())).size !== entry.e.length) {
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
                for (const [field, limit] of [["definition", 500], ["definitionTranslated", 500], ["partOfSpeech", 50], ["reviewStatus", 200]]) {
                    if (sense[field] !== undefined && !validText(sense[field], limit)) throw new Error("Invalid dictionary sense metadata");
                }
                if (sense.synonyms !== undefined && (!Array.isArray(sense.synonyms) || sense.synonyms.length > 3 ||
                    !sense.synonyms.every(s => validText(s, 80)) || new Set(sense.synonyms.map(s => s.toLowerCase())).size !== sense.synonyms.length)) {
                    throw new Error("Invalid dictionary synonyms");
                }
                if (sense.examples !== undefined && (!Array.isArray(sense.examples) || sense.examples.length > 4 ||
                    !sense.examples.every((example) => validPair(example, 500)))) {
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

        async function fetchBytes(path, limit) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            try {
                const response = await fetcher(BASE_URL + path, { signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-cache" });
                if (!response.ok) throw Object.assign(new Error(`Dictionary HTTP ${response.status}`), { status: response.status });
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

        const liveKey = (source, target, word) => `live-r2:${JSON.stringify([source, target, word])}`;
        const liveMemory = new Map(), liveRequests = new Map();
        function rememberLive(key, entry) {
            liveMemory.set(key, entry);
            if (liveMemory.size > 500) liveMemory.delete(liveMemory.keys().next().value);
            return entry;
        }
        const liveQueue = [];
        let liveRunning = 0;
        function validateLive(entry) {
            if (!isObject(entry) || !validText(entry.t, 120) || !validPair(entry.d, 300) ||
                !Array.isArray(entry.s) || entry.s.length > (entry.languageValidation === 1 ? 2 : 3) || !entry.s.every(v => validText(v, 80)) ||
                !Array.isArray(entry.e) || entry.e.length !== 3 || !entry.e.every(v => validPair(v, 300))) throw new Error("Invalid live entry");
            return entry;
        }
        async function getLive(source, target, word, { localOnly = false } = {}) {
            const supported = root.LectoroConstants?.SUPPORTED_LANGUAGES;
            if (!supported || !Object.hasOwn(supported, source) || !Object.hasOwn(supported, target) || source === target || !validText(word, 120)) return null;
            word = word.normalize("NFKC").trim().toLowerCase();
            const key = liveKey(source, target, word);
            if (liveMemory.has(key)) return liveMemory.get(key);
            const record = await read(key);
            try { if (record?.data?.languageValidation === 1) return rememberLive(key, validateLive(record.data)); } catch (_) {}
            if (localOnly) return null;
            if (liveRequests.has(key)) return liveRequests.get(key);
            const task = (async () => {
                if (liveRunning >= 6) await new Promise(resolve => liveQueue.push(resolve));
                else liveRunning++;
                try {
                    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(word));
                    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
                    let data;
                    try { data = decode(await fetchBytes(`live/${source}-${target}/${hash}.json`, 65536)); }
                    catch (error) { if (error.status === 404) return null; throw error; }
                    const entry = validateLive(data?.[word]);
                    if (entry.languageValidation !== 1) return null;
                    await putLive(source, target, word, entry);
                    return entry;
                } finally {
                    if (liveQueue.length) liveQueue.shift()();
                    else liveRunning--;
                }
            })().finally(() => liveRequests.delete(key));
            liveRequests.set(key, task);
            return task;
        }
        async function putLive(source, target, word, entry) {
            word = word.normalize("NFKC").trim().toLowerCase();
            validateLive(entry);
            if (entry.languageValidation !== 1) throw new Error("Dictionary entry has not passed language verification");
            rememberLive(liveKey(source, target, word), entry);
            await save({ key: liveKey(source, target, word), data: entry,
                bytes: new TextEncoder().encode(JSON.stringify(entry)).length, lastUsed: now() });
        }
        const normalizePhrase = (value) => String(value || "")
            .normalize("NFKC")
            .toLowerCase()
            .replace(/['‘]/g, "’")
            .replace(/[^\p{L}\p{M}\p{N}’ -]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
        const phraseKey = (source, target, phrase) => `phrase-r2:${JSON.stringify([source, target, phrase])}`;
        const phraseMemory = new Map(), phraseRequests = new Map(), phraseMisses = new Map();
        const phraseQueue = [];
        let phraseRunning = 0;
        function rememberPhrase(key, entry) {
            phraseMemory.set(key, entry);
            if (phraseMemory.size > 1000) phraseMemory.delete(phraseMemory.keys().next().value);
            return entry;
        }
        function validatePhraseObject(data, phrase) {
            if (!isObject(data)) return null;
            const direct = data[phrase];
            const fallback = Object.keys(data).length === 1 ? data[Object.keys(data)[0]] : null;
            const entry = isObject(direct) ? direct : isObject(fallback) ? fallback : null;
            if (!entry || !validText(entry.t, 300)) return null;
            return { t: entry.t };
        }
        async function getPhrase(source, target, phrase, { localOnly = false } = {}) {
            const supported = root.LectoroConstants?.SUPPORTED_LANGUAGES;
            if (!supported || !Object.hasOwn(supported, source) || !Object.hasOwn(supported, target) || source === target) return null;
            phrase = normalizePhrase(phrase);
            if (!phrase || phrase.length > 300 || phrase.split(/\s+/u).length < 2) return null;
            const key = phraseKey(source, target, phrase);
            if (phraseMemory.has(key)) return phraseMemory.get(key);
            const record = await read(key);
            if (record?.data?.t) {
                try { return rememberPhrase(key, validatePhraseObject({ [phrase]: record.data }, phrase)); } catch (_) {}
            }
            if (localOnly) return null;
            const missUntil = phraseMisses.get(key) || 0;
            if (missUntil > now()) return null;
            if (phraseRequests.has(key)) return phraseRequests.get(key);
            const task = (async () => {
                if (phraseRunning >= 8) await new Promise(resolve => phraseQueue.push(resolve));
                else phraseRunning++;
                try {
                    const digest = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(phrase));
                    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
                    let data;
                    try { data = decode(await fetchBytes(`phrase/${source}-${target}/${hash}.json`, 4096)); }
                    catch (error) {
                        if (error.status === 404) {
                            phraseMisses.set(key, now() + 5000);
                            return null;
                        }
                        throw error;
                    }
                    const entry = validatePhraseObject(data, phrase);
                    if (!entry) return null;
                    phraseMisses.delete(key);
                    rememberPhrase(key, entry);
                    await save({ key, data: entry, bytes: new TextEncoder().encode(JSON.stringify(entry)).length, lastUsed: now() });
                    return entry;
                } finally {
                    if (phraseQueue.length) phraseQueue.shift()();
                    else phraseRunning--;
                }
            })().finally(() => phraseRequests.delete(key));
            phraseRequests.set(key, task);
            return task;
        }

        const analysisKey = (source, target, context, words) => `phrase-analysis-v2:${JSON.stringify([source, target, context, words])}`;
        async function getAnalysis(source, target, context, words) {
            const key = analysisKey(source, target, context, words);
            if (liveMemory.has(key)) return liveMemory.get(key);
            const record = await read(key);
            return record?.data ? rememberLive(key, record.data) : null;
        }
        async function putAnalysis(source, target, context, words, data) {
            const key = analysisKey(source, target, context, words);
            rememberLive(key, data);
            await save({ key, data, bytes: new TextEncoder().encode(JSON.stringify(data)).length, lastUsed: now() });
        }
        return Object.freeze({ getLive, putLive, getPhrase, getAnalysis, putAnalysis });
    }

    root.DictionaryStore = createStore();
    if (typeof module !== "undefined" && module.exports) module.exports = { createStore, createPersistence, validatePack, validateCatalog, BASE_URL };
})(globalThis);
