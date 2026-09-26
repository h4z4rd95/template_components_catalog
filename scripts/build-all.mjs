#!/usr/bin/env node
/**
 * build-all.mjs — the local twin of .github/workflows/deploy.yml.
 *
 *   npm run build      →  sync manifest → build Next export (and Nuxt, once it exists)
 *                         → splice each framework export into docs/framework/<name>/
 *
 * basePath strategy: locally the preview server hosts `docs/` at "/", so the Next export
 * lives at "/framework/next". CI overrides NEXT_BASE_PATH with "</repo>/framework/next".
 * Because catalog hrefs are relative, the hub needs no rewriting in either case.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, mkdir, cp, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
const PAGES_BASE = (process.env.PAGES_BASE_PATH || "").replace(/\/$/, "");

const run = (cmd, args, opts = {}) =>
  new Promise((res, rej) => {
    console.log(`\n\x1b[2m$ ${cmd} ${args.join(" ")}\x1b[0m`);
    const child = spawn(cmd, args, { stdio: "inherit", cwd: ROOT, shell: process.platform === "win32", ...opts });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
    child.on("error", rej);
  });

const jobs = [
  {
    name: "next",
    label: "Next.js catalog",
    dir: "apps/next-catalog",
    workspace: "@catalog/next",
    out: "out",
    basePath: `${PAGES_BASE}/framework/next`,
  },
  {
    name: "nuxt",
    label: "Nuxt catalog",
    dir: "apps/nuxt-catalog",
    workspace: "@catalog/nuxt",
    out: ".output/public",
    basePath: `${PAGES_BASE}/framework/nuxt`,
    optional: true, // arrives in Batch 2
  },
];

async function main() {
  await run("node", ["scripts/sync-catalog.mjs"]);

  const built = [];
  for (const job of jobs) {
    if (!existsSync(join(ROOT, job.dir, "package.json"))) {
      if (job.optional) console.log(`\n\x1b[2m· skipping ${job.label} (not scaffolded yet)\x1b[0m`);
      continue;
    }
    await run("npm", ["--workspace", job.workspace, "run", "build"], {
      env: { ...process.env, NEXT_BASE_PATH: job.basePath, NUXT_APP_BASE_URL: `${job.basePath}/` },
    });

    const from = join(ROOT, job.dir, job.out);
    const to = join(DOCS, "framework", job.name);
    if (!existsSync(from)) throw new Error(`${job.label} produced no ${job.out}/ directory`);
    await rm(to, { recursive: true, force: true });
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to, { recursive: true });
    built.push({ name: job.name, basePath: job.basePath, files: job.out });
    console.log(`  ✓ ${job.label} → docs/framework/${job.name}  (basePath ${job.basePath || "/"})`);
  }

  await writeFile(
    join(DOCS, "framework", ".build-info.json"),
    JSON.stringify({ builtAt: new Date().toISOString(), apps: built, pagesBase: PAGES_BASE }, null, 2) + "\n",
    "utf8",
  );

  // The download archive is part of the deployment: it is generated here, right after the apps,
  // so the file a visitor downloads is the same revision the site is serving.
  await run("node", ["scripts/bundle.mjs"]);

  console.log(`\n\x1b[32m✔ catalog built\x1b[0m — ${built.length} framework app(s) spliced into docs/`);
  console.log(`  preview it with: npm run preview\n`);
}

main().catch((err) => {
  console.error(`\n\x1b[31m✖ build failed:\x1b[0m ${err.message}\n`);
  process.exit(1);
});
