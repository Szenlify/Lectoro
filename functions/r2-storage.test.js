const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
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

test("translation objects distinguish missing data from denied access and use conditional writes", async t => {
    const calls = [];
    let failure;
    const original = Module._load;
    t.mock.method(Module, "_load", function(name, ...args) {
        if (name !== "@aws-sdk/client-s3") return original.call(this, name, ...args);
        return {
            S3Client: class { async send(command) {
                calls.push(command.input);
                if (failure) throw failure;
                return { ContentLength: 10, ETag: '"old-version"', Body: Buffer.from('{"t":"dom"}') };
            } },
            GetObjectCommand: class { constructor(input) { this.input = input; } },
            PutObjectCommand: class { constructor(input) { this.input = input; } },
        };
    });
    const { getTranslationJson, putTranslationJson } = require("./r2-storage");
    const config = { accountId: "test", accessKeyId: "test", secretAccessKey: "test", bucketName: "test" };
    assert.deepEqual(await getTranslationJson(config, "words/test.json"), { t: "dom" });
    const record = await getTranslationJson(config, "words/test.json", { withMetadata: true });
    assert.deepEqual(record, { value: { t: "dom" }, etag: '"old-version"' });
    await putTranslationJson(config, "words/test.json", { t: "poprawiony" }, { etag: record.etag });
    assert.equal(calls.at(-1).IfMatch, '"old-version"');
    assert.equal(calls.at(-1).IfNoneMatch, undefined);
    assert.equal(calls.at(-1).Body, '{"t":"poprawiony"}');
    failure = { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
    assert.equal(await getTranslationJson(config, "words/missing.json"), null);
    failure = Object.assign(new Error("Denied"), { $metadata: { httpStatusCode: 403 } });
    await assert.rejects(getTranslationJson(config, "words/denied.json"), /Denied/);
    failure = null;
    await putTranslationJson(config, "words/test.json", { t: "dom" });
    assert.equal(calls.at(-1).IfNoneMatch, "*");
    assert.equal(calls.at(-1).Body, '{"t":"dom"}');
    failure = Object.assign(new Error("Already exists"), { $metadata: { httpStatusCode: 412 } });
    await assert.rejects(putTranslationJson(config, "words/test.json", { t: "overwrite" }), /Already exists/);
    await assert.rejects(putTranslationJson(config, "words/test.json", { t: "overwrite" }, { etag: '"stale-version"' }), /Already exists/);
});
