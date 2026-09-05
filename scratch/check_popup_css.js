const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function checkCssFile(cssFileName, htmlFileNames, jsFileNames) {
    const cssPath = path.join(rootDir, cssFileName);
    if (!fs.existsSync(cssPath)) return;
    const css = fs.readFileSync(cssPath, 'utf8');

    const classes = new Set();
    const matches = css.match(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g) || [];
    matches.forEach(m => classes.add(m.slice(1)));

    const targets = [...htmlFileNames, ...jsFileNames];
    const code = targets.map(f => {
        const p = path.join(rootDir, f);
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    }).join('\n');

    const unused = [];
    for (const cls of classes) {
        if (!code.includes(cls)) {
            unused.push(cls);
        }
    }
    console.log(`\n=== ${cssFileName} ===`);
    console.log(`Total classes: ${classes.size}`);
    console.log(`Unused classes (${unused.length}):`, unused);
}

checkCssFile('popup.css', ['popup.html'], [
    'popup/init.js', 'popup/words.js', 'popup/review.js', 'popup/export.js',
    'popup/firebase-ui.js', 'popup/settings.js', 'popup/tts.js', 'popup/library.js'
]);

checkCssFile('quiz.css', ['quiz.html', 'quiz-runner.html'], ['quiz.js', 'shared/quiz-export.js']);
