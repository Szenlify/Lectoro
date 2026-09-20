/** Paid speech synthesis supports Review and Hover contexts. */
function isReviewContext(context) {
    return context === "review" || context === "hover";
}

module.exports = { isReviewContext };
