/** Temporary: every card, in all four skins, must be complete — no dangling promises, no voids. */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true, protocolTimeout: 90_000, env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
for (const [lang, theme] of [["en", "dark"], ["en", "light"], ["fa", "dark"], ["fa", "light"]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:4173/?lang=${lang}&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
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
console.log("\nPROBLEMS:", problems.length ? problems : "none");
await browser.close();
