const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function getAllFiles(dir, exts = ['.js']) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === '.git' || file === 'scratch' || file === 'dist' || file === 'functions') return;
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

const allCode = allFiles.map(f => f.content).join('\n');

allFiles.forEach(file => {
    const funcRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
    const functionsInFile = [];
    let m;
    while ((m = funcRegex.exec(file.content)) !== null) {
        functionsInFile.push(m[1]);
    }

    const dead = [];
    for (const fn of functionsInFile) {
        // Skip factory / UMD wrappers / standard callbacks / tests
        if (fn.startsWith('init') || fn.startsWith('create') || fn === 'factory') continue;
        const countInAll = (allCode.match(new RegExp(`\\b${fn}\\b`, 'g')) || []).length;
        if (countInAll <= 1) {
            dead.push(fn);
        }
    }

    if (dead.length > 0) {
        console.log(`\nFile: ${file.relPath}`);
        console.log('Unreferenced functions:', dead);
    }
});
