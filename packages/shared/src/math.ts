/**
 * math.ts — the tiny numeric toolkit every variation shares.
 * Everything here is pure, allocation-light and safe with undefined input, because these
 * functions run inside rAF loops on devices we cannot test.
 */

export const clamp = (v: number, min = 0, max = 1): number => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const inverseLerp = (a: number, b: number, v: number): number => (a === b ? 0 : clamp((v - a) / (b - a)));

export const mapRange = (v: number, inMin: number, inMax: number, outMin: number, outMax: number): number =>
  lerp(outMin, outMax, inverseLerp(inMin, inMax, v));

/** Frame-rate independent exponential smoothing. `lambda` ≈ "how fast", `dt` in seconds. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * Math.max(dt, 0)));

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
};

export const round = (v: number, decimals = 2): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** Deterministic PRNG (mulberry32) so GPU point clouds are identical across reloads & SSR. */
export const createRandom = (seed = 0x1a2b3c4d) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Signed shortest angular difference, in radians. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export type Vec2 = { x: number; y: number };

/** One-pole spring integrator — the inertia used by the cursors and magnetic buttons. */
export class Spring {
  value: number;
  velocity = 0;
  constructor(initial = 0, private stiffness = 120, private dampingRatio = 0.85) {
    this.value = initial;
  }
  step(target: number, dt: number): number {
    const dtc = clamp(dt, 1 / 240, 1 / 20);
    const damping = 2 * this.dampingRatio * Math.sqrt(this.stiffness);
    const force = (target - this.value) * this.stiffness - this.velocity * damping;
    this.velocity += force * dtc;
    this.value += this.velocity * dtc;
    return this.value;
  }
}
