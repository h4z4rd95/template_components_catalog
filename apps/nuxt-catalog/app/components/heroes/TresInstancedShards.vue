<script setup lang="ts">
/**
 * Hero_V06_TresInstancedShards — Nuxt 4 · TresJS · Three.js
 *
 * A WebGL-first hero: 2,200–14,000 instanced shards live in a single draw call, and every aspect of
 * their motion — breathing, curl-drift, pointer repulsion, scroll dolly — is computed *in the vertex
 * shader*. The CPU only feeds uniforms, so the frame cost is nearly flat regardless of count.
 *
 * TresJS owns the renderer, camera and resize handling; this component owns the geometry and the
 * uniforms, and the only per-frame work on the JS side is lerping four numbers.
 */
import { TresCanvas } from "@tresjs/core";
import {
  clampDpr,
  prefersReducedMotion,
  qualityTier,
  supportsWebGL2,
  watchPerformance,
  type QualityTier,
} from "@catalog/shared";
import { glsl } from "@catalog/shared";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Counts are chosen so the *vertex* stage stays cheap in software rasterization too: every shard
// samples the noise field three times per frame, so the tier budget is really a noise budget.
const COUNT_BY_TIER: Record<QualityTier, number> = { low: 1800, medium: 4200, high: 7000, ultra: 11000 };

/** Frames-per-second sampling used by the telemetry panel (500ms windows, never a smoothed guess). */
function createFpsMeter() {
  let frames = 0;
  let span = 0;
  let last = 0;
  return (now: number) => {
    frames += 1;
    span += last ? now - last : 0;
    last = now;
    if (span <= 0.5) return null;
    const value = Math.round(frames / span);
    frames = 0;
    span = 0;
    return value;
  };
}

const stage = ref<HTMLElement | null>(null);
// A real Vector3, not an array: TresJS normalises plain arrays at runtime, but the declared
// prop type is the class — and a typed catalogue should satisfy its own types.
const cameraPosition = new THREE.Vector3(0, 0, 8.4);
const label = ref("—");
const tier = ref<QualityTier>("high");
const reduced = ref(false);
const supported = ref(true);
const count = ref(COUNT_BY_TIER.high);
const dpr = ref(1.5);
const live = ref(false);
let shards: THREE.InstancedMesh | null = null;
let disposeStop: (() => void) | null = null;
let stopWatch: (() => void) | null = null;

const uniforms = {
  uTime: { value: 0 },
  uScroll: { value: 0 },
  uPointer: { value: new THREE.Vector3(0, 0, 0) },
  uAccent: { value: new THREE.Color("#6ee7ff") },
  uSpread: { value: 1 },
};

const VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute float aSeed;
  attribute float aScale;

  uniform float uTime;
  uniform float uScroll;
  uniform float uSpread;
  uniform vec3 uPointer;

  varying float vEnergy;
  varying float vDepth;
  varying vec3 vNormal;

  ${glsl.NOISE_GLSL}

  void main() {
    // Curl-ish drift: each shard samples the same field at its own seed, so the cloud moves as one
    // fluid mass instead of a set of independent particles.
    float t = uTime * 0.16 + aSeed * 6.283;
    vec3 pos = aOffset;
    pos.x += snoise(vec3(pos.yz * 0.55, t)) * 0.42;
    pos.y += snoise(vec3(pos.zx * 0.62, t + 11.0)) * 0.42;
    pos.z += snoise(vec3(pos.xy * 0.48, t + 23.0)) * 0.42;

    // Scroll opens the field along z and lifts it — a dolly without moving the camera.
    pos.z *= mix(1.0, 2.35, uScroll);
    pos.y += uScroll * 0.9;

    // Pointer repulsion inside a 2.1-unit bubble; the falloff keeps it a push, never a snap.
    vec3 toPointer = pos - uPointer;
    float dist = length(toPointer);
    float push = smoothstep(2.1, 0.0, dist);
    pos += normalize(toPointer + 0.0001) * push * 0.75 * (1.0 - uScroll * 0.6);

    float energy = push + abs(snoise(vec3(pos.xy * 0.3, uTime * 0.4))) * 0.35;

    // Solid shards, not sprites: the octahedron's own vertices are scaled and spun around the
    // shard centre, so size lives in the transform (gl_PointSize does nothing for triangles).
    float scale = aScale * (1.0 + energy * 1.15) * uSpread;
    float spin = uTime * 0.35 + aSeed * 6.283;
    float c = cos(spin);
    float s2 = sin(spin);
    vec3 local = position * scale;
    local = vec3(local.x * c - local.z * s2, local.y, local.x * s2 + local.z * c);

    vec4 view = modelViewMatrix * vec4(pos + local, 1.0);
    gl_Position = projectionMatrix * view;

    vEnergy = energy;
    vDepth = clamp((-view.z - 2.0) / 9.0, 0.0, 1.0);
    vNormal = normalize(normalMatrix * normal);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uAccent;
  uniform float uScroll;

  varying float vEnergy;
  varying float vDepth;
  varying vec3 vNormal;

  void main() {
    // Faceted shading keeps every shard legible as *geometry*; the rim keeps the far field from
    // turning into mush, which is what a soft sprite field always does under additive blending.
    vec3 normal = normalize(vNormal) * 0.5 + 0.5;
    float facet = dot(normal, normalize(vec3(0.35, 0.85, 0.5)));

    vec3 cool = mix(vec3(0.03, 0.06, 0.12), uAccent, 0.42);
    vec3 hot = mix(uAccent, vec3(1.0), 0.5);
    vec3 color = mix(cool, hot, facet * 0.75 + vEnergy * 0.55);

    float alpha = (0.16 + facet * 0.5 + vEnergy * 0.55) * (1.0 - vDepth * 0.62);
    alpha *= mix(1.0, 0.6, uScroll * 0.5);

    gl_FragColor = vec4(color, alpha);
  }
`;

/** Everything a shard needs is baked into instanced attributes: position, seed and base scale. */
function buildShards(amount: number): THREE.InstancedMesh {
  const base = new THREE.OctahedronGeometry(0.045, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  // `getAttribute` + assertion: three declares attributes as possibly undefined, but a freshly
  // built octahedron always carries both, and this avoids mutating the attributes map directly.
  geometry.setAttribute("position", base.getAttribute("position") as THREE.BufferAttribute);
  geometry.setAttribute("normal", base.getAttribute("normal") as THREE.BufferAttribute);
  geometry.instanceCount = amount;

  const offsets = new Float32Array(amount * 3);
  const seeds = new Float32Array(amount);
  const scales = new Float32Array(amount);

  for (let i = 0; i < amount; i += 1) {
    // Fibonacci-ish shell distribution with a hollow core — dense where the eye lands, sparse outside.
    const ratio = i / amount;
    const theta = i * 2.399963;
    const radius = 1.15 + Math.cbrt(ratio) * 3.1;
    const phi = Math.acos(1 - 2 * ratio);
    offsets[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    offsets[i * 3 + 1] = (Math.cos(phi) * radius) * 0.62;
    offsets[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius * 0.72;
    seeds[i] = Math.random();
    scales[i] = 0.6 + Math.random() * 2.1;
  }

  geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scales, 1));

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, amount);
  mesh.frustumCulled = false;
  return mesh;
}

function rebuild(amount: number) {
  shards?.geometry.dispose();
  (shards?.material as THREE.Material | undefined)?.dispose();
  count.value = amount;
  shards = buildShards(amount);
  live.value = false;
  // The primitive is keyed so Vue mounts the new instance rather than mutating the old one.
  void nextTick(() => (live.value = true));
}

const sampleFps = createFpsMeter();
let started = 0;

function onLoop() {
  // Own clock: the TresJS context is opaque about time on purpose, and a catalogue should not lean
  // on an internal API for something this simple.
  const now = performance.now() / 1000;
  if (!started) started = now;
  uniforms.uTime.value = now - started;

  const fps = sampleFps(now);
  if (fps !== null) label.value = String(fps);
}

let pointer = new THREE.Vector3();
function onPointerMove(event: PointerEvent) {
  const node = stage.value;
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  pointer.set(x * 4.6, y * 3.1, 0.8);
}

onMounted(() => {
  reduced.value = prefersReducedMotion();
  // Pre-flight before a renderer exists: a blank frame must never be presented as artwork.
  supported.value = supportsWebGL2();
  tier.value = qualityTier();
  dpr.value = clampDpr(window.devicePixelRatio, tier.value);
  const amount = COUNT_BY_TIER[tier.value];
  count.value = amount;

  if (reduced.value || !supported.value) return; // composed poster: nothing to build, nothing to leak

  shards = buildShards(amount);
  live.value = true;

  const context = gsap.context(() => {
    const tween = gsap.to(uniforms.uScroll, {
      value: 1,
      ease: "none",
      scrollTrigger: {
        trigger: stage.value,
        start: "top top",
        end: "bottom top",
        scrub: 0.6,
      },
    });
    // The pointer target is lerped toward the uniform in the loop handler; GSAP owns the easing.
    gsap.ticker.add(step);
    disposeStop = () => {
      gsap.ticker.remove(step);
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, stage.value ?? undefined);

  stage.value?.addEventListener("pointermove", onPointerMove, { passive: true });

  // SwiftShader and old integrated GPUs deserve a smaller field rather than a slideshow.
  stopWatch = watchPerformance(() => {
    if (count.value > COUNT_BY_TIER.medium) rebuild(COUNT_BY_TIER[tier.value === "ultra" ? "high" : "medium"]);
  }, { once: true });

  void context;
});

function step() {
  uniforms.uPointer.value.lerp(pointer, 0.08);
}

onUnmounted(() => {
  disposeStop?.();
  stopWatch?.();
  stage.value?.removeEventListener("pointermove", onPointerMove);
  shards?.geometry.dispose();
  (shards?.material as THREE.Material | undefined)?.dispose();
  shards = null;
});

</script>

<template>
  <section ref="stage" class="shards">
    <div class="shards__field" aria-hidden="true">
      <TresCanvas
        v-if="live && supported && shards"
        :dpr="dpr"
        :alpha="true"
        :antialias="false"
        clear-color="#04060a"
        window-size
        class="shards__canvas"
        @loop="onLoop"
      >
        <TresPerspectiveCamera :args="[38, 1.6, 0.1, 80]" :position="cameraPosition" :fov="38" />
        <TresPrimitive :key="count" :object="shards" />
      </TresCanvas>

      <div v-else class="shards__poster">
        <span class="shards__poster-grid" />
        <p v-if="!supported">
          <strong>WebGL unavailable</strong>
          <span>
            This browser cannot create a WebGL2 context, so the shard field is replaced by its
            structural poster. Nothing is broken — the composition simply renders as flat colour.
          </span>
        </p>
        <p v-else>
          Motion composed for still reading — the shard field is replaced by its structural poster
          because this device asks for reduced motion.
        </p>
      </div>
    </div>

    <div class="shards__type">
      <p class="cat-eyebrow">V06 · WebGL-first · Instanced field</p>
      <h1 class="shards__title">
        <span class="shards__line">VOLUMETRIC</span>
        <span class="shards__line shards__line--thin">shard field</span>
      </h1>
      <p class="shards__lede">
        One draw call holds the whole composition. Move the pointer and the cloud opens around it;
        scroll and the field stretches into depth while the dolly stays locked.
      </p>
      <a class="cat-cta" href="#blueprint">Read the blueprint</a>
    </div>

    <aside class="shards__panel" aria-label="Live scene telemetry">
      <dl>
        <div>
          <dt>Tier</dt>
          <dd>{{ tier }}</dd>
        </div>
        <div>
          <dt>Shards</dt>
          <dd>{{ count.toLocaleString("en-US") }}</dd>
        </div>
        <div>
          <dt>Loop</dt>
          <dd>{{ label }} fps</dd>
        </div>
      </dl>
      <p class="shards__hint">Move the pointer · scroll to stretch</p>
    </aside>

    <span class="shards__rule" aria-hidden="true" />
  </section>

  <section id="blueprint" class="blueprint">
    <header class="blueprint__head">
      <p class="cat-eyebrow">Blueprint</p>
      <h2>What the GPU is doing while you read this</h2>
    </header>

    <div class="blueprint__grid">
      <article>
        <h3>Instanced attributes</h3>
        <p>
          Position, seed and scale are baked into three <code>InstancedBufferAttribute</code> arrays at
          build time. The mesh never re-uploads: the field is static data interpreted by a moving shader.
        </p>
      </article>
      <article>
        <h3>Curl drift</h3>
        <p>
          Every shard samples the shared simplex field at its own seed, so neighbours move together.
          That is what separates a fluid mass from confetti — the noise is shared, the phase is not.
        </p>
      </article>
      <article>
        <h3>Pointer as a pressure wave</h3>
        <p>
          The pointer is a 3D point in scene space; a smooth-stepped falloff pushes shards outward
          inside a 2.1-unit bubble, scaled down as the scroll opens the field.
        </p>
      </article>
      <article>
        <h3>Budget, not hope</h3>
        <p>
          The device reports a quality tier, a frame watcher degrades the count if the frame budget is
          missed, and DPR is clamped before the canvas is created — never after the first stutter.
        </p>
      </article>
    </div>

    <footer class="blueprint__foot">
      <span>Instanced draw · 1 call</span>
      <span>Shards · vertex-shaded</span>
      <span>TresJS · Three.js · GSAP ScrollTrigger</span>
    </footer>
  </section>
</template>

<style scoped>
.shards {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 78% 18%, rgba(110, 231, 255, 0.14), transparent 60%),
    linear-gradient(180deg, #04060a 0%, #070912 62%, #04060a 100%);
}

.shards__field {
  position: absolute;
  inset: 0;
}

.shards__canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}

.shards__poster {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 6rem clamp(1.5rem, 6vw, 6rem);
  background:
    repeating-linear-gradient(90deg, rgba(110, 231, 255, 0.07) 0 1px, transparent 1px 6.5rem),
    repeating-linear-gradient(0deg, rgba(110, 231, 255, 0.05) 0 1px, transparent 1px 6.5rem),
    radial-gradient(60% 50% at 62% 40%, rgba(110, 231, 255, 0.2), transparent 70%);
}

.shards__poster p {
  display: grid;
  gap: 0.55rem;
  max-width: 34rem;
  text-align: center;
  font: 400 0.92rem/1.7 var(--font-sans);
  color: var(--ink-dim);
}

.shards__poster strong {
  font: 600 0.68rem/1 var(--font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--accent) 82%, var(--ink));
}

.shards__type {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 1.1rem;
  align-content: center;
  min-height: 100svh;
  padding: calc(var(--chrome-h) + clamp(3rem, 9vh, 7rem)) clamp(1.25rem, 6vw, 6.5rem) clamp(3rem, 10vh, 7rem);
  pointer-events: none;
}

.shards__title {
  font: 400 clamp(2.9rem, 9.4vw, 8.4rem) / 0.94 var(--font-display);
  letter-spacing: -0.035em;
  text-transform: uppercase;
}

.shards__line {
  display: block;
}

.shards__line--thin {
  font-family: var(--font-serif);
  font-style: italic;
  font-weight: 400;
  text-transform: none;
  letter-spacing: -0.01em;
  color: color-mix(in oklab, var(--accent) 72%, var(--ink));
}

.shards__lede {
  max-width: 34rem;
  font: 400 clamp(0.92rem, 1.15vw, 1.06rem) / 1.65 var(--font-sans);
  color: var(--ink-dim);
}

.shards__lede + .cat-cta {
  justify-self: start;
  margin-top: 0.4rem;
  pointer-events: auto;
}

.shards__panel {
  position: absolute;
  right: clamp(0.9rem, 3vw, 2.4rem);
  bottom: calc(clamp(0.9rem, 3vw, 2.4rem) + 4.6rem);
  z-index: 3;
  width: min(19rem, calc(100vw - 2rem));
  padding: 0.85rem 0.95rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: rgba(6, 8, 14, 0.72);
  backdrop-filter: blur(12px);
  font-family: var(--font-mono);
}

.shards__panel dl {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
}

.shards__panel dt {
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.shards__panel dd {
  margin-top: 0.25rem;
  font-size: 0.82rem;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.shards__hint {
  margin-top: 0.7rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--line);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.shards__rule {
  position: absolute;
  left: clamp(1.25rem, 6vw, 6.5rem);
  right: clamp(1.25rem, 6vw, 6.5rem);
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--accent), transparent);
  opacity: 0.5;
}

.blueprint {
  display: grid;
  gap: clamp(1.5rem, 4vh, 3rem);
  padding: clamp(3.5rem, 10vh, 8rem) clamp(1.25rem, 6vw, 6.5rem);
  background: linear-gradient(180deg, #04060a, #080a12);
}

.blueprint__head {
  display: grid;
  gap: 0.7rem;
  max-width: 46rem;
}

.blueprint__head h2 {
  font: 400 clamp(1.6rem, 3.4vw, 2.7rem) / 1.12 var(--font-sans);
  letter-spacing: -0.02em;
}

.blueprint__grid {
  display: grid;
  gap: 1.1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.blueprint__grid article {
  display: grid;
  gap: 0.5rem;
  padding: 1.2rem 1.15rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: rgba(255, 255, 255, 0.015);
}

.blueprint__grid h3 {
  font: 600 0.72rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--accent) 80%, var(--ink));
}

.blueprint__grid p {
  font: 400 0.86rem/1.68 var(--font-sans);
  color: var(--ink-dim);
}

.blueprint__grid code {
  font-family: var(--font-mono);
  font-size: 0.82em;
  color: var(--ink);
}

.blueprint__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 1.4rem;
  padding-top: 1.1rem;
  border-top: 1px solid var(--line);
  font: 500 0.62rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

@media (max-width: 860px) {
  .shards__panel {
    position: static;
    margin: 0 clamp(1.25rem, 6vw, 6.5rem) clamp(1.5rem, 5vh, 3rem);
  }

  .shards__type {
    min-height: auto;
    padding-bottom: 1.6rem;
  }
}
</style>
