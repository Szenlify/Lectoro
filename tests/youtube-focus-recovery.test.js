const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFunction } = require('./helpers');
const S = require('../shared/subtitle-service');
const tokenizer = require('../shared/dictionary-tokenizer');

function timings(text, cue) {
    const context = vm.createContext({ SharedSubtitleService: S });
    for (const name of ['extractSegmentTimings', 'mapSpansToTimings', 'buildFocusTimings']) {
        loadFunction(context, 'video/subtitle-overlay.js', name);
    }
    return Array.from(context.buildFocusTimings(tokenizer.tokenize(text)
        .filter(token => token.type === 'word').map(token => ({ textContent: token.text })), cue),
    item => [item.span.textContent, item.startMs, item.endMs]);
}

test('Focus keeps exact word clocks despite standalone punctuation in real ASR captions', () => {
    const cues = S.parseYouTubeJson3(require('./fixtures/apple-asr-pl.json'), { preserveTiming: true, preserveCueBoundaries: true });
    const cue = cues.find(cue => cue.text.startsWith('. '));
    assert.ok(cue);
    assert.deepEqual(timings(cue.text, cue), [['Więc', 9000, 10000], ['Apple', 10000, 10240]]);
});

test('Focus never interpolates a phrase, absent clocks or malformed segment text', () => {
    for (const cue of [null, {}, { startTime: 2, endTime: 2 }, { startTime: 2, endTime: NaN },
        { startTime: 2, endTime: 3 },
        { startTime: 2, endTime: 3, segs: [{ utf8: 'One two', tOffsetMs: 0 }] },
        { startTime: 2, endTime: 3, segs: [{ utf8: 'Different', tAbsMs: NaN }] },
    ]) assert.deepEqual(timings('One two', cue), []);
    assert.deepEqual(timings('... ♪', { startTime: 1, endTime: 2 }), []);
});

function pipeline(events) {
    const context = vm.createContext({
        getSubtitleService: () => S, isCurrentRequest: () => true,
        captionGeneration: 1, clearCaptionStatus() {}, activeTrack: { languageCode: 'en' },
        cueIndex: [], cueMaxEnd: [], boundVideo: null,
        document: { querySelector: () => null }, currentVideoId: 'video',
        currentDisplayedText: '', currentDisplayedCue: null,
    });
    for (const name of ['processCaptionTrack', 'setCueIndex']) loadFunction(context, 'adapters/youtube-adapter.js', name);
    context.processCaptionTrack(S.parseTimedText(JSON.stringify({ events }), '', '',
        { preserveTiming: true, preserveCueBoundaries: true }), 'video');
    return Array.from(context.cueIndex);
}

test('JSON3 word clocks survive adapter copying, casing, repeated merging and source pauses', () => {
    const events = [
        { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'look' }, { utf8: ' here', tOffsetMs: 325 }] },
        { tStartMs: 2400, dDurationMs: 700, segs: [{ utf8: 'now' }] },
        { tStartMs: 3200, dDurationMs: 800, segs: [{ utf8: 'please' }] },
    ];
    const snapshot = structuredClone(events);
    const cues = pipeline(events);
    assert.equal(cues.length, 1);
    assert.deepEqual(timings(cues[0].text, cues[0]), [
        ['Look', 1000, 1325], ['here', 1325, 2000], ['now', 2400, 3100], ['please', 3200, 4000],
    ]);
    assert.deepEqual(events, snapshot);
});

test('cleaned sound labels and HTML entities do not invalidate real source word clocks', () => {
    const [cue] = pipeline([{ tStartMs: 1000, dDurationMs: 3000, segs: [
        { utf8: '[Music] ' }, { utf8: 'look', tOffsetMs: 600 },
        { utf8: '&nbsp;here', tOffsetMs: 1100 }, { utf8: ' &amp; ', tOffsetMs: 1300 },
        { utf8: 'now', tOffsetMs: 1900 },
    ] }]);
    assert.deepEqual(timings(cue.text, cue), [
        ['Look', 1600, 2100], ['here', 2100, 2300], ['now', 2900, 4000],
    ]);
});

test('equal JSON3 offsets are preserved instead of stretching a word over later words', () => {
    const [cue] = pipeline([{ tStartMs: 1000, dDurationMs: 2000, segs: [
        { utf8: 'go' }, { utf8: ' on', tOffsetMs: 0 }, { utf8: ' now', tOffsetMs: 650 },
    ] }]);
    assert.deepEqual(timings(cue.text, cue), [
        ['Go', 1000, 1650], ['on', 1000, 1650], ['now', 1650, 3000],
    ]);
});

test('a future word outside a clipped rolling window cannot disable currently spoken words', () => {
    const cue = { startTime: 1, endTime: 2, segs: [
        { utf8: 'go', tAbsMs: 1000 }, { utf8: ' now', tAbsMs: 1500 }, { utf8: ' later', tAbsMs: 2200 },
    ] };
    assert.deepEqual(timings('Go now later', cue), [['Go', 1000, 1500], ['now', 1500, 2000]]);
});

test('player caption responses cannot downgrade ASR clocks or overwrite a pending track switch', () => {
    const exact = [{ startTime: 0, endTime: 1, segs: [{ utf8: 'One', tAbsMs: 0 }, { utf8: ' two', tAbsMs: 500 }] }];
    const plain = [{ startTime: 0, endTime: 1, text: 'One two' }];
    let incoming = plain;
    const processed = [];
    const context = vm.createContext({
        URL, window: { location: { href: 'https://www.youtube.com/watch?v=video' } },
        boundVideo: {}, checkIsCcActive: () => true, buildTimedTextUrl: url => url,
        getVideoIdFromUrl: () => 'video', currentVideoId: 'video', pendingTrackKey: '',
        activeTrack: { languageCode: 'en', kind: 'asr', vssId: 'a.en' }, cueIndex: exact,
        getSubtitleService: () => ({ parseTimedText: () => incoming }),
        processCaptionTrack: cues => processed.push(cues),
    });
    loadFunction(context, 'adapters/youtube-adapter.js', 'handleTimedText');
    const response = suffix => context.handleTimedText({ detail: {
        url: `https://www.youtube.com/api/timedtext?v=video&lang=en${suffix}`, text: 'captions',
    } });
    response('&kind=asr&fmt=vtt');
    assert.equal(processed.length, 0, 'keep exact clocks over VTT');
    incoming = exact;
    response('&fmt=json3');
    assert.equal(processed.length, 0, 'ignore a late manual track in the same language');
    context.pendingTrackKey = 'loading';
    response('&kind=asr&fmt=json3');
    assert.equal(processed.length, 0, 'explicit load owns pending response');
    context.pendingTrackKey = '';
    response('&kind=asr&fmt=json3');
    assert.equal(processed.length, 1);
    context.cueIndex = plain;
    response('&kind=asr&fmt=json3');
    assert.equal(processed.length, 2, 'allow upgrading plain captions to word clocks');
});
