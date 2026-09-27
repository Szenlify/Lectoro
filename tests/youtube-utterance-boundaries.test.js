const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const S = require('../shared/subtitle-service');
const { loadFunction } = require('./helpers');
const exact = { preserveTiming: true, preserveCueBoundaries: true };
const nextSentence = 'me and all the boys have these haptic feedback suits on,';

function index(input) {
    const context = vm.createContext({
        getSubtitleService: () => S, cueIndex: [], cueMaxEnd: [], boundVideo: null,
        document: { querySelector: () => null }, currentVideoId: '', currentDisplayedText: '', currentDisplayedCue: null,
    });
    loadFunction(context, 'adapters/youtube-adapter.js', 'setCueIndex');
    loadFunction(context, 'adapters/youtube-adapter.js', 'findActiveCue');
    context.setCueIndex(S.parseYouTubeJson3(input, exact), 'video', 'en');
    return context;
}

test('God! remains a standalone utterance even before a short following sentence', () => {
    for (const ending of ['God!', 'God!\u200b', 'God!\u2060&#xA0;', 'No.', 'Really?', 'Stop!”']) {
        const context = index({ events: [
            { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: ending }] },
            { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'over here' }] },
        ] });
        assert.equal(context.cueIndex.length, 2, ending);
        assert.equal(context.findActiveCue(0.5).text.includes('over here'), false);
        assert.equal(context.findActiveCue(1).text.toLowerCase(), 'over here');
        assert.equal(context.findActiveCue(3), null);
    }
});

test('overlapping ASR windows do not preview the haptic-suits sentence during God!', () => {
    const source = { events: [
        { tStartMs: 0, dDurationMs: 5000, segs: [
            { utf8: 'God!\u200b' },
            { utf8: ' me and all the boys have these\u200b ', tOffsetMs: 1000 },
            { utf8: 'haptic feedback suits on,&#xA0;', tOffsetMs: 2500 },
        ] },
        { tStartMs: 1000, dDurationMs: 4000, segs: [
            { utf8: 'me and all the boys have these ' },
            { utf8: 'haptic feedback suits on,', tOffsetMs: 1500 },
        ] },
    ] };
    const original = structuredClone(source);
    const context = index(source);
    for (const time of [0, 0.1, 0.999]) assert.equal(context.findActiveCue(time).text, 'God!');
    for (const time of [1, 2.5, 4.999]) assert.equal(context.findActiveCue(time).text.toLowerCase(), nextSentence);
    assert.equal(context.findActiveCue(5), null);
    assert.equal(context.cueIndex[0].segs.length, 1);
    assert.equal(context.cueIndex[0].endTime, 1);
    assert.equal(context.cueIndex[1].segs[1].tAbsMs, 2500);
    assert.deepEqual(source, original, 'parsing must not rewrite source events');
});

test('repeated spoken text and untimed words are not deleted merely because they look similar', () => {
    for (const offset of [200, undefined]) {
        const parsed = S.parseYouTubeJson3({ events: [
            { tStartMs: 0, dDurationMs: 3000, segs: [
                { utf8: 'God! ' }, { utf8: nextSentence, ...(offset === undefined ? {} : { tOffsetMs: offset }) },
            ] },
            { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: nextSentence }] },
        ] }, exact);
        assert.equal(parsed[0].text, `God! ${nextSentence}`);
        assert.equal(parsed[1].text, nextSentence);
    }
});

test('strict YouTube parsing keeps source phrase boundaries and real silent gaps', () => {
    const parsed = S.parseYouTubeJson3({ events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Finished. So' }] },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'we continue.' }] },
        { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
    ] }, exact);
    assert.deepEqual(parsed.map(cue => [cue.text, cue.startTime, cue.endTime]), [
        ['Finished. So', 0, 1], ['we continue.', 2, 3],
    ]);
});

test('caption cleaning decodes non-breaking spaces without removing meaningful script joiners', () => {
    assert.equal(S.cleanCueText('God!\u200b \u2060&#xA0;'), 'God!');
    assert.equal(S.cleanCueText('one&nbsp;two&#160;three&#xa0;four'), 'one two three four');
    assert.equal(S.cleanCueText('می\u200cروم'), 'می\u200cروم');
    assert.equal(S.cleanCueText('first\u200b\nsecond&#xA0;', { preserveNewlines: true }), 'first\nsecond');
});
