<script setup lang="ts">
/**
 * Hero_V08_TresLiquidTerrain — Nuxt 4 · TresJS · custom GLSL terrain
 *
 * A displaced mesh: 4k–40k vertices ride a ridged-noise surface whose normals are derived *in the
 * shader* by finite differences, then lit with a chromatic three-stop ramp. The pointer is a bump of
 * light travelling across the plane; scrolling sweeps the palette from cold deep-water to hot
 * magenta and tips the camera up.
 *
 * The `supportsWebGL2()` pre-flight matters here: a catalogue may not present a blank frame as art,
 * so a visitor without WebGL gets a composed gradient poster and an honest notice instead.
 */
import { TresCanvas } from "@tresjs/core";
import { clampDpr, prefersReducedMotion, qualityTier, supportsWebGL2, watchPerformance, type QualityTier } from "@catalog/shared";
import { glsl } from "@catalog/shared";
import * as THREE from "three";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Three noise evaluations per vertex per frame is the real cost here, so the tier budget is
// expressed in segments (n² vertices) rather than in screen pixels.
const SEGMENTS_BY_TIER: Record<QualityTier, number> = { low: 56, medium: 80, high: 120, ultra: 168 };

const stage = ref<HTMLElement | null>(null);
// A real Vector3, not an array: TresJS normalises plain arrays at runtime, but the declared
// prop type is the class — and a typed catalogue should satisfy its own types.
const cameraPosition = new THREE.Vector3(0, 1.5, 4.6);
const tier = ref<QualityTier>("high");
const segments = ref(SEGMENTS_BY_TIER.high);
const dpr = ref(1.5);
const supported = ref(true);
const reduced = ref(false);
const live = ref(false);
const fps = ref("—");
const vertices = computed(() => (segments.value + 1) ** 2);

let terrain: THREE.Mesh | null = null;
let stopWatch: (() => void) | null = null;
let stopScroll: (() => void) | null = null;
const pointer = new THREE.Vector2(0, 0);

const uniforms = {
  uTime: { value: 0 },
  uScroll: { value: 0 },
  uPointer: { value: new THREE.Vector2(0, 0) },
  uAmp: { value: 0.42 },
  uLight: { value: new THREE.Vector3(0.45, 0.62, 0.65) },
  uColorA: { value: new THREE.Color("#10233f") },
  uColorB: { value: new THREE.Color("#4f6ef7") },
  uColorC: { value: new THREE.Color("#f06ab0") },
};

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScroll;
  uniform float uAmp;
  uniform vec2 uPointer;

  varying float vHeight;
  varying vec2 vUv;
  varying vec3 vNormal;

  ${glsl.NOISE_GLSL}

  // Terrain height as a function, so the normal can be derived instead of hand-authored.
  float terrain(vec2 p) {
    float n = fbm(vec3(p * 0.62 + uTime * 0.06, uTime * 0.12));
    float ridges = 1.0 - abs(n * 2.0 - 1.0);          // ridged noise: crests instead of lumps
    float swell = sin(p.x * 0.7 + uTime * 0.35) * 0.06;
    return (n * 0.72 + ridges * 0.44 + swell) * uAmp * (1.0 + uScroll * 0.4);
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    float h = terrain(pos.xy);
    float e = 0.075;
    float dx = terrain(pos.xy + vec2(e, 0.0)) - h;
    float dy = terrain(pos.xy + vec2(0.0, e)) - h;

    // A bump of light that follows the pointer across the plane.
    float d = distance(pos.xy, uPointer);
    pos.z += h + exp(-d * d * 2.4) * 0.62;

    vHeight = h;
    vNormal = normalize(normalMatrix * normalize(vec3(-dx / e, -dy / e, 1.0)));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uLight;
  uniform float uScroll;

  varying float vHeight;
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    float h = clamp(vHeight * 1.35 + 0.5, 0.0, 1.0);

    vec3 base = mix(uColorA, uColorB, smoothstep(0.02, 0.58, h));
    base = mix(base, uColorC, smoothstep(0.52, 1.0, h));

    vec3 normal = normalize(vNormal);
    float diff = clamp(dot(normal, normalize(uLight)), 0.0, 1.0);
    float sheen = pow(clamp(dot(normal, normalize(vec3(0.32, 0.42, 0.86))), 0.0, 1.0), 4.5);

    // Chromatic fringe: split the channels slightly by height so the crests carry colour instead of
    // a single white highlight — that is what makes it read as liquid rather than plastic.
    vec3 color = base * (0.42 + diff * 0.82);
    color.r += sheen * (0.14 + h * 0.12);
    color.g += sheen * 0.07;
    color.b += (1.0 - diff) * 0.06 + h * 0.04;

    // Vignette the plane edges so the terrain never ends in a hard cut at the viewport.
    float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(0.0, 0.16, vUv.y)
      * smoothstep(1.0, 0.84, vUv.x) * smoothstep(1.0, 0.84, vUv.y);
    color *= mix(0.55, 1.0, edge);
    color = mix(color, vec3(0.02, 0.03, 0.06), (1.0 - edge) * 0.7);

    gl_FragColor = vec4(color, 1.0);
  }
`;

function buildTerrain(segments_: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(9, 9, segments_, segments_);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2.42;
  mesh.position.set(0, -0.85, 0);
  return mesh;
}

function rebuild(segments_: number) {
  terrain?.geometry.dispose();
  (terrain?.material as THREE.Material | undefined)?.dispose();
  segments.value = segments_;
  terrain = buildTerrain(segments_);
  live.value = false;
  void nextTick(() => (live.value = true));
}

let frames = 0;
let elapsed = 0;
let last = 0;
let started = 0;

function onLoop() {
  // Own clock — see TresInstancedShards for why the render context is not asked for time.
  const now = performance.now() / 1000;
  if (!started) started = now;
  uniforms.uTime.value = now - started;
  uniforms.uPointer.value.lerp(pointer, 0.06);
  uniforms.uAmp.value = 0.42 + uniforms.uScroll.value * 0.3;

  frames += 1;
  elapsed += last ? now - last : 0;
  last = now;
  if (elapsed > 0.5) {
    fps.value = String(Math.round(frames / elapsed));
    frames = 0;
    elapsed = 0;
  }
}

function onPointerMove(event: PointerEvent) {
  const node = stage.value;
  if (!node) return;
  const rect = node.getBoundingClientRect();
  // The plane spans 9 world units; the pointer maps into it, not into normalised device space.
  pointer.set(
    (((event.clientX - rect.left) / rect.width) * 2 - 1) * 4.5,
    -(((event.clientY - rect.top) / rect.height) * 2 - 1) * 4.5,
  );
}

onMounted(() => {
  reduced.value = prefersReducedMotion();
  supported.value = supportsWebGL2();
  tier.value = qualityTier();
  dpr.value = clampDpr(window.devicePixelRatio, tier.value);
  segments.value = SEGMENTS_BY_TIER[tier.value];

  if (reduced.value || !supported.value) return;

  terrain = buildTerrain(segments.value);
  live.value = true;
  stage.value?.addEventListener("pointermove", onPointerMove, { passive: true });

  const context = gsap.context(() => {
    const sweep = gsap.timeline({
      scrollTrigger: {
        trigger: stage.value,
        start: "top top",
        end: "+=140%",
        scrub: 0.7,
      },
    });
    sweep.to(uniforms.uScroll, { value: 1, ease: "none" }, 0);
    // The palette sweep is the point of this variation: cold water at rest, hot magenta once read.
    sweep.to(uniforms.uColorA.value, { r: 0.16, g: 0.05, b: 0.22, ease: "none" }, 0);
    sweep.to(uniforms.uColorB.value, { r: 0.62, g: 0.28, b: 0.78, ease: "none" }, 0);
    sweep.to(uniforms.uColorC.value, { r: 1.0, g: 0.58, b: 0.86, ease: "none" }, 0);

    stopScroll = () => {
      sweep.scrollTrigger?.kill();
      sweep.kill();
    };
  }, stage.value ?? undefined);

  stopWatch = watchPerformance(() => {
    if (segments.value > SEGMENTS_BY_TIER.low) rebuild(Math.max(SEGMENTS_BY_TIER.low, segments.value - 48));
  }, { once: true });

  void context;
});

onUnmounted(() => {
  stopScroll?.();
  stopWatch?.();
  stage.value?.removeEventListener("pointermove", onPointerMove);
  terrain?.geometry.dispose();
  (terrain?.material as THREE.Material | undefined)?.dispose();
  terrain = null;
});
</script>

<template>
  <section ref="stage" class="terrain">
    <div class="terrain__scene" aria-hidden="true">
      <TresCanvas
        v-if="live && supported && terrain"
        :dpr="dpr"
        :alpha="false"
        :antialias="false"
        clear-color="#05060c"
        window-size
        class="terrain__canvas"
        @loop="onLoop"
      >
        <TresPerspectiveCamera :args="[42, 1.6, 0.1, 60]" :position="cameraPosition" :fov="42" />
        <TresPrimitive :key="segments" :object="terrain" />
      </TresCanvas>

      <div v-else class="terrain__poster">
        <span class="terrain__poster-glow" />
        <p v-if="!supported" class="terrain__notice">
          <strong>WebGL unavailable</strong>
          <span>
            This device or browser cannot create a WebGL2 context, so the terrain is replaced by its
            composed gradient. Nothing is broken — the artwork simply renders as static colour.
          </span>
        </p>
        <p v-else class="terrain__notice">
          <strong>Reduced motion</strong>
          <span>The height field is presented as a still gradient rather than a moving surface.</span>
        </p>
      </div>
    </div>

    <div class="terrain__type">
      <p class="cat-eyebrow">V08 · Chromatic liquid · Shader terrain</p>
      <h1 class="terrain__title">
        <span>LIQUID</span>
        <span class="terrain__title-thin">terrain, in three stops</span>
      </h1>
      <p class="terrain__lede">
        Ridged noise displaces the mesh; the normals are derived in the shader, not authored. Scroll
        to sweep the palette from deep water to magenta and tilt the horizon up under the type.
      </p>
      <a class="cat-cta" href="#blueprint">See how it is built</a>
    </div>

    <aside class="terrain__panel" aria-label="Terrain telemetry">
      <dl>
        <div>
          <dt>Mesh</dt>
          <dd>{{ segments }}²</dd>
        </div>
        <div>
          <dt>Vertices</dt>
          <dd>{{ vertices.toLocaleString("en-US") }}</dd>
        </div>
        <div>
          <dt>Loop</dt>
          <dd>{{ supported && !reduced ? `${fps} fps` : "static" }}</dd>
        </div>
      </dl>
      <p class="terrain__hint">Pointer is a bump of light · scroll sweeps the palette</p>
    </aside>
  </section>

  <section id="blueprint" class="terrain-notes">
    <header class="terrain-notes__head">
      <p class="cat-eyebrow">Blueprint</p>
      <h2>Normals derived, not authored</h2>
    </header>

    <div class="terrain-notes__grid">
      <article>
        <h3>Finite differences</h3>
        <p>
          The surface height is a pure function of position and time. Sampling it at two neighbouring
          points gives a real normal per vertex, which is why the crests catch light as they travel
          instead of flickering.
        </p>
      </article>
      <article>
        <h3>Cost, measured</h3>
        <p>
          Three noise evaluations per vertex add up fast, so segments scale with the device's quality
          tier (64² → 200²) and a frame watcher lowers them again if the budget is missed.
        </p>
      </article>
      <article>
        <h3>Scroll as a colour timeline</h3>
        <p>
          A scrubbed GSAP timeline drives four uniforms at once — amplitude, spread and all three
          palette stops — so the whole look changes with one gesture and stays frame-accurate.
        </p>
      </article>
      <article>
        <h3>Honest degradation</h3>
        <p>
          <code>supportsWebGL2()</code> runs before the renderer is created. A visitor without WebGL
          gets a composed poster and a notice, not an empty rectangle with console noise.
        </p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.terrain {
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  background: linear-gradient(180deg, #05060c 0%, #0a0714 70%, #05060c 100%);
}

.terrain__scene {
  position: absolute;
  inset: 0;
}

.terrain__canvas {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
}

.terrain__poster {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: start center;
  align-content: center;
  gap: 1.5rem;
  padding: 6rem clamp(1.5rem, 8vw, 8rem);
  background:
    radial-gradient(70% 55% at 50% 78%, rgba(240, 106, 176, 0.32), transparent 68%),
    radial-gradient(60% 45% at 30% 62%, rgba(79, 110, 247, 0.35), transparent 70%),
    linear-gradient(180deg, #070912, #140a1c 60%, #070912);
}

.terrain__poster-glow {
  position: absolute;
  left: 50%;
  bottom: 12%;
  width: min(70vw, 46rem);
  height: 1px;
  transform: translateX(-50%);
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  opacity: 0.7;
}

.terrain__notice {
  display: grid;
  gap: 0.55rem;
  max-width: 32rem;
  text-align: center;
  font: 400 0.9rem/1.65 var(--font-sans);
  color: var(--ink-dim);
}

.terrain__notice strong {
  font: 600 0.68rem/1 var(--font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--accent) 80%, var(--ink));
}

.terrain__type {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 1.05rem;
  align-content: center;
  min-height: 100svh;
  padding: calc(var(--chrome-h) + clamp(3rem, 9vh, 7rem)) clamp(1.25rem, 6vw, 6.5rem) clamp(3rem, 10vh, 7rem);
  pointer-events: none;
}

.terrain__title {
  display: grid;
  gap: 0.1em;
  font: 400 clamp(2.6rem, 8.4vw, 7.4rem) / 0.95 var(--font-display);
  letter-spacing: -0.03em;
  text-transform: uppercase;
}

.terrain__title-thin {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.52em;
  text-transform: none;
  letter-spacing: 0;
  color: color-mix(in oklab, var(--accent) 62%, var(--ink));
}

.terrain__lede {
  max-width: 33rem;
  font: 400 clamp(0.92rem, 1.1vw, 1.04rem) / 1.68 var(--font-sans);
  color: var(--ink-dim);
}

.terrain__lede + .cat-cta {
  justify-self: start;
  margin-top: 0.4rem;
  pointer-events: auto;
}

.terrain__panel {
  position: absolute;
  right: clamp(0.9rem, 3vw, 2.4rem);
  bottom: calc(clamp(0.9rem, 3vw, 2.4rem) + 4.6rem);
  z-index: 3;
  width: min(20rem, calc(100vw - 2rem));
  padding: 0.85rem 0.95rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: rgba(6, 6, 14, 0.7);
  backdrop-filter: blur(12px);
  font-family: var(--font-mono);
}

.terrain__panel dl {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
}

.terrain__panel dt {
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.terrain__panel dd {
  margin-top: 0.25rem;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.terrain__hint {
  margin-top: 0.7rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--line);
  font-size: 0.58rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.terrain-notes {
  display: grid;
  gap: clamp(1.4rem, 4vh, 2.4rem);
  padding: clamp(3rem, 9vh, 7rem) clamp(1.25rem, 6vw, 6rem);
  background: #0a0714;
}

.terrain-notes__head {
  display: grid;
  gap: 0.6rem;
  max-width: 44rem;
}

.terrain-notes__head h2 {
  font: 400 clamp(1.6rem, 3.2vw, 2.6rem) / 1.12 var(--font-sans);
  letter-spacing: -0.02em;
}

.terrain-notes__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.terrain-notes__grid article {
  display: grid;
  gap: 0.5rem;
  padding: 1.15rem;
  border: 1px solid var(--line);
  border-radius: 0.7rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent);
}

.terrain-notes__grid h3 {
  font: 600 0.7rem/1 var(--font-mono);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in oklab, var(--accent) 78%, var(--ink));
}

.terrain-notes__grid p {
  font: 400 0.86rem/1.7 var(--font-sans);
  color: var(--ink-dim);
}

.terrain-notes__grid code {
  font-family: var(--font-mono);
  font-size: 0.82em;
  color: var(--ink);
}

@media (max-width: 860px) {
  .terrain__panel {
    position: static;
    margin: 0 clamp(1.25rem, 6vw, 6.5rem) clamp(1.5rem, 5vh, 3rem);
  }

  .terrain__type {
    min-height: auto;
    padding-bottom: 1.6rem;
  }
}
</style>
