const test = require("node:test");
const assert = require("node:assert/strict");
const { isReviewContext } = require("./gemini-policy");

test("Gemini TTS accepts Review and Hover contexts", () => {
    assert.equal(isReviewContext("review"), true);
    assert.equal(isReviewContext("hover"), true);
    assert.equal(isReviewContext("content"), false);
    assert.equal(isReviewContext("random"), false);
    assert.equal(isReviewContext(undefined), false);
});
