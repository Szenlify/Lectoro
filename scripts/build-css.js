const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const entries = require("../css/entries.json");
const outputs = {
  content: "styles.css",
  popup: "popup.css",
};

/**
 * Compiles and bundles CSS entry points into clean, human-readable stylesheets.
 * Uses pure Node.js (no external dependencies required).
 */
function compile(kind) {
  if (!entries[kind]) {
    throw new Error(`Unknown CSS entry kind: "${kind}". Expected one of: ${Object.keys(entries).join(", ")}`);
  }

  const isContent = kind === "content";
  const title = isContent ? "Content Script Stylesheet (SSOT)" : "Popup Extension Stylesheet";
  const targetFile = outputs[kind];

  const header =
    "/* ==========================================================================\n" +
    `   Lectoro AI – ${title}\n` +
    `   Bundled into ${targetFile} for Chrome Extension\n` +
    "   Universal & Human-Readable (No Chained #id.class Selectors)\n" +
    "   ========================================================================== */\n";

  const chunks = [header];

  for (const relativePath of entries[kind]) {
    const fullPath = path.join(ROOT, relativePath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[build-css] Warning: Source file not found: ${relativePath}`);
      continue;
    }

    const fileContent = fs.readFileSync(fullPath, "utf8").trim();
    chunks.push(
      `\n/* -------------------------------------------------------------------------- */\n` +
      `/* Source: ${relativePath} */\n` +
      `/* -------------------------------------------------------------------------- */\n\n` +
      fileContent +
      "\n"
    );
  }

  return chunks.join("\n");
}

/**
 * Builds all defined CSS targets or validates that existing files are up to date.
 */
function build({ check = false } = {}) {
  for (const [kind, fileName] of Object.entries(outputs)) {
    const compiledCss = compile(kind);
    const targetPath = path.join(ROOT, fileName);

    if (check) {
      if (!fs.existsSync(targetPath)) {
        throw new Error(`${fileName} does not exist. Run "npm run build:css" or "node scripts/build-css.js".`);
      }
      const existingCss = fs.readFileSync(targetPath, "utf8");
      if (existingCss !== compiledCss) {
        throw new Error(`${fileName} is stale. Run "npm run build:css" to update it.`);
      }
      console.log(`✓ ${fileName} is up to date (${Buffer.byteLength(compiledCss)} bytes)`);
    } else {
      fs.writeFileSync(targetPath, compiledCss, "utf8");
      console.log(`✓ Generated ${fileName} (${Buffer.byteLength(compiledCss)} bytes)`);
    }
  }
}

if (require.main === module) {
  const checkMode = process.argv.includes("--check");
  try {
    build({ check: checkMode });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { compile, build };
