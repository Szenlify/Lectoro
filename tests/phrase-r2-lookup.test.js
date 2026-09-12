const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const path = require('node:path');

const storeCode = fs.readFileSync(path.join(__dirname, '../shared/dictionary-store.js'), 'utf8');
const dictCode = fs.readFileSync(path.join(__dirname, '../shared/local-dictionary.js'), 'utf8');

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
    LectoroConstants: { SUPPORTED_LANGUAGES: { en: {}, pl: {}, de: {} } },
    require,
    __dirname: path.join(__dirname, '../shared'),
    process,
    fetch: async (url) => {
      requests.push(url);
      return new Response('', { status: 404 });
    },
    Response,
  });
  vm.runInContext(storeCode, context);
  if (phrases) {
    context.DictionaryStore.setPhraseDictionary('en', 'pl', phrases);
  }
  vm.runInContext(dictCode, context);
  return { context, requests };
}

test('GET UP is returned as one phrase from static phrase dictionary without R2 calls', async () => {
  const { context, requests } = createRuntime({ 'get up': 'wstać' });
  const result = await context.LocalDictionary.lookupWords(['GET', 'UP'], 'pl', 'en', {
    wordByWord: true,
    contextual: true,
    context: 'GET UP',
  });
  assert.equal(result[0].translated, 'wstać');
  assert.equal(result[0].length, 2);
  assert.equal(result[1], null);
  assert.equal(requests.length, 0, 'No network requests made for static phrases');
});

test('common phrases from dictionaries/phrase/en-pl.json match in word-by-word mode', async () => {
  const { context, requests } = createRuntime(); // Loads from file
  const testCases = [
    { words: ['play', 'with', 'fire'], expected: 'igrać z ogniem', length: 3 },
    { words: ['on', 'thin', 'ice'], expected: 'na cienkim lodzie', length: 3 },
    { words: ['take', 'off'], expected: 'startować', length: 2 },
    { words: ['take', 'out'], expected: 'wyjmować', length: 2 },
    { words: ['take', 'over'], expected: 'przejmować kontrolę', length: 2 },
  ];

  for (const { words, expected, length } of testCases) {
    const result = await context.LocalDictionary.lookupWords(words, 'pl', 'en', {
      wordByWord: true,
      contextual: true,
      context: words.join(' '),
    });
    assert.equal(result[0]?.translated, expected, `Phrase "${words.join(' ')}" translated`);
    assert.equal(result[0]?.length, length);
    for (let i = 1; i < length; i++) {
      assert.equal(result[i], null);
    }
  }
  assert.equal(requests.length, 0);
});

test('longest phrase wins and curly/ascii apostrophes share canonical lookup', async () => {
  const { context, requests } = createRuntime({
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
  assert.equal(requests.length, 0);
});
