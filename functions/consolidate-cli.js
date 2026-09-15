#!/usr/bin/env node
"use strict";

const { consolidatePair, consolidateAll, SUPPORTED_TARGETS } = require("./consolidate-dictionary");

function getR2Config() {
    return {
        accountId: process.env.R2_ACCOUNT_ID || "94b9a2de404c8e3f8efa532d0607b5f1",
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "de6bc2bd824ee7c0963e2df93f80c22b",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME || "lectoro-media",
        publicUrl: process.env.R2_PUBLIC_URL || "https://pub-ee4534784e534bd9af38ba8022bc5e1e.r2.dev",
    };
}

async function main() {
    const args = process.argv.slice(2);
    const targetArg = args[0] || "en-pl";
    const forceUpload = args.includes("--force");

    const config = getR2Config();
    if (!config.secretAccessKey) {
        console.error("Error: R2_SECRET_ACCESS_KEY environment variable is required.");
        console.error("Example usage:");
        console.error("  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node functions/consolidate-cli.js en-pl --force");
        console.error("  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node functions/consolidate-cli.js all --force");
        process.exit(1);
    }

    console.log(`[Consolidator CLI] Starting consolidation for: ${targetArg} (force: ${forceUpload})`);
    console.log(`[Consolidator CLI] Using Account ID: ${config.accountId}`);
    console.log(`[Consolidator CLI] Using Access Key ID: ${config.accessKeyId}`);

    if (targetArg === "all") {
        const results = await consolidateAll(config, { forceUpload });
        console.log("\nSummary of all pairs:");
        console.table(results);
    } else {
        const result = await consolidatePair(config, targetArg, { forceUpload });
        console.log("\nResult:", result);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error("[Consolidator CLI] Fatal error:", err);
        process.exit(1);
    });
}
