/**
 * TTS module adapter for Lectoro.
 * Powered by OpenAI TTS-1 (with voices Nova and Onyx).
 */
const openAiTts = require("./openai-tts");

module.exports = {
    ...openAiTts,
};
