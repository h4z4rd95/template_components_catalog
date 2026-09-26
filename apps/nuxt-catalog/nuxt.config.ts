/**
 * nuxt.config.ts — the Nuxt 4 track of The Catalog.
 *
 * Mirrors the Next.js track's contract so the hub can treat every framework identically:
 *   · a static export that lands in docs/framework/nuxt/ (build-all.mjs splices it in)
 *   · routes derived from the *manifest*, not from a hand-maintained list, so a new variation
 *     cannot be shipped without a working deep link
 *   · the shared design tokens and HUD live in one stylesheet + one component, exactly like React
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { templateCompilerOptions } from "@tresjs/core";

const here = dirname(fileURLToPath(import.meta.url));

/** Every route this track owns — read from the manifest the catalogue sync just emitted. */
function trackRoutes(): string[] {
  const file = resolve(here, "app/generated/catalog.json");
  if (!existsSync(file)) return ["/"];
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    variations: { href?: string }[];
  };
  return [
    "/",
    ...manifest.variations
      .filter((variation) => variation.href?.startsWith("framework/nuxt/"))
      .map((variation) => "/" + String(variation.href).replace(/^framework\/nuxt\//, "")),
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
