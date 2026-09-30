/**
 * nuxt.config.ts — the Nuxt 4 track of The Catalog.
 *
 * Mirrors the Next.js track's contract so the hub can treat every framework identically:
 *   · a static export that lands in docs/framework/nuxt/ (build-all.mjs splices it in)
 *   · routes derived from the *manifest*, not from a hand-maintained list, so a new variation
 *     cannot be shipped without a working deep link
 *   · the shared design tokens and HUD live in one stylesheet + one component, exactly like React
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { templateCompilerOptions } from "@tresjs/core";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The route patterns this app actually ships, collected from `app/pages`.
 *
 * `/hero/[slug]` is a pattern, not a path — one segment, any value — which is exactly how Nuxt's
 * router reads the file name.
 */
function pagePatterns(dir = resolve(here, "app/pages"), prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const route = `${prefix}/${entry.name.replace(/\.vue$/, "")}`;
    if (entry.isDirectory()) return pagePatterns(resolve(dir, entry.name), route);
    if (!entry.name.endsWith(".vue")) return [];
    // `index.vue` is the segment's own route, and `[slug].vue` matches any one segment.
    return [route.replace(/\/index$/, "") || "/"];
  });
}

function hasPage(route: string, patterns: string[]): boolean {
  const segments = route.split("/").filter(Boolean);
  return patterns.some((pattern) => {
    const parts = pattern.split("/").filter(Boolean);
    if (parts.length !== segments.length) return false;
    return parts.every((part, index) => part.startsWith("[") || part === segments[index]);
  });
}

/**
 * Every route this track owns — read from the manifest the catalogue sync just emitted, then
 * filtered to the ones this app can actually render.
 *
 * The filter is not cosmetic. A planned variation reserves its route in the manifest long before its
 * page exists, and prerendering a route with no page emits a shell that renders the 404: that is how
 * `framework/nuxt/dashboard/realtime-wall/index.html` came to be a 102-character error page sitting
 * on GitHub Pages, claiming to be a dashboard. Reserving an address is a promise; a stub that serves
 * an error is not how you keep it. The moment the page file lands, the route prerenders again.
 */
function trackRoutes(): string[] {
  const file = resolve(here, "app/generated/catalog.json");
  if (!existsSync(file)) return ["/"];
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    variations: { href?: string }[];
  };
  const patterns = pagePatterns();
  return [
    "/",
    ...manifest.variations
      .filter((variation) => variation.href?.startsWith("framework/nuxt/"))
      .map((variation) => "/" + String(variation.href).replace(/^framework\/nuxt\//, ""))
      .filter((route) => hasPage(route, patterns)),
  ];
}

export default defineNuxtConfig({
  compatibilityDate: "2025-09-01",

  // A catalogue of GPU scenes has nothing meaningful to render on a server. Prerendering the shell
  // per route still gives GitHub Pages a real file for every deep link.
  ssr: false,

  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "The Catalog — Nuxt track",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "color-scheme", content: "dark" },
        {
          name: "description",
          content:
            "Nuxt 4 + TresJS variations from The Catalog — WebGL-first heroes, GSAP scroll choreography and Vue 3 craft.",
        },
      ],
    },
  },

  css: [
    "@fontsource-variable/inter",
    "@fontsource-variable/jetbrains-mono",
    "@fontsource/instrument-serif",
    "@fontsource/archivo-black",
    "~/assets/css/main.css",
  ],

  nitro: { prerender: { routes: trackRoutes(), crawlLinks: false } },

  vite: {
    // @catalog/shared ships raw TypeScript on purpose (see packages/shared/package.json); letting
    // esbuild pre-bundle it would strip the type-level contracts our builds rely on.
    optimizeDeps: { exclude: ["@catalog/shared"] },
    vue: { ...templateCompilerOptions },
  },

  typescript: { strict: true, typeCheck: false },
  devtools: { enabled: false },
});
