/**
 * useCatalog — the shared entry point for manifest data inside the Nuxt track.
 *
 * The manifest is generated (scripts/sync-catalog.mjs) and imported directly so it is bundled once,
 * typed once, and cannot drift from what the hub shows.
 */
import catalog from "~/generated/catalog.json";
import type { Variation } from "@catalog/shared";

interface Manifest {
  generatedAt?: string;
  variations: Variation[];
}

const manifest = catalog as unknown as Manifest;

/** Slug → variation, for this track's routes. */
export const variationBySlug = (slug: string): Variation | undefined =>
  manifest.variations.find(
    (variation) => variation.href?.startsWith("framework/nuxt/") && variation.href.endsWith(`hero/${slug}/`),
  );

export const useCatalog = () => ({
  all: manifest.variations,
  /** Only the Nuxt track — what the index page lists. */
  track: manifest.variations.filter((variation) => variation.href?.startsWith("framework/nuxt/")),
  /** 1-based position across the whole catalogue, used by the chrome counter. */
  indexOf: (id: string) => manifest.variations.findIndex((variation) => variation.id === id) + 1,
  total: manifest.variations.length,
  variationBySlug,
});

/**
 * The hub lives exactly two levels above this track's baseURL (…/framework/nuxt/ → …/), and the
 * hub address must stay relative so the same build works locally and under a GitHub Pages
 * repository prefix. Depth is measured at runtime because routes sit at different depths.
 */
export const useHubHref = () => {
  const base = useRuntimeConfig().app.baseURL || "/";
  const segments = (import.meta.client ? window.location.pathname : "")
    .slice(base.length)
    .split("/")
    .filter(Boolean).length;
  return `${base}${"../".repeat(2 + segments)}`;
};
