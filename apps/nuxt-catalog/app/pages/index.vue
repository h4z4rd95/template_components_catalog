<script setup lang="ts">
/**
 * The Nuxt track's index — the same information the hub shows, scoped to this framework so the
 * track can be browsed on its own (and so a deep link from GitHub Pages has a real parent page).
 */
const { track } = useCatalog();
const baseURL = useRuntimeConfig().app.baseURL || "/";
const href = (variation: { href?: string }) => `${baseURL}${String(variation.href).replace(/^framework\/nuxt\//, "")}`;

useHead({ title: "The Catalog — Nuxt track" });
</script>

<template>
  <main class="index">
    <header class="index__head">
      <p class="cat-eyebrow">Nuxt 4 · TresJS · GSAP</p>
      <h1>Nuxt track</h1>
      <p class="index__lede">
        The Vue side of the catalogue. Same metadata contract, same quality bar as the React track —
        different rendering philosophy: TresJS owns the scene graph, and every hero degrades honestly
        when a device cannot draw it.
      </p>
    </header>

    <ol class="index__list">
      <li v-for="variation in track" :key="variation.id">
        <a :href="href(variation)" :style="{ '--card-accent': variation.accent }">
          <span class="index__id">{{ variation.id }}</span>
          <span class="index__title">{{ variation.title }}</span>
          <span class="index__vibe">{{ variation.vibe }}</span>
          <span class="index__chips">
            <span v-for="tech in variation.stack.slice(0, 4)" :key="tech">{{ tech }}</span>
          </span>
          <span class="index__go" aria-hidden="true">Open ↗</span>
        </a>
      </li>
    </ol>

    <footer class="index__foot">
      <a class="cat-cta" :href="useHubHref()">Back to the hub</a>
    </footer>
  </main>
</template>

<style scoped>
.index {
  display: grid;
  gap: clamp(1.6rem, 4vh, 2.6rem);
  min-height: 100svh;
  padding: calc(var(--chrome-h) + clamp(2.5rem, 8vh, 5rem)) clamp(1.25rem, 6vw, 6rem) clamp(3rem, 8vh, 6rem);
}

.index__head {
  display: grid;
  gap: 0.7rem;
  max-width: 46rem;
}

.index__head h1 {
  font: 400 clamp(2.2rem, 6vw, 4.6rem) / 1 var(--font-display);
  letter-spacing: -0.03em;
  text-transform: uppercase;
}

.index__lede {
  font: 400 clamp(0.92rem, 1.1vw, 1.04rem) / 1.7 var(--font-sans);
  color: var(--ink-dim);
}

.index__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.index__list a {
  position: relative;
  display: grid;
  gap: 0.5rem;
  height: 100%;
  padding: 1.15rem;
  border: 1px solid var(--line);
  border-radius: 0.8rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent);
  transition: border-color 0.3s var(--ease-out), transform 0.3s var(--ease-out);
}

.index__list a:hover,
.index__list a:focus-visible {
  border-color: var(--card-accent);
  transform: translateY(-3px);
}

.index__id {
  font: 600 0.66rem/1 var(--font-mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--card-accent);
}

.index__title {
  font: 400 clamp(1.15rem, 1.8vw, 1.5rem) / 1.15 var(--font-serif);
}

.index__vibe,
.index__chips {
  font: 500 0.6rem/1 var(--font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.index__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.index__chips span {
  padding: 0.24rem 0.42rem;
  border: 1px solid var(--line);
  border-radius: 999px;
}

.index__go {
  margin-top: 0.4rem;
  font: 600 0.6rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.index__foot {
  display: flex;
}
</style>
