const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {load, loadFunction} = require('./helpers');
const dictionary = require('../shared/local-dictionary');
const C = require('../shared/constants');
const U = require('../shared/utils');
const {validatePack} = require('../shared/dictionary-store');
const pack = require('./fixtures/dictionary-meanings.json');
pack.version = 'test';
for (const [word,senses] of Object.entries(pack.entries)) for (const sense of senses) sense.senseId = word + '.' + sense.senseId.split('.').at(-1);
const target = dictionary.compilePack(pack);

test('context distinguishes noun, verb and auxiliary using curated data', () => {
  for (const [word, sentence, sense] of [
    ['like','I like music','primary'], ['like','It looks like a cat','similarity'],
    ['well','The well is deep','noun'], ['well','She sings well','primary'],
    ['has','She has left','auxiliary'], ['has','She has a car','primary'],
    ['can','A can of beans','container'], ['can','I can swim','primary'],
    ['are','We are waiting','progressive']]) {
    const words=sentence.split(' ');
    const result=dictionary.lookupDetails(word,target,words,words.indexOf(word));
    assert.equal(result.selection,'context',sentence);
    assert.equal(result.selectedSenseId,word+'.'+sense,sentence);
    assert.ok(result.primaryTranslation && !result.primaryTranslation.includes(" / "));
    assert.ok(!result.primaryTranslation.includes("czasownik pomocniczy"));
    assert.equal(result.translated,dictionary.lookup(word,target));
    assert.ok(result.senses[0].examples.length);
  }
});

test('ambiguous context preserves alternatives; punctuation and repeated words do not leak clues', () => {
  const noClues=dictionary.lookupDetails('like',target,['like'],0);
  assert.equal(noClues.selection,'ambiguous');
  assert.equal(noClues.translated,dictionary.lookup('like',target));
  const repeats=['I','like','music.','It','looks','like','a','cat.'];
  assert.equal(dictionary.lookupDetails('like',target,repeats,1).selectedSenseId,'like.primary');
  assert.equal(dictionary.lookupDetails('like',target,repeats,5).selectedSenseId,'like.similarity');
  assert.equal(dictionary.lookupDetails('like',target,repeats).selection,'ambiguous');
  const separated=['music.','like'];
  assert.equal(dictionary.lookupDetails('like',target,separated,1).selection,'ambiguous');
});

test('word-by-word uses the same ranking without changing span alignment', () => {
  const results=dictionary.lookupWordByWord(['She','sings','well'],target);
  assert.equal(results.length,3);
  assert.equal(results[2].translated,'dobrze');
  assert.equal(results[2].length,1);
  assert.equal(dictionary.lookupDetails('book',{book:'książka'}).senses.length,0);
});

test('detailed lookup travels through the public service and rejects oversized context', async () => {
  const context=vm.createContext({LectoroConstants:C,SharedUtils:U,DictionaryStore:{getPair:async()=>pack}});
  load(context,'shared/local-dictionary.js');
  const [result]=await context.LocalDictionary.lookupWords(['like'],'pl','en',{details:true,context:'I like music'});
  assert.equal(result.selectedSenseId,'like.primary');
  assert.ok(result.senses[0].examples.length);
  await assert.rejects(context.LocalDictionary.lookupWords(['like'],'pl','en',{details:true,context:'x'.repeat(10001)}));
  await assert.rejects(context.LocalDictionary.lookupWords(['like'],'pl','en',{details:true,contextWords:[{}]}));
});

test('pack validator bounds optional definitions and examples while accepting old packs', () => {
  assert.equal(validatePack(pack,'en','pl','test'),pack);
  for (const bad of [{examples:[{source:'missing target'}]}, {examples:Array(5).fill({source:'a',target:'b'})}, {definition:'x'.repeat(501)}]) {
    const invalid={...pack,entries:{a:[{senseId:'a',translations:['b'],...bad}]}};
    assert.throws(()=>validatePack(invalid,'en','pl','test'));
  }
});

test('hover renders definition and escaped source examples without example translations', () => {
  const context=vm.createContext({PREFIX:'__qt_',escapeHtml:U.escapeHtml,escapeAttr:U.escapeAttr});
  loadFunction(context,'core.js','buildDictionaryDetailsHtml');
  const result=dictionary.lookupDetails('like',target,['I','like','music'],1);
  result.senses=result.senses.map(s=>({...s,examples:[{source:'<img src=x onerror=alert(1)>',target:'Przykład'}]}));
  const html=context.buildDictionaryDetailsHtml(result,'en','pl');
  assert.ok(!html.includes('Suggested meaning'));
  assert.ok(!html.includes('Use this meaning'));
  assert.ok(html.includes('dictionary-definition'));
  assert.ok(!/<details[^>]+ open/.test(html));
  assert.ok(!html.includes('<details'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.replace(/<[^>]*>/g, '').includes('Przykład'));
  assert.equal(context.buildDictionaryDetailsHtml(null,'en','pl'),'');
});

test('example save translates the sentence once, prevents double clicks and allows retry', async () => {
  const saved = [];
  let calls = 0, fail = true;
  const status = {textContent:''};
  const btn = {
    dataset:{src:'She likes apples and oranges.',translated:'',srcLang:'en',tgtLang:'pl'},
    disabled:false, classList:{add(){}}, setAttribute(){},
    closest:()=>({querySelector:()=>status}),
  };
  const context = vm.createContext({
    PREFIX:'__qt_', cleanCardText:s=>String(s || '').trim(),
    window:{location:{href:'https://example.com'}},
    SharedTranslatorService:{async translate(text, target, source){
      calls++;
      assert.equal(text, btn.dataset.src);
      assert.equal(target,'pl'); assert.equal(source,'en');
      if(fail) throw new Error('Network unavailable');
      return {translated:'Lubi jabłka i pomarańcze.'};
    }}, QT:{async saveWord(entry){saved.push(entry);}},
  });
  loadFunction(context,'core.js','handleSaveExampleClick');
  await context.handleSaveExampleClick(btn);
  assert.equal(btn.disabled,false);
  assert.equal(saved.length,0);
  assert.equal(status.textContent,'Network unavailable');
  fail = false;
  await Promise.all([context.handleSaveExampleClick(btn),context.handleSaveExampleClick(btn)]);
  assert.equal(saved.length,1);
  assert.equal(saved[0].original,btn.dataset.src);
  assert.equal(saved[0].translated,'Lubi jabłka i pomarańcze.');
  assert.equal(calls,2);
  assert.equal(btn.disabled,true);
  btn.disabled=false; btn.dataset.translated='Gotowe tłumaczenie';
  await context.handleSaveExampleClick(btn);
  assert.equal(calls,2);
  assert.equal(saved[1].translated,'Gotowe tłumaczenie');
});

test('subtitle hover passes the exact word occurrence and ignores stale async results', async () => {
  const first={isConnected:true,textContent:'like'};
  const second={isConnected:true,textContent:'like'};
  let request, rendered, resolve;
  const waiting=new Promise(r=>{resolve=r;});
  const context=vm.createContext({
    PREFIX:'__qt_', activeWordSpans:[first,second], activeText:'like like',
    isSubHovering:true,lastHoveredSubWord:second,
    ensureSubtitleUiTracking(){},
    QT:{showLoading(){},showTooltip(html){rendered=html;},buildTooltipHtml(data){return data;},attachTooltipHandlers(){},escapeHtml:U.escapeHtml},
    SharedTranslatorService:{getReadingSettings:async()=>({targetLang:'pl',learningLang:'en'}),
      lookupWords:async(...args)=>{request=args;return waiting;}},
  });
  loadFunction(context,'video/subtitle-overlay.js','showWordTooltip');
  const pending=context.showWordTooltip(second,'like',{});
  await new Promise(r=>setImmediate(r));
  assert.equal(request[3].wordIndex,1);
  assert.deepEqual(Array.from(request[3].contextWords),['like','like']);
  assert.equal(request[3].details,true);
  context.lastHoveredSubWord=first;
  resolve([{translated:'lubić',senses:[]}]);
  await pending;
  assert.equal(rendered,undefined);
});

test('same-language detailed lookup keeps the response shape consistent', async () => {
  const context=vm.createContext({LectoroConstants:C,SharedUtils:U});
  load(context,'shared/local-dictionary.js');
  const [result]=await context.LocalDictionary.lookupWords(['book'],'en','en',{details:true});
  assert.equal(result.translated,'book');
  assert.equal(result.senses.length,0);
});


test('S shows one equivalent while hover shows lexical alternatives without grammar notes', () => {
  const all=dictionary.lookupDetails('all',target,['all'],0);
  assert.equal(all.translated,'cały / wszyscy / wszystkie / wszystko');
  assert.equal(all.primaryTranslation,'wszystko');
  assert.equal(dictionary.lookupWordByWord(['all'],target)[0].translated,'wszystko');
  const is=dictionary.lookupDetails('is',target,['He','is','sleeping'],1);
  assert.equal(is.translated,'jest');
  assert.equal(is.primaryTranslation,'jest');
  assert.ok(is.senses.some(s=>s.examples?.some(e=>e.source==='He is sleeping.')));
  const phrase=dictionary.lookupWordByWord(['give','up'],{'give up':'poddać się / zrezygnować'});
  assert.equal(phrase[0].translated,'poddać się');
});
