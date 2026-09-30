<script setup lang="ts">
/**
 * RouteFrame — the shell every Nuxt variation renders inside.
 *
 * Provides the same contract as the React track's `RouteFrame`: a reserved 2.9rem chrome band (so a
 * variation's own header can never collide with the catalogue wordmark), a scroll-progress hairline,
 * the metadata HUD, and the `data-motion-ready` flag that unlocks the shared `will-change` hints.
 */
import type { Variation } from "@catalog/shared";

const props = defineProps<{ variation: Variation }>();

const { indexOf, total } = useCatalog();
const hub = useHubHref();
const progress = ref(0);
let frame = 0;

function measure() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  progress.value = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

function onScroll() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
}

onMounted(() => {
  document.documentElement.dataset.motionReady = "true";
  measure();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
});

onUnmounted(() => {
  cancelAnimationFrame(frame);
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
  delete document.documentElement.dataset.motionReady;
});
</script>

<template>
  <div class="cat-frame" :style="{ '--accent': variation.accent }">
    <div class="cat-progress" aria-hidden="true">
      <span class="cat-progress-bar" :style="{ transform: `scaleX(${progress})` }" />
    </div>

    <header class="cat-chrome">
      <a class="cat-mark cat-chrome-link" :href="hub">
        <span class="cat-mark-dot" aria-hidden="true" />
        THE CATALOG
      </a>
      <span class="cat-counter">
        {{ String(indexOf(variation.id)).padStart(2, "0") }} / {{ String(total).padStart(2, "0") }}
        <span class="cat-counter-sep" aria-hidden="true">·</span>
        {{ variation.discipline }}
      </span>
    </header>

    <main>
      <slot />
    </main>

    <CatalogHUD :variation="variation" :index="indexOf(variation.id)" :total="total" />
  </div>
</template>
