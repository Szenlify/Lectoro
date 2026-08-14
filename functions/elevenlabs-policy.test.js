const test = require("node:test");
const assert = require("node:assert/strict");
const { isReviewContext } = require("./elevenlabs-policy");

test("ElevenLabs accepts only the explicit Review context", () => {
    assert.equal(isReviewContext("review"), true);
    assert.equal(isReviewContext("content"), false);
    assert.equal(isReviewContext("random"), false);
    assert.equal(isReviewContext(undefined), false);
});
