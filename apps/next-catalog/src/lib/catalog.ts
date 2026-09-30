/**
 * catalog.ts — typed access to the generated manifest.
 *
 * `src/generated/catalog.json` is emitted by `npm run catalog:sync` from the single source of
 * truth at /catalog/catalog.json. The Next app never edits it, and never hard-codes a variation:
 * add a hero, run sync, and the index page + HUD metadata follow automatically.
 */
import raw from "../generated/catalog.json";
import type { CatalogManifest, Discipline, Variation } from "@catalog/shared";

export const manifest = raw as unknown as CatalogManifest;
export const variations: Variation[] = manifest.variations;
export const disciplines: Discipline[] = manifest.disciplines;

/** Route slug → variation ("particle-morph-field" → Hero_V03_…) */
export const bySlug = (slug: string): Variation | undefined => variations.find((v) => v.slug === slug);

/** Pathname → variation, tolerant of the GitHub Pages basePath and trailing slashes. */
export function byPathname(pathname: string): Variation | undefined {
  const clean = pathname.replace(/\/+$/, "").toLowerCase();
  return variations.find((v) => {
    const suffix = `${v.discipline.toLowerCase()}/${v.slug}`;
    return clean.endsWith(suffix) || clean.endsWith(`${suffix}/`);
  });
}

export const byDiscipline = (discipline: string): Variation[] =>
  variations.filter((v) => v.discipline.toLowerCase() === discipline.toLowerCase());

export const counts = manifest.counts;

/**
 * Resolves the showroom root from wherever the app is currently mounted:
 *   dev            http://localhost:3000/hero/x  → "/"
 *   local preview  /framework/next/hero/x        → "/"
 *   GitHub Pages   /<repo>/framework/next/hero/x → "/<repo>/"
 * Deliberately runtime logic: one build, every host, no env plumbing.
 */
export function hubHref(fallback = "/"): string {
  if (typeof window === "undefined") return fallback;
  const { pathname } = window.location;
  const marker = pathname.indexOf("/framework/");
  return marker >= 0 ? pathname.slice(0, marker) || "/" : fallback;
}

/**
 * Absolute URL of a variation's route, derived from wherever the app is mounted.
 *
 * The manifest stores *relative* hrefs (that is what lets one build serve from `/` and `/<repo>/`),
 * but a link inside a variation must point at the app root, not at the current directory —
 * so we strip the active route off the pathname and re-append it.
 *
 *   dev            /hero/particle-morph-field/            → /hero/particle-morph-field/
 *   local preview  /framework/next/hero/<slug>/           → /framework/next/hero/<slug>/
 *   GitHub Pages   /<repo>/framework/next/hero/<slug>/    → /<repo>/framework/next/hero/<slug>/
 */
export function appHref(variation: Variation): string {
  const route = variation.route; // e.g. "hero/particle-morph-field/"
  if (typeof window === "undefined") return `/${route}`;
  const { pathname, origin } = window.location;
  const index = pathname.indexOf(`/${route}`);
  const base = index >= 0 ? pathname.slice(0, index + 1) : "/";
  return `${origin}${base}${route}`;
}
