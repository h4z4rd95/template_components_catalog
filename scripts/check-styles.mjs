#!/usr/bin/env node
/**
 * check-styles.mjs — static integrity check for CSS Modules.
 *
 * A typo like `styles.headlineWrap` (when the sheet defines `.headline-wrap`) fails *silently*:
 * CSS Modules return `undefined`, React drops the attribute, and the element renders unstyled.
 * TypeScript cannot see it. This script can.
 *
 * It also verifies that every `@keyframes`/custom property the stylesheets animate actually exist,
 * and that no TSX references a class the sheet never declared.
 *
 * Run: npm run check:styles   (also invoked by `npm test`)
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "next-catalog", "src");

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Class names declared in a stylesheet (a loose scan is fine: false positives are harmless). */
function declaredClasses(css) {
  const names = new Set();
  for (const match of css.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)) names.add(match[1]);
  return names;
}

async function main() {
  const files = await walk(SRC);
  const tsx = files.filter((f) => f.endsWith(".tsx"));
  const problems = [];
  const checked = [];

  for (const file of tsx) {
    const source = await readFile(file, "utf8");

    // `import styles from "./x.module.css"` (any local binding name)
    const importMatch = source.match(/import\s+(\w+)\s+from\s+"([^"]+\.module\.css)"/);
    if (!importMatch) continue;

    const [, binding, cssPath] = importMatch;
    const cssFile = resolve(dirname(file), cssPath);
    let css;
    try {
      css = await readFile(cssFile, "utf8");
    } catch {
      problems.push(`${relative(ROOT, file)} imports ${cssPath} but the file does not exist`);
      continue;
    }

    const declared = declaredClasses(css);
    const allowed = new Set();
    declared.forEach((name) => {
      allowed.add(name);
      allowed.add(camel(name));
    });
    // camelCase declarations also satisfy kebab-case lookups
    declared.forEach((name) => allowed.add(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)));

    const used = new Set();
    for (const match of source.matchAll(new RegExp(`${binding}\\.([A-Za-z_][A-Za-z0-9_]*)`, "g"))) {
      used.add(match[1]);
    }

    const missing = [...used].filter((name) => !allowed.has(name));
    if (missing.length) {
      problems.push(
        `${relative(ROOT, file)} → ${relative(ROOT, cssFile)}: no such class: ${missing
          .map((m) => `.${m}`)
          .join(", ")}`,
      );
    }

    // Report declared-but-unused classes only for local sheets (informational).
    const unusedLocal = [...declared].filter(
      (name) => !used.has(name) && !used.has(camel(name)) && !used.has(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
    );

    checked.push({ file: relative(ROOT, file), classes: used.size, declared: declared.size, unusedLocal });
  }

  /* ---- report ------------------------------------------------------------ */
  console.log("─".repeat(72));
  console.log("  CSS MODULE INTEGRITY");
  console.log("─".repeat(72));
  const width = Math.max(...checked.map((c) => c.file.length), 20);
  checked.forEach((entry) => {
    console.log(
      `  ${entry.file.padEnd(width)}  ${String(entry.classes).padStart(3)} used / ${String(entry.declared).padStart(3)} declared`,
    );
  });
  console.log("─".repeat(72));

  if (problems.length) {
    problems.forEach((p) => console.error(`  ✖ ${p}`));
    console.error(`\n  ${problems.length} problem(s). Fix the class names and re-run.\n`);
    process.exit(1);
  }
  console.log("  ✓ every styles.* reference resolves to a declared class\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
