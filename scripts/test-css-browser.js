/* Compare source modules to bundles, or a pre-refactor snapshot via --baseline DIR.
 * Uses an isolated browser and blocks network; no user profile or account data.
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const postcss = require("postcss");
const entries = require("../css/entries.json");
const migration = require("../css/class-migration.json");
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const baselineIndex = process.argv.indexOf("--baseline");
const baseline = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
const freeze = "*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}";

// Exercise selector families beyond the initially visible popup, including
// dynamically rendered cards, nested buttons, pseudo-elements and state classes.
function fixture(css, migrate) {
  const chains = [];
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type !== "root") return;
    for (const selector of rule.selectors) {
      if (!selector.startsWith(".") && !selector.startsWith("#__qt_")) continue;
      if (selector.includes(":")) continue; // Interaction states are tested on real controls below.
      const chain = selector.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      if (chain.some((part) => !/^(?:[a-z]+)?(?:[.#][\w-]+)*(?:\[[^\]]+\])?$/.test(part))) continue;
      let html = "CSS sample", valid = true;
      for (const part of chain.reverse()) {
        const tag = /^[a-z]+/.exec(part)?.[0] || (/btn|button|speak/.test(part) ? "button" : "div");
        if (["input", "img", "br", "option"].includes(tag)) { valid = false; break; }
        const id = /#([\w-]+)/.exec(part)?.[1];
        const classes = [...part.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        const value = classes.map((name) => migrate ? migration[name] || name : name).join(" ");
        const attr = /\[([^\]]+)\]/.exec(part)?.[1] || "";
        html = `<${tag}${id ? ` id="${id}"` : ""} class="${value}" ${attr}>${html}</${tag}>`;
      }
      if (valid) chains.push(`<section data-css-fixture>${html}</section>`);
    }
  });
  return chains.join("\n");
}

async function snapshot(page) {
  return page.evaluate(() => [...document.querySelectorAll("body, body *")].flatMap((el, index) => {
    if (el.matches("script, style")) return [];
    return [null, "::before", "::after"].map((pseudo) => {
      const style = getComputedStyle(el, pseudo);
      const values = {};
      // Visual and interaction properties, including shorthand serialization.
      // Avoid serializing hundreds of unrelated browser-default properties for
      // every pseudo-element, which makes this test unnecessarily expensive.
      const properties = `display position inset width height min-width max-width min-height max-height
        margin padding box-sizing flex flex-direction flex-wrap align-items align-self justify-content
        gap grid-template-columns grid-template-rows grid-column grid-row overflow overflow-x overflow-y
        color background border border-radius outline outline-offset box-shadow text-shadow
        font-family font-size font-weight font-style line-height letter-spacing text-align text-transform
        text-decoration white-space word-break text-overflow opacity visibility pointer-events cursor
        user-select z-index transform transform-origin filter backdrop-filter content appearance
        object-fit vertical-align scrollbar-color scrollbar-width clip-path`.split(/\s+/);
      for (const prop of properties) values[prop] = style.getPropertyValue(prop);
      return { index, pseudo, values };
    });
  }));
}

async function main() {
  const executablePath = process.env.CHROME_PATH || (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined);
  const browser = await chromium.launch({ executablePath, headless: true });
  let comparisons = 0, elements = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    await context.route("**/*", (route) => route.abort());
    for (const kind of ["popup", "content"]) {
      const file = kind === "popup" ? "popup.css" : "styles.css";
      const beforeCss = baseline ? fs.readFileSync(path.join(baseline, file), "utf8")
        : entries[kind].map(read).join("\n");
      const afterCss = read(file);
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const pages = await Promise.all([context.newPage(), context.newPage()]);
        for (let i = 0; i < 2; i++) {
          const page = pages[i];
          await page.emulateMedia({ reducedMotion });
          const realHtml = kind === "popup" ? (i === 0 && baseline
            ? fs.readFileSync(path.join(baseline, "popup.html"), "utf8") : read("popup.html")) : "<body><p id='host-sentinel'>Host page</p>";
          const clean = realHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<link\b[^>]*>/gi, "");
          await page.setContent(clean);
          await page.addStyleTag({ content: (i ? afterCss : beforeCss) + freeze });
        }
        const compare = async (label) => {
          const [before, after] = await Promise.all(pages.map(snapshot));
          const diffs = [];
          assert.equal(before.length, after.length, label + " element count");
          for (let i = 0; i < before.length; i++) {
            for (const [prop, value] of Object.entries(before[i].values)) {
              if (after[i].values[prop] !== value) diffs.push({ index: before[i].index, pseudo: before[i].pseudo, prop, before: value, after: after[i].values[prop] });
            }
          }
          assert.equal(diffs.length, 0, `${label}: ${JSON.stringify(diffs.slice(0, 12))}`);
          comparisons++; elements += before.length;
          console.log(`PASS: ${label}`);
        };
        if (kind === "popup") {
          const tabs = await pages[0].locator(".tab-content").count();
          for (let tab = 0; tab < tabs; tab++) {
            for (const page of pages) await page.evaluate((active) => {
              document.querySelectorAll(".tab-content").forEach((el, i) => el.classList.toggle("active", i === active));
            }, tab);
            await compare(`popup tab ${tab}, ${reducedMotion}`);
          }
          for (const selector of [".settings select", '.settings input[type="text"]', ".export-btn"]) {
            for (const page of pages) await page.evaluate((selector) => {
              const el = document.querySelector(selector);
              el?.closest(".tab-content")?.classList.add("active");
              el?.focus();
            }, selector);
            await compare(`focus ${selector}, ${reducedMotion}`);
          }
        } else await compare(`host page, ${reducedMotion}`);
        for (let i = 0; i < 2; i++) {
          await pages[i].setContent(`<body>${fixture(beforeCss, i === 1 && !!baseline)}</body>`);
          await pages[i].addStyleTag({ content: (i ? afterCss : beforeCss) + freeze });
        }
        await compare(`${kind} selector fixtures, ${reducedMotion}`);
        for (const page of pages) await page.close();
      }
    }
  } finally { await browser.close(); }
  console.log(`PASS: ${comparisons} CSS comparisons, ${elements} element/pseudo-element snapshots.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
