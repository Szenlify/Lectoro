const test = require("node:test");
const assert = require("node:assert/strict");
const { MODEL, CACHE_VERSION, VOICES, audioCacheKey, pcmToWav, synthesizeSpeech } = require("./gemini-tts");
const C = require("../shared/constants");
const Utils = require("../shared/utils");

const sampleMp3 = Buffer.from([0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00]);

test("client and server agree on model, two voices and multilingual cache keys", async () => {
    assert.equal(C.OPENAI_TTS_MODEL, MODEL);
    assert.equal(C.OPENAI_TTS_CACHE_VERSION, CACHE_VERSION);
    assert.deepEqual(C.ALLOWED_OPENAI_TTS_VOICE_IDS, VOICES.map((v) => v.voice_id));
    assert.equal(VOICES.length, 2);
    for (const voice of VOICES) {
        for (const lang of ["pl", "en", "zh-CN", "pt-BR", "ja"]) {
            assert.equal(await Utils.getGeminiAudioCacheKey(voice.voice_id, "  Żółć 世界  ", lang),
                audioCacheKey(voice.voice_id, "  Żółć 世界  ", lang));
        }
    }
    assert.notEqual(audioCacheKey("nova", "Dom", "pl"), audioCacheKey("nova", "DOM", "pl"));
    assert.notEqual(audioCacheKey("nova", "Gift", "en"), audioCacheKey("nova", "Gift", "de"));
    assert.notEqual(audioCacheKey("nova", "Hello", "en"), audioCacheKey("onyx", "Hello", "en"));
    assert.throws(() => audioCacheKey("old-elevenlabs-id", "Hello", "en"));
    assert.throws(() => audioCacheKey("nova", "Hello", "../../en"));
});

test("legacy voice settings migrate without changing browser voice preference", () => {
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "elevenlabs", elVoiceId: "TX3LPaxmHKxFdv7VOQHJ" }),
        { ttsMode: "openai", elVoiceId: "onyx" });
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "elevenlabs", elVoiceId: "XrExE9yKIg1WjnnlVkGX" }),
        { ttsMode: "openai", elVoiceId: "nova" });
    assert.equal(C.normalizeTtsProviderSettings({ ttsMode: "browser" }).ttsMode, "browser");
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "gemini", elVoiceId: "Algieba" }),
        { ttsMode: "openai", elVoiceId: "onyx" });
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "gemini", elVoiceId: "Sulafat" }),
        { ttsMode: "openai", elVoiceId: "nova" });
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "openai", elVoiceId: "alloy" }),
        { ttsMode: "openai", elVoiceId: "onyx" });
    assert.deepEqual(C.normalizeTtsProviderSettings({ ttsMode: "openai", elVoiceId: "onyx" }),
        { ttsMode: "openai", elVoiceId: "onyx" });
});

test("PCM is wrapped in a playable 24 kHz mono 16-bit WAV without changing samples", () => {
    const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
    const wav = pcmToWav(pcm);
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.toString("ascii", 8, 12), "WAVE");
    assert.equal(wav.readUInt32LE(4), wav.length - 8);
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 24000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), pcm.length);
    assert.deepEqual(wav.subarray(44), pcm);
    assert.throws(() => pcmToWav(Buffer.alloc(0)));
    assert.throws(() => pcmToWav(Buffer.from([1])));
});

test("synthesis calls only OpenAI tts-1 model, passes voice and returns MP3", async () => {
    let count = 0;
    const result = await synthesizeSpeech({ apiKey: "test-only", text: "Cześć!", voiceId: "nova", language: "pl",
        fetchImpl: async (url, options) => {
            count++;
            assert.equal(url, "https://api.openai.com/v1/audio/speech");
            assert.equal(options.headers["Authorization"], "Bearer test-only");
            assert.ok(options.signal);
            const body = JSON.parse(options.body);
            assert.equal(body.model, "tts-1");
            assert.equal(body.voice, "nova");
            assert.equal(body.input, "Cześć!");
            assert.equal(body.response_format, "mp3");
            return {
                ok: true,
                arrayBuffer: async () => sampleMp3.buffer.slice(sampleMp3.byteOffset, sampleMp3.byteOffset + sampleMp3.byteLength),
            };
        },
    });
    assert.equal(count, 1);
    assert.deepEqual(result, sampleMp3);
});

test("missing credentials or invalid voices fail before a paid request", async () => {
    const fetchImpl = () => assert.fail("must not call provider");
    await assert.rejects(synthesizeSpeech({ apiKey: "", text: "Hi", voiceId: "nova", fetchImpl }),
        { code: "OPENAI_TTS_PROVIDER_DISABLED" });
    await assert.rejects(synthesizeSpeech({ apiKey: "test", text: "Hi", voiceId: "unknown", fetchImpl }));
});

test("quota and access failures have stable codes and are not retried or leaked", async () => {
    for (const [status, code] of [[429, "OPENAI_TTS_PROVIDER_QUOTA"], [403, "OPENAI_TTS_PROVIDER_DISABLED"], [500, "OPENAI_TTS_SYNTHESIS_FAILED"]]) {
        let calls = 0;
        await assert.rejects(synthesizeSpeech({ apiKey: "test", text: "Hi", voiceId: "onyx", language: "en",
            fetchImpl: async () => { calls++; return { ok: false, status }; },
        }), { code });
        assert.equal(calls, 1);
    }
});

test("empty response cannot be cached as successful audio", async () => {
    await assert.rejects(synthesizeSpeech({ apiKey: "test", text: "Hi", voiceId: "nova", language: "en",
        fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }),
    }));
});
