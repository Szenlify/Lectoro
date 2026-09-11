const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(context, file) {
    vm.runInContext(read(file), context, { filename: file });
}
function loadFunction(context, file, name) {
    const source = read(file).replace(/\r\n/g, "\n");
    const declaration = new RegExp(
        `^( +)(?:async )?function ${name}\\(`,
        "m",
    ).exec(source);
    if (!declaration) throw new Error(`Missing ${name} in ${file}`);
    const end = source.indexOf(`\n${declaration[1]}}\n`, declaration.index);
    if (end < 0) throw new Error(`Missing end of ${name}`);
    vm.runInContext(
        source.slice(declaration.index, end + declaration[1].length + 2),
        context,
    );
}
function storage(initial = {}) {
    const data = { ...initial };
    const listeners = [];
    return {
        data,
        onChanged: { addListener: (fn) => listeners.push(fn) },
        local: {
            async get(defaults) {
                return { ...defaults, ...data };
            },
            async set(values) {
                const changes = {};
                for (const [key, value] of Object.entries(values)) {
                    changes[key] = { oldValue: data[key], newValue: value };
                    data[key] = value;
                }
                for (const fn of listeners) fn(changes, "local");
            },
            async remove(key) {
                delete data[key];
            },
        },
    };
}
function deferred() {
    let resolve, reject;
    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function cssRule(file, selector) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    const tokens = {};
    require("postcss").parse(source).walkDecls((decl) => {
        if (decl.prop.startsWith("--lx-")) tokens[decl.prop] = decl.value;
    });
    const resolve = (value, seen = new Set()) => value.replace(
        /var\((--lx-[\w-]+)\)/g,
        (_, name) => {
            if (!(name in tokens) || seen.has(name)) {
                throw new Error(`Invalid CSS token: ${name}`);
            }
            return resolve(tokens[name], new Set([...seen, name]));
        },
    );
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const declarations = {};
    for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (
            !match[1]
                .split(",")
                .some((item) => normalize(item) === normalize(selector))
        )
            continue;
        for (const part of match[2].split(";")) {
            const colon = part.indexOf(":");
            if (colon >= 0)
                declarations[part.slice(0, colon).trim()] = normalize(
                    resolve(part.slice(colon + 1)),
                );
        }
    }
    return declarations;
}
module.exports = { read, load, loadFunction, storage, deferred, tick, cssRule };
