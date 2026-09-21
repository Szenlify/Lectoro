const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {read} = require('./helpers');
const utils = require('../shared/utils');

function harness() {
  const handlers = {};
  const context = vm.createContext({
    SharedUtils: utils, escapeHtml: utils.escapeHtml, escapeAttr: utils.escapeAttr,
    console, TextEncoder, Uint8Array, DataView, Blob,
    document: {getElementById: (id) => !id.toLowerCase().includes('badge')
      ? {addEventListener: (event, fn) => { handlers[id] = fn; }, querySelector: () => ({textContent: 'Anki'})}
      : null},
  });
  vm.runInContext(read('popup/export.js'), context);
  return {context, handlers};
}

test('Anki tests one expression, reveals saved translation and excludes AI fields', () => {
  const {context} = harness();
  const card = context.buildAnkiCard({
    original: 'bank', translated: 'brzeg', sentence: 'We sat on the bank.',
    sentenceTranslated: 'Siedzieliśmy na brzegu.',
    aiSentence: 'AI example', aiSentenceTranslated: 'AI translation', explanation: 'AI explanation',
  });
  assert.match(card.front, />bank</);
  assert.doesNotMatch(card.front, /brzeg|We sat|c1::/);
  assert.match(card.parts.join(''), /brzeg/);
  assert.match(card.parts.join(''), /We sat on the bank/);
  assert.doesNotMatch(card.parts.join(''), /AI/);
});

test('full sentences and non-Latin scripts stay intact; HTML is escaped', () => {
  const {context} = harness();
  const original = '日本語 <script>alert(1)</script>';
  const card = context.buildAnkiCard({original, sentence: original, translated: 'A & B'});
  assert.equal(card.parts.length, 1);
  assert.match(card.front, /日本語 &lt;script&gt;/);
  assert.doesNotMatch(card.front, /<script>/);
  assert.match(card.parts[0], /A &amp; B/);
});

test('TSV quotes round-trip without splitting notes or HTML fields', () => {
  const {context} = harness();
  const html = '<div title="word">a\tb\nc</div>';
  const encoded = context.ankiTsvField(html);
  assert.equal(encoded.slice(1, -1).replace(/""/g, '"'), '<div title="word">a b c</div>');
  assert.doesNotMatch(encoded, /[\r\n\t]/);
});

test('downloaded archive uses Basic fields and includes only complete cards', async () => {
  const {context, handlers} = harness();
  context.SharedWordRepository = {getStoredWords: async () => [
    {original: 'hello', translated: 'cześć', aiSentence: 'DO NOT EXPORT', screenshot: 'data:image/png;base64,test'},
    {original: 'missing', translated: ''},
  ]};
  context.SharedTranslatorService = {getLearningLang: async () => 'en'};
  context.filterWords = (words) => words;
  context.enforceExportQuota = async () => true;
  context.recordExportSuccess = async () => {};
  context.markAsDownloaded = () => {};
  context.fetchAudioBlob = async (text) => {
    assert.equal(text, 'hello');
    return {blob: new Blob(['audio'], {type: 'audio/wav'}), provider: 'gemini'};
  };
  context.imageToJpeg = async () => ({blob: new Blob(['image'], {type: 'image/jpeg'})});
  let files;
  context.buildZip = (value) => {files = value; return new Uint8Array();};
  context.URL = {createObjectURL: () => 'blob:test', revokeObjectURL() {}};
  context.document.createElement = () => ({click() {}});
  context.document.body = {appendChild() {}, removeChild() {}};
  context.alert = (message) => {throw new Error(message);};
  await handlers.exportAnki();
  const cards = new TextDecoder().decode(files.find((file) => /^anki-.*\.txt$/.test(file.name)).data);
  assert.match(cards, /#notetype:Basic/);
  assert.match(cards, /#columns:Front\tBack/);
  assert.equal(cards.split('\n').filter((line) => !line.startsWith('#')).length, 1);
  assert.match(cards, /cześć/);
  assert.doesNotMatch(cards, /DO NOT EXPORT|missing|c1::|<audio/);
  const audio = files.find((file) => file.name.endsWith('.wav'));
  const image = files.find((file) => file.name.endsWith('.jpg'));
  assert.ok(audio && image);
  assert.ok(cards.includes('[sound:' + audio.name + ']'));
  assert.ok(cards.includes(image.name));
  assert.doesNotMatch(cards, /data:image/);
});
