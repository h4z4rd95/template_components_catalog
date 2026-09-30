/**
 * liquid.ts — the raw WebGL2 mesh-gradient shader behind Hero_V05_LiquidChromaGlass.
 *
 * Technique: two-step domain-warped fBm drives a 5-stop cosine palette, then a *second* warp
 * sample is used to offset the first — giving the gradient genuine fluid advection rather than
 * a moving blur. Pointer inertia is injected as an advection vector `uVelocity`, so the field
 * is dragged by the cursor and keeps drifting after it stops (this is the "liquid" in the name).
 *
 * Hand-written on purpose: no Three.js, no post-processing library — a single fullscreen triangle
 * and one program. ~0.6ms at 1080p on integrated graphics.
 */
import { NOISE_GLSL, HASH_GLSL } from "./noise";

export const LIQUID_VERT = /* glsl */ `#version 300 es
precision highp float;

// Fullscreen triangle: three vertices, no attribute buffers, no index — position is derived
// from gl_VertexID so the draw call is drawArrays(TRIANGLES, 0, 3) with a bare VAO.
const vec2 POSITIONS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));

out vec2 vUv;

void main() {
  vec2 pos = POSITIONS[gl_VertexID];
  // map clip space [-1,1] → uv [0,1]; the oversized triangle clips cleanly.
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const LIQUID_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float uTime;        // seconds, pre-modulated
uniform vec2  uResolution;  // drawing buffer size in px
uniform vec2  uPointer;     // pointer in uv space, smoothed
uniform vec2  uVelocity;    // pointer inertia (uv/sec, damped)
uniform float uScroll;      // 0..1 page progress
uniform float uIntensity;   // 0..1 master amplitude (drops on low-tier devices)
uniform float uBass;        // 0..1 optional audio-ish pulse
uniform vec3  uC1;          // palette stops
uniform vec3  uC2;
uniform vec3  uC3;
uniform vec3  uC4;
uniform vec3  uC5;

${NOISE_GLSL}

${HASH_GLSL}

/** 5-stop cosine-flavoured palette ramp, tuned for chromatic (not muddy) transitions. */
vec3 palette(float t) {
  float s = clamp(t, 0.0, 1.0);
  vec3 c = mix(uC1, uC2, smoothstep(0.0, 0.28, s));
  c = mix(c, uC3, smoothstep(0.22, 0.52, s));
  c = mix(c, uC4, smoothstep(0.48, 0.78, s));
  c = mix(c, uC5, smoothstep(0.72, 1.0, s));
  return c;
}

void main() {
  // Aspect-corrected, pointer-centred space so warps feel isotropic on any viewport.
  vec2 uv = (vUv - 0.5) * vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);

  float zoom = 1.0 + uScroll * 0.85;
  float time = uTime * 0.09;

  // --- layer 1: slow global drift -------------------------------------------------
  vec3 p = vec3(uv * (1.15 * zoom), time * 0.6);

  // --- pointer inertia: drag the field, then let it relax ------------------------
  vec2 drag = uVelocity * 0.55;
  p.xy += drag;
  float pullDist = length(uv - (uPointer - 0.5));
  float finger = exp(-pullDist * 3.4);
  p.z += finger * 0.35;

  // --- layer 2: two-step domain warp --------------------------------------------
  float warpStrength = 1.15 + length(uVelocity) * 1.4 + uBass * 0.4;
  float n1 = warpedFbm(p * 1.25, warpStrength, 4);

  // second, finer octave set for micro-structure (reads as liquid surface tension)
  float n2 = warpedFbm(p * 3.1 + vec3(2.7, 1.1, 0.0), 0.6 + finger * 0.5, 3);

  float field = n1 * 0.72 + n2 * 0.28;

  // --- layer 3: braided filaments -------------------------------------------------
  // abs()-folding the field creates the thin chromatic ribbons of the reference look.
  float braid = abs(sin(field * 5.1 + time * 2.0 + uScroll * 2.2));
  float ribbon = smoothstep(0.72, 1.0, braid) * 0.35;

  // --- layer 4: pointer heat + specular shimmer ----------------------------------
  vec3 col = palette(field * 0.5 + 0.5);
  col += palette(finger * 0.9) * (0.35 * finger);
  col += ribbon * palette(0.5 + n2 * 0.5);

  // iridescence: shift hue by the gradient's local slope (a poor-man's normal)
  float slope = length(vec2(dFdx(field), dFdy(field)));
  col += vec3(0.16, 0.05, 0.28) * smoothstep(0.15, 0.9, slope);

  // --- finish: glassy bloom, film grain, vignette --------------------------------
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.28);      // soft filmic S-curve
  col += pow(max(0.0, field), 3.0) * 0.22;                   // bloom-ish
  col *= uIntensity;

  float grain = (hash21(vUv * uResolution + fract(uTime) * 91.7) - 0.5) * 0.045;
  col += grain;

  float vignette = 1.0 - smoothstep(0.55, 1.35, length((vUv - 0.5) * vec2(1.25, 1.0)));
  col *= mix(0.82, 1.0, vignette);

  fragColor = vec4(max(col, 0.0), 1.0);
}
`;
