"use strict";

const fs = require("node:fs");
const path = require("node:path");
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
async function consolidatePair(config, pair, { s3Client, localFallbackDir, forceUpload = false } = {}) {
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
        if (parsed?.entries && typeof parsed.entries === "object") {
            pack = parsed;
            packExistedOnR2 = true;
        }
    } catch (error) {
        if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) {
            console.warn(`[Consolidator] Could not read existing pack for ${pair}:`, error.message);
        }
    }

    // 2. If pack was not on R2, check local starter pack fallback
    if (!packExistedOnR2) {
        const fallbackPath = path.join(
            localFallbackDir || path.join(__dirname, "../dictionaries/packs"),
            `${pair}.json`
        );
        if (fs.existsSync(fallbackPath)) {
            try {
                const localPack = JSON.parse(fs.readFileSync(fallbackPath, "utf-8"));
                if (localPack?.entries) {
                    pack = localPack;
                    console.log(`[Consolidator] Seeded ${pair} from local starter pack (${Object.keys(pack.entries).length} words).`);
                }
            } catch (err) {
                console.warn(`[Consolidator] Failed reading local starter pack for ${pair}:`, err.message);
            }
        }
    }

    // 3. List and merge all live words under dictionaries/live/<pair>/
    let continuationToken = null;
    let newWordsAdded = 0;
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
            break;
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
                    // Skip corrupt or unreadable files gracefully
                }
            }));
        }

        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : null;
    } while (continuationToken);

    // 4. Save updated pack to R2 if new words were added or pack didn't exist or forceUpload is set
    const shouldUpload = newWordsAdded > 0 || !packExistedOnR2 || forceUpload;
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

    return {
        pair,
        packKey,
        totalWords,
        newWordsAdded,
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
    return results;
}

module.exports = {
    consolidatePair,
    consolidateAll,
    SUPPORTED_TARGETS,
    getR2Client,
};
