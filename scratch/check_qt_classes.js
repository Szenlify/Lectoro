const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const cssFile = path.join(rootDir, 'styles.css');
const css = fs.readFileSync(cssFile, 'utf8');

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
const allFilesContent = allCodeFiles.map(f => ({ file: path.relative(rootDir, f), content: fs.readFileSync(f, 'utf8') }));
const allCode = allFilesContent.map(f => f.content).join('\n');

// Find all .__qt_ classes in styles.css
const qtClasses = new Set();
const matches = css.match(/\.__qt_[a-zA-Z0-9_-]+/g) || [];
matches.forEach(m => qtClasses.add(m.slice(1)));

console.log(`Total .__qt_ classes in styles.css: ${qtClasses.size}`);

const dead = [];
for (const cls of qtClasses) {
    const raw = cls.replace(/^__qt_/, '');
    // Check if raw appears anywhere in allCode
    // We check: cls, raw, or if raw has dashes: camelCase or UPPER_SNAKE
    const camel = raw.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const snake = raw.replace(/-/g, '_');
    const upperSnake = snake.toUpperCase();

    const inCode = allCode.includes(cls) ||
                   allCode.includes(raw) ||
                   allCode.includes(camel) ||
                   allCode.includes(snake) ||
                   allCode.includes(upperSnake);

    if (!inCode) {
        dead.push(cls);
    }
}

console.log(`Potentially dead .__qt_ classes (${dead.length}):`, dead);
