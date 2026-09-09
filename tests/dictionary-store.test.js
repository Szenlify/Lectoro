const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const vm = require("node:vm");
const { load } = require("./helpers");
const C = require("../shared/constants");
const U = require("../shared/utils");
const dictionary = require("../shared/local-dictionary");
const tokenizer = require("../shared/dictionary-tokenizer");

function pack(source = "en", target = "pl", version = "v1") {
    return { schemaVersion: 1, sourceLanguage: source, targetLanguage: target, version,
        entries: { book: [{ senseId: "book.1", translations: ["książka"] }] }, forms: { books: ["book"] } };
}
function artifact(data) {
    const raw = Buffer.from(JSON.stringify(data));
    const pair = `${data.sourceLanguage}-${data.targetLanguage}`;
    return { raw, catalog: { schemaVersion: 1, pairs: { [pair]: {
        path: `releases/${data.version}/${pair}.json`, version: data.version, bytes: raw.length,
        sha256: createHash("sha256").update(raw).digest("hex"), entryCount: Object.keys(data.entries).length,
    } } } };
}
function environment({ records = new Map(), serve, clock = () => 1000000, failSave = false } = {}) {
    const calls = [];
    const context = vm.createContext({
        LectoroConstants: C, SharedUtils: U, crypto: webcrypto,
        TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout,
        console: { warn() {} }, module: { exports: {} },
    });
    load(context, "shared/dictionary-store.js");
    const api = context.module.exports;
    const store = api.createStore({ now: clock, persistence: {
        get: async (key) => structuredClone(records.get(key)),
        put: async (record) => { if (failSave) throw Error("QuotaExceededError"); records.set(record.key, structuredClone(record)); },
    }, fetcher: async (url, options) => {
        calls.push(url);
        assert.equal(options.credentials, "omit");
        assert.equal(options.redirect, "error");
        assert.ok(url.startsWith(api.BASE_URL));
        return serve(url, options);
    } });
    context.DictionaryStore = store;
    load(context, "shared/dictionary-tokenizer.js");
    load(context, "shared/local-dictionary.js");
    return { store, api, calls, context, records };
}

test("bilingual compact entries preserve translations and accept zero to three synonyms", () => {
    const env = environment({serve:()=>{throw Error('unused');}});
    const examples = [1,2,3].map(n=>({source:`Example ${n} with work.`,target:`Przykład ${n} z pracą.`}));
    for (const synonyms of [[],['job'],['job','labor','employment']]) {
        const entry = {t:'praca',d:{source:'An activity.',target:'Czynność.'},s:synonyms,e:examples};
        const pack = env.api.validatePack({work:entry},'en','pl','v1');
        const details = dictionary.lookupDetails('work',dictionary.compilePack(pack));
        assert.deepEqual(details.senses[0].examples,examples);
        assert.equal(details.senses[0].definition,'An activity.');
        assert.equal(details.senses[0].definitionTranslated,'Czynność.');
        for (const invalid of [{...entry,d:{source:'An activity.',target:''}}, {...entry,s:['a','b','c','d']},
            {...entry,e:examples.map(e=>({...e,target:''}))}, {...entry,e:[examples[0],examples[0],examples[2]]}]) {
            assert.throws(()=>env.api.validatePack({work:invalid},'en','pl','v1'));
        }
    }
});

test("short bilingual keys work in both directions and reject mixed aliases", () => {
    const env = environment({serve:()=>{throw Error('unused');}});
    const examples = [1,2,3].map(n=>({s:`Work example ${n}.`,t:`Przykład pracy ${n}.`}));
    const entry = {t:'praca',d:{s:'What you do in a job.',t:'To, co robisz w pracy.'},s:[],e:examples};
    const forward = env.api.validatePack({work:entry},'en','pl','v1');
    const details = dictionary.lookupDetails('work', dictionary.compilePack(forward));
    assert.equal(details.senses[0].definition,entry.d.s);
    assert.equal(details.senses[0].examples[0].target,examples[0].t);
    const reverse = {schemaVersion:1,sourceLanguage:'pl',targetLanguage:'en',version:'v1',entries:{praca:[{
        senseId:'work',translations:['work'],definition:entry.d.t,definitionTranslated:entry.d.s,synonyms:[],
        examples:examples.map(e=>({s:e.t,t:e.s}))
    }]}};
    env.api.validatePack(reverse,'pl','en','v1');
    assert.equal(dictionary.lookupDetails('praca',dictionary.compilePack(reverse)).senses[0].examples[0].source,examples[0].t);
    assert.throws(()=>env.api.validatePack({work:{...entry,d:{s:'Text',target:'Tekst'}}},'en','pl','v1'));
});

test("switching to a newly published reverse pair refreshes a cached catalog", async () => {
    const old = artifact(pack());
    const raw = Buffer.from(JSON.stringify({praca:{t:'work',d:{s:'To, co robisz.',t:'What you do.'},s:[],
        e:[1,2,3].map(n=>({s:`Praca ${n}.`,t:`Work ${n}.`}))}}));
    const catalog = {schemaVersion:1,pairs:{...old.catalog.pairs,'pl-en':{
        path:'releases/compact-reverse/pl-en.json',version:'compact-reverse',bytes:raw.length,
        sha256:createHash('sha256').update(raw).digest('hex'),entryCount:1}}};
    const records = new Map([['catalog',{key:'catalog',data:old.catalog,checkedAt:1000000}]]);
    const env = environment({records,serve:url=>new Response(url.endsWith('catalog.json') ? JSON.stringify(catalog) : raw)});
    const [details] = await env.context.LocalDictionary.lookupWords(['praca'],'en','pl',{details:true});
    assert.equal(details.primaryTranslation,'work');
    assert.equal(details.senses[0].definition,'To, co robisz.');
    assert.equal(env.calls.filter(url=>url.endsWith('catalog.json')).length,1);
});

test("fixed compact paths refresh both UI directions by checksum and survive partial uploads", async () => {
    let time = 1000000, revision = 1, broken = false;
    const build = (pair) => {
        const reverse = pair === 'pl-en';
        const entry = {t:reverse?'work':'praca',d:{s:`Definition ${revision}`,t:`Definicja ${revision}`},s:[],
            e:[1,2,3].map(n=>({s:`Example ${n}`,t:`Przykład ${n}`}))};
        const raw = Buffer.from(JSON.stringify({[reverse?'praca':'work']:entry}));
        return {raw,item:{version:'compact',path:`releases/compact/${pair}.json`,bytes:raw.length,
            sha256:createHash('sha256').update(raw).digest('hex'),entryCount:1}};
    };
    const env = environment({clock:()=>time,serve:url=>{
        if(url.endsWith('catalog.json')) return new Response(JSON.stringify({schemaVersion:1,pairs:{
            'en-pl':build('en-pl').item,'pl-en':build('pl-en').item}}));
        const pair = url.includes('/pl-en.json')?'pl-en':'en-pl';
        const data = build(pair);
        assert.equal(new URL(url).searchParams.get('sha256'),data.item.sha256);
        return new Response(broken ? Buffer.alloc(data.raw.length,32) : data.raw);
    }});
    const lookup = async (word,target,source) => (await env.context.LocalDictionary.lookupWords([word],target,source,{details:true}))[0];
    assert.equal((await lookup('work','pl','en')).senses[0].definition,'Definition 1');
    assert.equal((await lookup('praca','en','pl')).primaryTranslation,'work');
    revision = 2; time += 60001; broken = true;
    assert.equal((await lookup('work','pl','en')).senses[0].definition,'Definition 1');
    broken = false; time += 60001;
    assert.equal((await lookup('work','pl','en')).senses[0].definition,'Definition 2');
    assert.equal((await lookup('praca','en','pl')).senses[0].definition,'Definition 2');
});

test("compact R2 JSON supports details, inflections and offline restart", async () => {
    const entry = {t: "praca", d: "an activity you do as part of your job", s: ["job", "labor"], e: ["My work is important.", "I have work today.", "We work every day."]};
    const raw = Buffer.from(JSON.stringify({work: entry}));
    const catalog = {schemaVersion: 1, pairs: {"en-pl": {version: "compact-v1", path: "releases/compact-v1/en-pl.json",
        bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), entryCount: 1}}};
    const env = environment({serve: url => new Response(url.endsWith("catalog.json") ? JSON.stringify(catalog) : raw)});
    const [details] = await env.context.LocalDictionary.lookupWords(["works"], "pl", "en", {details: true});
    assert.equal(details.primaryTranslation, "praca");
    assert.equal(details.senses[0].definition, entry.d);
    assert.deepEqual(Array.from(details.senses[0].synonyms), entry.s);
    assert.equal(details.senses[0].examples[0].source, entry.e[0]);
    const offline = environment({records: env.records, serve: () => {throw Error("offline");}});
    assert.equal((await offline.context.LocalDictionary.lookupWords(["work"], "pl", "en"))[0], "praca");
    assert.equal(offline.calls.length, 0);
    for (const invalid of [{...entry, t: "ciężka praca"}, {...entry, s: ["job", "job"]}]) {
        assert.throws(() => env.api.validatePack({work: invalid}, "en", "pl", "v1"));
    }
});

test("concurrent lookups download one catalog and one verified pair; missing words have no API fallback", async () => {
    const { raw, catalog } = artifact(pack());
    const env = environment({ serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(catalog) : raw) });
    const results = await Promise.all([
        env.context.LocalDictionary.lookupWords(["books", "zzqvxx"], "pl", "en"),
        env.context.LocalDictionary.lookupWords(["book"], "pl", "en"),
    ]);
    assert.deepEqual(Array.from(results[0]), ["książka", null]);
    assert.equal(env.calls.length, 2);
    assert.ok(env.records.has("en-pl"));
    assert.deepEqual(Array.from(await env.context.LocalDictionary.lookupWords(["zzqvxx"], "pl", "en")), [null]);
    assert.equal(env.calls.length, 2);
});

test("saved pack survives a new worker without network; an old saved pack works when offline", async () => {
    const { raw, catalog } = artifact(pack());
    const first = environment({ serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(catalog) : raw) });
    await first.store.getPair("en", "pl");
    const fresh = environment({ records: first.records, serve: () => { throw Error("offline"); } });
    assert.equal((await fresh.store.getPair("en", "pl")).entries.book[0].translations[0], "książka");
    assert.equal(fresh.calls.length, 0);
    const stale = environment({ records: first.records, clock: () => 100000000, serve: () => { throw Error("offline"); } });
    assert.equal((await stale.store.getPair("en", "pl")).version, "v1");
    assert.equal(stale.calls.length, 1);
});

test("corrupt update retains the saved pair; a later valid update replaces it", async () => {
    const v1 = artifact(pack());
    const initial = environment({ serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(v1.catalog) : v1.raw) });
    await initial.store.getPair("en", "pl");
    const v2 = artifact(pack("en", "pl", "v2"));
    const broken = Buffer.from(v2.raw); broken[10] = 88;
    const update = environment({ records: initial.records, clock: () => 100000000,
        serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(v2.catalog) : broken) });
    assert.equal((await update.store.getPair("en", "pl")).version, "v1");
    assert.equal(initial.records.get("en-pl").data.version, "v1");
    const retry = environment({ records: initial.records, clock: () => 100000001, serve: () => new Response(v2.raw) });
    assert.equal((await retry.store.getPair("en", "pl")).version, "v2");
    assert.equal(initial.records.get("en-pl").data.version, "v2");
});

test("403 has a retry delay and unavailable non-English pairs never guess through English", async () => {
    let time = 1000000;
    const env = environment({ clock: () => time, serve: () => new Response("Forbidden", { status: 403 }) });
    assert.deepEqual(Array.from(await env.context.LocalDictionary.lookupWords(["zamek"], "de", "pl")), [null]);
    assert.equal(await env.store.getPair("pl", "de"), null);
    assert.equal(env.calls.length, 1);
    time += 300001;
    assert.equal(await env.store.getPair("pl", "de"), null);
    assert.equal(env.calls.length, 2);
    assert.equal(await env.store.getPair("../../evil", "de"), null);
    assert.equal(env.calls.length, 2);
});

test("catalog path escapes, wrong identities, invalid forms, and oversized data are rejected", async () => {
    const env = environment({ serve: () => new Response("not reached") });
    for (const path of ["https://evil.example/data.json", "../pl.json", "releases/../en-pl.json"]) {
        const { catalog } = artifact(pack());
        catalog.pairs["en-pl"].path = path;
        assert.throws(() => env.api.validateCatalog(catalog));
    }
    const bad = pack(); bad.forms.books = ["missing"];
    assert.throws(() => env.api.validatePack(bad, "en", "pl", "v1"));
    const otherPair = artifact(pack("en", "de"));
    const item = otherPair.catalog.pairs["en-de"];
    const catalog = { schemaVersion: 1, pairs: { "en-pl": { ...item, path: "releases/v1/en-pl.json" } } };
    const wrong = environment({ serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(catalog) : otherPair.raw) });
    assert.equal(await wrong.store.getPair("en", "pl"), null);
    assert.equal(wrong.records.has("en-pl"), false);
    const valid = artifact(pack());
    const oversized = environment({ serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(valid.catalog) : Buffer.concat([valid.raw, Buffer.alloc(20)])) });
    assert.equal(await oversized.store.getPair("en", "pl"), null);
    assert.equal(oversized.records.has("en-pl"), false);
});

test("quota failure still permits a verified pack in memory", async () => {
    const { raw, catalog } = artifact(pack());
    const env = environment({ failSave: true, serve: (url) => new Response(url.endsWith("catalog.json") ? JSON.stringify(catalog) : raw) });
    assert.equal((await env.store.getPair("en", "pl")).version, "v1");
    assert.equal(env.records.size, 0);
});

test("direct pairs preserve multiple meanings, aliases and non-English phrases without English stemming", () => {
    const data = pack("pl", "de");
    data.entries = {
        zamek: [{ senseId: "castle", translations: ["Burg"] }, { senseId: "lock", translations: ["Schloss"] }],
        "dzień dobry": [{ senseId: "greeting", translations: ["Guten Tag"] }],
        bus: [{ senseId: "bus", translations: ["Bus"] }],
    };
    data.forms = { zamku: ["zamek"] };
    const compiled = dictionary.compilePack(data);
    assert.equal(dictionary.lookup("zamku", compiled), "Burg / Schloss");
    assert.equal(dictionary.lookup("buses", compiled), null);
    assert.deepEqual(dictionary.lookupWordByWord(["dzień", "dobry", "zamku"], compiled), [
        { translated: "Guten Tag", length: 2 }, null, { translated: "Burg", length: 1 },
    ]);
});

test("Japanese segmentation preserves exact rendered text and aligns local phrase results", () => {
    const text = "日本語を勉強します。 Hello!";
    const tokens = tokenizer.tokenize(text);
    assert.equal(tokens.map((token) => token.text).join(""), text);
    assert.ok(tokens.filter((token) => token.type === "word").length > 2);
    const data = pack("ja", "pl");
    data.entries = { "日本語を": [{ senseId: "ja", translations: ["język japoński"] }] };
    data.forms = {};
    const words = tokens.filter((token) => token.type === "word").map((token) => token.text);
    const results = dictionary.lookupWordByWord(words, dictionary.compilePack(data));
    assert.equal(results[0].translated, "język japoński");
    assert.equal(results[0].length, 2);
});
