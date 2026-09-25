#!/usr/bin/env node
/**
 * sync-catalog.mjs — the manifest pipeline.
 *
 *   1. validates catalog/catalog.json (ids, enums, required fields, on-disk sources)
 *   2. emits docs/data/catalog.json  → for fetch()
 *   3. emits docs/data/catalog.js    → window.__CATALOG__ fallback so the hub also works from file://
 *   4. vendors the vanilla track's assets out of node_modules (docs/vanilla/shared/**) so the
 *      buildless pages stay offline and CDN-free while still using the same versions as the apps
 *
 * Run: npm run catalog:sync
 */
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "catalog", "catalog.json");
const OUT_DIR = join(ROOT, "docs", "data");

const ID_RE = /^(Hero|Nav|Loader|Scroll|Footer|UX|Dashboard|Commerce)_V\d{2}_[A-Za-z0-9]+$/;
const STATUSES = new Set(["stable", "beta", "planned"]);
const REQUIRED = ["id", "discipline", "title", "stack", "vibe", "interaction", "href", "source", "status", "accent", "tags"];
// A shipped variation must exist in both languages. The plan is explicit about this: a bilingual
// catalogue whose second language is half-filled is worse than a monolingual one.
const REQUIRED_I18N = ["titleFa", "vibeFa", "interactionFa", "topic"];

const errors = [];
const warnings = [];

const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const slugify = (id) =>
  id
    .replace(/^[A-Za-z]+_V\d{2}_/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

function deriveSlugs(raw) {
  return raw.map((v) => {
    const slug = v.slug ?? slugify(v.id);
    const base = v.discipline.toLowerCase();
    return { ...v, slug, route: `${base}/${slug}/`, url: v.href ?? `framework/next/${base}/${slug}/` };
  });
}

/* ---------------------------------------------------------------------------- 4. vendoring ---
 * The vanilla track is deliberately buildless, so it cannot `import "motion"`. It gets the same
 * bytes the apps get, copied out of node_modules at sync time: a plain <script src> and a plain
 * @font-face, both same-origin, both working from file:// as well as from Pages. Nothing is
 * fetched from a CDN at runtime, which is what keeps a single HTML file self-sufficient.
 */
/* The Persian faces. Each Latin role in this catalogue already had a face (Archivo Black for the
 * kinetic display, Instrument Serif for editorial, JetBrains Mono for telemetry); each one gets a
 * Persian counterpart chosen for the *same job*, so a headline reads as a headline in both
 * languages rather than as the same font wearing a different script. All three are OFL. */
const FONT_FACES = [
  { dir: ["@fontsource-variable", "vazirmatn", "files"], file: "vazirmatn-latin-wght-normal.woff2", weight: "100 900", format: "woff2-variations", script: "latin" },
  { dir: ["@fontsource-variable", "vazirmatn", "files"], file: "vazirmatn-arabic-wght-normal.woff2", weight: "100 900", format: "woff2-variations", script: "arabic" },
  { dir: ["@fontsource", "lalezar", "files"], file: "lalezar-latin-400-normal.woff2", weight: "400", format: "woff2", script: "latin" },
  { dir: ["@fontsource", "lalezar", "files"], file: "lalezar-arabic-400-normal.woff2", weight: "400", format: "woff2", script: "arabic" },
  { dir: ["@fontsource-variable", "readex-pro", "files"], file: "readex-pro-latin-wght-normal.woff2", weight: "100 900", format: "woff2-variations", script: "latin" },
  { dir: ["@fontsource-variable", "readex-pro", "files"], file: "readex-pro-arabic-wght-normal.woff2", weight: "100 900", format: "woff2-variations", script: "arabic" },
];

// Subset ranges lifted from the packages' own stylesheets — the browser picks the right file per
// glyph, which is what lets one family name render Latin with Archivo and Persian with Lalezar.
const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const ARABIC_RANGE =
  "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0898-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFF";

const VENDOR = [
  {
    label: "Motion One",
    from: join(ROOT, "node_modules", "motion", "dist", "motion.js"),
    meta: join(ROOT, "node_modules", "motion", "package.json"),
    to: join(ROOT, "docs", "vanilla", "shared", "vendor", "motion.min.js"),
    text: true,
    note: "UMD build, MIT — loaded with a plain <script src>",
  },
  {
    label: "Archivo Black",
    from: join(ROOT, "node_modules", "@fontsource", "archivo-black", "files", "archivo-black-latin-400-normal.woff2"),
    meta: join(ROOT, "node_modules", "@fontsource", "archivo-black", "package.json"),
    to: join(ROOT, "docs", "vanilla", "shared", "fonts", "archivo-black-latin-400-normal.woff2"),
    text: false,
    note: "latin subset, OFL — display face of the catalogue",
  },
  ...FONT_FACES.map((face) => ({
    label: face.file.replace(/-wght|-400|-normal|\.woff2/g, ""),
    from: join(ROOT, "node_modules", ...face.dir, face.file),
    meta: join(ROOT, "node_modules", face.dir[0], face.dir[1], "package.json"),
    to: join(ROOT, "docs", "assets", "fonts", face.file),
    text: false,
    note: `${face.script} subset — vendored for the bilingual shell`,
  })),
];

async function vendorAssets() {
  const results = [];
  for (const asset of VENDOR) {
    const rel = asset.to.replace(ROOT + "/", "");
    let version = "unknown";
    try {
      version = JSON.parse(await readFile(asset.meta, "utf8")).version;
    } catch {
      /* version is cosmetic; the bytes below are what matter */
    }

    let bytes = null;
    try {
      bytes = await readFile(asset.from, asset.text ? "utf8" : undefined);
    } catch {
      bytes = null;
    }

    if (bytes === null) {
      // A fresh clone that runs the sync before `npm install` keeps the committed copy.
      let kept = false;
      try {
        await access(asset.to);
        kept = true;
      } catch {
        kept = false;
      }
      if (kept) results.push(`  ~ ${asset.label.padEnd(14)} kept the committed copy (node_modules absent)`);
      else warn(`vanilla vendor: ${rel} missing and node_modules/${asset.label} is not installed — run \`npm install\``);
      continue;
    }

    await mkdir(dirname(asset.to), { recursive: true });
    if (asset.text) {
      const banner =
        `/*! ${asset.label} v${version} — ${asset.note}.\n` +
        ` *  Vendored by scripts/sync-catalog.mjs from node_modules/${asset.label === "Motion One" ? "motion/dist/motion.js" : "@fontsource/archivo-black/files"}.\n` +
        ` *  Do not edit by hand: re-run \`npm run catalog:sync\` after a dependency bump. */\n`;
      await writeFile(asset.to, banner + bytes, "utf8");
      results.push(`  ✔ ${asset.label.padEnd(14)} v${version} → ${rel}`);
    } else {
      await writeFile(asset.to, bytes);
      results.push(`  ✔ ${asset.label.padEnd(14)} v${version} → ${rel} (${Math.round(bytes.length / 1024)} KB)`);
    }
  }
  return results;
}

/**
 * The role map, generated rather than hand-written so the stylesheet can never drift from the
 * bytes that were actually copied. One family name per *job*, two faces per family (Latin +
 * Persian) split by `unicode-range`:
 *
 *   Catalog Sans       body + UI                    Inter-like  →  Vazirmatn
 *   Catalog Display    kinetic / brutalist headlines Archivo      →  Lalezar
 *   Catalog Editorial  editorial + luxury headings   Instrument   →  Readex Pro
 *   Catalog Mono       telemetry, IDs, counters      JetBrains    →  Vazirmatn (tabular)
 */
async function emitFontStylesheet() {
  const faces = FONT_FACES.map((face) => {
    const family = face.file.startsWith("vazirmatn")
      ? "Catalog Sans"
      : face.file.startsWith("lalezar")
        ? "Catalog Display"
        : "Catalog Editorial";
    const range = face.script === "arabic" ? ARABIC_RANGE : LATIN_RANGE;
    return `@font-face {
  font-family: "${family}";
  font-style: normal;
  font-weight: ${face.weight};
  font-display: swap;
  src: url("fonts/${face.file}") format("${face.format}");
  unicode-range: ${range};
}`;
  });

  const css = `/* Generated by scripts/sync-catalog.mjs — do not edit.
 * The catalogue's own OFL faces, in both scripts, split by unicode-range so one family name
 * renders Latin and Persian with the face each language deserves. */

${faces.join("\n\n")}

:root {
  /* Persian never resolves to a missing glyph: each stack ends in a face that covers U+06xx. */
  --font-sans: "Catalog Sans", "Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display: "Catalog Display", "Archivo Black", "Catalog Sans", system-ui, sans-serif;
  --font-editorial: "Catalog Editorial", "Instrument Serif", Georgia, serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, "Catalog Sans", monospace;

  /* Editorial Persian is not the display Persian: Nastaliq-free Readex keeps long headlines
   * readable, while Lalezar is reserved for the sections that are supposed to shout. */
  --leading-fa: 1.75;
}

[lang="fa"] {
  --leading-body: var(--leading-fa);
  letter-spacing: 0;
}
`;

  await writeFile(join(ROOT, "docs", "assets", "fonts.css"), css, "utf8");
  return `  ✔ fonts.css              role map regenerated (${FONT_FACES.length} faces, 2 scripts)`;
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (err) {
    console.error(`✖ Cannot read ${MANIFEST}\n  ${err.message}`);
    process.exit(1);
  }

  const disciplineIds = new Set((manifest.disciplines ?? []).map((d) => d.id));
  const variations = deriveSlugs(manifest.variations ?? []);
  const seen = new Map();

  if (!variations.length) fail("manifest contains no variations");

  for (const v of variations) {
    const where = `variation "${v.id ?? "(missing id)"}"`;

    for (const key of REQUIRED) if (v[key] === undefined || v[key] === null) fail(`${where}: missing required field \`${key}\``);
    if (typeof v.id === "string" && !ID_RE.test(v.id)) fail(`${where}: id must match {Discipline}_V##_StyleCodename`);
    if (v.discipline && !disciplineIds.has(v.discipline)) fail(`${where}: unknown discipline \`${v.discipline}\``);
    if (v.status && !STATUSES.has(v.status)) fail(`${where}: status must be one of ${[...STATUSES].join(", ")}`);
    if (!Array.isArray(v.stack) || !v.stack.length) fail(`${where}: stack must be a non-empty array`);
    if (!Array.isArray(v.tags) || !v.tags.length) fail(`${where}: tags must be a non-empty array`);
    if (v.accent && !/^#[0-9a-fA-F]{6}$/.test(v.accent)) fail(`${where}: accent must be a 6-digit hex colour`);
    if (v.status === "stable") {
      for (const key of REQUIRED_I18N) {
        if (!v[key]) fail(`${where}: a shipped variation needs \`${key}\` (Persian content) — see PLAN §8`);
      }
    }
    if (typeof v.interaction === "string" && v.interaction.split(/\s+/).length < 8) warn(`${where}: interaction note is very short — the HUD likes a full sentence`);

    if (v.id) {
      if (seen.has(v.id)) fail(`duplicate id "${v.id}" (also used by ${seen.get(v.id)})`);
      else seen.set(v.id, v.discipline);
    }

    // source must exist on disk (planned entries are exempt)
    if (v.status !== "planned" && v.source) {
      try {
        await access(join(ROOT, v.source));
      } catch {
        fail(`${where}: source path does not exist → ${v.source}`);
      }
    }

    if (v.perf?.webgl && v.status === "stable") {
      const tags = v.tags.join(" ");
      if (!/webgl|shader|three|r3f|tres/i.test(tags)) warn(`${where}: marked webgl but no GPU-ish tags`);
    }
  }

  // ---- topic registry -----------------------------------------------------
  const topics = manifest.topics ?? [];
  const topicIds = new Set(topics.map((t) => t.id));
  if (!topics.length) fail("manifest declares no topics — the browse pages need them");
  for (const t of topics) {
    for (const key of ["id", "label", "labelFa", "blurb", "blurbFa"]) {
      if (!t[key]) fail(`topic "${t.id ?? "(missing id)"}": missing \`${key}\``);
    }
  }
  for (const v of variations) {
    if (!v.topic) continue;
    if (!topicIds.has(v.topic)) fail(`variation "${v.id}": unknown topic \`${v.topic}\``);
    const discipline = (manifest.disciplines ?? []).find((d) => d.id === v.discipline);
    if (discipline?.topics?.length && !discipline.topics.includes(v.topic)) {
      fail(`variation "${v.id}": topic \`${v.topic}\` is not listed under discipline \`${v.discipline}\``);
    }
  }

  // ---- language parity ----------------------------------------------------
  const ui = manifest.ui ?? {};
  const locales = (manifest.locales ?? []).map((l) => l.id);
  if (locales.length < 2) fail("manifest must declare at least two locales");
  for (const id of locales) if (!ui[id]) fail(`ui dictionary is missing locale \`${id}\``);
  if (locales.length >= 2) {
    const base = Object.keys(ui[locales[0]] ?? {}).sort();
    for (const id of locales.slice(1)) {
      const other = Object.keys(ui[id] ?? {}).sort();
      const missing = base.filter((k) => !other.includes(k));
      const extra = other.filter((k) => !base.includes(k));
      if (missing.length) fail(`ui[${id}] is missing ${missing.length} key(s): ${missing.slice(0, 6).join(", ")}`);
      if (extra.length) fail(`ui[${id}] has ${extra.length} key(s) that ui[${locales[0]}] lacks: ${extra.slice(0, 6).join(", ")}`);
    }
  }
  for (const d of manifest.disciplines ?? []) {
    for (const key of ["labelFa", "blurbFa"]) {
      if (!d[key]) fail(`discipline "${d.id}": missing \`${key}\` — the shell has to switch language too`);
    }
  }

  const counts = {
    total: variations.length,
    stable: variations.filter((v) => v.status === "stable").length,
    beta: variations.filter((v) => v.status === "beta").length,
    planned: variations.filter((v) => v.status === "planned").length,
  };

  const payload = {
    ...manifest,
    variations,
    counts,
    generatedAt: new Date().toISOString(),
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "catalog.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
  await writeFile(
    join(OUT_DIR, "catalog.js"),
    `/* generated by scripts/sync-catalog.mjs — do not edit. Enables the hub over file:// */\n` +
      `window.__CATALOG__ = ${JSON.stringify(payload)};\n`,
    "utf8",
  );

  // App-local copies: bundlers cannot safely import JSON from outside their project root,
  // so each framework app gets its own typed copy of the same payload.
  const APP_TARGETS = [
    ["apps/next-catalog/src/generated/catalog.json", true],
    ["apps/nuxt-catalog/app/generated/catalog.json", false], // appears with Batch 2
  ];
  for (const [rel, required] of APP_TARGETS) {
    const target = join(ROOT, rel);
    const dir = join(target, "..");
    if (!required) {
      try {
        await access(join(dir, ".."));
      } catch {
        continue; // app not scaffolded yet
      }
    }
    await mkdir(dir, { recursive: true });
    // Pure JSON on purpose — bundlers parse it, and a stray comment would break `import`.
    await writeFile(target, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  // ---- report -------------------------------------------------------------
  const vendored = await vendorAssets();
  vendored.push(await emitFontStylesheet());
  const line = "─".repeat(64);
  console.log(line);
  console.log(`  CATALOG SYNC  ·  ${counts.total} variations  (stable ${counts.stable} / beta ${counts.beta} / planned ${counts.planned})`);
  console.log(line);
  for (const v of variations) {
    const badge = v.status === "stable" ? "✔" : v.status === "beta" ? "~" : "○";
    console.log(`  ${badge} ${v.id.padEnd(32)} → ${v.url}`);
  }
  console.log(line);
  console.log(`  vanilla track (buildless: no bundler, no CDN)`);
  for (const r of vendored) console.log(r);
  console.log(line);
  for (const w of warnings) console.log(`  ! warning: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ✖ ${e}`);
    console.error(`\n  ${errors.length} manifest error(s). Fix catalog/catalog.json and re-run.\n`);
    process.exit(1);
  }
  console.log(`  ✓ wrote docs/data/catalog.json + docs/data/catalog.js\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
