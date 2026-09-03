/** Server-side policy for ElevenLabs entry points. */
function isReviewContext(context) {
    return context === "review";
}

const ALLOWED_VOICE_KEYS = Object.freeze(["liam", "matilda"]);

module.exports = { isReviewContext, ALLOWED_VOICE_KEYS };
