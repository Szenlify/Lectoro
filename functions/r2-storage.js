/**
 * Cloudflare R2 Storage integration for Lectoro (S3-compatible).
 * Central audio cache for ElevenLabs & optimized WebP flashcard images.
 */
const crypto = require("crypto");

let S3Sdk = null;
function getS3Sdk() {
    if (!S3Sdk) {
        S3Sdk = require("@aws-sdk/client-s3");
    }
    return S3Sdk;
}

let cachedClient = null;
let lastConfigHash = "";

function computeTextHash(text) {
    return crypto
        .createHash("sha256")
        .update(String(text || "").trim().toLowerCase())
        .digest("hex");
}

function getR2Client(config) {
    const { accountId, accessKeyId, secretAccessKey } = config;
    if (!accountId || !accessKeyId || !secretAccessKey) return null;

    const configHash = `${accountId}:${accessKeyId}`;
    if (cachedClient && lastConfigHash === configHash) {
        return cachedClient;
    }

    try {
        const { S3Client } = getS3Sdk();
        cachedClient = new S3Client({
            region: "auto",
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
        lastConfigHash = configHash;
        return cachedClient;
    } catch (error) {
        console.warn("[R2 Storage] Failed to initialize S3 client:", error.message);
        return null;
    }
}

async function streamToBuffer(stream) {
    if (!stream) return Buffer.alloc(0);
    if (Buffer.isBuffer(stream)) return stream;
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

/**
 * Check and fetch cached ElevenLabs audio from Cloudflare R2.
 */
async function getCachedAudio(config, voiceId, text) {
    const s3 = getR2Client(config);
    const bucket = config.bucketName;
    if (!s3 || !bucket) return null;

    const hash = computeTextHash(text);
    const safeVoiceId = String(voiceId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
    const key = `audio/${safeVoiceId}/${hash}.mp3`;

    try {
        const { GetObjectCommand } = getS3Sdk();
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        const response = await s3.send(command);
        const buffer = await streamToBuffer(response.Body);
        const publicUrl = config.publicUrl
            ? `${config.publicUrl.replace(/\/+$/, "")}/${key}`
            : null;

        return {
            key,
            buffer,
            publicUrl,
            contentType: response.ContentType || "audio/mpeg",
        };
    } catch (error) {
        // NoSuchKey / 404 is expected on cache miss
        if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) {
            console.warn(`[R2 Storage] getCachedAudio error for ${key}:`, error.message);
        }
        return null;
    }
}

/**
 * Save synthesized ElevenLabs audio buffer to Cloudflare R2.
 */
async function saveCachedAudio(config, voiceId, text, audioBuffer) {
    const s3 = getR2Client(config);
    const bucket = config.bucketName;
    if (!s3 || !bucket || !audioBuffer || audioBuffer.length === 0) return null;

    const hash = computeTextHash(text);
    const safeVoiceId = String(voiceId || "default").replace(/[^a-zA-Z0-9_-]/g, "");
    const key = `audio/${safeVoiceId}/${hash}.mp3`;

    try {
        const { PutObjectCommand } = getS3Sdk();
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: audioBuffer,
            ContentType: "audio/mpeg",
            CacheControl: "public, max-age=31536000, immutable",
            Metadata: {
                voiceId: safeVoiceId,
                hash,
            },
        });
        await s3.send(command);
        const publicUrl = config.publicUrl
            ? `${config.publicUrl.replace(/\/+$/, "")}/${key}`
            : null;
        console.log(`[R2 Storage] Cached audio: ${key} (${audioBuffer.length} bytes)`);
        return { key, publicUrl };
    } catch (error) {
        console.warn(`[R2 Storage] saveCachedAudio failed for ${key}:`, error.message);
        return null;
    }
}

/**
 * Save user review screenshot/image to Cloudflare R2 as WebP.
 */
async function saveCardImage(config, uid, wordId, imageBuffer, contentType = "image/webp") {
    const s3 = getR2Client(config);
    const bucket = config.bucketName;
    if (!s3 || !bucket || !imageBuffer || imageBuffer.length === 0) return null;

    const safeUid = String(uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "");
    const safeWordId = String(wordId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "");
    const ext = contentType.includes("webp")
        ? "webp"
        : contentType.includes("png")
          ? "png"
          : "jpg";
    const key = `images/${safeUid}/${safeWordId}.${ext}`;

    try {
        const { PutObjectCommand } = getS3Sdk();
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: imageBuffer,
            ContentType: contentType,
            CacheControl: "public, max-age=31536000, immutable",
        });
        await s3.send(command);
        const basePublicUrl = config.publicUrl || "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev";
        const publicUrl = `${basePublicUrl.replace(/\/+$/, "")}/${key}`;
        console.log(`[R2 Storage] Uploaded image: ${key} (${imageBuffer.length} bytes)`);
        return { key, publicUrl };
    } catch (error) {
        console.warn(`[R2 Storage] saveCardImage failed for ${key}:`, error.message);
        return null;
    }
}

/**
 * Delete a single card image from Cloudflare R2.
 */
async function deleteCardImage(config, uid, wordId) {
    const s3 = getR2Client(config);
    const bucket = config?.bucketName;
    if (!s3 || !bucket || !wordId) return false;

    const safeUid = String(uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "");
    const safeWordId = String(wordId).replace(/[^a-zA-Z0-9_-]/g, "");
    const { DeleteObjectsCommand } = getS3Sdk();

    const keysToDelete = [
        { Key: `images/${safeUid}/${safeWordId}.webp` },
        { Key: `images/${safeUid}/${safeWordId}.jpg` },
        { Key: `images/${safeUid}/${safeWordId}.png` },
    ];

    try {
        const command = new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keysToDelete, Quiet: true },
        });
        await s3.send(command);
        console.log(`[R2 Storage] Deleted image for wordId: ${safeWordId} (user ${safeUid})`);
        return true;
    } catch (error) {
        console.warn(`[R2 Storage] deleteCardImage failed for ${safeWordId}:`, error.message);
        return false;
    }
}

/**
 * Batch delete multiple card images from Cloudflare R2.
 */
async function deleteCardImages(config, uid, wordIds = []) {
    const s3 = getR2Client(config);
    const bucket = config?.bucketName;
    if (!s3 || !bucket || !Array.isArray(wordIds) || wordIds.length === 0) return 0;

    const safeUid = String(uid || "anon").replace(/[^a-zA-Z0-9_-]/g, "");
    const { DeleteObjectsCommand } = getS3Sdk();

    const keysToDelete = [];
    for (const wordId of wordIds) {
        const safeWordId = String(wordId).replace(/[^a-zA-Z0-9_-]/g, "");
        if (safeWordId) {
            keysToDelete.push(
                { Key: `images/${safeUid}/${safeWordId}.webp` },
                { Key: `images/${safeUid}/${safeWordId}.jpg` },
                { Key: `images/${safeUid}/${safeWordId}.png` },
            );
        }
    }

    if (keysToDelete.length === 0) return 0;

    let totalDeleted = 0;
    while (keysToDelete.length > 0) {
        const chunk = keysToDelete.splice(0, 1000);
        try {
            const command = new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: chunk, Quiet: true },
            });
            await s3.send(command);
            totalDeleted += chunk.length / 3;
        } catch (error) {
            console.warn("[R2 Storage] deleteCardImages batch error:", error.message);
        }
    }
    return totalDeleted;
}

/**
 * Delete all images belonging to a user from Cloudflare R2.
 */
async function deleteAllUserImages(config, uid) {
    const s3 = getR2Client(config);
    const bucket = config?.bucketName;
    if (!s3 || !bucket || !uid) return 0;

    const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, "");
    const prefix = `images/${safeUid}/`;
    const { ListObjectsV2Command, DeleteObjectsCommand } = getS3Sdk();

    let totalDeleted = 0;
    let continuationToken = undefined;

    try {
        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            });
            const listRes = await s3.send(listCommand);
            const objects = (listRes.Contents || []).map((o) => ({ Key: o.Key }));

            if (objects.length > 0) {
                const deleteCommand = new DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: { Objects: objects, Quiet: true },
                });
                await s3.send(deleteCommand);
                totalDeleted += objects.length;
            }

            continuationToken = listRes.IsTruncated
                ? listRes.NextContinuationToken
                : undefined;
        } while (continuationToken);

        console.log(`[R2 Storage] deleteAllUserImages: deleted ${totalDeleted} images for user ${safeUid}`);
        return totalDeleted;
    } catch (error) {
        console.warn(`[R2 Storage] deleteAllUserImages failed for ${safeUid}:`, error.message);
        return totalDeleted;
    }
}

module.exports = {
    computeTextHash,
    getCachedAudio,
    saveCachedAudio,
    saveCardImage,
    deleteCardImage,
    deleteCardImages,
    deleteAllUserImages,
};
