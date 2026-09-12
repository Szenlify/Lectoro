const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./helpers');

test('language swap saves both directions atomically and leaves UI intact on failure', async () => {
    const select = {value:'pl'};
    const learningLangSelect = {value:'en'};
    const swapLanguagesButton = {disabled:false};
    const writes = [];
    let fail = false;
    const context = vm.createContext({select, learningLangSelect, swapLanguagesButton, flashSaved(){},
        chrome:{storage:{local:{async set(values){if(fail) throw Error('storage'); writes.push({...values});}}}}});
    const source = read('popup/settings.js').replace(/\r\n/g,'\n');
    vm.runInContext(source.match(/async function swapTranslationLanguages\(\) \{[\s\S]*?\n\}/)[0],context);
    await Promise.all([context.swapTranslationLanguages(),context.swapTranslationLanguages()]);
    assert.deepEqual(writes,[{learningLang:'pl',targetLang:'en'}]);
    assert.equal(select.value,'en');
    assert.equal(learningLangSelect.value,'pl');
    fail = true;
    await context.swapTranslationLanguages();
    assert.equal(select.value,'en');
    assert.equal(learningLangSelect.value,'pl');
    assert.equal(swapLanguagesButton.disabled,false);
});
