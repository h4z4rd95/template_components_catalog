#!/usr/bin/env node
/**
 * serve.mjs — zero-dependency preview server for the Pages root (`docs/`).
 *
 *   npm run preview            → http://localhost:4173
 *   PORT=8080 npm run preview  → http://localhost:8080
 *
 * Binds 0.0.0.0 so it also works behind container/preview proxies, resolves directory
 * indexes ("/framework/next/hero/x/" → index.html, exactly like GitHub Pages), and knows
 * the handful of MIME types a WebGL catalog needs (.glsl, .hdr, .basis, .wasm, .mp4).
 */
import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import { join, resolve, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "docs");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".glsl": "text/plain; charset=utf-8",
  ".vert": "text/plain; charset=utf-8",
  ".frag": "text/plain; charset=utf-8",
  ".hdr": "application/octet-stream",
  ".basis": "application/octet-stream",
  ".ktx2": "application/octet-stream",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
};

const NOT_FOUND = `<!doctype html><meta charset="utf-8"><title>404 — The Catalog</title>
<style>body{background:#08080a;color:#e8e8ec;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;display:grid;place-items:center;height:100vh;margin:0}
a{color:#FF4FD8}b{color:#fff}</style>
<div style="text-align:center"><p style="font-size:11px;letter-spacing:.3em;opacity:.5">THE CATALOG · 404</p>
<h1 style="font-size:22px;margin:.4em 0 1em">nothing mounted at <b>%PATH%</b></h1>
<p>Is this a framework variation? Build it first: <b>npm run build</b></p>
<p style="margin-top:2em"><a href="/">← back to the hub</a></p></div>`;

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^([/\\])+/, "");
  if (clean.split(/[/\\]/).includes("..")) return null;
  const target = join(ROOT, clean);
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return null;

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      for (const candidate of ["index.html", "index.htm"]) {
        try {
          const idx = join(target, candidate);
          const idxInfo = await stat(idx);
          if (idxInfo.isFile()) return idx;
        } catch {}
      }
      return null;
    }
    return info.isFile() ? target : null;
  } catch {
    // GitHub-Pages behaviour: "/foo" also serves "/foo.html"
    try {
      const html = `${target}.html`;
      const info = await stat(html);
      return info.isFile() ? html : null;
    } catch {
      return null;
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const file = await resolveFile(req.url || "/");
    if (!file) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(NOT_FOUND.replace("%PATH%", (req.url || "/").replace(/</g, "&lt;")));
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-cache",
      // the catalog embeds its own routes in iframes → never block same-origin framing
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`500 — ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  THE CATALOG — preview server`);
  console.log(`  root   ${ROOT}`);
  console.log(`  local  http://localhost:${PORT}`);
  console.log(`  net    http://${HOST}:${PORT}\n`);
});
