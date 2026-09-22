<script setup lang="ts">
/**
 * The root of the Nuxt track. Every page draws its own full-bleed stage, so this is deliberately
 * thin — the shell (chrome band, progress hairline, metadata HUD) belongs to RouteFrame, which the
 * hero pages compose around, and the skip target is the artwork itself.
 */
</script>

<template>
  <div class="cat-root">
    <a class="cat-skip" href="#stage">Skip to the artwork</a>
    <NuxtPage />
  </div>
</template>
