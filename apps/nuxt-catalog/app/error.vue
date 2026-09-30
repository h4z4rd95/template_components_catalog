<script setup lang="ts">
/**
 * The Nuxt track's error page — the 404 a visitor sees inside this app.
 *
 * It exists because the alternative shipped: Nuxt's built-in error screen (one unformatted sentence,
 * in the framework's own type, with a "Go back home" link that leaves the catalogue entirely). That
 * is a strange thing to hand a visitor from a showroom whose whole argument is that every page in it
 * was designed — and it is the same defect the React track had until `not-found.tsx` replaced Next's
 * default apology.
 *
 * Two decisions worth keeping:
 *   · the skin is read, not assumed — `useCatalogSkin` restores the visitor's language, direction
 *     and theme, so the page arrives in the state they left the catalogue in;
 *   · the "back" links are relative to the *hub*, computed from the current depth, because an error
 *     route can be any path at all and `useHubHref` is what the rest of the track uses to escape.
 */
import type { NuxtError } from "#app";

const props = defineProps<{ error: NuxtError }>();

const skin = useCatalogSkin();
const hub = useHubHref();

const status = computed(() => Number(props.error?.statusCode) || 404);
/** The track root — a full navigation, which is also what clears the error state. */
const track = useRuntimeConfig().app.baseURL || "/";

/** A friendly line per status, and the framework's message tucked under it as evidence. */
const headline = computed(() =>
  status.value === 404
    ? "This route is not in the manifest."
    : "Something in this scene threw before it could render.",
);

const detail = computed(
  () => props.error?.statusMessage || props.error?.message || "No route matched this address.",
);

</script>

<template>
  <main class="cat-error" :data-theme="skin.theme" :dir="skin.dir" :lang="skin.locale">
    <p class="cat-error-code">{{ status }}</p>

    <h1 class="cat-error-title">{{ headline }}</h1>

    <p class="cat-error-lede">
      The catalogue is generated from a manifest, so every page it has is listed there — and this
      address is not one of them. A slug lost a hyphen, or an old link outlived a rename.
    </p>

    <dl class="cat-error-facts">
      <div>
        <dt>Reported</dt>
        <dd class="force-ltr">{{ detail }}</dd>
      </div>
      <div>
        <dt>Track</dt>
        <dd class="force-ltr">Nuxt 4 · Vue 3 · TresJS</dd>
      </div>
    </dl>

    <div class="cat-error-actions">
      <a class="cat-error-primary" :href="hub">Back to the catalogue</a>
      <a class="cat-error-secondary" :href="track">The Nuxt track home</a>
    </div>
  </main>
</template>
