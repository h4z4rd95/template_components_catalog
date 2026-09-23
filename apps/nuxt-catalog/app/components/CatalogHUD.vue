<script setup lang="ts">
/**
 * CatalogHUD — the metadata heads-up display that wraps every variation in this track.
 *
 * A faithful Vue 3 mirror of the React `CatalogHUD` (same information, same affordances, same DOM
 * contract: `data-catalog-hud`), because a catalogue whose two frameworks behaved differently would
 * be a worse catalogue. Vue 3 specifics: `computed`/`onMounted`/`onUnmounted` instead of hooks, and
 * `v-show` (a real `display: none`) rather than the `hidden` attribute — an author CSS rule can
 * defeat `hidden`, which is exactly the class of bug the real-browser audit exists to catch.
 */
import type { Variation } from "@catalog/shared";

const props = defineProps<{
  variation: Variation;
  index: number;
  total: number;
}>();

const CATALOG_REPO = "https://github.com/h4z4rd95/template_components_catalog";
const STORAGE_KEY = "catalog:hud:collapsed";

const open = ref(true);
const copied = ref<"" | "id" | "link">("");
const inIframe = ref(false);
const baseURL = useRuntimeConfig().app.baseURL || "/";
/** Resolved once during setup — a composable must not be invoked from the render function. */
const hubHref = useHubHref();

/** This variation's own address, one level below the track root. */
const rawHref = computed(() => `${baseURL}${String(props.variation.href).replace(/^framework\/nuxt\//, "")}`);
const sourceHref = computed(() => `${CATALOG_REPO}/tree/main/${props.variation.source}`);
const badge = computed(() => `BATCH ${String(props.variation.batch).padStart(2, "0")}`);

function toggle(next?: boolean) {
  open.value = next ?? !open.value;
  try {
    window.localStorage.setItem(STORAGE_KEY, open.value ? "0" : "1");
  } catch {
    /* private mode — the default state is fine */
  }
}

function copy(kind: "id" | "link") {
  const value = kind === "id" ? props.variation.id : window.location.href;
  const done = () => {
    copied.value = kind;
    window.setTimeout(() => (copied.value = ""), 1600);
  };
  navigator.clipboard
    ?.writeText(value)
    .then(done)
    .catch(() => {
      // Clipboard API is unavailable over file:// and in some embeds → legacy path.
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try {
        document.execCommand("copy");
      } catch {
        /* the button still reports the attempt */
      }
      helper.remove();
      done();
    });
}

function expand() {
  if (inIframe.value) {
    // The hub listens for this and expands the card into a full-width stage.
    window.parent.postMessage({ type: "catalog:expand", id: props.variation.id }, "*");
    return;
  }
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}

function onKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && /input|textarea|select/i.test(target.tagName)) return;
  if (event.key === "h" || event.key === "H") toggle();
}

onMounted(() => {
  inIframe.value = window.self !== window.top;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "1") open.value = false;
    else if (stored === "0") open.value = true;
    // No stored preference: a wide panel would eat most of a phone in a catalogue where the
    // No stored preference: a wide panel would eat most of a phone in a catalogue where the
    // artwork *is* the content, so start collapsed there. The height threshold is 860px on
    // purpose: the open panel is ~20rem tall, and on anything shorter it would sit on top of
    // the hero copy rather than beside it. A visitor who wants the metadata can still open it.
    else if (window.innerWidth < 900 || window.innerHeight < 860) open.value = false;
  } catch {
    /* ignore */
  }
  window.addEventListener("keydown", onKey);
});

onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <aside
    class="cat-hud"
    data-catalog-hud
    :style="{ '--accent': variation.accent }"
    :aria-label="`Metadata for ${variation.id}`"
  >
    <div class="cat-hud-tab">
      <span class="cat-hud-dot" aria-hidden="true" />
      <span class="cat-hud-id">{{ variation.id }}</span>
      <button
        type="button"
        class="cat-hud-toggle"
        :aria-expanded="open"
        aria-controls="catalog-hud-body"
        @click="toggle()"
      >
        {{ open ? "Hide HUD (H)" : "Show HUD (H)" }}
      </button>
    </div>

    <div v-show="open" id="catalog-hud-body" class="cat-hud-body">
      <header class="cat-hud-head">
        <span class="cat-hud-badge">{{ badge }}</span>
        <span>{{ variation.discipline }}</span>
        <span class="cat-hud-status" :data-status="variation.status">{{ variation.status }}</span>
        <span style="margin-left: auto">
          {{ String(index).padStart(2, "0") }} / {{ String(total).padStart(2, "0") }}
        </span>
      </header>

      <h2 class="cat-hud-name">{{ variation.id }}</h2>
      <p class="cat-hud-title">{{ variation.title }}</p>

      <dl class="cat-hud-meta">
        <div class="cat-hud-row">
          <dt>Stack</dt>
          <dd class="cat-hud-chips">
            <span v-for="tech in variation.stack" :key="tech" class="cat-hud-chip">{{ tech }}</span>
          </dd>
        </div>
        <div class="cat-hud-row">
          <dt>Vibe</dt>
          <dd class="cat-hud-vibe">{{ variation.vibe }}</dd>
        </div>
        <div class="cat-hud-row">
          <dt>Interaction</dt>
          <dd class="cat-hud-note">{{ variation.interaction }}</dd>
        </div>
      </dl>

      <div class="cat-hud-actions">
        <button type="button" class="cat-hud-action" @click="copy('id')">
          {{ copied === "id" ? "Copied ✓" : "Copy ID" }}
        </button>
        <button type="button" class="cat-hud-action" @click="copy('link')">
          {{ copied === "link" ? "Copied ✓" : "Copy link" }}
        </button>
        <button type="button" class="cat-hud-action" @click="expand()">
          {{ inIframe ? "Expand" : "Fullscreen" }}
        </button>
        <a class="cat-hud-action" :href="sourceHref" target="_blank" rel="noreferrer noopener">
          Source ↗
        </a>
            <a class="cat-hud-action" :href="hubHref">Hub ↩</a>
        <a
          v-if="inIframe"
          class="cat-hud-action"
          :href="rawHref"
          target="_blank"
          rel="noreferrer noopener"
        >
          Raw ↗
        </a>
      </div>
    </div>
  </aside>
</template>
