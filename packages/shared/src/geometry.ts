/**
 * geometry.ts — procedural point-cloud builders.
 *
 * All builders return a flat Float32Array of xyz positions in roughly the same bounding volume
 * (radius ~1.6) so a single shader can morph between any pair without a rescale pass.
 * Seeded PRNG everywhere → the field looks identical on every reload and in CI screenshots.
 */
import { createRandom } from "./math";

export type PointCloud = Float32Array;

const TAU = Math.PI * 2;

/** Hollow torus shell — the "resting" shape of the morph field. */
export function torusPoints(count: number, { radius = 1.15, tube = 0.42, jitter = 0.05, seed = 11 } = {}): PointCloud {
  const rand = createRandom(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rand() * TAU;
    const v = rand() * TAU;
    const r = tube * Math.sqrt(rand());
    const rr = radius + r * Math.cos(v);
    out[i * 3] = rr * Math.cos(u) + (rand() - 0.5) * jitter;
    out[i * 3 + 1] = r * Math.sin(v) + (rand() - 0.5) * jitter;
    out[i * 3 + 2] = rr * Math.sin(u) + (rand() - 0.5) * jitter;
  }
  return out;
}

/** Double helix — the "unfold" state, reads as data/DNA at small scales. */
export function helixPoints(count: number, { radius = 0.95, height = 3.1, turns = 3.2, jitter = 0.045, seed = 23 } = {}): PointCloud {
  const rand = createRandom(seed);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const strand = i % 2 === 0 ? 0 : Math.PI;
    const t = rand();
    const angle = t * TAU * turns + strand;
    const r = radius * (0.9 + rand() * 0.12);
    out[i * 3] = Math.cos(angle) * r + (rand() - 0.5) * jitter;
    out[i * 3 + 1] = (t - 0.5) * height + (rand() - 0.5) * jitter;
    out[i * 3 + 2] = Math.sin(angle) * r + (rand() - 0.5) * jitter;
  }
  return out;
}

/** Fibonacci sphere — the "settle" state: dense, calm, obviously volumetric. */
export function spherePoints(count: number, { radius = 1.55, jitter = 0.035, seed = 37 } = {}): PointCloud {
  const rand = createRandom(seed);
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const j = 1 + (rand() - 0.5) * jitter * 6;
    out[i * 3] = Math.cos(theta) * r * radius * j;
    out[i * 3 + 1] = y * radius * j;
    out[i * 3 + 2] = Math.sin(theta) * r * radius * j;
  }
  return out;
}

/** Loose slatted wall — the "assembled structure" state for architectural reveals. */
export function slatWallPoints(
  count: number,
  { cols = 14, width = 3.2, height = 3.2, jitter = 0.02, seed = 53 } = {},
): PointCloud {
  const rand = createRandom(seed);
  const out = new Float32Array(count * 3);
  const rows = Math.ceil(count / cols);
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols) % rows;
    const x = (col / (cols - 1) - 0.5) * width;
    const y = (row / Math.max(1, rows - 1) - 0.5) * height;
    const z = Math.sin(col * 0.7) * 0.16;
    out[i * 3] = x + (rand() - 0.5) * jitter;
    out[i * 3 + 1] = y + (rand() - 0.5) * jitter;
    out[i * 3 + 2] = z + (rand() - 0.5) * jitter;
  }
  return out;
}

/** Random per-point scalars in [a,b] — drives size variance without a texture lookup. */
export function randomScalars(count: number, a = 0.4, b = 1, seed = 71): Float32Array {
  const rand = createRandom(seed);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) out[i] = a + rand() * (b - a);
  return out;
}

/** Unit-circle positions for canvas-based rings, dials and radar sweeps. */
export function ringSegments(count: number, radius = 1, phase = 0): Float32Array {
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const a = phase + (i / count) * TAU;
    out[i * 2] = Math.cos(a) * radius;
    out[i * 2 + 1] = Math.sin(a) * radius;
  }
  return out;
}
