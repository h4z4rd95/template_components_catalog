<script setup lang="ts">
/**
 * A single variation, resolved from the manifest by slug.
 *
 * The map is explicit rather than dynamic-imported by convention: an unknown slug must produce a
 * real, designed answer (this page's own "not in this track" panel) instead of a blank frame — the
 * same rule the variations themselves follow when a device cannot draw them.
 */
import TresInstancedShards from "~/components/heroes/TresInstancedShards.vue";
import EditorialChapterRail from "~/components/heroes/EditorialChapterRail.vue";
import TresLiquidTerrain from "~/components/heroes/TresLiquidTerrain.vue";

const HEROES = {
  "tres-instanced-shards": TresInstancedShards,
  "editorial-chapter-rail": EditorialChapterRail,
  "tres-liquid-terrain": TresLiquidTerrain,
} as const;

const route = useRoute();
const slug = computed(() => String(route.params.slug ?? ""));
const variation = computed(() => variationBySlug(slug.value));
const hero = computed(() => HEROES[slug.value as keyof typeof HEROES]);
const baseURL = useRuntimeConfig().app.baseURL || "/";

useHead({
  title: () => (variation.value ? `${variation.value.id} — ${variation.value.title}` : "Unknown variation"),
});
</script>

<template>
  <RouteFrame v-if="variation && hero" :variation="variation">
    <component :is="hero" />
  </RouteFrame>

  <main v-else class="missing">
    <p class="cat-eyebrow">Not in this track</p>
    <h1>{{ slug || "that route" }}</h1>
    <p class="missing__lede">
      This slug has no Nuxt variation behind it. The catalogue hub still knows about it, and the
      Next.js track may own it — both are one click away.
    </p>
    <nav class="missing__nav">
      <a class="cat-cta" :href="`${baseURL}`">Nuxt track index</a>
      <a class="cat-cta" :href="useHubHref()">Catalogue hub</a>
    </nav>
  </main>
</template>

<style scoped>
.missing {
  display: grid;
  gap: 1rem;
  align-content: center;
  min-height: 100svh;
  padding: calc(var(--chrome-h) + 3rem) clamp(1.25rem, 6vw, 6rem) 3rem;
}

.missing h1 {
  font: 400 clamp(2rem, 6vw, 4rem) / 1 var(--font-display);
  letter-spacing: -0.03em;
  text-transform: uppercase;
  word-break: break-word;
}

.missing__lede {
  max-width: 38rem;
  font: 400 0.95rem/1.7 var(--font-sans);
  color: var(--ink-dim);
}

.missing__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
</style>
