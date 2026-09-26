#!/usr/bin/env node
/**
 * bundle.mjs — build the downloadable project archive.
 *
 * The catalogue is a GitHub Pages site, so it cannot zip anything on demand. Instead the archive
 * is produced here, at build time, and committed next to the site: the download button in the
 * header then hands over a file that genuinely exists, works offline, and is versioned with the
 * deploy it came from.
 *
 * Contents = every tracked file (git is the source of truth, so `node_modules`, build output and
 * caches never sneak in) minus two things that would only bloat it:
 *   · docs/vision/**  — the motion reel's captures, ~26 MB of generated GIFs and stills
 *   · docs/download/** — the archive cannot contain itself
 *
 * The ZIP is written by hand: stored/deflated entries, CRC-32, UTF-8 names. No dependency.
 */
import { deflateRawSync } from "node:zlib";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "download");
const OUT_FILE = join(OUT_DIR, "catalog-source.zip");
const MAX_ENTRY_BYTES = 24 * 1024 * 1024;

const EXCLUDE = [
  (p) => p === "docs/vision" || p.startsWith("docs/vision/"),
  (p) => p === "docs/download" || p.startsWith("docs/download/"),
  (p) => p === "docs/framework" || p.startsWith("docs/framework/"),
  (p) => p.endsWith(".zip"),
];

/* ------------------------------------------------------------------ file list */

function trackedFiles() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    return out
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((p) => p.split(sep).join("/"));
  } catch {
    return null; // no git (a downloaded copy of the bundle itself): fall back to a walk
  }
}

const WALK_SKIP = new Set([
  "node_modules", ".git", ".cache", ".next", ".nuxt", ".output", "out", "dist", "build",
  "coverage", ".turbo", ".vite", "download",
]);

async function walk(dir, prefix = "") {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (WALK_SKIP.has(entry.name)) continue;
      files.push(...(await walk(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function keep(path) {
  return !EXCLUDE.some((test) => test(path));
}

/* ------------------------------------------------------------------------ zip */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** MS-DOS date/time, because that is what the format stores. */
function dosStamp(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const { time, day } = dosStamp(entry.mtime);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const store = deflated.length >= entry.data.length;
    const body = store ? entry.data : deflated;
    const method = store ? 0 : 8;
    const crc = crc32(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    local.push(localHeader, nameBytes, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    // `<<` yields a *signed* 32-bit result in JavaScript, so the mode bits must be coerced back.
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, 0644
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const localBuffer = Buffer.concat(local);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(localBuffer.length, 16);

  return Buffer.concat([localBuffer, centralBuffer, end]);
}

/* ----------------------------------------------------------------------- main */

async function main() {
  const tracked = trackedFiles();
  const candidates = (tracked ?? (await walk(ROOT))).filter(keep).sort();

  const entries = [];
  let skipped = 0;
  for (const name of candidates) {
    const abs = join(ROOT, name);
    if (!existsSync(abs)) continue;
    const info = await stat(abs);
    if (!info.isFile()) continue;
    if (info.size > MAX_ENTRY_BYTES) {
      skipped += 1;
      continue;
    }
    entries.push({ name, data: await readFile(abs), mtime: info.mtime });
  }

  const zip = buildZip(entries);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, zip);

  const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
  const raw = entries.reduce((total, entry) => total + entry.data.length, 0);

  console.log(`  bundle   docs/download/catalog-source.zip`);
  console.log(`           ${entries.length} files · ${kb(raw)} → ${kb(zip.length)} zipped`);
  if (skipped) console.log(`           ${skipped} file(s) over ${kb(MAX_ENTRY_BYTES)} were skipped`);
  console.log(`           source: ${tracked ? "git index" : "filesystem walk"} · excludes docs/vision, docs/framework, docs/download`);

  // The header states the download's real size and file count, so those numbers live with the
  // artifact instead of being typed into a translation string that goes stale on the next build.
  await writeFile(
    join(ROOT, "docs", "data", "download.json"),
    JSON.stringify(
      {
        source: {
          file: "download/catalog-source.zip",
          bytes: zip.length,
          uncompressedBytes: raw,
          files: entries.length,
          excludes: ["docs/vision/**", "docs/framework/**", "docs/download/**"],
          generatedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return OUT_FILE;
}

main().catch((error) => {
  console.error(`✖ bundle failed: ${error.message}`);
  process.exit(1);
});
