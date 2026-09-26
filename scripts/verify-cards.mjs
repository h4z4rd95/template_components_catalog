#!/usr/bin/env node
/**
 * verify-cards.mjs — the card completeness gate.
 *
 * The catalogue is bilingual (fa/en) and dual-theme (day/night). A card that is complete in one
 * of those four skins and broken in another is a bug a screenshot of the default view will never
 * show — and it is exactly how the Persian column ended up with zero live previews while English
 * mounted four.
 *
 * This walks the hub in all four skins and asserts, per card:
 *   · its frame has a mode: a live iframe, a loading placeholder, or the planned blueprint panel
 *   · a planned variation shows the panel and never the live placeholder
 *   · a shipped variation never shows the planned panel
 *   · no card prints a promise it cannot keep
 *   · the metadata HUD carries its title, vibe, interaction and tags
 *
 * Run: npm run verify:cards      (expects a preview server on 4173 or VISION_PORT)
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const PORT = Number(process.env.VISION_PORT || 4173);
const BASE = `http://127.0.0.1:${PORT}`;
const SKINS = [
  ["en", "dark"],
  ["en", "light"],
  ["fa", "dark"],
  ["fa", "light"],
];
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true, protocolTimeout: 90_000, env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
for (const [lang, theme] of SKINS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?lang=${lang}&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2500));
  const report = await page.evaluate(() => {
    const out = [];
    [...document.querySelectorAll(".card")].forEach((card) => {
      const frame = card.querySelector(".card__frame");
      const planned = card.dataset.planned === "1";
      const isIframe = !!frame?.querySelector("iframe");
      const isPanel = !!frame?.querySelector(".card__planned");
      const isPlaceholder = !!frame?.querySelector(".card__placeholder");
      const text = (frame?.textContent || "").trim();
      out.push({
        id: card.id.replace(/^card-/, ""),
        planned,
        modes: [isIframe && "iframe", isPanel && "panel", isPlaceholder && "placeholder"].filter(Boolean),
        frameText: text.slice(0, 40),
        hasTitle: !!card.querySelector(".card__title")?.textContent?.trim(),
        hasVibe: !!card.querySelector(".card__vibe")?.textContent?.trim(),
        hasNote: !!card.querySelector("dd")?.textContent?.trim(),
        tags: card.querySelectorAll(".card__tag").length,
      });
    });
    return out;
  });
  report.forEach((c) => {
    const modes = c.modes.join("+") || "EMPTY";
    if (modes === "EMPTY") problems.push(`${lang}/${theme} ${c.id}: frame has no mode`);
    if (c.planned && modes !== "panel") problems.push(`${lang}/${theme} ${c.id}: planned but frame is ${modes}`);
    if (!c.planned && modes === "panel") problems.push(`${lang}/${theme} ${c.id}: live but shows a planned panel`);
    // the placeholder caption is localised, so match the i18n keys rather than the English text
    if (c.planned && /mounts|نمایش زنده|Live preview/i.test(c.frameText))
      problems.push(`${lang}/${theme} ${c.id}: dangling promise`);
    if (!c.hasTitle || !c.hasVibe || !c.hasNote) problems.push(`${lang}/${theme} ${c.id}: HUD incomplete`);
    if (!c.tags) problems.push(`${lang}/${theme} ${c.id}: no tags`);
  });
  const planned = report.filter((c) => c.planned).length;
  const mounted = await page.evaluate(() => document.querySelectorAll(".card__frame iframe").length);
  console.log(`${lang}/${theme}: ${report.length} cards · ${planned} planned · ${mounted} live frames · modes ${[...new Set(report.map((c) => c.modes.join("+") || "EMPTY"))].join(", ")}`);
  await page.close();
}
await browser.close();

const line = "─".repeat(72);
console.log(`\n${line}`);
if (problems.length) {
  console.log(`  ✖ ${problems.length} card problem(s):`);
  for (const problem of problems) console.log(`    · ${problem}`);
  console.log(`${line}\n`);
  process.exit(1);
}
console.log(`  ✓ every card is complete in all ${SKINS.length} skins (en/fa × day/night)`);
console.log(`${line}\n`);
