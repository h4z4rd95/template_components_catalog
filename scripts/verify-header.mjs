/**
 * Header gate — the shared shell, on a phone, a tablet and a desktop, in both directions.
 *
 * The card gate (`verify:cards.mjs`) looks at the catalogue grid; this one looks at the chrome
 * around it, where a bug is silent by construction: the bar is `overflow-x: hidden`, so a control
 * that no longer fits is simply *clipped* — still in the DOM, still "verified" by any DOM-only
 * assertion, invisible to the person using it. That is exactly how a 390 px bar came to want
 * 664 px and swallow the download button.
 *
 * It asserts, per skin: the bar does not overflow, no visible bar control is clipped by the
 * viewport, the download button is visible, its panel opens *inside* the viewport, the archive
 * link carries `download`, the stated size / file count resolves in the current language, the
 * mobile drawer carries the moved controls — and that switching language with the drawer open
 * re-labels it (a menu built once from `t()` does not follow `[data-i18n]` on its own).
 *
 * Needs a running preview server (npm run preview). PORT via VISION_PORT, default 4173.
 * Write screenshots with SHOTS=1.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Scripts live in scripts/, so the repo root is one level up — resolving the chromium path from
// the script's own directory would look for .cache/catalog-browser/ inside scripts/.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.VISION_PORT || "4173";
const SHOTS = process.env.SHOTS === "1";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;
if (SHOTS) mkdirSync(join(ROOT, ".shots"), { recursive: true });

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true, protocolTimeout: 60_000, env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const problems = [];
const t0 = Date.now();
const CASES = [
  ["en", "dark", 1440, 900],
  ["fa", "dark", 390, 844],
  ["en", "light", 390, 844],
  ["fa", "light", 720, 900],
];

for (const [lang, theme, width, height] of CASES) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("js: " + e.message.slice(0, 90)));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()} ${r.url().slice(-38)}`); });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/?lang=${lang}&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2400));

  const bar = await page.evaluate(() => {
    const b = document.querySelector(".masthead__bar");
    const kids = [...b.children]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => el.className.split(" ")[0] + ":" + Math.round(el.getBoundingClientRect().width));
    const overflows = b.scrollWidth > b.clientWidth + 1;
    // Only controls the bar actually shows: at desktop the burger is display:none, and a hidden
    // element's zero-size rect at 0,0 must not read as "clipped".
    const cut = [...b.querySelectorAll(".download, .burger, .brand")]
      .filter((el) => getComputedStyle(el).display !== "none")
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className.split(" ")[0], inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0 };
      });
    return { kids, overflows, cut, vw: window.innerWidth };
  });
  if (bar.overflows) problems.push(`${lang}/${theme}/${width}: bar overflows (${bar.kids.join(" ")})`);
  for (const c of bar.cut) if (!c.inside) problems.push(`${lang}/${theme}/${width}: ${c.cls} clipped by the bar`);

  const button = await page.evaluate(() => {
    const d = document.querySelector("[data-download]");
    const r = d.getBoundingClientRect();
    return { visible: r.width > 30 && r.height > 18, label: d.querySelector("summary").textContent.replace(/\s+/g, " ").trim() };
  });
  if (!button.visible) problems.push(`${lang}/${theme}/${width}: download button not visible`);

  await page.click("[data-download] summary");
  await new Promise((r) => setTimeout(r, 450));
  const open = await page.evaluate(() => {
    const d = document.querySelector("[data-download]");
    const panel = d.querySelector(".download__panel");
    const r = panel.getBoundingClientRect();
    return {
      open: d.open,
      inside: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
      rect: `${Math.round(r.width)}×${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`,
      zip: [...panel.querySelectorAll("a")].some((a) => a.getAttribute("href").includes("catalog-source.zip") && a.hasAttribute("download")),
      facts: (panel.querySelector("[data-download-facts]") || {}).textContent || "",
    };
  });
  if (!open.open) problems.push(`${lang}/${theme}/${width}: panel did not open`);
  if (!open.inside) problems.push(`${lang}/${theme}/${width}: panel outside viewport ${open.rect}`);
  if (!open.zip) problems.push(`${lang}/${theme}/${width}: no zip link`);
  if (!/KB|MB/.test(open.facts)) problems.push(`${lang}/${theme}/${width}: archive facts not loaded ("${open.facts}")`);

  console.log(`${lang}/${theme}/${width}  bar[${bar.kids.join(" ")}]  btn="${button.label}"  panel ${open.rect} inside=${open.inside}  facts="${open.facts}"`);
  if (SHOTS) {
    await page.screenshot({ path: join(ROOT, ".shots", `header-${lang}-${theme}-${width}.png`), clip: { x: 0, y: 0, width, height: Math.min(height, 460) } });
  }

  // Mobile: the drawer must carry the moved controls and must speak the current language.
  if (width <= 720) {
    await page.evaluate(() => { document.querySelector("[data-download]").open = false; });
    await page.click("[data-burger]");
    await new Promise((r) => setTimeout(r, 700));
    const drawer = await page.evaluate(() => {
      const d = document.querySelector("#nav-drawer");
      const r = d.getBoundingClientRect();
      const cta = [...d.querySelectorAll(".drawer__cta")].map((a) => ({ text: a.textContent.replace(/\s+/g, " ").trim(), href: a.getAttribute("href"), dl: a.hasAttribute("download") }));
      return {
        visible: !d.hidden && r.width > 100,
        title: d.querySelector(".drawer__title").textContent,
        summary: d.querySelector(".drawer__summary-label").textContent,
        blurb: d.querySelector(".drawer__blurb").textContent.slice(0, 34),
        cta,
      };
    });
    console.log(`   drawer: "${drawer.title}" · "${drawer.summary}" · "${drawer.blurb}" · ${drawer.cta.map((c) => c.text).join(" | ")}`);
    if (!drawer.visible) problems.push(`${lang}/${theme}/${width}: drawer did not open`);
    const persian = lang === "fa";
    const looksFa = /[\u0600-\u06FF]/.test(drawer.title + drawer.summary + drawer.blurb);
    if (persian && !looksFa) problems.push(`${lang}/${theme}/${width}: drawer text still English (${drawer.title} / ${drawer.summary})`);
    if (!persian && looksFa) problems.push(`${lang}/${theme}/${width}: drawer text leaked Persian into English`);
    if (!drawer.cta.some((c) => c.dl && c.href.includes("catalog-source.zip"))) problems.push(`${lang}/${theme}/${width}: drawer has no zip link`);
    if (!drawer.cta.some((c) => c.href.includes("vision/index.html"))) problems.push(`${lang}/${theme}/${width}: drawer has no reel link`);

    // The menu's text is built once; switching language must re-label it, not leave it stale.
    await page.click(`.drawer__foot .lang-switch__button[data-lang="${lang === "fa" ? "en" : "fa"}"]`);
    await new Promise((r) => setTimeout(r, 1000));
    const after = await page.evaluate(() => {
      const d = document.querySelector("#nav-drawer");
      return { title: d.querySelector(".drawer__title").textContent, summary: d.querySelector(".drawer__summary-label").textContent, cta: d.querySelector(".drawer__cta--primary .drawer__cta-name").textContent };
    });
    const shouldSwitch = lang === "fa" ? !/[\u0600-\u06FF]/.test(after.title) : /[\u0600-\u06FF]/.test(after.title);
    console.log(`   after language switch: "${after.title}" · "${after.summary}" · "${after.cta}"`);
    if (!shouldSwitch) problems.push(`${lang}/${theme}/${width}: drawer did not re-label on language switch ("${after.title}")`);
    if (SHOTS) await page.screenshot({ path: join(ROOT, ".shots", `drawer-${lang}-${width}.png`) });
  }

  if (errors.length) problems.push(`${lang}/${theme}/${width}: ${errors.slice(0, 3).join(" | ")}`);
  await page.close();
}
await browser.close();

if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("\n" + "─".repeat(72));
console.log("  ✓ the header holds up in every skin · every control reachable · drawer re-labels");
console.log("─".repeat(72) + "\n");
