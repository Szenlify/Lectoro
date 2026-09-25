/** OpenAI speech generation (tts-1). No provider key or arbitrary model comes from the client. */
const crypto = require("node:crypto");
const MODEL = "tts-1";
const CACHE_VERSION = "v1";
const VOICES = Object.freeze([
    Object.freeze({ voice_id: "nova", name: "Nova", gender: "female", labels: { description: "Warm & Natural" } }),
    Object.freeze({ voice_id: "alloy", name: "Alloy", gender: "male", labels: { description: "Balanced & Clear" } }),
]);

function normalizeLanguage(language) {
    const value = String(language || "en").trim().toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value) || value.length > 35) {
        throw new Error("Invalid speech language.");
    }
    return value;
}

function normalizeVoiceId(voiceId) {
    const v = String(voiceId || "").trim().toLowerCase();
    if (v === "sulafat") return "nova";
    if (v === "algieba") return "alloy";
    if (VOICES.some((voice) => voice.voice_id === v)) return v;
    throw new Error("Invalid OpenAI TTS voice identifier.");
}

function audioCacheKey(voiceId, text, language) {
    const normalizedVoice = normalizeVoiceId(voiceId);
    const lang = normalizeLanguage(language);
    // Preserve case: e.g. Polish "Dom" and the acronym "DOM" need not sound alike.
    const hash = crypto.createHash("sha256").update(String(text).trim()).digest("hex");
    return `audio/openai/${MODEL}/${CACHE_VERSION}/${normalizedVoice}/${lang}/${hash}.mp3`;
}

function pcmToWav(pcm, sampleRate = 24000) {
    if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % 2) {
        throw new Error("TTS returned invalid PCM audio.");
    }
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function synthesizeSpeech({ apiKey, text, voiceId, language, fetchImpl = fetch }) {
    if (!apiKey) {
        const error = new Error("OpenAI TTS is not configured on the server.");
        error.code = "OPENAI_TTS_PROVIDER_DISABLED";
        throw error;
    }
    const cleanText = String(text || "").trim();
    if (!cleanText) throw new Error("Speech text is empty.");
    const normalizedVoice = normalizeVoiceId(voiceId);
    normalizeLanguage(language); // Validate language format before contacting provider

    const response = await fetchImpl("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
            model: MODEL,
            input: cleanText,
            voice: normalizedVoice,
            response_format: "mp3",
        }),
    });

    if (!response.ok) {
        const error = new Error(`OpenAI TTS request failed (${response.status}).`);
        error.code = response.status === 429
            ? "OPENAI_TTS_PROVIDER_QUOTA"
            : [401, 403].includes(response.status)
              ? "OPENAI_TTS_PROVIDER_DISABLED"
              : "OPENAI_TTS_SYNTHESIS_FAILED";
        throw error;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer || buffer.length === 0) {
        throw new Error("OpenAI TTS returned empty audio.");
    }
    return buffer;
}

module.exports = {
    MODEL,
    CACHE_VERSION,
    VOICES,
    normalizeLanguage,
    normalizeVoiceId,
    audioCacheKey,
    pcmToWav,
    synthesizeSpeech,
};
