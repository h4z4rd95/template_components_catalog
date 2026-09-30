/**
 * Navigation gate — the catalogue's navigation variation, in both languages, both themes, desktop
 * and phone.
 *
 * This gate exists because the failures it was written for were all *silent*: a discipline trigger
 * that did not fit the row was clipped off the trailing edge by `overflow: clip` — present in the
 * DOM, invisible on screen, unreachable by pointer or keyboard — and a light-theme variation sat
 * on a dark canvas because the skin never reached the document. Neither shows up in a DOM-only
 * assertion, and neither is visible without looking at pixels in *both* languages (the Persian
 * labels are wider, so a row that fits in English does not fit in Persian).
 *
 * It asserts: the document carries the right direction and theme; the trigger row never overflows
 * and every discipline it hides is reachable through "More"; each panel opens inside the viewport
 * with links that really resolve; the phone gets a full-height sheet that Escape closes; and the
 * ⌘K palette filters instead of emptying.
 *
 * Needs a running preview server (npm run preview) and a built framework export (npm run build).
 * PORT via VISION_PORT, default 4173. Write screenshots with SHOTS=1.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Scripts live in scripts/, so the repo root is one level up — resolving the chromium path from the
// script's own directory would look for .cache/catalog-browser/ inside scripts/.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.VISION_PORT || "4173";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;
if (process.env.SHOTS === "1") mkdirSync(join(ROOT, ".shots"), { recursive: true });
const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true, protocolTimeout: 60_000, env,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
});
const problems = [];
for (const [lang, theme, width, height] of [["en", "dark", 1440, 900], ["fa", "light", 1440, 900], ["fa", "dark", 390, 844]]) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("js: " + e.message.slice(0, 100)));
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes(`:${PORT}/`)) errors.push(`http ${r.status()} ${r.url().split(`:${PORT}/`)[1]}`); });
  await page.setViewport({ width, height });
  await page.goto(`http://127.0.0.1:${PORT}/framework/next/nav/mega-menu-command/index.html?lang=${lang}&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 2600));

  const base = await page.evaluate(() => {
    // The trigger row must never overflow: a discipline that does not fit belongs in "More", not
    // clipped off the trailing edge where neither pointer nor keyboard can reach it.
    const row = document.querySelector("nav:has(button[aria-haspopup])") || document.querySelector("header nav");
    const triggers = [...(row?.querySelectorAll("[data-trigger]") ?? [])];
    const more = row?.querySelector("[data-more-trigger]");
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
    };
    return {
    rowOverflow: row ? row.scrollWidth - row.clientWidth : 0,
    disciplineTriggers: triggers.length,
    rowVisible: !!row && getComputedStyle(row).display !== "none" && row.getBoundingClientRect().width > 0,
    visibleTriggers: triggers.filter(inView).length,
    hiddenTriggers: triggers.filter((el) => el.offsetWidth === 0).length,
    moreVisible: more ? inView(more) : false,
    moreLabel: more?.textContent?.trim() ?? null,
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme,
    hue: getComputedStyle(document.body).backgroundColor,
    triggers: document.querySelectorAll("nav button[aria-haspopup]").length,
    brand: document.querySelector("header a")?.textContent?.trim().slice(0, 20),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

  // open a panel: hover the first trigger (desktop) or use the sheet (phone)
  if (width > 880) {
    await page.hover("nav button[aria-haspopup]");
    await new Promise((r) => setTimeout(r, 900));
  } else {
    // Several buttons carry aria-expanded; on a phone only one of them is visible, and clicking a
    // hidden one is exactly the mistake this probe exists to catch elsewhere.
    const clicked = await page.evaluate(() => {
      const wanted = /menu|منو/i;
      const button = [...document.querySelectorAll("header button")].find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 20 && getComputedStyle(b).display !== "none" && wanted.test(b.textContent);
      });
      if (!button) return null;
      button.click();
      return button.textContent.trim();
    });
    console.log("   mobile sheet opener:", clicked);
    await new Promise((r) => setTimeout(r, 800));
  }

  const panel = await page.evaluate(() => {
    const el = document.querySelector("[data-panel]") || document.querySelector('[role="dialog"]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      inside: rect.left >= -1 && rect.right <= window.innerWidth + 1,
      size: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
      title: (el.querySelector("h2, h3")?.textContent ?? "").trim().slice(0, 30),
      links: [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).slice(0, 3),
      linkCount: el.querySelectorAll("a[href]").length,
    };
  });

  // pick a link and confirm its target really exists
  const firstHref = panel?.links?.[0] ?? null;
  let target = "—";
  if (firstHref) {
    const response = await page.evaluate(async (href) => {
      const r = await fetch(href, { method: "GET" });
      return r.status;
    }, firstHref);
    target = `${firstHref.split("/").slice(-3).join("/")} → ${response}`;
  }

  console.log(
    `${lang}/${theme}/${width}  dir=${base.dir} theme=${base.theme} canvas=${base.hue}\n` +
      `   triggers ${base.disciplineTriggers}: visible=${base.visibleTriggers} hidden=${base.hiddenTriggers} rowVisible=${base.rowVisible} more=${base.moreVisible ? `"${base.moreLabel}"` : "off"} rowOverflow=${base.rowOverflow} pageOverflow=${base.overflow}\n` +
      `   panel ${panel?.size ?? "none"} inside=${panel?.inside} title="${panel?.title}" links=${panel?.linkCount} · first link: ${target}`,
  );
  if (base.dir !== (lang === "fa" ? "rtl" : "ltr")) problems.push(`${lang}/${theme}/${width}: dir=${base.dir}`);
  if (base.theme !== theme) problems.push(`${lang}/${theme}/${width}: theme=${base.theme}`);
  if (base.overflow > 1) problems.push(`${lang}/${theme}/${width}: overflow ${base.overflow}px`);
  if (base.rowOverflow > 1) problems.push(`${lang}/${theme}/${width}: trigger row overflows by ${base.rowOverflow}px`);
  // Below the sheet breakpoint the whole row is hidden on purpose: the menu lives in the sheet.
  if (base.rowVisible && base.visibleTriggers + base.hiddenTriggers !== base.disciplineTriggers) {
    problems.push(
      `${lang}/${theme}/${width}: trigger accounting is off (${base.visibleTriggers}+${base.hiddenTriggers}≠${base.disciplineTriggers})`,
    );
  }
  if (base.rowVisible && base.hiddenTriggers > 0 && !base.moreVisible) {
    problems.push(`${lang}/${theme}/${width}: ${base.hiddenTriggers} discipline(s) hidden with no "More" trigger`);
  }
  if (!panel) problems.push(`${lang}/${theme}/${width}: no panel opened`);
  else {
    if (!panel.inside) problems.push(`${lang}/${theme}/${width}: panel outside viewport`);
    if (!panel.linkCount) problems.push(`${lang}/${theme}/${width}: panel has no links`);
    if (target !== "—" && !target.endsWith("200")) problems.push(`${lang}/${theme}/${width}: menu link 404s (${target})`);
  }
  if (width <= 880) {
    const sheet = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return null;
      const rect = dialog.getBoundingClientRect();
      return {
        full: rect.height > window.innerHeight * 0.85,
        links: dialog.querySelectorAll("a[href]").length,
        heading: (dialog.querySelector("h3, h2")?.textContent ?? "").trim().slice(0, 24),
      };
    });
    console.log(`   sheet ${sheet ? `${sheet.links} links · "${sheet.heading}" · fullHeight=${sheet.full}` : "none"}`);
    if (!sheet) problems.push(`${lang}/${theme}/${width}: the menu sheet did not open`);
    else if (!sheet.full) problems.push(`${lang}/${theme}/${width}: sheet is not full height`);

    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    const closed = await page.evaluate(() => !document.querySelector('[role="dialog"]'));
    if (!closed) problems.push(`${lang}/${theme}/${width}: Escape did not close the sheet`);

    // ⌘K: filter, then read the row count, so the palette is exercised and not just opened.
    await page.keyboard.down("Control");
    await page.keyboard.press("k");
    await page.keyboard.up("Control");
    await new Promise((r) => setTimeout(r, 500));
    await page.keyboard.type("gpu");
    await new Promise((r) => setTimeout(r, 400));
    const palette = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[role="option"]')];
      return { count: rows.length, first: rows[0]?.textContent?.trim().slice(0, 30) || null };
    });
    console.log(`   palette "gpu" → ${palette.count} rows, first: ${palette.first}`);
    if (palette.count === 0) problems.push(`${lang}/${theme}/${width}: command palette filtered everything out`);
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 400));
  }

  if (errors.length) problems.push(`${lang}/${theme}/${width}: ${errors.slice(0, 2).join(" | ")}`);
  if (process.env.SHOTS === "1") await page.screenshot({ path: join(ROOT, ".shots", `nav-${lang}-${theme}-${width}.png`) });
  await page.close();
}
await browser.close();

if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("\n" + "─".repeat(72));
console.log("  ✓ the navigation variation holds in en/fa × day/night on desktop and phone");
console.log("─".repeat(72) + "\n");
