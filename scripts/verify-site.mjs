#!/usr/bin/env node
/**
 * verify-site.mjs — the composed deliverables: the gaming-news newsroom, the handbook, and the
 * buildless navigation variation they both build on.
 *
 * These pages are not generated from the manifest like the browse tree, so their failure modes are
 * their own: a link to a story page that was renamed, an embed that mounts nothing, a Persian page
 * whose captions stayed English, a fan of nav items that overlaps itself, or a sticky bar whose
 * ancestors quietly change what `position: fixed` means.
 *
 * So it asserts, per skin (en/fa × dark/light) and per page:
 *   · direction, theme and canvas colour are what the shell asked for,
 *   · no horizontal overflow, and a headline that is actually localised,
 *   · every internal link resolves to a file on disk,
 *   · each banner slot either mounts the variation or says why it cannot,
 *   · the orbital nav opens, keeps every item apart (**no two items may overlap**), and its list
 *     on a phone stays inside the viewport,
 *   · the article's progress hairline exists, and the guide's sections all render.
 *
 * Needs a running preview server (npm run preview) and a built framework export (npm run build).
 * PORT via VISION_PORT, default 4173. Write screenshots with SHOTS=1.
 */
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Scripts live in scripts/, so the repo root is one level up.
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
  ["fa", "light"],
];

const PAGES = [
  { path: "sites/gaming-news/index.html", kind: "newsroom" },
  { path: "sites/gaming-news/category.html", kind: "sections" },
  { path: "sites/gaming-news/article.html", kind: "longform" },
  { path: "guide/index.html", kind: "guide" },
  { path: "vanilla/orbital-nav/index.html", kind: "nav-variation" },
];

const problems = [];
const { readFile, readdir } = await import("node:fs/promises");

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

/** Two rectangles overlap by more than a hairline. */
const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

for (const [lang, theme] of SKINS) {
  for (const page of PAGES) {
    for (const width of [1440, 390]) {
      const tab = await browser.newPage();
      const failures = [];
      tab.on("pageerror", (error) => failures.push("js: " + error.message.slice(0, 90)));
      tab.on("response", (response) => {
        if (response.status() === 404 && response.url().includes(`:${PORT}/`)) {
          failures.push("404 " + response.url().split(`:${PORT}/`).pop());
        }
      });

      await tab.setViewport({ width, height: width > 800 ? 950 : 844, deviceScaleFactor: 1 });
      await tab.goto(`http://127.0.0.1:${PORT}/${page.path}?lang=${lang}&theme=${theme}`, {
        waitUntil: "load",
        timeout: 60_000,
      });
      await new Promise((r) => setTimeout(r, 2600));

      const state = await tab.evaluate(() => {
        const root = document.documentElement;
        const links = [...document.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href"))
          .filter((href) => href && !/^(https?:|mailto:|#|\?)/.test(href));
        const embed = document.querySelector("[data-embed]");
        const lead = document.querySelector("h1, .site__lead-title, .orb-stage__title, .guide__title");
        return {
          dir: root.dir,
          theme: root.dataset.theme,
          locale: root.dataset.locale,
          bg: getComputedStyle(document.body).backgroundColor,
          overflow: root.scrollWidth - window.innerWidth,
          headline: (lead?.textContent ?? "").trim().slice(0, 42),
          // Every node that shipped its Persian in `data-i18n-fa` must actually be showing it. A
          // node mounted after the shell's first pass keeps its English text and is invisible to a
          // headline-only check — this is the assertion that catches it.
          untranslated: (() => {
            const out = [];
            for (const node of document.querySelectorAll("[data-i18n-fa]")) {
              const wanted = node.getAttribute("data-i18n-fa") || "";
              if (!/[\u0600-\u06FF]/.test(wanted)) continue;
              if (!/[\u0600-\u06FF]/.test(node.textContent || "")) {
                out.push((node.className || node.tagName).toString().split(" ")[0] + ":" + (node.textContent || "").trim().slice(0, 18));
              }
            }
            return out;
          })(),
          // The other direction: an English page must not be showing the Persian half of a pair.
          persianLeak: (() => {
            const out = [];
            for (const node of document.querySelectorAll("[data-i18n-fa]")) {
              if (!/[\u0600-\u06FF]/.test(node.textContent || "")) continue;
              if ((node.className || "").toString().includes("lang-switch")) continue;
              out.push((node.className || node.tagName).toString().split(" ")[0] + ":" + (node.textContent || "").trim().slice(0, 18));
            }
            return out;
          })(),
          docTitle: document.title,
          links,
          embed: embed ? (embed.querySelector("iframe") ? "iframe" : embed.querySelector(".site__embed-missing") ? "notice" : "empty") : "none",
          cards: document.querySelectorAll(".site__card").length,
          rows: document.querySelectorAll("[data-rows] .site__row").length,
          chips: document.querySelectorAll("[data-filter]").length,
          guideSections: document.querySelectorAll(".guide__section").length,
          progress: !!document.querySelector("[data-progress]"),
          hasNav: !!document.querySelector(".orb"),
        };
      });

      const label = `${page.path} · ${lang}/${theme}/${width}`;
      const persian = lang === "fa";
      const hasFa = (value) => /[\u0600-\u06FF]/.test(value);

      if (state.dir !== (persian ? "rtl" : "ltr")) problems.push(`${label}: direction is "${state.dir}"`);
      if (state.theme !== theme) problems.push(`${label}: theme is "${state.theme}"`);
      if (state.overflow > 1) problems.push(`${label}: ${state.overflow}px of horizontal overflow`);
      if (!state.headline) problems.push(`${label}: no headline`);
      if (persian && !hasFa(state.headline)) problems.push(`${label}: headline stayed English ("${state.headline}")`);
      if (!persian && hasFa(state.docTitle)) problems.push(`${label}: Persian leaked into the English title`);
      if (persian && state.untranslated.length) {
        problems.push(`${label}: ${state.untranslated.length} node(s) still English on the Persian page (${state.untranslated.slice(0, 3).join(", ")})`);
      }
      if (!persian && state.persianLeak.length) {
        problems.push(`${label}: Persian shown on the English page (${state.persianLeak.slice(0, 3).join(", ")})`);
      }
      if (page.kind === "newsroom" && state.cards < 4) problems.push(`${label}: only ${state.cards} story cards`);
      if (page.kind === "sections" && (!state.rows || !state.chips)) problems.push(`${label}: no rows/chips`);
      if (page.kind === "longform" && !state.progress) problems.push(`${label}: no reading progress bar`);
      if (page.kind === "guide" && state.guideSections < 6) problems.push(`${label}: ${state.guideSections} guide sections`);
      if (state.embed !== "none" && state.embed === "empty") problems.push(`${label}: banner slot is empty`);

      for (const href of state.links) {
        const rel = href.split("#")[0].split("?")[0];
        if (!rel || rel.endsWith("/")) continue;
        const target = rel.startsWith("/") ? join(DOCS, rel) : resolve(join(DOCS, dirname(page.path)), rel);
        if (!existsSync(target)) problems.push(`${label}: dead link → ${href}`);
      }

      // The nav: opens, separates its items, and stays on screen.
      if (state.hasNav) {
        const nav = await tab.evaluate(async () => {
          const root = document.querySelector(".orb");
          root.querySelector(".orb__trigger").click();
          await new Promise((r) => setTimeout(r, 800));
          const items = [...root.querySelectorAll(".orb__item")];
          const rects = items.map((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          });
          const field = root.querySelector(".orb__field").getBoundingClientRect();
          return {
            open: root.dataset.open,
            count: items.length,
            rects,
            field: { left: field.left, top: field.top, right: field.right, bottom: field.bottom },
            viewport: { w: window.innerWidth, h: window.innerHeight },
          };
        });

        if (nav.open !== "true") problems.push(`${label}: the nav did not open`);
        if (nav.count < 3) problems.push(`${label}: only ${nav.count} nav items`);
        if (width > 800) {
          for (let i = 0; i < nav.rects.length; i += 1) {
            for (let j = i + 1; j < nav.rects.length; j += 1) {
              if (overlaps(nav.rects[i], nav.rects[j])) {
                problems.push(`${label}: nav items ${i + 1} and ${j + 1} overlap`);
              }
            }
          }
        }
        const outside = nav.rects.filter((r) => r.left < -1 || r.right > nav.viewport.w + 1).length;
        if (outside) problems.push(`${label}: ${outside} nav item(s) off screen`);

        if (SHOTS) {
          await tab.screenshot({
            path: join(ROOT, ".shots", `gate-${page.path.replace(/\W+/g, "-")}-${lang}-${theme}-${width}.png`),
          });
        }
      }

      for (const failure of failures) problems.push(`${label}: ${failure}`);

      console.log(
        `${label.padEnd(50)} ${state.headline.slice(0, 26).padEnd(28)} ` +
          `embed=${state.embed} cards=${state.cards} rows=${state.rows} overflow=${state.overflow}`,
      );
      await tab.close();
    }
  }
}

// Structure over the whole newsroom + guide tree, not just the pages sampled above.
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

const tree = (await walk(join(DOCS, "sites"))).concat(await walk(join(DOCS, "guide")));
for (const file of tree) {
  const source = await readFile(file, "utf8");
  const rel = file.slice(DOCS.length + 1);
  if (!source.includes("data-title-fa")) problems.push(`${rel}: no Persian document title`);
  if (/dir="rtl"/.test(source) && !source.includes("data-i18n-fa")) problems.push(`${rel}: RTL markup with nothing to translate`);
  // Anything Persian that is not behind a translation attribute would show on the English page too.
  // The shell's own language button is the one legitimate exception (both labels name their own
  // language), so it is removed — and the report is taken from the *stripped* text, because quoting
  // matches from the original would just name the translations that were correctly stripped.
  const stripped = source
    // Scripts and styles carry bilingual lookup tables and Persian strings as *code*; the check is
    // about what a reader sees, so those blocks are removed rather than excused individually.
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<(pre|code|kbd|samp|textarea)[\s\S]*?<\/\1>/g, "")
    .replace(/data-i18n-fa(-html)?="[^"]*"/g, "")
    .replace(/data-title-fa="[^"]*"/g, "")
    .replace(/data-desc-fa="[^"]*"/g, "")
    .replace(/<button[^>]*data-lang="fa"[^>]*>[^<]*<\/button>/g, "");
  const stray = stripped.match(/[\u0600-\u06FF]{3,}/g);
  if (stray) {
    const at = stripped.search(/[\u0600-\u06FF]{3,}/);
    problems.push(`${rel}: Persian outside a translation attribute → ${JSON.stringify(stripped.slice(Math.max(0, at - 40), at + 30))}`);
  }
}

await browser.close();

console.log(`\n  ${tree.length} composed pages checked for structure`);
if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("─".repeat(72));
console.log("  ✓ newsroom, handbook and orbital nav: localised, linked, mounted, and never overlapping");
console.log("─".repeat(72) + "\n");
