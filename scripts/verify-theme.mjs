#!/usr/bin/env node
/**
 * verify-theme.mjs — day and night, measured rather than eyeballed.
 *
 * The catalogue's dark ramp was authored first, and a light ramp bolted on afterwards is exactly
 * the situation where text goes missing: a rule that hardcodes white looks perfect until the page
 * behind it turns to paper. Reading the CSS cannot catch that — only the rendered pixel can.
 *
 * So, per page and per theme, this walks every text node that is actually painted, resolves its
 * colour and its *effective* background (walking up past translucent layers and gradient-bearing
 * ancestors to the first genuinely opaque paint), and computes WCAG contrast. Anything below the
 * large-text threshold fails the run.
 *
 * Colours are resolved by *painting them into a canvas* rather than parsing them: the computed
 * value can be `rgb()`, `color(srgb …)` or `oklab(…)`, depending on whether a `color-mix()` landed
 * in the declaration, and a parser that understands only the first silently reports every mixed
 * colour as the page background.
 *
 * PORT via VISION_PORT (default 4173). Needs a running preview server.
 */
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.VISION_PORT || "4173";
const LIB = join(ROOT, ".cache", "catalog-browser", "lib");
const env = { ...process.env, LD_LIBRARY_PATH: LIB };
const icd = join(LIB, "vk_swiftshader_icd.json");
if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;

const PAGES = [
  "index.html",
  "browse/hero/index.html",
  "browse/commerce/index.html",
  "component/mega-menu-command/index.html",
  "sites/gaming-news/index.html",
  "sites/gaming-news/category.html",
  "sites/gaming-news/article.html",
  "guide/index.html",
  "vanilla/orbital-nav/index.html",
  "sites/shop/index.html",
  "sites/shop/digital.html",
  "sites/shop/product-chroma.html",
  "sites/shop/product-editorial.html",
  "sites/shop/cart.html",
  "sites/shop/checkout.html",
  "sites/shop/checkout-ritual.html",
];

const problems = [];

const browser = await puppeteer.launch({
  executablePath: join(ROOT, ".cache", "catalog-browser", "chromium"),
  headless: true,
  protocolTimeout: 90_000,
  env,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

for (const theme of ["dark", "light"]) {
  for (const path of PAGES) {
    for (const width of [1440, 390]) {
      const tab = await browser.newPage();
      await tab.setViewport({ width, height: width > 800 ? 950 : 844 });
      await tab.goto(`http://127.0.0.1:${PORT}/${path}?lang=en&theme=${theme}`, { waitUntil: "load", timeout: 60_000 });
      await new Promise((r) => setTimeout(r, 1800));

      const report = await tab.evaluate(() => {
        // Paint any CSS colour into a canvas and read the bytes back: this understands rgb(),
        // rgba(), color(srgb …), oklab() and named colours alike.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const toRgb = (css) => {
          if (!css || css === "transparent") return null;
          const probe = css.match(/rgba?\(([^)]+)\)/);
          if (probe) {
            const parts = probe[1].split(/[,\s/]+/).filter(Boolean).map(Number);
            if (parts.length >= 4 && parts[3] === 0) return null;
            if (parts.length >= 4) return { rgb: parts.slice(0, 3), alpha: parts[3] };
            return { rgb: parts.slice(0, 3), alpha: 1 };
          }
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = "#000";
          ctx.fillStyle = css; // invalid values leave the previous fillStyle in place
          if (ctx.fillStyle === "#000000" && !/^(#000|rgb\(0, 0, 0\)|black)/.test(css.trim())) return null;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return { rgb: [r, g, b], alpha: a / 255 };
        };

        const blend = (top, bottom) => ({
          rgb: top.rgb.map((c, i) => c * top.alpha + bottom.rgb[i] * (1 - top.alpha)),
          alpha: 1,
        });

        /**
         * The colour actually behind the text.
         *
         * Layers are *stacked*, not picked: a chip's 12%-accent wash sits on a card, which sits on
         * the page, and the text is read against the composite. Returning the first translucent
         * layer instead (which this gate did until it reported an ink-on-paper headline at 1.2:1)
         * measures the wash as if it were the paper — a false failure that would have hidden the
         * real ones.
         *
         * Compositing is bottom-up, so the layers are collected top-down and then folded in reverse;
         * the walk stops at the first opaque, untextured ancestor, which is the base by definition.
         */
        const backdrop = (el) => {
          const layers = [];
          let base = null;
          for (let node = el; node; node = node.parentElement) {
            const cs = getComputedStyle(node);
            const rgb = toRgb(cs.backgroundColor);
            const textured = cs.backgroundImage !== "none";
            if (rgb && rgb.alpha > 0) {
              layers.push(rgb);
              if (rgb.alpha > 0.99 && !textured) {
                base = rgb;
                break;
              }
            } else if (rgb && rgb.alpha > 0.99 && !textured) {
              base = rgb;
              break;
            }
          }
          const paper = base || { rgb: [0, 0, 0], alpha: 1 };
          let result = { rgb: paper.rgb, alpha: 1 };
          for (let i = layers.length - 1; i >= 0; i -= 1) {
            result = { rgb: layers[i].rgb.map((c, k) => c * layers[i].alpha + result.rgb[k] * (1 - layers[i].alpha)), alpha: 1 };
          }
          return result;
        };

        const luminance = ([r, g, b]) => {
          const f = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };

        const failures = [];
        const seen = new Set();
        for (const el of document.querySelectorAll("body *")) {
          if (el.children.length) continue; // leaf text only — no double counting
          // Decoration is exempt (WCAG 1.4.3): the ghost numeral on a planned card repeats the
          // batch line right beside it, and a watermark that passes contrast is not a watermark.
          if (el.closest('[aria-hidden="true"]')) continue;
          if (getComputedStyle(el.closest("[aria-hidden='true']") || el).visibility === "hidden") continue;
          const text = (el.textContent || "").trim();
          if (text.length < 2) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.4) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;

          const fg = toRgb(cs.color);
          if (!fg) continue;
          const bg = backdrop(el);
          const fgOnBg = fg.alpha < 1 ? blend(fg, bg) : fg;

          const l1 = luminance(fgOnBg.rgb);
          const l2 = luminance(bg.rgb);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

          const px = parseFloat(cs.fontSize);
          const bold = Number(cs.fontWeight) >= 700;
          const large = px >= 24 || (bold && px >= 18.66);
          const floor = large ? 3 : 4.5;

          if (ratio < floor) {
            const key = `${cs.color}|${bg.rgb.join()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            failures.push({
              ratio: Number(ratio.toFixed(2)),
              floor,
              sel: (el.className || el.tagName).toString().split(" ")[0],
              text: text.slice(0, 30),
            });
          }
        }
        return { failures: failures.sort((a, b) => a.ratio - b.ratio).slice(0, 8), theme: document.documentElement.dataset.theme };
      });

      const label = `${path} · ${theme}/${width}`;
      if (report.theme !== theme) problems.push(`${label}: document theme is "${report.theme}"`);
      for (const f of report.failures) {
        problems.push(`${label}: ${f.ratio}:1 (needs ${f.floor}) — .${f.sel} "${f.text}"`);
      }
      console.log(`${label.padEnd(52)} ${report.failures.length ? `${report.failures.length} low-contrast` : "✓"}`);
      await tab.close();
    }
  }
}

await browser.close();

if (problems.length) {
  console.error("\nPROBLEMS:\n  - " + problems.join("\n  - ") + "\n");
  process.exit(1);
}
console.log("─".repeat(72));
console.log("  ✓ day and night: every painted text layer clears WCAG AA on its real backdrop");
console.log("─".repeat(72) + "\n");
