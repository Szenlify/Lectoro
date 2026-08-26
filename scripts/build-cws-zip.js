#!/usr/bin/env node
/**
 * Lectoro AI – Chrome Web Store Distribution Package Builder
 *
 * Tworzy czyste, zoptymalizowane archiwum ZIP gotowe do wgrania do Chrome Web Store Developer Dashboard.
 * Automatycznie usuwa pole "key" w paczce ZIP (zachowując je w lokalnym manifest.json do testów).
 * Wyklucza pliki deweloperskie, testy, backend functions/, node_modules, notatki Markdown i katalogi robocze.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const STAGING_DIR = path.join(DIST_DIR, "staging");
const MANIFEST_PATH = path.join(ROOT_DIR, "manifest.json");

if (!fs.existsSync(MANIFEST_PATH)) {
    console.error("❌ Błąd: Brak pliku manifest.json w głównym katalogu projektu.");
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

console.log(`📦 Budowanie paczki produkcyjnej dla Lectoro AI v${version}...`);

// Pliki i foldery wchodzące w skład rozszerzenia
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

// Kopiowanie do katalogu tymczasowego
for (const entry of INCLUDED_ENTRIES) {
    const srcPath = path.join(ROOT_DIR, entry);
    const destPath = path.join(STAGING_DIR, entry);

    if (!fs.existsSync(srcPath)) {
        console.error(`❌ Błąd: Wymagany element '${entry}' nie istnieje w projekcie.`);
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

// Oczyszczenie manifest.json ze statycznego pola "key" w paczce produkcyjnej
const stagingManifestPath = path.join(STAGING_DIR, "manifest.json");
const stagingManifest = JSON.parse(fs.readFileSync(stagingManifestPath, "utf8"));
if (stagingManifest.key) {
    delete stagingManifest.key;
    fs.writeFileSync(
        stagingManifestPath,
        JSON.stringify(stagingManifest, null, 4),
        "utf8",
    );
    console.log("🧹 Usunięto pole 'key' ze staging manifest.json (CWS compliant).");
}

// Pakowanie zawartości katalogu staging do archiwum ZIP
try {
    let packed = false;
    if (process.platform === "win32") {
        try {
            // Windows PowerShell Compress-Archive
            const psScript = `Compress-Archive -Path (Get-ChildItem -Path '${STAGING_DIR}' | Select-Object -ExpandProperty FullName) -DestinationPath '${zipPath}' -Force`;
            execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psScript}"`, {
                cwd: STAGING_DIR,
                stdio: "pipe",
            });
            packed = true;
        } catch (_) {
            try {
                // Windows tar fallback
                execSync(`tar -a -c -f "${zipPath}" *`, {
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
    const stats = fs.statSync(zipPath);
    const sizeKb = (stats.size / 1024).toFixed(1);
    console.log(`✅ Sukces! Utworzono archiwum: dist/${zipName} (${sizeKb} KB)`);
    console.log(`🚀 Paczka jest gotowa do wgrania w Chrome Web Store Developer Dashboard.`);
} catch (err) {
    console.error("❌ Błąd podczas tworzenia pliku ZIP:", err.message);
    process.exit(1);
}
