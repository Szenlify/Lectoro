const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function getAllFiles(dir, exts = ['.js', '.html']) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === '.git' || file === 'scratch' || file === 'dist') return;
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllFiles(fullPath, exts));
        } else {
            const ext = path.extname(fullPath);
            if (exts.includes(ext)) {
                results.push(fullPath);
            }
        }
    });
    return results;
}

const allCodeFiles = getAllFiles(rootDir);
const allFiles = allCodeFiles.map(f => ({
    relPath: path.relative(rootDir, f),
    content: fs.readFileSync(f, 'utf8')
}));

// Analyze functions in video/subtitle-overlay.js
const subOverlayFile = allFiles.find(f => f.relPath === 'video/subtitle-overlay.js');
const funcRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;

const functionsInOverlay = [];
let m;
while ((m = funcRegex.exec(subOverlayFile.content)) !== null) {
    functionsInOverlay.push(m[1]);
}

const unusedInOverlay = [];
for (const fn of functionsInOverlay) {
    // Count occurrences of fn in subOverlayFile
    const countInFile = (subOverlayFile.content.match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
    // Count occurrences in other files
    let countInOthers = 0;
    allFiles.forEach(f => {
        if (f.relPath !== 'video/subtitle-overlay.js') {
            countInOthers += (f.content.match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
        }
    });

    // If only occurs once (definition) or not exported and never called:
    if (countInFile <= 1 && countInOthers === 0) {
        unusedInOverlay.push({ fn, countInFile, countInOthers });
    }
}

console.log(`Functions in subtitle-overlay.js: ${functionsInOverlay.length}`);
console.log('Unused / single-occurrence functions in subtitle-overlay.js:', unusedInOverlay);

// Check core.js
const coreFile = allFiles.find(f => f.relPath === 'core.js');
const functionsInCore = [];
while ((m = funcRegex.exec(coreFile.content)) !== null) {
    functionsInCore.push(m[1]);
}

const unusedInCore = [];
for (const fn of functionsInCore) {
    const countInFile = (coreFile.content.match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
    let countInOthers = 0;
    allFiles.forEach(f => {
        if (f.relPath !== 'core.js') {
            countInOthers += (f.content.match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
        }
    });
    if (countInFile <= 1 && countInOthers === 0) {
        unusedInCore.push({ fn, countInFile, countInOthers });
    }
}
console.log(`Functions in core.js: ${functionsInCore.length}`);
console.log('Unused / single-occurrence functions in core.js:', unusedInCore);
