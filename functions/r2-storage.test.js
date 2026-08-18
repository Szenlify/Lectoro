const test = require("node:test");
const assert = require("node:assert/strict");
const {
    computeTextHash,
    getCachedAudio,
    saveCachedAudio,
    saveCardImage,
    deleteCardImage,
    deleteCardImages,
    deleteAllUserImages,
} = require("./r2-storage");

test("computeTextHash produces consistent lowercase sha256", () => {
    const hash1 = computeTextHash("Fascinating");
    const hash2 = computeTextHash("  fascinating  ");
    const hash3 = computeTextHash("different");
    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
});

test("getCachedAudio gracefully returns null when R2 is unconfigured", async () => {
    const result = await getCachedAudio({}, "voice123", "hello world");
    assert.equal(result, null);
});

test("saveCachedAudio gracefully returns null when R2 is unconfigured", async () => {
    const result = await saveCachedAudio({}, "voice123", "hello world", Buffer.from("fake audio"));
    assert.equal(result, null);
});

test("saveCardImage gracefully returns null when R2 is unconfigured", async () => {
    const result = await saveCardImage({}, "user123", "word123", Buffer.from("fake image"));
    assert.equal(result, null);
});

test("deleteCardImage gracefully returns false when R2 is unconfigured", async () => {
    const result = await deleteCardImage({}, "user123", "word123");
    assert.equal(result, false);
});

test("deleteCardImages gracefully returns 0 when R2 is unconfigured", async () => {
    const result = await deleteCardImages({}, "user123", ["word123", "word456"]);
    assert.equal(result, 0);
});

test("deleteAllUserImages gracefully returns 0 when R2 is unconfigured", async () => {
    const result = await deleteAllUserImages({}, "user123");
    assert.equal(result, 0);
});
