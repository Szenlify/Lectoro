"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand
} = require("@aws-sdk/client-s3");

const SUPPORTED_TARGETS = ["pl", "de", "es", "fr", "it", "cs", "ja", "ko", "nl", "pt"];

function getR2Client(config) {
    if (!config?.accountId || !config?.accessKeyId || !config?.secretAccessKey) {
        throw new Error("R2 configuration is incomplete.");
    }
    return new S3Client({
        region: "auto",
        endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
}

async function streamToString(stream) {
    if (!stream) return "";
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Consolidates live word translations into the consolidated language pack on R2.
 */
async function consolidatePair(config, pair, { s3Client, localFallbackDir, forceUpload = false, saveLocal = false } = {}) {
    const s3 = s3Client || getR2Client(config);
    const bucket = config.bucketName || "lectoro-media";
    const packKey = `dictionaries/packs/${pair}.json`;
    const livePrefix = `dictionaries/live/${pair}/`;

    let pack = {
        schemaVersion: 2,
        pair,
        updatedAt: 0,
        entries: {}
    };
    let packExistedOnR2 = false;

    // 1. Try reading existing consolidated pack from R2
    try {
        const getRes = await s3.send(new GetObjectCommand({
            Bucket: bucket,
            Key: packKey,
        }), { abortSignal: AbortSignal.timeout(10000) });
        const json = await streamToString(getRes.Body);
        const parsed = JSON.parse(json);
        if (parsed?.entries && typeof parsed.entries === "object" && !Array.isArray(parsed.entries)) {
            pack = parsed;
            packExistedOnR2 = true;
        } else {
            throw new Error(`Invalid existing pack: ${packKey}`);
        }
    } catch (error) {
        if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) {
            throw new Error(`Could not read existing pack for ${pair}: ${error.message}`, { cause: error });
        }
    }

    const originalEntries = structuredClone(pack.entries);
    let newWordsAdded = 0;

    // 2. Merge local pack entries if local file exists (allows manual additions in project folder)
    const fallbackPath = path.join(
        localFallbackDir || path.join(__dirname, "../dictionaries/packs"),
        `${pair}.json`
    );
    if (fs.existsSync(fallbackPath)) {
        try {
            const localPack = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
            if (localPack?.entries && typeof localPack.entries === "object") {
                if (!packExistedOnR2) {
                    pack = localPack;
                    console.log(`[Consolidator] Seeded ${pair} from local starter pack (${Object.keys(pack.entries).length} words).`);
                } else {
                    let localMergedCount = 0;
                    for (const [rawWord, entry] of Object.entries(localPack.entries)) {
                        const word = rawWord.normalize("NFKC").trim().toLowerCase();
                        if (entry && (entry.languageValidation === 1 || entry.t)) {
                            if (!pack.entries[word]) {
                                newWordsAdded++;
                                localMergedCount++;
                            }
                            pack.entries[word] = entry;
                        }
                    }
                    if (localMergedCount > 0) {
                        console.log(`[Consolidator] Merged ${localMergedCount} new/local words from ${pair}.json into pack.`);
                    }
                }
            }
        } catch (err) {
            console.warn(`[Consolidator] Failed reading local pack for ${pair}:`, err.message);
        }
    }

    // 3. List and merge all live words under dictionaries/live/<pair>/
    let continuationToken = null;
    let liveFilesExamined = 0;

    do {
        let listRes;
        try {
            listRes = await s3.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: livePrefix,
                ContinuationToken: continuationToken,
                MaxKeys: 1000,
            }), { abortSignal: AbortSignal.timeout(10000) });
        } catch (listErr) {
            console.warn(`[Consolidator] List error for ${livePrefix}:`, listErr.message);
            throw listErr;
        }

        const contents = listRes.Contents || [];
        liveFilesExamined += contents.length;

        // Process files in batches of 20 to avoid overwhelming network/memory
        for (let i = 0; i < contents.length; i += 20) {
            const batch = contents.slice(i, i + 20);
            await Promise.all(batch.map(async (item) => {
                try {
                    const obj = await s3.send(new GetObjectCommand({
                        Bucket: bucket,
                        Key: item.Key,
                    }), { abortSignal: AbortSignal.timeout(5000) });
                    const fileContent = JSON.parse(await streamToString(obj.Body));
                    // Content format: { "word": { ...entry } }
                    for (const [rawWord, entry] of Object.entries(fileContent)) {
                        const word = rawWord.normalize("NFKC").trim().toLowerCase();
                        if (entry && entry.languageValidation === 1) {
                            if (!pack.entries[word]) {
                                newWordsAdded++;
                            }
                            pack.entries[word] = entry;
                        }
                    }
                } catch (e) {
                    throw new Error(`Could not read live file ${item.Key}: ${e.message}`, { cause: e });
                }
            }));
        }

        if (listRes.IsTruncated && !listRes.NextContinuationToken) {
            throw new Error(`Missing continuation token for ${livePrefix}`);
        }
        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : null;
    } while (continuationToken);

    // Persist corrections to existing words as well as newly added words.
    const updatedWords = Object.keys(pack.entries).filter(word =>
        Object.hasOwn(originalEntries, word) && !isDeepStrictEqual(originalEntries[word], pack.entries[word])
    ).length;
    const shouldUpload = newWordsAdded > 0 || updatedWords > 0 || !packExistedOnR2 || forceUpload;
    const totalWords = Object.keys(pack.entries).length;

    if (shouldUpload && totalWords > 0) {
        pack.updatedAt = Date.now();
        const bodyBuffer = Buffer.from(JSON.stringify(pack), "utf-8");
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: packKey,
            Body: bodyBuffer,
            ContentType: "application/json; charset=utf-8",
            CacheControl: "public, max-age=3600",
        }), { abortSignal: AbortSignal.timeout(15000) });

        console.log(`[Consolidator] Uploaded ${packKey}: ${totalWords} words (+${newWordsAdded} new).`);
    } else {
        console.log(`[Consolidator] ${pair} is already up to date (${totalWords} words, 0 new).`);
    }

    if (saveLocal && totalWords > 0) {
        const localPath = path.join(
            localFallbackDir || path.join(__dirname, "../dictionaries/packs"),
            `${pair}.json`
        );
        try {
            fs.writeFileSync(localPath, JSON.stringify(pack, null, 2), "utf-8");
            console.log(`[Consolidator] Synced local pack file: ${localPath}`);
        } catch (localErr) {
            console.warn(`[Consolidator] Could not write local pack file:`, localErr.message);
        }
    }

    return {
        pair,
        packKey,
        totalWords,
        newWordsAdded,
        updatedWords,
        liveFilesExamined,
        uploaded: shouldUpload && totalWords > 0,
    };
}

/**
 * Consolidates all standard English -> target language packs.
 */
async function consolidateAll(config, options = {}) {
    const results = [];
    for (const target of SUPPORTED_TARGETS) {
        const pair = `en-${target}`;
        try {
            const res = await consolidatePair(config, pair, options);
            results.push(res);
        } catch (err) {
            console.error(`[Consolidator] Failed consolidating ${pair}:`, err.message);
            results.push({ pair, error: err.message });
        }
    }
    const failures = results.filter(result => result.error);
    if (failures.length) {
        const error = new Error(`Dictionary consolidation failed: ${failures.map(result => `${result.pair}: ${result.error}`).join("; ")}`);
        error.results = results;
        throw error;
    }
    return results;
}

module.exports = {
    consolidatePair,
    consolidateAll,
    SUPPORTED_TARGETS,
    getR2Client,
};
