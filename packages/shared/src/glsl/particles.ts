/**
 * particles.ts — the GPU point-morph shader behind Hero_V03_ParticleMorphField.
 *
 * Design: three target lattices are baked as vertex attributes (`aBase`, `aHelix`, `aSphere`),
 * and `uMorph` (0→1→2) blends between consecutive pairs inside the vertex shader. Nothing is
 * re-uploaded per frame; the CPU only writes three uniforms. Curl-ish noise adds life, a radial
 * mouse force dents the cloud, and a depth-fog + colour ramp give the field its atmosphere.
 *
 * Written for Three.js ShaderMaterial (GLSL ES 1.00), so it also works under R3F and TresJS.
 */
import { NOISE_GLSL } from "./noise";

export const PARTICLE_VERT = /* glsl */ `precision highp float;

attribute vec3 aBase;    // resting torus
attribute vec3 aHelix;   // unfold state
attribute vec3 aSphere;  // settle state
attribute float aScale;  // per-point size variance (0.4 .. 1.0)
attribute float aSeed;   // per-point phase offset

uniform float uTime;
uniform float uMorph;      // 0 = base, 1 = helix, 2 = sphere (continuous)
uniform vec2  uPointer;    // pointer in world XY
uniform float uPointerAmp; // 0 when the pointer leaves / on touch
uniform float uSize;
uniform float uDpr;
uniform float uTurbulence;
uniform float uScroll;     // 0..1
uniform float uQuality;    // 1 low .. 2 ultra — scales displacement cost
uniform vec3  uRipple;     // xy = world centre, z = strength (0 when idle)
uniform float uRippleTime; // seconds since the last click

varying float vDepth;
varying float vGlow;
varying float vSeed;

${NOISE_GLSL}

void main() {
  // --- 3-way morph: blend two segments so morph never "teleports" ---------------
  float seg1 = smoothstep(0.0, 1.0, clamp(uMorph, 0.0, 1.0));
  float seg2 = smoothstep(0.0, 1.0, clamp(uMorph - 1.0, 0.0, 1.0));
  vec3 pos = mix(aBase, aHelix, seg1);
  pos = mix(pos, aSphere, seg2);

  // --- organic life: layered noise drift, cheaper on low tiers -------------------
  float t = uTime * 0.35;
  vec3 drift = vec3(
    snoise(pos * 1.6 + vec3(t, 0.0, 0.0)),
    snoise(pos * 1.6 + vec3(0.0, t, 4.2)),
    snoise(pos * 1.6 + vec3(3.1, 0.0, t))
  );
  pos += drift * uTurbulence;

  if (uQuality > 1.2) {
    // finer secondary ripple — the "shimmer" that sells 30k points as a field, not a mesh
    pos += snoise(pos * 5.2 + t * 1.7) * 0.035 * vec3(1.0, 0.6, 1.0);
  }

  // --- pointer dent: radial repulsion with an inverse-square falloff ------------
  vec2 toPointer = pos.xy - uPointer;
  float dist = length(toPointer);
  float influence = exp(-dist * dist * 2.4) * uPointerAmp;
  pos.xy += normalize(toPointer + 1e-5) * influence * 0.55;
  pos.z += influence * 0.35;

  // --- click shockwave: an expanding, decaying ring of pressure ------------------
  if (uRipple.z > 0.001) {
    vec2 delta = pos.xy - uRipple.xy;
    float rdist = length(delta);
    float wavefront = uRippleTime * 2.3;                       // ring radius grows with time
    float ring = exp(-pow(rdist - wavefront, 2.0) * 5.5);      // gaussian ring, not a disc
    float decay = exp(-uRippleTime * 2.1);
    float push = ring * decay * uRipple.z;
    pos.xy += normalize(delta + 1e-5) * push * 0.62;
    pos.z += push * 0.7;
  }

  // --- scroll subtlety: the whole field tilts and breathes ----------------------
  float tilt = uScroll * 0.35;
  pos.yz = mat2(cos(tilt), -sin(tilt), sin(tilt), cos(tilt)) * pos.yz;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);

  // size attenuation with a floor so distant points stay visible
  float scale = aScale * uSize * (1.0 + influence * 2.2);
  gl_PointSize = max(1.0, scale * uDpr * (300.0 / max(-mvPosition.z, 0.1)));

  vDepth = -mvPosition.z;
  vGlow = influence + smoothstep(-1.5, 1.5, pos.y) * 0.25;
  vSeed = aSeed;

  gl_Position = projectionMatrix * mvPosition;
}
`;

export const PARTICLE_FRAG = /* glsl */ `precision highp float;

uniform vec3  uColorA;   // deep core
uniform vec3  uColorB;   // mid
uniform vec3  uColorC;   // hot rim
uniform float uOpacity;
uniform float uFade;     // driven by GSAP during intro/outro

varying float vDepth;
varying float vGlow;
varying float vSeed;

void main() {
  // analytic round sprite — no texture fetch, no banding
  vec2 centred = gl_PointCoord - 0.5;
  float d = length(centred);
  if (d > 0.5) discard;

  // Under additive blending a generous halo saturates to white and the palette disappears;
  // a tight core with a restrained halo keeps hue while still reading as a glowing field.
  float core = smoothstep(0.5, 0.04, d);
  float halo = smoothstep(0.5, 0.22, d) * 0.28;

  // vertical + seed colour ramp: warm rim on the outer shell, cool core inside
  vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 1.0, vGlow));
  col = mix(col, uColorC, pow(core, 2.0) * 0.85 + vSeed * 0.15);

  // atmospheric depth fade — far points sink into the background
  float depthFade = 1.0 - smoothstep(3.0, 9.5, vDepth);
  float alpha = (core + halo) * uOpacity * uFade * depthFade;

  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;
