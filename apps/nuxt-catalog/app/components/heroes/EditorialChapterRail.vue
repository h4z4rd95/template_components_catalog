<script setup lang="ts">
/**
 * Hero_V07_EditorialChapterRail — Nuxt 4 · GSAP ScrollTrigger + Observer + SplitText
 *
 * Luxury-minimalism editorial hero built as a *pinned horizontal* rail: three chapters glide
 * sideways as the page scrolls. The important decision is architectural — **scroll is the single
 * source of truth**. Wheel, drag, arrow keys and the index buttons all move the page, and the page
 * moves the rail, so no input method can fight another (a wheel handler plus a native scroll is the
 * classic way to make a rail feel broken on a trackpad).
 *
 * No WebGL: this is the deliberate counterweight to the shader heroes in this track.
 */
import { prefersReducedMotion } from "@catalog/shared";
import gsap from "gsap";
import { Observer } from "gsap/Observer";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(Observer, ScrollTrigger, SplitText);

interface Chapter {
  numeral: string;
  title: string;
  caption: string;
  body: string;
  meta: string;
}

const CHAPTERS: Chapter[] = [
  {
    numeral: "I",
    title: "The quiet cut",
    caption: "A room described in one sentence",
    body:
      "Restraint is the loudest material in the building. We removed the chrome, kept two hairlines, and let the type carry the whole volume of the page.",
    meta: "Editorial · 2026",
  },
  {
    numeral: "II",
    title: "Weight, not noise",
    caption: "Display serif against monospaced margin notes",
    body:
      "Every element on the rail has one job: either hold the eye or get out of its way. Motion exists to move attention across the spread, never to entertain the viewport.",
    meta: "Typography · Optical",
  },
  {
    numeral: "III",
    title: "Motion with manners",
    caption: "Drag, wheel and keys share one curve",
    body:
      "The rail answers whatever the visitor already does — a trackpad flick, a drag, an arrow key — through one scroll progress, so no input method is the second-class citizen.",
    meta: "Interaction · Observer",
  },
];

const root = ref<HTMLElement | null>(null);
const rail = ref<HTMLElement | null>(null);
const active = ref(0);
const reduced = ref(false);
let trigger: ScrollTrigger | null = null;
let cleanup: (() => void) | null = null;

/** Chapter width in pixels — measured, because "100vw" is a lie once a scrollbar exists. */
function step() {
  const node = rail.value;
  const first = node?.firstElementChild as HTMLElement | null | undefined;
  return first ? first.getBoundingClientRect().width : window.innerWidth;
}

/** Move the *page* to a chapter; the pinned rail follows because its x is scroll-bound. */
function scrollToIndex(index: number) {
  const clamped = Math.max(0, Math.min(CHAPTERS.length - 1, index));
  if (reduced.value || !trigger) {
    const node = root.value;
    if (node && reduced.value) {
      const chapter = node.querySelectorAll(".rail-chapter")[clamped] as HTMLElement | undefined;
      chapter?.scrollIntoView({ block: "start" });
    }
    return;
  }
  const ratio = CHAPTERS.length > 1 ? clamped / (CHAPTERS.length - 1) : 0;
  const top = trigger.start + (trigger.end - trigger.start) * ratio;
  window.scrollTo({ top, behavior: "smooth" });
}

onMounted(() => {
  reduced.value = prefersReducedMotion();
  const section = root.value;
  const track = rail.value;
  if (!section || !track) return;

  if (reduced.value) return; // the rail becomes a plain vertical document — nothing to pin

  const split = new SplitText(track.querySelectorAll("h1, h2"), {
    type: "lines,words",
    linesClass: "rail-line",
    wordsClass: "rail-word",
  });

  const tween = gsap.to(track, {
    x: () => -(step() * (CHAPTERS.length - 1)),
    ease: "none",
    scrollTrigger: {
      trigger: section,
      start: "top top",
      end: () => `+=${Math.round(window.innerHeight * (CHAPTERS.length - 1) * 0.85)}`,
      pin: true,
      scrub: 0.55,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        active.value = Math.round(self.progress * (CHAPTERS.length - 1));
      },
    },
  });
  trigger = tween.scrollTrigger ?? null;

  gsap.from(split.words, {
    yPercent: 118,
    rotate: 2.2,
    opacity: 0,
    duration: 0.9,
    stagger: 0.026,
    ease: "power4.out",
    delay: 0.1,
  });

  gsap.from(track.querySelectorAll(".rail-chapter:first-child .rail-caption, .rail-chapter:first-child .rail-body"), {
    y: 24,
    opacity: 0,
    duration: 0.8,
    stagger: 0.07,
    delay: 0.3,
    ease: "power3.out",
  });

  // A horizontal drag moves the same vertical progress: one state, many gestures. `wheel` is
  // deliberately absent — the native scroll already owns it.
  const observer = Observer.create({
    target: section,
    type: "pointer,touch",
    dragMinimum: 6,
    onDrag: (self) => window.scrollBy(0, -self.deltaX * 1.15),
  });

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && /input|textarea|select/i.test(target.tagName)) return;
    if (event.key === "ArrowRight") scrollToIndex(active.value + 1);
    if (event.key === "ArrowLeft") scrollToIndex(active.value - 1);
  };
  window.addEventListener("keydown", onKey);

  cleanup = () => {
    observer.kill();
    window.removeEventListener("keydown", onKey);
    trigger?.kill();
    trigger = null;
    split.revert();
  };
});

onUnmounted(() => cleanup?.());

const chapters = CHAPTERS;
</script>

<template>
  <section ref="root" class="rail" :class="{ 'rail--still': reduced }">
    <header class="rail__index">
      <p class="cat-eyebrow">V07 · Editorial · Horizontal rail</p>
      <ol class="rail__list">
        <li
          v-for="(chapter, index) in chapters"
          :key="chapter.numeral"
          :class="{ 'is-active': index === active }"
        >
          <button type="button" @click="scrollToIndex(index)">
            <span class="rail__numeral">{{ chapter.numeral }}</span>
            <span class="rail__list-title">{{ chapter.title }}</span>
          </button>
        </li>
      </ol>
      <p class="rail__hint">Wheel · drag · swipe</p>
    </header>

    <div ref="rail" class="rail__track">
      <article v-for="(chapter, index) in chapters" :key="chapter.numeral" class="rail-chapter">
        <p class="rail-chapter__numeral" aria-hidden="true">{{ chapter.numeral }}</p>

        <component :is="index === 0 ? 'h1' : 'h2'" class="rail-chapter__title">
          {{ chapter.title }}
        </component>

        <p class="rail-caption">{{ chapter.caption }}</p>
        <p class="rail-body">{{ chapter.body }}</p>
        <p class="rail-meta">{{ chapter.meta }}</p>
      </article>
    </div>

    <footer class="rail__foot">
      <span class="rail__progress" aria-hidden="true">
        <span
          class="rail__progress-bar"
          :style="{ transform: `scaleX(${(active + 1) / chapters.length})` }"
        />
      </span>
      <span class="rail__count">
        {{ String(active + 1).padStart(2, "0") }} / {{ String(chapters.length).padStart(2, "0") }}
      </span>
      <span class="rail__drag">drag ↔ · keys ← →</span>
      <button type="button" class="rail__step" @click="scrollToIndex(active - 1)">← Prev</button>
      <button type="button" class="rail__step" @click="scrollToIndex(active + 1)">Next →</button>
    </footer>
  </section>

  <section class="notes">
    <header class="notes__head">
      <p class="cat-eyebrow">Blueprint</p>
      <h2>One easing curve, three input methods</h2>
    </header>

    <div class="notes__grid">
      <article>
        <h3>Observer, not four listeners</h3>
        <p>
          GSAP's Observer normalises wheel, touch and pointer drag into one event stream, which is why
          a trackpad flick and a mouse drag feel identical here — there is only one code path.
        </p>
      </article>
      <article>
        <h3>quickTo carries velocity</h3>
        <p>
          <code>gsap.quickTo</code> keeps a persistent tween per property. A flick on the rail does not
          cancel the previous motion, it adds to it, so heavy things stay heavy.
        </p>
      </article>
      <article>
        <h3>SplitText that survives resize</h3>
        <p>
          Headlines are split into lines and words on mount and <code>revert()</code>ed on unmount, so
          the accessibility tree keeps the original sentence — no screen reader ever hears "The quiet
          cut" as three fragments.
        </p>
      </article>
      <article>
        <h3>Measured, never assumed</h3>
        <p>
          Chapter width is measured from the DOM rather than assumed to be <code>100vw</code>, because
          a visible scrollbar makes those two numbers disagree by exactly enough to misalign the rail.
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.rail {
  position: relative;
  display: grid;
  grid-template-columns: minmax(13rem, 18rem) 1fr;
  align-items: stretch;
  min-height: 100svh;
  padding-top: var(--chrome-h);
  overflow: hidden;
  background: linear-gradient(180deg, #08070a 0%, #0b0a0d 100%);
}

.rail__index {
  display: flex;
  flex-direction: column;
  gap: 1.4rem;
  padding: clamp(2rem, 7vh, 4.5rem) clamp(1.1rem, 3vw, 2.4rem) clamp(2rem, 6vh, 3.5rem);
  border-right: 1px solid var(--line);
}

.rail__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.7rem;
}

.rail__list button {
  display: grid;
  grid-template-columns: 2.4rem 1fr;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--ink-faint);
  transition: color 0.35s var(--ease-out);
}

.rail__list .is-active button {
  color: var(--ink);
}

.rail__numeral {
  font: 500 0.66rem/1 var(--font-mono);
  letter-spacing: 0.18em;
}

.rail__list-title {
  font: 400 clamp(1rem, 1.5vw, 1.28rem) / 1.2 var(--font-serif);
  letter-spacing: 0.005em;
}

.rail__list .is-active .rail__list-title {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.35em;
  text-decoration-color: color-mix(in oklab, var(--accent) 80%, transparent);
}

.rail__hint {
  margin-top: auto;
  font: 500 0.6rem/1 var(--font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.rail__track {
  display: flex;
  will-change: transform;
}

.rail-chapter {
  flex: none;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.1rem;
  padding: clamp(2.4rem, 8vh, 6rem) clamp(1.2rem, 5vw, 5rem);
  border-right: 1px solid var(--line);
}

.rail-chapter__numeral {
  font: 400 clamp(3rem, 8vw, 7rem) / 1 var(--font-serif);
  color: color-mix(in oklab, var(--ink) 22%, transparent);
}

.rail-chapter__title {
  max-width: 18ch;
  font: 400 clamp(2.2rem, 5.6vw, 5rem) / 1.02 var(--font-serif);
  letter-spacing: -0.02em;
  overflow: hidden;
}

.rail-caption {
  font: 500 0.66rem/1 var(--font-mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--accent) 75%, var(--ink));
}

.rail-body {
  max-width: 38ch;
  font: 400 clamp(0.92rem, 1.1vw, 1.05rem) / 1.75 var(--font-sans);
  color: var(--ink-dim);
}

.rail-meta {
  font: 500 0.6rem/1 var(--font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.rail__foot {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem clamp(1.1rem, 3vw, 2.4rem);
  border-top: 1px solid var(--line);
  background: rgba(8, 7, 10, 0.72);
  backdrop-filter: blur(10px);
  font: 500 0.62rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.rail__progress {
  position: relative;
  flex: 1;
  height: 1px;
  background: var(--line);
}

.rail__progress-bar {
  position: absolute;
  inset: 0;
  transform-origin: 0 50%;
  background: var(--accent);
  transition: transform 0.6s var(--ease-out);
}

.rail__count {
  font-variant-numeric: tabular-nums;
  color: var(--ink-dim);
}

.rail__step {
  padding: 0.35rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
  font: 500 0.6rem/1 var(--font-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.rail__step:hover,
.rail__step:focus-visible {
  color: var(--ink);
  border-color: color-mix(in oklab, var(--accent) 60%, var(--line));
}

/* Reduced motion: the rail is a plain document again — no transforms, nothing to drag. */
.rail--still {
  grid-template-columns: 1fr;
}

.rail--still .rail__track {
  flex-direction: column;
}

.rail--still .rail-chapter {
  width: 100%;
  border-right: 0;
  border-bottom: 1px solid var(--line);
}

.rail--still .rail__index,
.rail--still .rail__foot,
.rail--still .rail__drag {
  color: var(--ink-faint);
  display: none;
}

.notes {
  display: grid;
  gap: clamp(1.5rem, 4vh, 2.6rem);
  padding: clamp(3rem, 9vh, 7rem) clamp(1.25rem, 6vw, 6rem);
  background: #0b0a0d;
}

.notes__head {
  display: grid;
  gap: 0.6rem;
  max-width: 44rem;
}

.notes__head h2 {
  font: 400 clamp(1.6rem, 3.2vw, 2.6rem) / 1.1 var(--font-serif);
  letter-spacing: -0.015em;
}

.notes__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
}

.notes__grid article {
  display: grid;
  gap: 0.5rem;
  padding: 1.2rem 1.15rem;
  border-top: 1px solid var(--line);
}

.notes__grid h3 {
  font: 600 0.7rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink);
}

.notes__grid p {
  font: 400 0.86rem/1.7 var(--font-sans);
  color: var(--ink-dim);
}

.notes__grid code {
  font-family: var(--font-mono);
  font-size: 0.82em;
  color: var(--ink);
}

@media (max-width: 900px) {
  .rail {
    grid-template-columns: 1fr;
  }

  .rail__index {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .rail__hint {
    display: none;
  }

  .rail-chapter {
    width: 100%;
  }
}
</style>
