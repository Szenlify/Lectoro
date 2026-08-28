#!/usr/bin/env node
/**
 * Lectoro AI – Chrome Web Store Distribution Package Builder
 *
 * Creates a clean, optimized ZIP archive ready for upload to Chrome Web Store Developer Dashboard.
 * Automatically removes the "key" field in the ZIP package (retaining it in local manifest.json for testing).
 * Excludes developer files, tests, backend functions/, node_modules, Markdown docs, and temporary folders.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const STAGING_DIR = path.join(DIST_DIR, "staging");
const MANIFEST_PATH = path.join(ROOT_DIR, "manifest.json");

if (!fs.existsSync(MANIFEST_PATH)) {
    console.error("❌ Error: Missing manifest.json in project root.");
    process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const version = manifest.version || "1.0.0";
const zipName = `lectoro-cws-v${version}.zip`;
const zipPath = path.join(DIST_DIR, zipName);

if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
}

console.log(`📦 Building production package for Lectoro AI v${version}...`);

// Files and folders included in extension build
const INCLUDED_ENTRIES = [
    "manifest.json",
    "background.js",
    "content.js",
    "core.js",
    "netflix-player-bridge.js",
    "youtube-player-bridge.js",
    "video-frame-bootstrap.js",
    "popup.html",
    "popup.css",
    "quiz.html",
    "quiz.css",
    "quiz.js",
    "quiz-runner.html",
    "styles.css",
    "icons",
    "popup",
    "shared",
    "adapters",
    "video",
    "firebase/firebase-config.js",
    "firebase/firebase-sync.js",
];

// Copy to staging directory
for (const entry of INCLUDED_ENTRIES) {
    const srcPath = path.join(ROOT_DIR, entry);
    const destPath = path.join(STAGING_DIR, entry);

    if (!fs.existsSync(srcPath)) {
        console.error(`❌ Error: Required entry '${entry}' does not exist in project.`);
        process.exit(1);
    }

    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
        fs.cpSync(srcPath, destPath, {
            recursive: true,
            filter: (src) => {
                const base = path.basename(src);
                return (
                    base !== ".DS_Store" &&
                    !base.endsWith(".test.js") &&
                    !base.endsWith(".ts") &&
                    base !== "__MACOSX"
                );
            },
        });
    } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
    }
}

// Clean manifest.json from development "key" field in production package
const stagingManifestPath = path.join(STAGING_DIR, "manifest.json");
const stagingManifest = JSON.parse(fs.readFileSync(stagingManifestPath, "utf8"));
if (stagingManifest.key) {
    delete stagingManifest.key;
    fs.writeFileSync(
        stagingManifestPath,
        JSON.stringify(stagingManifest, null, 4),
        "utf8",
    );
    console.log("🧹 Removed 'key' field from staging manifest.json (CWS compliant).");
}

// Pack staging contents into ZIP archive
try {
    let packed = false;
    if (process.platform === "win32") {
        try {
            // Windows tar (preferred: produces standard forward slashes '/' in ZIP paths)
            execSync(`tar -a -c -f "${zipPath}" *`, {
                cwd: STAGING_DIR,
                stdio: "pipe",
            });
            packed = true;
        } catch (_) {
            try {
                // Fallback: PowerShell using .NET ZipArchive with forward slash normalization
                const psScript = [
                    "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
                    `$staging = (Get-Item -LiteralPath '${STAGING_DIR.replace(/'/g, "''")}').FullName;`,
                    `$zip = [System.IO.Compression.ZipFile]::Open('${zipPath.replace(/'/g, "''")}', [System.IO.Compression.ZipArchiveMode]::Create);`,
                    "Get-ChildItem -LiteralPath $staging -Recurse -File | ForEach-Object {",
                    "    $rel = $_.FullName.Substring($staging.Length + 1).Replace([char]92, [char]47);",
                    "    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel);",
                    "};",
                    "$zip.Dispose();"
                ].join(" ");
                execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`, {
                    cwd: STAGING_DIR,
                    stdio: "pipe",
                });
                packed = true;
            } catch (_) {}
        }
    }

    if (!packed) {
        // Unix zip command
        execSync(`zip -q -r "${zipPath}" . -x "*.DS_Store" "*__MACOSX*"`, {
            cwd: STAGING_DIR,
            stdio: "inherit",
        });
    }

    fs.rmSync(STAGING_DIR, { recursive: true, force: true });

    // Validate archive entries for Chrome Web Store path compliance
    try {
        const listCmd = process.platform === "win32" ? `tar -t -f "${zipPath}"` : `unzip -Z1 "${zipPath}"`;
        const entries = execSync(listCmd, { stdio: "pipe" }).toString().split(/\r?\n/).filter(Boolean);
        const invalidBackslashes = entries.filter((e) => e.includes("\\"));
        if (invalidBackslashes.length > 0) {
            console.warn(`⚠️ Warning: Found ${invalidBackslashes.length} entries with backslash separators.`);
        } else {
            console.log("🔍 Verified ZIP paths: 100% standard forward slashes '/' (CWS compliant).");
        }
    } catch (_) {}

    const stats = fs.statSync(zipPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`✅ Success! Created archive: dist/${zipName} (${sizeKb} KB)`);
    console.log(`🚀 Package is ready for upload to Chrome Web Store Developer Dashboard.`);
} catch (err) {
    console.error("❌ Error while creating ZIP archive:", err.message);
    process.exit(1);
}
