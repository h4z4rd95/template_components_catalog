/** Temporary: capture the shell in both languages and both themes while iterating on it. */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const OUT = join(ROOT, ".shots");
const BASE = process.env.SHOT_BASE || "http://127.0.0.1:4173";
const PAGE = process.argv[2] || "/";

const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true,
  protocolTimeout: 90_000,
  env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});

const cases = [
  ["desktop-en-dark", 1440, 900, "en", "dark"],
  ["desktop-fa-light", 1440, 900, "fa", "light"],
  ["mobile-en-dark", 390, 844, "en", "dark"],
  ["mobile-fa-light", 390, 844, "fa", "light"],
  ["mobile-fa-drawer", 390, 844, "fa", "light", "drawer"],
];

const problems = [];
for (const [name, width, height, lang, theme, action] of cases) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}${PAGE}?lang=${lang}&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2200));
  if (action === "drawer") {
    await page.click("[data-burger]");
    await new Promise((r) => setTimeout(r, 500));
    await page.click(".drawer__summary");
    await new Promise((r) => setTimeout(r, 450));
  }
  await page.screenshot({ path: join(OUT, `${name}.png`) });

  const probe = await page.evaluate(() => {
    const root = document.documentElement;
    const invisible = [];
    document.querySelectorAll("h1, h2, h3, p, a, button, .nav__trigger, .drawer__summary").forEach((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const opacity = Number(style.opacity);
      if (opacity < 0.15) invisible.push(`${node.tagName}.${node.className} opacity ${opacity}`);
      if (style.visibility === "hidden") invisible.push(`${node.tagName}.${node.className} hidden`);
    });
    // does the nav actually exist and hold the right number of entries?
    return {
      lang: root.lang,
      dir: root.dir,
      theme: root.dataset.theme,
      navItems: document.querySelectorAll(".nav__item").length,
      navTriggers: [...document.querySelectorAll(".nav__trigger-label")].map((n) => n.textContent),
      railLabels: [...document.querySelectorAll("#discipline-rail .chip")].map((n) => n.textContent),
      topicChips: [...document.querySelectorAll("#topic-rail .chip")].map((n) => n.textContent),
      results: document.getElementById("results")?.textContent?.trim().slice(0, 90),
      cards: document.querySelectorAll(".card").length,
      plannedCards: document.querySelectorAll(".card[data-planned=\"1\"]").length,
      mountedFrames: document.querySelectorAll(".card__frame iframe").length,
      plannedNote: document.querySelector(".card[data-planned=\"1\"] .card__frame")?.dataset.plannedNote?.split("\n")[0],
      drawerOpen: !document.querySelector(".drawer")?.hidden,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      invisible: invisible.slice(0, 6),
      bodyFont: getComputedStyle(document.body).fontFamily.slice(0, 60),
    };
  });
  console.log(name.padEnd(20), JSON.stringify(probe));
  if (probe.overflowX > 1) problems.push(`${name}: horizontal overflow ${probe.overflowX}px`);
  if (probe.invisible.length) problems.push(`${name}: invisible nodes ${probe.invisible.join(", ")}`);
  if (errors.length) problems.push(`${name}: ${errors.slice(0, 3).join(" | ")}`);
  await page.close();
}

console.log("\nPROBLEMS:", problems.length ? problems : "none");
console.log("stills →", OUT);
await browser.close();
