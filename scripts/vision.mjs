#!/usr/bin/env node
/**
 * vision.mjs — real-browser verification **and** vision capture for The Catalog.
 *
 * Why this exists: every other gate in this repository verifies *source* (types, manifest, CSS-module
 * bindings) or *DOM behaviour* (jsdom). None of them proves a single pixel was painted, and jsdom has
 * no layout engine at all — so it cannot see the two worst bugs this project ever had:
 *
 *   · `.stage { display: grid }` silently defeating the `hidden` attribute, leaving the fullscreen
 *     overlay permanently on top of the hub while every other gate stayed green;
 *   · a self-recursive pump() that leaked a GPU-backed iframe on every scroll pass.
 *
 * So this script drives a real Chromium against the built showroom and does two jobs at once:
 *
 *   1. AUDIT   — console errors, WebGL context creation, layout overflow at 360/768/1440/2560,
 *                `hidden`-attribute leaks, text hidden under the host chrome, reduced-motion
 *                composition, font loading, frame rate, request failures.
 *   2. VISION  — a choreographed screencast of every variation (pointer arcs for hover physics, eased
 *                scroll trajectories, real clicks) encoded to a budgeted GIF with ordered dithering,
 *                plus high-resolution stills and an HTML gallery carrying the audit beside the art.
 *
 * Output: docs/vision/{index.html,report.json,*.gif,shots/*.png}
 *
 * Usage
 *   npm run verify:browser                 # audit + capture everything
 *   npm run verify:browser -- --audit      # audit only (fast, no media)
 *   npm run verify:browser -- --only hub   # one target
 *
 * NOTE: a full capture takes ~20 minutes on a software rasterizer (2 vCPU sandbox). Run it as a
 * background process; see `npm run verify:browser:bg`.
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import jpeg from "jpeg-js";
import gifenc from "gifenc"; // CJS: named exports are not statically analysable

const { GIFEncoder, quantize, applyPalette } = gifenc;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const OUT = join(DOCS, "vision");
const SHOTS = join(OUT, "shots");
const PORT = Number(process.env.VISION_PORT || 4188);
const BASE = `http://127.0.0.1:${PORT}`;

const argv = process.argv.slice(2);
const AUDIT_ONLY = argv.includes("--audit");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--force-device-scale-factor=1",
  "--hide-scrollbars",
  "--font-render-hinting=none",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--mute-audio",
];

/**
 * WebGL in a headless container is a negotiation, not a constant.
 *
 * `--use-angle=swiftshader` — Chrome's documented software-WebGL shortcut — works on most machines
 * but fails inside some hardened sandboxes: ANGLE reports `Internal Vulkan error (-3)` and every
 * shader variation silently paints nothing. The full Vulkan feature path reaches the same
 * SwiftShader rasterizer and succeeds there. So the harness does not guess: it launches with each
 * profile in turn and keeps the first one that can actually hand out a context.
 */
const GPU_PROFILES = [
  { name: "swangle", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  {
    name: "vulkan-swiftshader",
    args: [
      "--ignore-gpu-blocklist",
      "--use-angle=vulkan",
      "--enable-features=Vulkan,VulkanFromANGLE",
      "--enable-unsafe-swiftshader",
    ],
  },
];

/**
 * Environment for the browser process. A provisioned Chromium keeps its NSS/SwiftShader libraries
 * *and* SwiftShader's Vulkan ICD manifest outside the loader's default search path, so both have to
 * be pointed at explicitly — without `VK_ICD_FILENAMES` the Vulkan loader finds no driver at all and
 * ANGLE fails with the same opaque error as a machine with no GPU whatsoever.
 */
function browserEnv(chromePath) {
  const lib = libraryPathFor(chromePath);
  if (!lib) return process.env;
  const env = { ...process.env, LD_LIBRARY_PATH: lib };
  const icd = join(lib, "vk_swiftshader_icd.json");
  if (existsSync(icd)) env.VK_ICD_FILENAMES = icd;
  return env;
}

const launchWith = (chromePath, args) =>
  puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    defaultViewport: CAPTURE_VIEWPORT,
    protocolTimeout: 480_000, // a heavy shader scene under software rasterization is slow, not hung
    env: browserEnv(chromePath),
    args,
  });

/** Can this browser hand out a WebGL context — and on what renderer? */
async function probeGpu(browser) {
  let page;
  try {
    page = await browser.newPage();
    await page.goto("about:blank");
    return await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return { ok: false, version: null, renderer: null };
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        ok: true,
        version: gl.getParameter(gl.VERSION),
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      };
    });
  } catch {
    return { ok: false, version: null, renderer: null };
  } finally {
    await page?.close().catch(() => {});
  }
}

/**
 * Launch the browser, keeping the first GPU profile that grants contexts.
 *
 * A long capture creates and destroys dozens of contexts, and SwiftShader (in the field: real
 * drivers, after a reset) eventually stops granting new ones — after which every WebGL variation
 * looks broken while the code is fine. Callers recycle via `gpuHealthy()` so a run measures the
 * catalog rather than the harness's accumulated state.
 */
async function launchBrowser(chromePath) {
  let failure = "no profile tried";
  for (const profile of GPU_PROFILES) {
    try {
      const browser = await launchWith(chromePath, [...CHROME_ARGS, ...profile.args]);
      const gpu = await probeGpu(browser);
      if (gpu.ok) {
        console.log(`  GPU        ${profile.name} — ${String(gpu.renderer || gpu.version).slice(0, 56)}`);
        return { browser, gpu, profile: profile.name };
      }
      await browser.close().catch(() => {});
      failure = `${profile.name}: launched, but no context`;
    } catch (error) {
      failure = `${profile.name}: ${error.message.split("\n")[0].slice(0, 70)}`;
    }
  }
  // Nothing grants WebGL here. Keep going: the catalogue degrades by design, and the report should
  // say "this environment had no WebGL" rather than pretending the variation failed.
  console.log(`  GPU        unavailable (${failure})`);
  console.log("             shader heroes will be recorded in their honest fallback state");
  return {
    browser: await launchWith(chromePath, [...CHROME_ARGS, ...GPU_PROFILES[0].args]),
    gpu: { ok: false, version: null, renderer: null },
    profile: "none",
  };
}

/**
 * Is this browser still able to hand out a WebGL context?
 *
 * A long capture session creates and destroys dozens of contexts. SwiftShader (and, in the field,
 * real drivers after a reset) eventually stops granting new ones — after which every WebGL variation
 * looks broken even though nothing is wrong with the code. When that happens we recycle the browser
 * so the run measures the catalog, not the harness's accumulated state.
 */
const gpuHealthy = async (browser) => (await probeGpu(browser)).ok;

/**
 * Capture viewport. Software rasterization (SwiftShader) makes the two WebGL variations crawl at
 * full desktop resolution, so they are recorded smaller — a capture is a behaviour record, not a
 * benchmark. Real GPUs are unaffected. Widths here are the *capture* size; the audit sweep below
 * always uses the real-world breakpoints.
 */
const CAPTURE_VIEWPORT = { width: 1280, height: 800 };
const HEAVY_CAPTURE_VIEWPORT = { width: 1024, height: 640 };
const viewportFor = (target) => (target?.variation?.perf?.webgl ? HEAVY_CAPTURE_VIEWPORT : CAPTURE_VIEWPORT);

/* ══════════════════════════════════════════════════════════════ browser discovery */

const CANDIDATES = [
  process.env.CHROME_PATH,
  join(ROOT, ".cache", "catalog-browser", "chromium"), // from `npm run setup:browser`
  "/tmp/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

async function findChrome() {
  for (const candidate of CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** The shipped NSS/SwiftShader libs live beside the binary when provisioned by setup-browser. */
function libraryPathFor(chromePath) {
  const dir = dirname(chromePath);
  const lib = join(dir, "lib");
  return lib === dir ? undefined : lib;
}

/* ══════════════════════════════════════════════════════════════ static server */

async function startServer() {
  const child = spawn(process.execPath, [join(ROOT, "scripts", "serve.mjs")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(`[serve] ${d}`));

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { method: "HEAD" });
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill("SIGKILL");
  throw new Error("preview server did not come up");
}

/* ══════════════════════════════════════════════════════════════ diagnostics */

function attachDiagnostics(page, bucket) {
  page.on("pageerror", (error) => bucket.errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") bucket.errors.push(`console: ${message.text().slice(0, 300)}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "";
    const url = request.url();

    // Two deliberate cancellations, both by design:
    //   · about:blank teardown of preview iframes
    //   · ERR_ABORTED on a route blanked *while still loading* — exactly how the hub frees a WebGL
    //     context before exceeding the browser's live-context budget
    if (url.startsWith("about:")) return;
    if (/ERR_ABORTED/.test(failure)) {
      bucket.abortedByDesign.push(url.replace(BASE, ""));
      return;
    }
    bucket.failedRequests.push(`${failure} ${url.replace(BASE, "")}`);
  });
}

/**
 * Everything below runs **inside the page**. It is deliberately one function so `clippedBy` is in
 * scope everywhere it is used (an earlier refactor hoisted it into a second `evaluate` block and
 * produced a TDZ crash that silently voided half the report).
 */
async function probePage(page) {
  return page.evaluate(() => {
    /**
     * An element whose ancestor clips or scrolls it horizontally can never widen the document,
     * however wide it is — marquee children, decorative layers, clipped scenes. Those are not
     * defects, and reporting them buries the real ones.
     */
    const clippedBy = (node) => {
      let parent = node.parentElement;
      while (parent && parent !== document.body) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX === "hidden" || overflowX === "clip" || overflowX === "auto" || overflowX === "scroll") {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const doc = document.documentElement;
    const canvas = document.querySelector("canvas");
    let webgl = null;
    if (canvas) {
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const debug = gl.getExtension("WEBGL_debug_renderer_info");
        webgl = {
          version: gl.getParameter(gl.VERSION),
          vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          buffer: [canvas.width, canvas.height],
        };
      } else {
        webgl = { version: null, note: "canvas present but no context" };
      }
    }

    const shellOverflowX = getComputedStyle(doc).overflowX;
    const bodyOverflowX = getComputedStyle(document.body).overflowX;
    // `overflow-x` on <body> propagates to the viewport when <html> is `visible` — the mechanism
    // this catalog relies on so that transformed scenes never create a horizontal scrollbar.
    const viewportClipsX =
      shellOverflowX === "hidden" ||
      shellOverflowX === "clip" ||
      (shellOverflowX === "visible" && (bodyOverflowX === "hidden" || bodyOverflowX === "clip"));

    /* ---- genuine viewport offenders -------------------------------------- */
    const offenders = [];
    for (const node of document.querySelectorAll("body *")) {
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right <= doc.clientWidth + 2 && rect.left >= -2) continue;
      if (clippedBy(node)) continue;
      const parent = node.parentElement;
      if (parent && parent !== document.body) {
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.right > doc.clientWidth + 2 || parentRect.left < -2) continue;
      }
      const style = getComputedStyle(node);
      offenders.push(
        `${node.tagName.toLowerCase()}.${String(node.className || "").split(" ")[0]} ` +
          `(${Math.round(rect.width)}px, right=${Math.round(rect.right)}/${doc.clientWidth}, ` +
          `display=${style.display}, overflowX=${style.overflowX})`,
      );
      if (offenders.length > 5) break;
    }

    /* ---- content escaping its own box, unclipped ------------------------- */
    const spills = [];
    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.overflowX !== "visible") continue;
      if (node.scrollWidth <= node.clientWidth + 4) continue;
      if (node.clientWidth < 40) continue;
      if (node.matches("iframe, canvas, html, body")) continue;
      if (clippedBy(node)) continue;
      if (/paint|layout|strict|content/.test(style.contain)) continue; // containment clips too
      spills.push(
        `${node.tagName.toLowerCase()}.${String(node.className || "").split(" ")[0]} ` +
          `(scrollW ${node.scrollWidth} > clientW ${node.clientWidth})`,
      );
      if (spills.length > 5) break;
    }

    const heading = document.querySelector("h1");
    const headingStyle = heading ? getComputedStyle(heading) : null;

    return {
      title: document.title,
      hud: !!document.querySelector("[data-catalog-hud], .card__hud"),
      h1: heading
        ? {
            text: heading.textContent.replace(/\s+/g, " ").trim().slice(0, 70),
            opacity: Number(headingStyle.opacity),
            height: Math.round(heading.getBoundingClientRect().height),
            visible: heading.getBoundingClientRect().height > 10 && Number(headingStyle.opacity) > 0.5,
          }
        : null,
      webgl,
      // `check()` is true only for faces the browser has actually downloaded, so a false value here
      // means "not used on this route", not "missing".
      fonts: {
        inter: document.fonts ? document.fonts.check('16px "Inter Variable"') : null,
        mono: document.fonts ? document.fonts.check('16px "JetBrains Mono Variable"') : null,
        serif: document.fonts ? document.fonts.check('16px "Instrument Serif"') : null,
        display: document.fonts ? document.fonts.check('16px "Archivo Black"') : null,
      },
      undefinedClasses: document.querySelectorAll('[class*="undefined"]').length,
      /**
       * Regression guard for the nastiest bug class in this project: an author `display` rule
       * silently overriding the `hidden` attribute. jsdom cannot detect it (no layout), TypeScript
       * cannot detect it, and it made the stage overlay cover the entire hub.
       */
      leakedHidden: Array.from(document.querySelectorAll("[hidden]"))
        .filter((node) => getComputedStyle(node).display !== "none")
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className || "").split(" ")[0] || "(no class)"}`)
        .slice(0, 5),
      /**
       * Is variation text sitting *underneath* the host chrome band? The chrome owns the top 2.9rem;
       * if a variation's own header starts inside it, both labels render into each other.
       */
      underChrome: (() => {
        const chrome = document.querySelector("header[class*='chrome']");
        if (!chrome) return [];
        const rect = chrome.getBoundingClientRect();
        const found = new Set();
        for (let x = 12; x < rect.width; x += Math.max(48, rect.width / 14)) {
          for (const y of [rect.top + 6, rect.top + rect.height / 2, rect.bottom - 6]) {
            for (const node of document.elementsFromPoint(x, y)) {
              if (chrome.contains(node)) continue;
              if (node.closest("[data-catalog-hud]")) continue;
              if (!node.textContent || !node.textContent.trim()) continue;
              if (node.children.length > 0) continue;
              found.add(`${node.tagName.toLowerCase()}.${String(node.className || "").split(" ")[0]}`);
            }
          }
        }
        return Array.from(found).slice(0, 5);
      })(),
      horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
      reachableOverflow: doc.scrollWidth > doc.clientWidth + 1 && !viewportClipsX,
      viewportClipsX,
      spills,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      offenders,
      docHeight: doc.scrollHeight,
      iframes: document.querySelectorAll("iframe").length,
      canvases: document.querySelectorAll("canvas").length,
    };
  });
}

const measureFps = (page, ms = 2000) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed < duration) requestAnimationFrame(tick);
          else resolve(Math.round((frames / elapsed) * 1000));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

/* ══════════════════════════════════════════════════════════════ choreography */

/** Eased scroll driver: pixel-accurate, interruptible, and it fires real scroll events. */
async function glide(page, fromY, toY, durationMs) {
  const steps = Math.max(8, Math.round(durationMs / 70));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOutQuad
    await page.evaluate((target) => window.scrollTo(0, target), fromY + (toY - fromY) * eased);
    await sleep(durationMs / steps);
  }
}

/** Pointer arc — drives hover physics (tile recoil, liquid advection, reticles, radar pings). */
async function sweepPointer(page, { cx, cy, radius, turns = 1, steps = 26, durationMs = 1800 }) {
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2 * turns;
    await page.mouse.move(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.55, { steps: 2 });
    await sleep(durationMs / steps);
  }
}

/** Per-variation signature move; anything unlisted falls back to a slow scroll-through. */
const CHOREOGRAPHY = {
  hub: async (page) => {
    await sleep(1200);
    await glide(page, 0, 900, 2600);
    await glide(page, 900, 1900, 2400);
    await sleep(900);
  },
  "kinetic-brutal-grid": async (page) => {
    await sleep(400);
    await sweepPointer(page, { cx: 520, cy: 380, radius: 260, turns: 1.1, durationMs: 2400 });
    await page.mouse.move(900, 420, { steps: 24 });
    await sleep(500);
    await glide(page, 0, 700, 3200);
    await sleep(700);
  },
  "editorial-scroll-lock": async (page) => {
    await sleep(600);
    await glide(page, 0, 1200, 3400); // words arrive → ghost → grid wipes open
    await sleep(300);
    await glide(page, 1200, 2100, 3000); // the word lands in the image cell
    await sleep(800);
  },
  "particle-morph-field": async (page) => {
    await sleep(900);
    await sweepPointer(page, { cx: 620, cy: 380, radius: 280, turns: 0.9, durationMs: 2600 });
    await page.mouse.click(620, 380); // shockwave
    await sleep(600);
    await glide(page, 0, 1100, 3600); // torus → helix
    await sleep(900);
  },
  "cyber-scanner-hud": async (page) => {
    await sleep(1600); // boot sequence + typewriter
    await sweepPointer(page, { cx: 600, cy: 360, radius: 240, turns: 0.8, durationMs: 1900 }); // radar pings
    await page.mouse.click(600, 360); // glitch burst
    await sleep(400);
    await glide(page, 0, 900, 3400);
    await sleep(700);
  },
  "liquid-chroma-glass": async (page) => {
    await sleep(700);
    await sweepPointer(page, { cx: 560, cy: 380, radius: 300, turns: 1.2, durationMs: 3000 }); // advection
    await page.mouse.click(560, 380); // field pulse
    await sleep(400);
    await glide(page, 0, 950, 3200);
    await sleep(700);
  },
};

const genericScript = async (page) => {
  await sleep(1200);
  await sweepPointer(page, { cx: 640, cy: 400, radius: 240, turns: 0.8, durationMs: 1600 });
  await glide(page, 0, 900, 2800);
  await sleep(800);
};

/* ══════════════════════════════════════════════════════════════ GIF encoding */

/** 8×8 ordered Bayer matrix — cheap, stable dithering that keeps gradients from banding. */
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];

function ditherInPlace(rgba, width, height, strength = 18) {
  for (let y = 0; y < height; y += 1) {
    const row = BAYER[y & 7];
    for (let x = 0; x < width; x += 1) {
      const offset = (row[x & 7] / 63 - 0.5) * strength;
      const i = (y * width + x) * 4;
      rgba[i] = Math.max(0, Math.min(255, rgba[i] + offset));
      rgba[i + 1] = Math.max(0, Math.min(255, rgba[i + 1] + offset));
      rgba[i + 2] = Math.max(0, Math.min(255, rgba[i + 2] + offset));
    }
  }
}

/** Box-filter downscale — plenty for GIF, and it avoids a dependency. */
function downscale(frame, targetWidth) {
  const { width, height, data } = frame;
  if (width <= targetWidth) return frame;
  const ratio = width / targetWidth;
  const outWidth = targetWidth;
  const outHeight = Math.max(1, Math.round(height / ratio));
  const out = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(width, Math.floor((x + 1) * ratio));
      const y0 = Math.floor(y * ratio);
      const y1 = Math.min(height, Math.floor((y + 1) * ratio));
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const i = (sy * width + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      const o = (y * outWidth + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

/**
 * Encodes to GIF under a hard byte budget by walking a quality ladder, so a particle-heavy
 * variation cannot silently add 12 MB to the repository.
 *
 * `delayMs` is derived from the *measured* capture interval, never an assumed 12fps: software
 * rasterization captures the WebGL variations at ~2fps, and playing those frames back at 12fps
 * would show a 45-second morph in 7 seconds — a lie about the timing. With the real interval the
 * GIF plays at true speed.
 */
function encodeGif(frames, { delayMs = 83, budgetBytes = 1_600_000 } = {}) {
  const ladder = [256, 192, 160, 128, 96, 64, 48].map((colors, index) => ({
    width: Math.max(400, 900 - index * 80),
    colors,
    delayMs,
  }));

  const attempt = (preset) => {
    const delay = Math.max(20, Math.min(600, Math.round(preset.delayMs)));
    const scaled = frames.map((frame) => downscale(frame, preset.width));

    // One global palette keeps colours stable across frames (per-frame palettes flicker).
    const stride = Math.max(1, Math.floor(scaled.length / 10));
    const sampled = [];
    for (let i = 0; i < scaled.length; i += stride) sampled.push(scaled[i].data);
    const total = sampled.reduce((sum, d) => sum + d.length, 0);
    const paletteInput = new Uint8Array(total);
    let offset = 0;
    for (const d of sampled) {
      paletteInput.set(d, offset);
      offset += d.length;
    }
    const palette = quantize(paletteInput, preset.colors, { format: "rgb565" });

    const gif = GIFEncoder();
    scaled.forEach((frame, index) => {
      const rgba = Uint8Array.from(frame.data);
      if (preset.colors > 96) ditherInPlace(rgba, frame.width, frame.height, 18);
      const indexed = applyPalette(rgba, palette, "rgb565");
      gif.writeFrame(indexed, frame.width, frame.height, {
        palette,
        delay,
        repeat: index === 0 ? 0 : undefined,
      });
    });
    gif.finish();
    return { bytes: gif.bytes(), preset, size: scaled[0], delay };
  };

  let best = null;
  for (const preset of ladder) {
    best = attempt(preset);
    if (best.bytes.length <= budgetBytes) break;
  }
  return best;
}

/* ══════════════════════════════════════════════════════════════ capture */

async function captureTarget(browser, target) {
  const page = await browser.newPage();
  const capture = viewportFor(target);
  await page.setViewport({ ...capture, deviceScaleFactor: 1 });

  const bucket = { errors: [], failedRequests: [], abortedByDesign: [] };
  attachDiagnostics(page, bucket);

  await page.goto(`${BASE}${target.path}`, { waitUntil: "load", timeout: 90_000 });
  await sleep(1200);

  const report = { key: target.key, path: target.path };
  Object.assign(report, await probePage(page));
  report.errors = bucket.errors.slice(0, 8);
  report.failedRequests = bucket.failedRequests.slice(0, 8);
  report.abortedByDesign = bucket.abortedByDesign.length;

  /* ---- responsive sweep (real-world breakpoints, always) ---------------- */
  report.responsive = [];
  for (const viewport of [
    { name: "mobile", width: 360, height: 780 },
    { name: "tablet", width: 768, height: 900 },
    { name: "desktop", width: 1440, height: 900 },
    { name: "ultrawide", width: 2560, height: 1080 },
  ]) {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await sleep(700);
    const probe = await probePage(page);
    report.responsive.push({
      viewport: viewport.name,
      width: viewport.width,
      reachableOverflow: probe.reachableOverflow,
      clippedOverflow: probe.horizontalScroll && !probe.reachableOverflow,
      scrollWidth: probe.scrollWidth,
      clientWidth: probe.clientWidth,
      offenders: probe.offenders,
      spills: probe.spills,
      undefinedClasses: probe.undefinedClasses,
      leakedHidden: probe.leakedHidden,
      underChrome: probe.underChrome,
    });
  }
  await page.setViewport({ ...capture, deviceScaleFactor: 1 });
  await sleep(400);

  /* ---- frame rate (software rasterizer: relative signal only) ---------- */
  report.fpsSoftware = await measureFps(page, 1800);

  /* ---- reduced motion: does a composed frame still exist? -------------- */
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.reload({ waitUntil: "load", timeout: 90_000 });
  await sleep(1600);
  const reduced = await probePage(page);
  report.reducedMotion = {
    headingVisible: !!reduced.h1?.visible,
    headingOpacity: reduced.h1?.opacity ?? null,
    h1: reduced.h1?.text ?? null,
    webgl: reduced.webgl?.version ?? null,
    leakedHidden: reduced.leakedHidden,
  };
  if (!AUDIT_ONLY) await page.screenshot({ path: join(SHOTS, `${target.key}-reduced-motion.png`) });
  await page.emulateMediaFeatures([]);
  await page.reload({ waitUntil: "load", timeout: 90_000 });

  if (AUDIT_ONLY) {
    await page.close();
    return report;
  }

  /* ---- vision capture -------------------------------------------------- */
  await sleep(2600); // let the intro land before rolling

  const frames = [];
  const client = await page.createCDPSession();
  client.on("Page.screencastFrame", async (event) => {
    frames.push(Buffer.from(event.data, "base64"));
    try {
      await client.send("Page.screencastFrameAck", { sessionId: event.sessionId });
    } catch {
      /* frame arrived after stop — harmless */
    }
  });

  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 80,
    maxWidth: 1120, // ~final GIF width: the browser scales, which is cheaper than doing it in JS
    maxHeight: 700,
    // WebGL variations rasterize at ~2fps in software; capturing every frame costs decode time
    // without adding information.
    everyNthFrame: target?.variation?.perf?.webgl ? 3 : 1,
  });

  const script = CHOREOGRAPHY[target.key] || genericScript;
  const choreographyStart = Date.now();
  await script(page);
  const choreographyMs = Date.now() - choreographyStart;
  await sleep(400);
  await client.send("Page.stopScreencast").catch(() => {});
  await client.detach().catch(() => {});

  /* ---- stills at three scroll depths ---------------------------------- */
  const stills = [];
  for (const [index, depth] of [0, 0.32, 0.68].entries()) {
    await page.evaluate((d) => window.scrollTo(0, document.documentElement.scrollHeight * d), depth);
    await sleep(900);
    const file = join(SHOTS, `${target.key}-${["hero", "mid", "deep"][index]}.png`);
    await page.screenshot({ path: file });
    stills.push(file.replace(`${DOCS}/`, ""));
  }
  report.stills = stills;

  /* ---- decode → budget → encode --------------------------------------- */
  const decoded = [];
  for (const buffer of frames) {
    try {
      const { width, height, data } = jpeg.decode(buffer, { useTArray: true });
      decoded.push({ width, height, data });
    } catch {
      /* truncated frame: skip it rather than failing the run */
    }
  }

  // A 10 MB GIF helps nobody: sample long takes down to a fixed frame budget before encoding.
  const MAX_GIF_FRAMES = 84;
  let framesForGif = decoded;
  if (decoded.length > MAX_GIF_FRAMES) {
    const stride = decoded.length / MAX_GIF_FRAMES;
    framesForGif = Array.from({ length: MAX_GIF_FRAMES }, (_, i) => decoded[Math.floor(i * stride)]);
  }

  if (framesForGif.length > 12) {
    const measuredDelay = choreographyMs / Math.max(framesForGif.length, 1);
    const gif = encodeGif(framesForGif, { delayMs: measuredDelay, budgetBytes: 1_600_000 });
    await writeFile(join(OUT, `${target.key}.gif`), gif.bytes);
    report.gif = {
      file: `vision/${target.key}.gif`,
      bytes: gif.bytes.length,
      kb: Math.round(gif.bytes.length / 1024),
      frames: framesForGif.length,
      capturedFrames: decoded.length,
      width: gif.size.width,
      height: gif.size.height,
      delayMs: gif.delay,
      effectiveFps: Number((1000 / gif.delay).toFixed(1)),
      choreographyMs,
      colors: gif.preset.colors,
    };
  }

  report.frameCount = decoded.length;
  report.captureViewport = capture;
  await page.close();
  return report;
}

/* ══════════════════════════════════════════════════════════════ gallery */

async function writeGallery(reports, variations, meta) {
  const cards = reports
    .map((report) => {
      if (report.key === "hub") return "";
      const variation = variations.find((v) => v.slug === report.key) || {};
      const accent = variation.accent || "#ff4fd8";
      const responsive = report.responsive || [];
      const clean =
        responsive.every((r) => !r.reachableOverflow && !(r.spills || []).length && !(r.leakedHidden || []).length) &&
        (report.errors || []).length === 0;

      return `
      <article class="vision-card" style="--accent: ${accent}">
        <header>
          <span class="badge">BATCH ${String(variation.batch ?? 1).padStart(2, "0")}</span>
          <span class="discipline">${variation.discipline ?? ""}</span>
          <span class="verdict ${clean ? "ok" : "warn"}">${clean ? "verified" : "see report"}</span>
        </header>
        <h3>${variation.id ?? report.key}</h3>
        <p class="vibe">${variation.vibe ?? ""}</p>
        ${
          report.gif
            ? `<img src="${report.gif.file.replace("vision/", "")}" alt="Animated capture of ${variation.id}" loading="lazy" width="${report.gif.width}" height="${report.gif.height}" />`
            : `<p class="nogif">no capture in this run (audit only)</p>`
        }
        <dl>
          <div><dt>Captured</dt><dd>${
            report.gif
              ? `${report.gif.frames} frames · ${report.gif.width}×${report.gif.height} · ${report.gif.colors} colours · ${report.gif.kb} KB`
              : "—"
          }</dd></div>
          <div><dt>Playback</dt><dd>${
            report.gif ? `${report.gif.effectiveFps} fps real-time (${report.gif.delayMs} ms/frame) — software rasterizer, no GPU` : "—"
          }</dd></div>
          <div><dt>WebGL</dt><dd>${
            report.webgl?.version
              ? `${report.webgl.version} — ${String(report.webgl.renderer).slice(0, 46)}`
              : "not used (by design)"
          }</dd></div>
          <div><dt>HUD</dt><dd>${report.hud ? "present" : "MISSING"}</dd></div>
          <div><dt>Overflow</dt><dd>${responsive
            .map(
              (r) =>
                `${r.width}px ${
                  r.reachableOverflow ? "✗ scrollable" : (r.spills || []).length ? "✗ clipped" : "✓"
                }`,
            )
            .join(" · ")}</dd></div>
          <div><dt>hidden leaks</dt><dd>${(report.leakedHidden || []).length === 0 ? "none ✓" : report.leakedHidden.join(", ")}</dd></div>
          <div><dt>Reduced motion</dt><dd>${report.reducedMotion?.headingVisible ? "composed static frame ✓" : "✗ empty"}</dd></div>
          <div><dt>Console</dt><dd>${(report.errors || []).length === 0 ? "clean ✓" : `${report.errors.length} error(s)`}</dd></div>
        </dl>
        <div class="stills">
          ${(report.stills || [])
            .map(
              (still) =>
                `<a href="${still.replace("vision/", "")}" target="_blank" rel="noreferrer"><img src="${still.replace("vision/", "")}" alt="Still frame" loading="lazy" /></a>`,
            )
            .join("")}
        </div>
      </article>`;
    })
    .join("");

  const gifs = reports.filter((r) => r.gif);
  const totalBytes = gifs.reduce((sum, r) => sum + r.gif.bytes, 0);
  const failures = reports.reduce(
    (sum, report) =>
      sum +
      (report.errors?.length || 0) +
      (report.failedRequests?.length || 0) +
      (report.leakedHidden?.length || 0) +
      (report.underChrome?.length || 0) +
      (report.responsive || []).filter((r) => r.reachableOverflow || (r.spills || []).length).length +
      (report.reducedMotion && !report.reducedMotion.headingVisible ? 1 : 0),
    0,
  );

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Vision reel — The Catalog</title>
<meta name="description" content="Real-browser captures of every Catalog variation, beside the audit that produced them." />
<link rel="stylesheet" href="../assets/hub.css" />
<style>
  body { background: #050506; }
  .vision-head { padding: clamp(3rem, 9vh, 6rem) var(--gutter) clamp(1.5rem, 4vh, 2.5rem); border-bottom: 1px solid rgba(255,255,255,.08); }
  .vision-head h1 { font-size: clamp(2rem, 5vw, 4rem); color: #fff; letter-spacing: -.04em; }
  .vision-head p { max-width: 70ch; color: rgba(255,255,255,.62); margin-top: 1rem; line-height: 1.6; }
  .vision-head .meta { font-family: var(--font-mono); font-size: .58rem; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.4); margin-top: 1.4rem; display: flex; gap: 1.4rem; flex-wrap: wrap; }
  .vision-summary { margin: 0 var(--gutter) clamp(1.5rem,4vh,2.5rem); border: 1px solid ${failures ? "rgba(255,59,31,.5)" : "rgba(0,240,168,.35)"}; background: ${failures ? "rgba(255,59,31,.08)" : "rgba(0,240,168,.06)"}; padding: 1rem 1.2rem; font-family: var(--font-mono); font-size: .62rem; letter-spacing: .14em; text-transform: uppercase; color: ${failures ? "#ff8a76" : "#6ef0b0"}; }
  .vision-grid { display: grid; gap: clamp(1.4rem, 3vw, 2.6rem); grid-template-columns: repeat(auto-fit, minmax(min(100%, 30rem), 1fr)); padding: 0 var(--gutter) clamp(3rem, 9vh, 6rem); }
  .vision-card { border: 1px solid rgba(255,255,255,.1); border-top: 2px solid var(--accent); background: rgba(255,255,255,.02); padding: 1rem 1rem 1.2rem; display: grid; gap: .8rem; }
  .vision-card header { display: flex; align-items: center; gap: .5rem; font-family: var(--font-mono); font-size: .52rem; letter-spacing: .18em; text-transform: uppercase; }
  .vision-card .badge { background: var(--accent); color: #05050a; padding: .14rem .34rem; font-weight: 700; }
  .vision-card .discipline { color: rgba(255,255,255,.45); }
  .vision-card .verdict { margin-left: auto; }
  .vision-card .verdict.ok { color: #6ef0b0; }
  .vision-card .verdict.warn { color: #ff8a76; }
  .vision-card h3 { font-family: var(--font-mono); font-size: .88rem; color: #fff; letter-spacing: .01em; word-break: break-word; }
  .vision-card .vibe { font-family: var(--font-mono); font-size: .58rem; letter-spacing: .1em; text-transform: uppercase; color: color-mix(in oklab, var(--accent) 76%, #fff 24%); }
  .vision-card img { width: 100%; height: auto; border: 1px solid rgba(255,255,255,.08); background: #050506; }
  .vision-card .nogif { font-family: var(--font-mono); font-size: .6rem; color: rgba(255,255,255,.4); border: 1px dashed rgba(255,255,255,.15); padding: 2rem; text-align: center; }
  .vision-card dl { display: grid; gap: .35rem; margin: 0; font-size: .72rem; }
  .vision-card dl > div { display: grid; grid-template-columns: 7.5rem minmax(0,1fr); gap: .5rem; }
  .vision-card dt { font-family: var(--font-mono); font-size: .5rem; letter-spacing: .18em; text-transform: uppercase; color: rgba(255,255,255,.34); padding-top: .15rem; }
  .vision-card dd { margin: 0; color: rgba(255,255,255,.72); overflow-wrap: anywhere; }
  .stills { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: .35rem; }
  .stills img { aspect-ratio: 4/3; object-fit: cover; object-position: top; }
  .vision-foot { padding: 1.6rem var(--gutter) 2.4rem; border-top: 1px solid rgba(255,255,255,.08); font-family: var(--font-mono); font-size: .56rem; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,255,255,.34); display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .vision-foot a { color: var(--accent); }
  @media (max-width: 620px) { .stills { grid-template-columns: repeat(2, minmax(0,1fr)); } }
</style>
</head>
<body>
<header class="vision-head">
  <p class="meta" style="margin-top:0"><a href="../index.html" style="color:var(--accent)">← back to the hub</a></p>
  <h1>Vision reel</h1>
  <p>
    Every variation below was driven by a real Chromium — screenshotted, screencast, encoded and audited
    in the same pass. The animated frames are the actual render loop, not a mockup: the pointer arcs, the
    scroll trajectories and the clicks all happened. Audit results sit beside each capture, so the
    visuals and the evidence come from one source of truth.
  </p>
  <p class="meta">
    <span>captured ${meta.capturedAt}</span>
    <span>${reports.length} targets</span>
    <span>${gifs.length} captures · ${(totalBytes / 1048576).toFixed(1)} MB</span>
    <span>renderer: ${meta.renderer}</span>
  </p>
</header>
<section class="vision-summary">
  ${
    failures === 0
      ? "✓ all targets verified — no console errors, no horizontal overflow at 360/768/1440/2560, nothing hiding under the host chrome, HUD present, reduced-motion composition confirmed"
      : `${failures} finding(s) — inspect the report beside each capture`
  }
</section>
<main class="vision-grid">${cards}</main>
<footer class="vision-foot">
  <span>generated by scripts/vision.mjs · npm run verify:browser</span>
  <span><a href="report.json">machine-readable report.json</a></span>
</footer>
</body>
</html>`;

  await writeFile(join(OUT, "index.html"), html, "utf8");
}

/* ══════════════════════════════════════════════════════════════ main */

async function main() {
  const chromePath = await findChrome();
  if (!chromePath) {
    console.log(
      [
        "",
        "  ⚠ vision: no Chromium found — skipping real-browser verification.",
        "",
        "    Provision one with:   npm run setup:browser",
        "    Or point at your own: CHROME_PATH=/usr/bin/chromium npm run verify:browser",
        "",
      ].join("\n"),
    );
    return;
  }

  const manifest = JSON.parse(await readFile(join(DOCS, "data", "catalog.json"), "utf8"));
  const variations = manifest.variations.filter((v) => v.status !== "planned");

  // Navigate to the *directory* URL, never `…/index.html`: that is the address a visitor, the hub's
  // iframes and GitHub Pages all use, and a client-side router may legitimately refuse the explicit
  // file form (Nuxt does: it 404s `/route/index.html` while serving `/route/` perfectly). The file
  // is still what we check for existence below.
  // The hub runs its previews live — that is the product. Four is the sweet spot for a capture:
  // enough real artwork to prove the grid composes, few enough that a software rasterizer finishes
  // the tour (six cost ~9 minutes; four cost ~3). Pass ?live=0..6 by hand to see the other budgets.
  const targets = [{ key: "hub", path: "/?live=4" }].concat(
    variations.map((v) => ({
      key: v.slug,
      path: `/${v.href}`,
      file: join(DOCS, v.href, "index.html"),
      variation: v,
    })),
  );

  const selected = ONLY ? targets.filter((t) => t.key === ONLY) : targets;
  if (!selected.length) {
    console.error(`  ✖ --only ${ONLY} matched no target`);
    process.exit(1);
  }

  // A build must exist before we can screenshot it — say so instead of capturing 404 pages.
  for (const target of selected) {
    if (target.key === "hub") continue;
    try {
      await stat(target.file ?? join(DOCS, "index.html"));
    } catch {
      console.error(`\n  ✖ docs${target.path} does not exist. Run \`npm run build\` first.\n`);
      process.exit(1);
    }
  }

  await mkdir(SHOTS, { recursive: true });

  console.log(`\n  Chromium   ${chromePath}`);
  console.log(`  Targets    ${selected.map((t) => t.key).join(", ")}`);
  console.log(`  Mode       ${AUDIT_ONLY ? "audit only" : "audit + vision capture"}\n`);

  const server = await startServer();
  const launched = await launchBrowser(chromePath);
  let { browser } = launched;
  let gpuWorks = launched.gpu.ok;

  const reports = [];
  try {
    for (const target of selected) {
      process.stdout.write(`  ▸ ${target.key.padEnd(24)}`);

      // Recycle the browser if the GPU process has stopped granting contexts mid-run. (If the
      // environment never had WebGL there is nothing to recycle — the variations say so themselves.)
      if (gpuWorks && !(await gpuHealthy(browser))) {
        process.stdout.write("(recycling browser) ");
        await browser.close().catch(() => {});
        const recycled = await launchBrowser(chromePath);
        browser = recycled.browser;
        gpuWorks = recycled.gpu.ok;
      }

      const started = Date.now();
      try {
        const report = await captureTarget(browser, target);
        reports.push(report);
        const findings =
          (report.errors?.length || 0) +
          (report.failedRequests?.length || 0) +
          (report.leakedHidden?.length || 0) +
          (report.underChrome?.length || 0) +
          (report.responsive || []).filter((r) => r.reachableOverflow || (r.spills || []).length).length;
        console.log(
          `${!gpuWorks && target?.variation?.perf?.webgl ? "⚠ no WebGL here · " : ""}${
            findings === 0 ? "✓" : `✖ ${findings} finding(s)`
          }  ${
            report.gif ? `${report.gif.frames}f → ${report.gif.width}px / ${report.gif.kb}KB · ` : ""
          }${((Date.now() - started) / 1000).toFixed(1)}s`,
        );
        // Flush progress to disk continuously: a long capture that dies must not lose everything.
        await mkdir(OUT, { recursive: true });
        await writeFile(
          join(OUT, "report.partial.json"),
          JSON.stringify({ capturedAt: new Date().toISOString(), complete: false, reports }, null, 2) + "\n",
        );
      } catch (error) {
        console.log(`✖ crashed: ${error.message}`);
        reports.push({ key: target.key, path: target.path, errors: [error.message], responsive: [], crashed: true });
      }
    }
  } finally {
    await browser.close();
    server.kill("SIGKILL");
  }

  const meta = {
    capturedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    renderer: reports.find((r) => r.webgl?.renderer)?.webgl?.renderer?.slice(0, 60) || "software rasterizer",
    gpuProfile: launched.profile,
  };

  /**
   * `--only <key>` refreshes one variation's evidence *without discarding the rest of the reel*.
   * Iterating on a single variation is the normal case, and a 20-minute re-capture of everything is
   * exactly the wrong tax to charge for it — so merge into the existing report, ordered by manifest.
   */
  let allReports = reports;
  if (ONLY) {
    try {
      const previous = JSON.parse(await readFile(join(OUT, "report.json"), "utf8"));
      const order = ["hub", ...variations.map((variation) => variation.slug)];
      const merged = new Map((previous.reports ?? []).map((entry) => [entry.key, entry]));
      for (const report of reports) merged.set(report.key, report);
      allReports = order.map((key) => merged.get(key)).filter(Boolean);
    } catch {
      /* first run, or no previous report: this run's reports stand on their own */
    }
  }

  await mkdir(OUT, { recursive: true });
  await writeFile(
    join(OUT, "report.json"),
    JSON.stringify({ ...meta, complete: true, reports: allReports }, null, 2) + "\n",
  );
  await writeGallery(allReports, variations, meta);

  /* ---- console summary -------------------------------------------------- */
  const line = "─".repeat(84);
  console.log(`\n${line}`);
  console.log("  BROWSER VERIFICATION");
  console.log(line);
  for (const report of allReports) {
    const flags = [];
    if ((report.errors || []).length) flags.push(`${report.errors.length} console error(s)`);
    if ((report.failedRequests || []).length) flags.push(`${report.failedRequests.length} failed request(s)`);
    if ((report.leakedHidden || []).length) flags.push(`hidden ignored: ${report.leakedHidden.join(",")}`);
    if ((report.underChrome || []).length) flags.push(`text under chrome: ${report.underChrome.join(",")}`);
    (report.responsive || [])
      .filter((r) => r.reachableOverflow)
      .forEach((r) => flags.push(`scrollable h-overflow @${r.width}px`));
    (report.responsive || [])
      .filter((r) => (r.spills || []).length)
      .forEach((r) => flags.push(`${r.spills.length} clipped label(s) @${r.width}px`));
    if (report.undefinedClasses) flags.push(`${report.undefinedClasses} undefined class refs`);
    if (report.reducedMotion && !report.reducedMotion.headingVisible) flags.push("reduced-motion frame empty");
    if (report.hud === false) flags.push("HUD missing");
    console.log(
      `  ${flags.length ? "✖" : "✔"} ${report.key.padEnd(24)} ${
        report.webgl?.version
          ? "webgl " + String(report.webgl.version).split(" ")[1]
          : report.webgl?.note
            ? "no webgl (fallback shown)"
            : "no webgl (by design)"
      }  ${report.fpsSoftware ? report.fpsSoftware + "fps(sw)" : ""}  ${flags.join(", ") || "clean"}`,
    );
    (report.errors || []).slice(0, 3).forEach((e) => flags.length && console.log(`      · ${e}`));
    (report.failedRequests || []).slice(0, 3).forEach((e) => flags.length && console.log(`      · ${e}`));
  }
  console.log(line);
  console.log(`  report   docs/vision/report.json`);
  console.log(`  gallery  docs/vision/index.html`);
  console.log(`${line}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
