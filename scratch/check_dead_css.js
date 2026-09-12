const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const cssFile = path.join(rootDir, 'styles.css');
const css = fs.readFileSync(cssFile, 'utf8');

// Strip comments and strings to only analyze CSS rules
const cleanedCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''");

// Match rule selectors before {
const selectorBlocks = [];
const ruleRegex = /([^{}]+)\{/g;
let rm;
while ((rm = ruleRegex.exec(cleanedCss)) !== null) {
    selectorBlocks.push(rm[1]);
}

const classMatches = new Set();
const idMatches = new Set();

selectorBlocks.forEach(sel => {
    // Look for .class and #id in selectors only
    const cMatches = sel.match(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g);
    if (cMatches) {
        cMatches.forEach(c => classMatches.add(c.slice(1)));
    }
    const iMatches = sel.match(/#([_a-zA-Z][_a-zA-Z0-9-]*)/g);
    if (iMatches) {
        iMatches.forEach(i => idMatches.add(i.slice(1)));
    }
});

function getAllFiles(dir, exts = ['.js', '.html']) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        if (file === 'node_modules' || file === '.git' || file === 'scratch' || file === 'tests' || file === 'functions' || file === 'dist') return;
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
const allCode = allCodeFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const unusedClasses = [];
const externalClasses = [];
// These selectors target the host player's DOM, not elements created by this extension.
const externalPlayerClass = /^(?:ytp-|watch-video--|vjs-|PlayerControlsNeo__)/;
for (const cls of classMatches) {
    if (externalPlayerClass.test(cls)) {
        externalClasses.push(cls);
        continue;
    }
    const cleanCls = cls.replace(/^__qt_/, '');
    // Check if class exists directly, or dynamically prefixed (e.g. `${PREFIX}cls`), or in constants
    const found = allCode.includes(cls) ||
                  (cls.startsWith('__qt_tb-') && allCode.includes('tb-${kind}') &&
                   allCode.includes(`"${cls.slice('__qt_tb-'.length)}"`)) ||
                  allCode.includes(`"${cleanCls}"`) ||
                  allCode.includes(`'${cleanCls}'`) ||
                  allCode.includes(`\`${cleanCls}\``) ||
                  allCode.includes(`PREFIX + "${cleanCls}"`) ||
                  allCode.includes(`PREFIX + '${cleanCls}'`) ||
                  allCode.includes(`\${PREFIX}${cleanCls}`) ||
                  allCode.includes(`\${P}${cleanCls}`) ||
                  allCode.includes(`UI_CLASSES`) && allCode.includes(cleanCls.replace(/-/g, '_').toUpperCase());
    if (!found) {
        unusedClasses.push(cls);
    }
}

const unusedIds = [];
for (const id of idMatches) {
    const cleanId = id.replace(/^__qt_/, '');
    const found = allCode.includes(id) ||
                  allCode.includes(`"${cleanId}"`) ||
                  allCode.includes(`'${cleanId}'`) ||
                  allCode.includes(`UI_IDS`) && allCode.includes(cleanId.replace(/-/g, '_').toUpperCase());
    if (!found) {
        unusedIds.push(id);
    }
}

console.log(`Real classes in styles.css: ${classMatches.size}`);
console.log(`Unresolved class candidates (verify dynamic generation) (${unusedClasses.length}):`, unusedClasses);
console.log(`Real IDs in styles.css: ${idMatches.size}`);
console.log(`Unresolved ID candidates (${unusedIds.length}):`, unusedIds);

console.log(`Host-player classes (not candidates for removal): ${externalClasses.length}`);
