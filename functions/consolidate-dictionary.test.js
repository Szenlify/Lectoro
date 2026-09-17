"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { consolidatePair } = require("./consolidate-dictionary");

function createMockS3({ r2Files = new Map() } = {}) {
    const uploaded = new Map();
    return {
        r2Files,
        uploaded,
        async send(command) {
            const cmdName = command.constructor.name;
            if (cmdName === "GetObjectCommand" || command.Key) {
                const key = command.input?.Key || command.Key;
                if (!r2Files.has(key)) {
                    const err = new Error("NoSuchKey");
                    err.name = "NoSuchKey";
                    err.$metadata = { httpStatusCode: 404 };
                    throw err;
                }
                const bodyStr = r2Files.get(key);
                return {
                    Body: (async function* () {
                        yield Buffer.from(bodyStr, "utf-8");
                    })(),
                };
            }
            if (cmdName === "ListObjectsV2Command" || command.Prefix) {
                const prefix = command.input?.Prefix || command.Prefix;
                const matches = [];
                for (const key of r2Files.keys()) {
                    if (key.startsWith(prefix)) {
                        matches.push({ Key: key });
                    }
                }
                return {
                    Contents: matches,
                    IsTruncated: false,
                };
            }
            if (cmdName === "PutObjectCommand" || command.Body) {
                const key = command.input?.Key || command.Key;
                const body = command.input?.Body || command.Body;
                uploaded.set(key, body.toString("utf-8"));
                r2Files.set(key, body.toString("utf-8"));
                return { ETag: "\"mock-etag\"" };
            }
            throw new Error(`Unhandled mock S3 command: ${cmdName}`);
        },
    };
}

test("consolidatePair creates pack from local starter pack and live R2 words", async () => {
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consolidate-test-"));
    const starterPack = {
        schemaVersion: 2,
        source: "en",
        target: "pl",
        entries: {
            time: {
                t: "czas",
                d: { s: "Continued progress of existence.", t: "Upływ czasu." },
                s: ["moment"],
                e: [{ s: "Time flies.", t: "Czas leci." }],
                languageValidation: 1
            }
        }
    };
    fs.writeFileSync(path.join(tmpDir, "en-pl.json"), JSON.stringify(starterPack), "utf-8");

    try {
        const r2Files = new Map();
        // Simulate a new live word in R2: dictionaries/live/en-pl/<hash>.json
        const newLiveWord = {
            house: {
                languageValidation: 1,
                t: "dom",
                d: { s: "A building for human habitation.", t: "Budynek mieszkalny dla ludzi." },
                s: ["residence"],
                e: [
                    { s: "They bought a new house.", t: "Kupili nowy dom." },
                    { s: "The house has a large garden.", t: "Dom ma duży ogród." },
                    { s: "Welcome to my house.", t: "Witamy w moim domu." }
                ]
            }
        };
        r2Files.set("dictionaries/live/en-pl/abcdef123456.json", JSON.stringify(newLiveWord));

        const s3Client = createMockS3({ r2Files });
        const config = { bucketName: "lectoro-media" };

        const result = await consolidatePair(config, "en-pl", { s3Client, localFallbackDir: tmpDir });

        assert.equal(result.uploaded, true);
        assert.equal(result.newWordsAdded, 1);
        // Starter pack has 1 word + 1 new word = 2 words
        assert.equal(result.totalWords, 2);

        const savedPackJson = s3Client.uploaded.get("dictionaries/packs/en-pl.json");
        assert.ok(savedPackJson);
        const savedPack = JSON.parse(savedPackJson);
        assert.equal(savedPack.entries.house.t, "dom");
        assert.equal(savedPack.entries.time.t, "czas");
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test("consolidatePair skips invalid entries without languageValidation", async () => {
    const r2Files = new Map();
    const existingPack = {
        schemaVersion: 2,
        pair: "en-pl",
        updatedAt: 1000,
        entries: {
            time: {
                languageValidation: 1,
                t: "czas",
                d: { s: "time", t: "czas" },
                s: [],
                e: [{ s: "time 1", t: "czas 1" }, { s: "time 2", t: "czas 2" }, { s: "time 3", t: "czas 3" }]
            }
        }
    };
    r2Files.set("dictionaries/packs/en-pl.json", JSON.stringify(existingPack));

    // Live file with unverified translation
    r2Files.set("dictionaries/live/en-pl/bad123.json", JSON.stringify({
        bogus: { languageValidation: 0, t: "złe" }
    }));

    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "consolidate-test-empty-"));

    try {
        const s3Client = createMockS3({ r2Files });
        const config = { bucketName: "lectoro-media" };

        const result = await consolidatePair(config, "en-pl", { s3Client, localFallbackDir: emptyTmpDir });

        assert.equal(result.newWordsAdded, 0);
        assert.equal(result.uploaded, false);
    } finally {
        fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
});

for (const failure of ["pack", "list", "live", "corrupt-pack", "corrupt-live"]) {
    test(`consolidatePair refuses to upload after ${failure} failure`, async () => {
        const r2Files = new Map([
            ["dictionaries/packs/en-pl.json", JSON.stringify({ entries: { old: { t: "stare" } } })],
            ["dictionaries/live/en-pl/word.json", JSON.stringify({ house: { t: "dom", languageValidation: 1 } })],
        ]);
        if (failure === "corrupt-pack") r2Files.set("dictionaries/packs/en-pl.json", '{"entries":[]}');
        if (failure === "corrupt-live") r2Files.set("dictionaries/live/en-pl/word.json", 'broken');
        const s3Client = createMockS3({ r2Files });
        const send = s3Client.send.bind(s3Client);
        s3Client.send = async command => {
            if ((failure === "pack" && command.input.Key === "dictionaries/packs/en-pl.json") ||
                (failure === "list" && command.constructor.name === "ListObjectsV2Command") ||
                (failure === "live" && command.input.Key?.includes("/live/"))) {
                throw new Error("Unauthorized");
            }
            return send(command);
        };
        await assert.rejects(consolidatePair({ bucketName: "test" }, "en-pl", {
            s3Client, localFallbackDir: "/nonexistent-test-directory",
        }));
        assert.equal(s3Client.uploaded.size, 0);
    });
}

test("existing word corrections are uploaded, then unchanged runs are idempotent", async () => {
    const s3Client = createMockS3({ r2Files: new Map([
        ["dictionaries/packs/en-pl.json", JSON.stringify({ entries: { house: { t: "błąd", languageValidation: 1 } } })],
        ["dictionaries/live/en-pl/word.json", JSON.stringify({ house: { t: "dom", languageValidation: 1 } })],
    ]) });
    const options = { s3Client, localFallbackDir: "/nonexistent-test-directory" };
    const result = await consolidatePair({ bucketName: "test" }, "en-pl", options);
    assert.equal(result.newWordsAdded, 0);
    assert.equal(result.updatedWords, 1);
    assert.equal(result.uploaded, true);
    assert.equal(JSON.parse(s3Client.uploaded.get(result.packKey)).entries.house.t, "dom");
    assert.equal((await consolidatePair({ bucketName: "test" }, "en-pl", options)).uploaded, false);
});

test("consolidateAll reports failures instead of returning success", async () => {
    const { consolidateAll, SUPPORTED_TARGETS } = require("./consolidate-dictionary");
    let attempts = 0;
    await assert.rejects(consolidateAll({}, {
        s3Client: { async send() { attempts++; throw new Error("Unauthorized"); } },
    }), error => {
        assert.equal(error.results.length, SUPPORTED_TARGETS.length);
        assert.ok(error.results.every(result => result.error.includes("Unauthorized")));
        return true;
    });
    assert.equal(attempts, SUPPORTED_TARGETS.length);
});
