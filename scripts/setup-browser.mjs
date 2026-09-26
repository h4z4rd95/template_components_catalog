#!/usr/bin/env node
/**
 * setup-browser.mjs — provisions a real Chromium for `npm run verify:browser`.
 *
 * Why this exists
 * ───────────────
 * Playwright's CDN, Puppeteer's download host and Debian's apt mirrors are all routinely blocked in
 * sandboxes and CI runners. What is *not* blocked is the npm registry — and `@sparticuz/chromium`
 * ships a complete, static Chromium build inside its tarball, together with the shared libraries it
 * needs (as brotli archives) and a SwiftShader build for software GL.
 *
 * This script
 *   1. installs the browser + capture dependencies as devDependencies,
 *   2. extracts the brotli archives into `.cache/catalog-browser/` (git-ignored, and excluded from
 *      workspace snapshots — nothing large ever enters the repository),
 *   3. verifies the binary actually launches and reports its version,
 *   4. prints the two environment variables the vision harness needs.
 *
 * Usage
 *   npm run setup:browser          # install + extract + smoke-test
 *   node scripts/setup-browser.mjs --skip-install
 *
 * Environment
 *   CHROME_PATH   use an existing Chromium instead (skips provisioning entirely)
 */
import { spawn, spawnSync } from "node:child_process";
import { access, copyFile, link, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = join(ROOT, ".cache", "catalog-browser");
const SKIP_INSTALL = process.argv.includes("--skip-install");

const PACKAGES = {
  dev: ["@sparticuz/chromium@153", "puppeteer-core@25", "gifenc@1.0.3", "jpeg-js"],
};

const run = (command, args, opts = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit", ...opts });
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`))));
    child.on("error", reject);
  });

const exists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

/** Tar reader: enough of the format to extract .so files (ustar + GNU long names). */
function extractTar(buffer, destination, filter = () => true) {
  const written = [];
  let offset = 0;
  let pendingLongName = null;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const readString = (start, length) =>
      header.subarray(start, start + length).toString("utf8").replace(/\0.*$/, "").trim();

    let name = readString(0, 100);
    const prefix = readString(345, 155);
    const size = Number.parseInt(readString(124, 12), 8) || 0;
    const type = String.fromCharCode(header[156] || 48);
    const contentStart = offset + 512;

    if (type === "L") {
      pendingLongName = buffer.subarray(contentStart, contentStart + size).toString("utf8").replace(/\0.*$/, "");
    } else {
      if (pendingLongName) {
        name = pendingLongName;
        pendingLongName = null;
      } else if (prefix) {
        name = `${prefix}/${name}`;
      }

      if ((type === "0" || type === " " || type === "") && filter(name)) {
        const target = join(destination, name.replace(/^\.\//, ""));
        written.push({ target, data: buffer.subarray(contentStart, contentStart + size) });
      }
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return written;
}

async function main() {
  /* ---------------------------------------------------------- 0. use what exists */
  if (process.env.CHROME_PATH && (await exists(process.env.CHROME_PATH))) {
    console.log(`\n  ✓ using CHROME_PATH=${process.env.CHROME_PATH}`);
    console.log("    (browser provisioning skipped)\n");
    return;
  }

  /* ---------------------------------------------------------- 1. dependencies */
  if (!SKIP_INSTALL) {
    console.log("\n  → installing browser + capture dependencies…");
    await run("npm", ["install", "--no-audit", "--no-fund", "--save-dev", ...PACKAGES.dev]);
  }

  const chromiumEntry = join(ROOT, "node_modules", "@sparticuz", "chromium", "build", "index.js");
  if (!(await exists(chromiumEntry))) {
    console.error("\n  ✖ @sparticuz/chromium is not installed. Re-run without --skip-install.\n");
    process.exit(1);
  }

  /* ---------------------------------------------------------- 2. extract */
  await mkdir(CACHE, { recursive: true });

  const { default: Chromium } = await import(chromiumEntry);
  // The package's own executablePath() inflates its archives into /tmp; do it ourselves so the
  // result lives somewhere predictable and re-usable across runs.
  const binDir = join(ROOT, "node_modules", "@sparticuz", "chromium", "bin");

  const binaryArchive = join(binDir, "chromium.br");
  if (!(await exists(binaryArchive))) {
    console.error(`\n  ✖ ${binaryArchive} not found — is @sparticuz/chromium installed correctly?\n`);
    process.exit(1);
  }

  const chromiumPath = join(CACHE, "chromium");
  if (!(await exists(chromiumPath))) {
    console.log("  → inflating chromium.br (≈67 MB)…");
    const { readFile } = await import("node:fs/promises");
    const binary = zlib.brotliDecompressSync(await readFile(binaryArchive));
    await writeFile(chromiumPath, binary, { mode: 0o755 });
  }

  const libraryDir = join(CACHE, "lib");
  await mkdir(libraryDir, { recursive: true });
  if (!(await exists(join(libraryDir, "libnspr4.so")))) {
    const { readFile } = await import("node:fs/promises");
    for (const archive of ["al2023.tar.br", "swiftshader.tar.br"]) {
      const source = join(binDir, archive);
      if (!(await exists(source))) continue;
      console.log(`  → inflating ${archive}…`);
      const tar = zlib.brotliDecompressSync(await readFile(source));
      // Extract *everything* from both archives, flattened into one directory.
      //
      // Filtering to `*.so` is tempting and wrong: the SwiftShader archive also carries
      // `vk_swiftshader_icd.json`, the Vulkan ICD manifest ANGLE reads to find its software
      // rasterizer. Without it Chrome launches happily and then refuses to create any WebGL
      // context — which looks exactly like "this machine has no GPU support".
      for (const { target, data } of extractTar(tar, libraryDir)) {
        const name = target.split("/").pop();
        if (!name) continue;
        await writeFile(join(libraryDir, name), data, { mode: name.endsWith(".json") ? 0o644 : 0o755 });
      }
    }
  }

  const ldPath = libraryDir;

  /* ------------------------------------------------- 2b. libraries beside the binary */
  // The GPU process does not inherit LD_LIBRARY_PATH, and Chrome dlopen()s its graphics libraries
  // lazily — so ANGLE resolves libvulkan.so.1 / libvk_swiftshader.so *relative to the executable*.
  // Provisioning into lib/ alone produces a browser that launches perfectly and then refuses every
  // single WebGL context with an opaque "Internal Vulkan error (-3)". Hardlink the libraries next to
  // the binary (falling back to a copy where the filesystem refuses links) so both lookups succeed.
  const binaryDir = dirname(chromiumPath);
  let linked = 0;
  for (const entry of await readdir(libraryDir)) {
    const destination = join(binaryDir, entry);
    if (await exists(destination)) continue;
    try {
      await link(join(libraryDir, entry), destination);
    } catch {
      await copyFile(join(libraryDir, entry), destination);
    }
    linked += 1;
  }

  /* ---------------------------------------------------------- 3. verify it launches */
  const icd = join(libraryDir, "vk_swiftshader_icd.json");
  if (!(await exists(icd))) {
    console.error(`\n  ✖ ${icd} is missing — ANGLE cannot locate its SwiftShader rasterizer and WebGL will not work.\n`);
    process.exit(1);
  }

  // The shipped manifest names its driver with a *relative* path (`./libvk_swiftshader.so`). A
  // loader resolves that against the manifest's own directory, but not every consumer does — and
  // guessing wrong is invisible until WebGL quietly renders nothing. An absolute path is
  // unconditionally correct, so we rewrite the manifest rather than trust it.
  await writeFile(
    icd,
    JSON.stringify({
      file_format_version: "1.0.0",
      ICD: { library_path: join(libraryDir, "libvk_swiftshader.so"), api_version: "1.0.5" },
    }) + "\n",
    "utf8",
  );

  console.log("  → smoke-testing the binary…");
  const probe = spawnSync(chromiumPath, ["--version"], {
    env: { ...process.env, LD_LIBRARY_PATH: ldPath },
    encoding: "utf8",
  });

  const version = (probe.stdout || probe.stderr || "").trim();
  if (probe.status !== 0 || !/Chromium/i.test(version)) {
    console.error("\n  ✖ Chromium did not launch.");
    console.error(`    ${version || probe.error?.message || "no output"}`);
    console.error(`    Try: LD_LIBRARY_PATH=${ldPath} ${chromiumPath} --version\n`);
    process.exit(1);
  }

  /* ---------------------------------------------------------- 4. graphics probe */
  // A browser that launches but cannot create a WebGL context silently ruins every shader variation,
  // so prove graphics at provisioning time instead of discovering it during a 20-minute capture.
  // These are the same two profiles the vision harness negotiates between (``--use-angle=swiftshader``
  // fails in some hardened sandboxes where the full Vulkan path to the very same rasterizer works).
  let graphics = null;
  let graphicsNote = "not probed";
  try {
    const puppeteer = (await import("puppeteer-core")).default;
    const profiles = [
      ["swangle", ["--use-gl=angle", "--use-angle=swiftshader"]],
      [
        "vulkan-swiftshader",
        ["--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan,VulkanFromANGLE"],
      ],
    ];
    for (const [name, extra] of profiles) {
      const browser = await puppeteer.launch({
        executablePath: chromiumPath,
        headless: true,
        env: { ...process.env, LD_LIBRARY_PATH: ldPath, VK_ICD_FILENAMES: icd },
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", ...extra],
      });
      const page = await browser.newPage();
      await page.goto("about:blank");
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        if (!gl) return null;
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return `${gl.getParameter(gl.VERSION)}${info ? ` — ${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}` : ""}`;
      });
      await browser.close();
      if (renderer) {
        graphics = `${renderer} [${name}]`;
        break;
      }
      graphicsNote = `profile "${name}" could not create a context`;
    }
  } catch (error) {
    graphicsNote = error.message.split("\n")[0];
  }

  /* ---------------------------------------------------------- 5. report */
  console.log(
    [
      "",
      "  ────────────────────────────────────────────────────────────",
      `  ✓ browser ready   ${version}`,
      `    path            ${chromiumPath}`,
      `    libraries       ${ldPath}  (+${linked} beside the binary)`,
      graphics
        ? `    graphics        ${graphics.slice(0, 92)}`
        : `    graphics        ⚠ none — ${graphicsNote}\n                    shader variations will be captured in their fallback state`,
      "",
      "  The vision harness auto-detects this location, so:",
      "",
      "      npm run verify:browser",
      "",
      "  …just works. To drive a different browser:",
      "",
      "      CHROME_PATH=/usr/bin/chromium npm run verify:browser",
      "  ────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );

  // Keep the cache out of git no matter what the root .gitignore says.
  const gitignore = join(ROOT, ".cache", ".gitignore");
  if (!(await exists(gitignore))) {
    await mkdir(join(ROOT, ".cache"), { recursive: true });
    await writeFile(gitignore, "*\n", "utf8");
  }
  void Chromium; // (documented above: we inflate the archives ourselves)
  void rm;
}

main().catch((error) => {
  console.error(`\n  ✖ setup-browser failed: ${error.message}\n`);
  process.exit(1);
});
