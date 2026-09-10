const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

const storeCode = fs.readFileSync(__dirname + '/dictionary-store.js', 'utf8');
const dictCode = fs.readFileSync(__dirname + '/local-dictionary.js', 'utf8');

function createRuntime(phrases) {
  const requests = [];
  const context = vm.createContext({
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    AbortController,
    SharedUtils: { isSimpleWord: () => false },
    LectoroConstants: { SUPPORTED_LANGUAGES: { en: {}, pl: {} } },
    fetch: async (url) => {
      requests.push(url);
      const hash = String(url).match(/\/phrase\/en-pl\/([a-f0-9]{64})\.json$/)?.[1];
      for (const [source, translated] of Object.entries(phrases)) {
        const data = new TextEncoder().encode(source);
        const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', data)).toString('hex');
        if (digest === hash) return new Response(JSON.stringify({ [source]: { t: translated } }), { status: 200 });
      }
      return new Response('', { status: 404 });
    },
    Response,
  });
  vm.runInContext(storeCode, context);
  vm.runInContext(dictCode, context);
  return { context, requests };
}

test('GET UP is returned as one phrase from hashed R2 object', async () => {
  const { context, requests } = createRuntime({ 'get up': 'wstać' });
  const result = await context.LocalDictionary.lookupWords(['GET', 'UP'], 'pl', 'en', {
    wordByWord: true,
    contextual: true,
    context: 'GET UP',
  });
  assert.equal(result[0].translated, 'wstać');
  assert.equal(result[0].length, 2);
  assert.equal(result[1], null);
  assert.ok(requests.some(url => url.includes('/dictionaries/phrase/en-pl/')));
});

test('longest phrase wins and curly/ascii apostrophes share canonical hash', async () => {
  const { context } = createRuntime({
    'get up': 'wstać',
    'can’t get up': 'nie mogę wstać',
  });
  const result = await context.LocalDictionary.lookupWords(["CAN'T", 'GET', 'UP'], 'pl', 'en', {
    wordByWord: true,
    contextual: true,
  });
  assert.equal(result[0].translated, 'nie mogę wstać');
  assert.equal(result[0].length, 3);
  assert.equal(result[1], null);
  assert.equal(result[2], null);
});
