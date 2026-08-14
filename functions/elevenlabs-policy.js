/** Server-side policy for ElevenLabs entry points. */
function isReviewContext(context) {
    return context === "review";
}

module.exports = { isReviewContext };
