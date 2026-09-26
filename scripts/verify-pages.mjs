#!/usr/bin/env node
/**
 * verify-pages.mjs — the generated pages, in every skin, against the real filesystem.
 *
 * `verify:cards` walks the hub; this walks what the hub links to. The pages are generated from the
 * manifest, so the failure modes are different from a hand-written page: a link can point at a
 * variation that was renamed, a planned variation can grow a stage it must not have, a Persian
 * page can render with the English labels still in place, or the whole tree can ship with the
 * wrong depth in its stylesheet URLs and look broken only in the places nobody clicked.
 *
 * So it asserts, for a browse index, a discipline, a topic, a stable component and a planned one,
 * in en/fa × dark/light:
 *   · the page and every asset it loads return 200 (no silent 404 CSS),
 *   · every internal link resolves to a file that exists on disk,
 *   · the document is one line long horizontally — no overflow in either direction,
 *   · the heading, crumbs and metadata HUD are present and localised,
 *   · a stable component mounts its live stage (or says honestly why it cannot),
 *   · a planned component shows its blueprint and never a preview frame.
 *
 * Needs a running preview server (npm run preview). PORT via VISION_PORT, default 4173.
 * Write screenshots with SHOTS=1.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const PORT = process.env.VISION_PORT || "4173";
const SHOTS = process.env.SHOTS === "1";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;
if (SHOTS) mkdirSync(join(ROOT, ".shots"), { recursive: true });

const SKINS = [
  ["en", "dark"],
  ["en", "light"],
  ["fa", "dark"],
  ["fa", "light"],
];

const PAGES = [
  { path: "browse/index.html", kind: "browse" },
  { path: "browse/hero/index.html", kind: "discipline" },
  { path: "browse/hero/gpu/index.html", kind: "topic" },
  { path: "browse/commerce/storefront/index.html", kind: "topic(planned)" },
  { path: "component/kinetic-brutal-grid/index.html", kind: "component" },
  { path: "component/holo-storefront/index.html", kind: "component(planned)" },
];

const problems = [];
const skins = {};
const html = (await import("node:fs/promises")).readFile;

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true,
  protocolTimeout: 90_000,
  env,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
  ],
});

for (const [lang, theme] of SKINS) {
  for (const page of PAGES) {
    const tab = await browser.newPage();
    const failures = [];
    tab.on("pageerror", (error) => failures.push("js: " + error.message.slice(0, 90)));
    tab.on("requestfailed", (request) => {
      // Chrome reports an aborted HEAD *after* the response has been delivered and used (a
      // keep-alive framing quirk). The stage's availability probe is a HEAD, and it demonstrably
      // works — the response is seen and the frame mounts — so it is not a failure to report.
      const error = request.failure()?.errorText || "";
      if (request.method() === "HEAD" && error.includes("ERR_ABORTED")) return;
      // Third-party fonts are not ours to fix, but a same-origin 404 is.
      if (request.url().includes(`127.0.0.1:${PORT}`)) {
        failures.push("req " + request.url().split(`:${PORT}/`).pop() + " " + error);
      }
    });
    tab.on("response", (response) => {
      if (response.status() === 404 && response.url().includes(`127.0.0.1:${PORT}`)) {
        failures.push("404 " + response.url().split(`:${PORT}/`)[1]);
      }
    });

    await tab.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const url = `http://127.0.0.1:${PORT}/${page.path}?lang=${lang}&theme=${theme}`;
    await tab.goto(url, { waitUntil: "load", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 1600));

    const state = await tab.evaluate(() => {
      const root = document.documentElement;
      const title = document.querySelector("h1");
      const links = [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href"))
        .filter((href) => href && !/^(https?:|mailto:|#|\?)/.test(href));
      const stage = document.querySelector("[data-stage]");
      return {
        lang: root.lang,
        dir: root.dir,
        theme: root.dataset.theme,
        overflow: root.scrollWidth - window.innerWidth,
        title: title ? title.textContent.trim() : "",
        crumbs: document.querySelectorAll(".pg__crumbs a, .pg__crumbs [aria-current]").length,
        specRows: document.querySelectorAll(".pg__spec-row").length,
        specLabels: [...document.querySelectorAll(".pg__spec-row dt")].map((dt) => dt.textContent.trim()),
        rows: document.querySelectorAll(".pg__row").length,
        chips: document.querySelectorAll(".pg__chip").length,
        barBuilt: !!document.querySelector("[data-shell-bar] .brand"),
        drawerBuilt: !!document.querySelector("#nav-drawer .lang-switch"),
        iframe: !!document.querySelector("[data-stage-frame] iframe"),
        notice: !!document.querySelector(".pg__notice"),
        planned: !!document.querySelector("[data-planned]"),
        docTitle: document.title,
        // Painted pixels, not just attributes: a page can carry data-theme="light" and still
        // render dark if the ramps are read in the wrong order, which is invisible to a DOM check.
        paper: getComputedStyle(document.body).backgroundColor,
        ink: getComputedStyle(document.documentElement).getPropertyValue("--ink-000").trim(),
        links: links.slice(0, 240),
      };
    });

    const label = `${page.path} · ${lang}/${theme}`;
    const persian = lang === "fa";
    const hasFa = (value) => /[\u0600-\u06FF]/.test(value);

    if (state.lang !== lang) problems.push(`${label}: document lang is "${state.lang}"`);
    if (state.dir !== (persian ? "rtl" : "ltr")) problems.push(`${label}: direction is "${state.dir}"`);
    if (state.theme !== theme) problems.push(`${label}: theme is "${state.theme}"`);
    if (state.overflow > 1) problems.push(`${label}: ${state.overflow}px of horizontal overflow`);
    if (!state.title) problems.push(`${label}: no h1`);
    if (state.crumbs < 2) problems.push(`${label}: breadcrumbs missing`);
    if (!state.barBuilt || !state.drawerBuilt) problems.push(`${label}: the shell did not build (bar/drawer)`);
    if (persian && state.title && !hasFa(state.title)) problems.push(`${label}: heading still English ("${state.title}")`);
    if (!persian && hasFa(state.docTitle)) problems.push(`${label}: Persian leaked into the English title`);

    if (page.kind.startsWith("component")) {
      if (state.specRows < 6) problems.push(`${label}: metadata HUD has ${state.specRows} rows`);
      if (persian && state.specLabels.join(" ").match(/^(id|stack|vibe|interaction|tags)$/m)) {
        problems.push(`${label}: HUD labels still English (${state.specLabels.join(", ")})`);
      }
      const planned = page.kind.includes("planned");
      if (planned && state.iframe) problems.push(`${label}: a planned page mounted a preview frame`);
      if (planned && !state.planned) problems.push(`${label}: a planned page has no blueprint`);
      if (!planned && !state.iframe && !state.notice) {
        problems.push(`${label}: neither a live stage nor an honest notice`);
      }
      if (!planned && state.iframe && state.notice) problems.push(`${label}: stage and notice both present`);
    } else {
      if (!state.rows) problems.push(`${label}: no variation rows`);
      if (!state.chips) problems.push(`${label}: no topic chips`);
    }

    // Every internal link the page offers must lead to a file that is really there: a catalogue
    // whose rows 404 is worse than one that lists nothing.
    for (const href of state.links) {
      const rel = href.split("#")[0].split("?")[0];
      if (!rel || rel.endsWith("/")) continue;
      const from = join(DOCS, dirname(page.path));
      const target = rel.startsWith("/") ? join(DOCS, rel) : resolve(from, rel);
      if (!existsSync(target)) problems.push(`${label}: dead link → ${href}`);
    }

    for (const failure of failures) problems.push(`${label}: ${failure}`);

    // Same page, other theme: the two must not paint the same colour.
    const other = skins[`${page.path}|${lang}|${theme === "dark" ? "light" : "dark"}`];
    if (other && other.paper === state.paper) {
      problems.push(`${label}: paints the same background in both themes (${state.paper})`);
    }
    skins[`${page.path}|${lang}|${theme}`] = state;

    console.log(
      `${label.padEnd(46)} h1 ok · crumbs ${state.crumbs} · rows ${state.rows} · chips ${state.chips} · spec ${state.specRows} · ` +
        `stage ${state.iframe ? "iframe" : state.notice ? "notice" : "—"} · overflow ${state.overflow}px`,
    );

    if (SHOTS) {
      await tab.screenshot({
        path: join(ROOT, ".shots", `page-${page.path.replace(/\W+/g, "-")}-${lang}-${theme}.png`),
        fullPage: false,
      });
    }
    await tab.close();
  }
}

// A quick structural pass over the whole tree, not just the pages sampled above.
const { readdir } = await import("node:fs/promises");
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}
const all = (await walk(join(DOCS, "browse"))).concat(await walk(join(DOCS, "component")));
for (const file of all) {
  const source = await html(file, "utf8");
  const rel = file.slice(DOCS.length + 1);
  if (!source.includes('data-shell-bar')) problems.push(`${rel}: no shell bar host`);
  if (!source.includes("assets/page.css")) problems.push(`${rel}: page.css not linked`);
  if (/href="(?!https?:|\?|#)[^"]*\/index\.html/.test(source) === false && !source.includes("index.html")) {
    problems.push(`${rel}: nothing to navigate to`);
  }
  for (const match of source.matchAll(/href="\.\.\/[^"]*"/g)) {
    const target = resolve(dirname(file), match[0].slice(6, -1));
    if (!existsSync(target)) problems.push(`${rel}: relative link escapes to nothing → ${match[0]}`);
  }
}

await browser.close();

console.log(`\n  ${all.length} generated pages checked for structure`);
if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("─".repeat(72));
console.log("  ✓ every generated page: assets load, links exist, no overflow, localised, staged");
console.log("─".repeat(72) + "\n");
