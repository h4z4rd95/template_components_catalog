#!/usr/bin/env node
/**
 * verify-demos.mjs — the whole shipped site, page by page, in a real browser.
 *
 * The other gates each own a slice: `verify:pages` the generated tree, `verify:site` the composed
 * pages, `verify:shop` the commerce flow, `verify:theme` contrast, `verify:header` the bar. None of
 * them answers the question a visitor actually asks — *does every demo on this site load?* — because
 * none of them walks the site as a whole, and the interesting failures are exactly the ones that
 * fall between the slices: a link to a page that was renamed by a different generator, an asset
 * that only exists after `npm run build`, a framework route that boots into an empty body.
 *
 * So this gate enumerates every `.html` file under `docs/` (minus the capture folder) and, for each
 * one, at both a desktop and a phone width:
 *
 *   · loads it and records every HTTP failure (404/500) — assets included;
 *   · records uncaught page errors and console errors;
 *   · measures horizontal overflow, and the height of the real content;
 *   · checks the page is not an empty shell (a title, and something visible in the body);
 *   · mounts: for a page with `data-embed`, waits for the frame to arrive and reports whether it
 *     did — a banner slot that silently renders nothing is the failure this catches.
 *
 * Output is a table of every page, so a passing run is also a readable inventory of the site.
 * Exit code 1 if anything is wrong. VISION_PORT for the port (default 4173).
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const PORT = process.env.VISION_PORT || "4173";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;

/** Everything under docs/, minus the vision reel's captures (not part of the site). */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vision" || entry.name === "download") continue;
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A framework's own fallback routes (`404.html`, Nuxt's `200.html`, Next's `_not-found`) are not
 * demos — they are what the export serves when a route does not exist, and their content is
 * deliberately a one-line apology. They are still loaded, so a missing asset is caught, but the
 * content rules do not apply to them.
 *
 * The exemption is scoped to `framework/` on purpose: `docs/404.html` is the *hub's* 404, hand-written
 * chrome that GitHub Pages serves for any unresolvable path, and it has to satisfy every content rule
 * like any other page. Only a framework's generated apology is allowed to be one line long.
 */
const isFallback = (url) =>
  /^framework\//.test(url) && /(^|\/)(404|200)\.html$|_not-found|(^|\/)404\/index\.html$/.test(url);

const files = (await walk(DOCS)).sort();
const pages = files.map((file) => ({
  file,
  url: relative(DOCS, file).split(sep).join("/"),
  kb: 0,
}));
for (const page of pages) page.kb = Math.round((await stat(page.file)).size / 1024);

/**
 * The gate drives a real server rather than starting one, so say so plainly instead of reporting
 * ninety-six pages of `ECONNREFUSED` — which reads like a site-wide failure rather than a missing
 * command. (The preview is what the visitor sees: same static files, same directory-URL routing.)
 */
try {
  const probe = await fetch(`http://127.0.0.1:${PORT}/index.html`, { method: "HEAD" });
  if (!probe.ok) throw new Error(String(probe.status));
} catch (error) {
  console.error(
    `\n  The audit needs the preview running on port ${PORT} — start it first:\n\n` +
      `      npm run preview        # in another terminal\n\n` +
      `  (set VISION_PORT to audit a server on a different port; the probe said: ${error.message})\n`,
  );
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true,
  protocolTimeout: 120_000,
  env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
const rows = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const page of pages) {
  for (const [width, label] of [[1440, "desktop"], [390, "phone"]]) {
    const tab = await browser.newPage();
    const failures = [];
    const consoleErrors = [];
    tab.on("response", (response) => {
      const status = response.status();
      if (status >= 400 && response.url().includes(`:${PORT}/`)) {
        failures.push(`${status} ${response.url().split(`:${PORT}/`)[1]?.split("?")[0]}`);
      }
    });
    tab.on("pageerror", (error) => consoleErrors.push(error.message.split("\n")[0].slice(0, 90)));
    tab.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        // A refused HEAD on a slow frame is Chrome's own noise, and any browser will log it.
        if (/Failed to load resource/.test(text) && /net::ERR_ABORTED/.test(text)) return;
        consoleErrors.push("console: " + text.slice(0, 90));
      }
    });

    await tab.setViewport({ width, height: width > 800 ? 950 : 844 });
    // Loaded as the *directory* URL, the way a visitor arrives by clicking a link: an app route's
    // client router matches paths, and `<route>/index.html` is a path it has no route for (the
    // Nuxt export renders its own 404 for it). The file is still enumerated for coverage.
    const liveUrl = page.url.replace(/index\.html$/, "");
    let navigation = "";
    try {
      await tab.goto(`http://127.0.0.1:${PORT}/${liveUrl}`, { waitUntil: "load", timeout: 45_000 });
    } catch (error) {
      navigation = error.message.split("\n")[0].slice(0, 80);
    }
    // Pages with a live frame need the frame to arrive; a plain page is ready as soon as it paints.
    const hasEmbeds = await tab.evaluate(() => document.querySelectorAll("[data-embed], iframe").length > 0);
    await wait(hasEmbeds ? 1800 : 700);

    const state = await tab.evaluate(async () => {
      const body = document.body;
      const text = (body.innerText || "").trim();
      return {
        title: document.title.trim(),
        textLength: text.length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        embedsRequested: document.querySelectorAll("[data-embed]").length,
        frames: document.querySelectorAll("iframe").length,
        notices: document.querySelectorAll("[data-embed] .site__embed-note, [data-embed] .shop__embed-note").length,
        canvases: document.querySelectorAll("canvas").length,
        shellBar: Boolean(document.querySelector("[data-shell-bar]")),
      };
    });

    // A page that asks for an embed has to end up with either a frame or an honest notice.
    if (state.embedsRequested && !state.frames && !state.notices) {
      problems.push(`${page.url} (${label}): ${state.embedsRequested} embed slot(s) mounted nothing`);
    }
    const fallback = isFallback(page.url);
    if (navigation) problems.push(`${page.url} (${label}): ${navigation}`);
    if (!state.title && !fallback) problems.push(`${page.url} (${label}): no <title>`);
    if (!fallback && state.textLength < 40) {
      problems.push(`${page.url} (${label}): only ${state.textLength} characters of visible text`);
    }
    if (state.overflow > 1) problems.push(`${page.url} (${label}): ${state.overflow}px of horizontal overflow`);
    for (const failure of failures) problems.push(`${page.url} (${label}): ${failure}`);
    // A fallback page is *supposed* to report the missing route (Nuxt logs `NUXT_E1005`); every
    // other page must be silent.
    if (!fallback) {
      for (const error of consoleErrors) problems.push(`${page.url} (${label}): ${error}`);
    }

    rows.push({
      url: page.url,
      label,
      kb: page.kb,
      text: state.textLength,
      frames: state.frames,
      canvases: state.canvases,
      overflow: state.overflow,
      status: failures.length || (!fallback && consoleErrors.length) || navigation || state.overflow > 1 ? "FAIL" : "ok",
    });

    await tab.close();
  }
}

/* ------------------------------------------------- the manifest, as a promise ---
 *
 * The pass above proves every file that exists loads. This one proves the converse, which is the
 * question the catalogue makes to a visitor: **does every variation it advertises have a page — at
 * the address it claims, showing the variation it names?**
 *
 * A file walk cannot answer that. A page can be renamed and its manifest entry left behind; a route
 * can exist and serve an empty shell; the wrong variation can land at the right URL after a bad
 * copy-paste. Each of those ships a catalogue that lies about itself while every per-file check
 * stays green.
 *
 * Two addresses per stable variation, and the rule is the same for both — the page must *be about
 * this variation*, which is checked by its ID appearing in the served document:
 *
 *   · `component/<slug>/` — the catalogue's own page for it, where the metadata HUD is the point;
 *   · `variation.href`    — the content address: a framework route, a vanilla page, or a composed
 *                           site. Their HUDs differ by nature (React/Vue stamp `data-catalog-hud`,
 *                           the vanilla pages carry `.hud` / `.orb-hud`, a composed storefront has
 *                           no variation HUD at all but names the variation it is built from), so
 *                           the check is the ID, not one implementation's DOM.
 *
 * `textContent` rather than `innerText`: a collapsed HUD is hidden, not absent, and a page whose
 * metadata is one click away is not a lying page.
 */
const manifestPath = join(DOCS, "data", "catalog.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const stable = manifest.variations.filter((v) => v.status === "stable");
const contractRows = [];

for (const variation of stable) {
  const targets = [
    { label: "page", url: `component/${variation.slug}/` },
    { label: "route", url: variation.href },
  ];

  for (const target of targets) {
    if (!target.url) {
      problems.push(`${variation.id}: the manifest has no href, so nothing can link to it`);
      contractRows.push({ id: variation.id, label: target.label, ok: false, note: "no href" });
      continue;
    }
    const tab = await browser.newPage();
    await tab.setViewport({ width: 1440, height: 950 });
    let status = 0;
    try {
      const response = await tab.goto(`http://127.0.0.1:${PORT}/${target.url}`, {
        waitUntil: "load",
        timeout: 45_000,
      });
      status = response ? response.status() : 0;
    } catch (error) {
      problems.push(`${variation.id} (${target.label}): ${error.message.split("\n")[0].slice(0, 70)}`);
    }
    // A hydrated app has not named anything at `load`: the Nuxt track ships `ssr: false`, so the
    // HUD arrives when Vue boots. Wait for the name, bounded — a page that never says it is the
    // failure this check exists to catch, and it should be reported as such, not waited on forever.
    // (`innerText` would miss a collapsed HUD; `textContent` sees hidden-but-served content.)
    try {
      await tab.waitForFunction(
        (id) => `${document.title} ${document.documentElement.textContent || ""}`.includes(id),
        { timeout: 8000 },
        variation.id,
      );
    } catch {
      /* fall through — the assertion below reports it with the address and the expectation */
    }
    const found = await tab.evaluate((id) => {
      const text = `${document.title} ${document.documentElement.textContent || ""}`;
      return text.includes(id);
    }, variation.id);

    if (status !== 200) {
      problems.push(`${variation.id} (${target.label}): ${target.url} answered ${status}`);
    } else if (!found) {
      problems.push(
        `${variation.id} (${target.label}): ${target.url} loads but never names ${variation.id}`,
      );
    }
    contractRows.push({ id: variation.id, label: target.label, ok: status === 200 && found, status });
    await tab.close();
  }
}

await browser.close();

/* ------------------------------------------------------------------- report --- */

const width = Math.max(...rows.map((row) => row.url.length)) + 2;
console.log(`\n  ${"page".padEnd(width)} ${"view".padEnd(8)} ${"KB".padStart(5)} ${"text".padStart(6)} ${"frames".padStart(6)} ${"canvas".padStart(6)}  ${"status"}`);
console.log("  " + "─".repeat(width + 44));
for (const row of rows) {
  console.log(
    `  ${row.url.padEnd(width)} ${row.label.padEnd(8)} ${String(row.kb).padStart(5)} ${String(row.text).padStart(6)} ` +
      `${String(row.frames).padStart(6)} ${String(row.canvases).padStart(6)}  ${row.status}`,
  );
}

const unique = [...new Set(pages.map((page) => page.url))];
console.log("  " + "─".repeat(width + 44));
console.log(`  ${unique.length} pages · ${rows.length} loads · ${rows.filter((r) => r.frames).length} with a live frame\n`);

// The manifest contract, printed only when something is wrong — a green list of 44 checks is noise.
const broken = contractRows.filter((row) => !row.ok);
console.log(
  `  manifest: ${stable.length} stable variations × 2 addresses (${contractRows.length} loads) — ` +
    (broken.length ? `${broken.length} BROKEN` : "every variation has its page, at its address, showing its own ID"),
);
if (broken.length) {
  for (const row of broken) console.log(`      ✗ ${row.id} (${row.label})${row.note ? ` — ${row.note}` : ""}`);
}
console.log("");

if (problems.length) {
  console.error("PROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("─".repeat(72));
console.log("  ✓ every demo loads: no missing assets, no page errors, nothing empty, nothing clipped,");
console.log("    and every variation the manifest advertises has its page at the address it claims");
console.log("─".repeat(72) + "\n");
