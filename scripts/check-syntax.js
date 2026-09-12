#!/usr/bin/env node
/**
 * Lectoro AI – JavaScript Syntax Validator
 * Recursively validates all JS files using `node --check`.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", "functions/node_modules"]);

let totalChecked = 0;
let failedFiles = [];

function checkDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(ROOT_DIR, fullPath);

        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name) && !EXCLUDED_DIRS.has(relPath)) {
                checkDirectory(fullPath);
            }
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            totalChecked++;
            try {
                execSync(`node --check "${fullPath}"`, { stdio: "pipe" });
            } catch (err) {
                console.error(`❌ Syntax error in: ${relPath}`);
                failedFiles.push(relPath);
            }
        }
    }
}

console.log("🔍 Checking syntax of all JavaScript files in repository...");
checkDirectory(ROOT_DIR);

if (failedFiles.length > 0) {
    console.error(`\n❌ Failed: ${failedFiles.length} file(s) have syntax errors.`);
    process.exit(1);
} else {
    console.log(`✅ All ${totalChecked} JS files passed syntax check!`);
}
