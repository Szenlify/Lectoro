const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function checkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !["node_modules", ".git", "dist", "scratch"].includes(e.name)) {
            checkDir(full);
        } else if (e.isFile() && e.name.endsWith(".js")) {
            try {
                execSync(`node --check "${full}"`);
            } catch (err) {
                console.error("Syntax error in:", full);
                process.exit(1);
            }
        }
    }
}
checkDir(".");
console.log("All JS syntax checks passed!");
