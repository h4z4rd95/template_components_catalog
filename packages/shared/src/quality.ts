/**
 * quality.ts — device profiling. Every GPU variation reads this before allocating memory,
 * so a 2019 Android gets a beautiful 6k-point field instead of a melted battery.
 */

export type QualityTier = "low" | "medium" | "high" | "ultra";

export interface DeviceProfile {
  tier: QualityTier;
  /** Renderer pixel ratio cap — the single most effective GPU saving. */
  dpr: number;
  /** Suggested instance/particle budget. */
  particles: number;
  /** Suggested segmentation for swept geometry. */
  segments: number;
  /** True when the pointer is coarse (touch) → skip cursor-following work. */
  coarsePointer: boolean;
  /** True when the user asked for reduced motion. */
  reducedMotion: boolean;
  /** True when the UA looks mobile/tablet. */
  mobile: boolean;
}

const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";

export const prefersReducedMotion = (): boolean =>
  isBrowser && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : true; // SSR: assume the calm version, hydrate into motion.

export const isCoarsePointer = (): boolean =>
  isBrowser && typeof window.matchMedia === "function" ? window.matchMedia("(pointer: coarse)").matches : false;

export const isMobileUA = (): boolean =>
  isBrowser ? /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) : false;

/** Cheap capability probe: does this device even hand out a WebGL2 context? */
export const supportsWebGL2 = (): boolean => {
  if (!isBrowser) return false;
  try {
    const canvas = document.createElement("canvas");
    return !!canvas.getContext("webgl2");
  } catch {
    return false;
  }
};

export function qualityTier(): QualityTier {
  if (!isBrowser) return "high";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const mobile = isMobileUA();

  if (mobile && cores <= 4) return "low";
  if (memory <= 4 || cores <= 2) return "medium";
  if (cores >= 12 && memory >= 8 && !mobile) return "ultra";
  return mobile ? "medium" : "high";
}

const BUDGETS: Record<QualityTier, { dpr: number; particles: number; segments: number }> = {
  low: { dpr: 1, particles: 4_000, segments: 24 },
  medium: { dpr: 1.35, particles: 12_000, segments: 48 },
  high: { dpr: 1.6, particles: 30_000, segments: 96 },
  ultra: { dpr: 2, particles: 60_000, segments: 160 },
};

export function deviceProfile(): DeviceProfile {
  const tier = qualityTier();
  const budget = BUDGETS[tier];
  return {
    tier,
    ...budget,
    coarsePointer: isCoarsePointer(),
    reducedMotion: prefersReducedMotion(),
    mobile: isMobileUA(),
  };
}

/** Clamp a raw devicePixelRatio to a tier-appropriate ceiling. */
export const clampDpr = (dpr = 1, tier: QualityTier = qualityTier()): number =>
  Math.max(1, Math.min(dpr, BUDGETS[tier].dpr));

/**
 * Watches for runtime slowdowns (browser throttling, thermal falloff) and lets a scene
 * drop one tier. Returns an unsubscribe function.
 */
export function watchPerformance(
  onDegrade: (fps: number) => void,
  { floor = 34, window = 90, once = false }: { floor?: number; window?: number; once?: boolean } = {},
): () => void {
  if (!isBrowser) return () => {};
  let frames = 0;
  let start = performance.now();
  let raf = 0;
  let alive = true;

  const tick = () => {
    if (!alive) return;
    frames += 1;
    const now = performance.now();
    if (now - start >= 1000) {
      const fps = (frames * 1000) / (now - start);
      if (fps < floor && fps > 0) {
        // `once: true` is the right default for *destructive* reactions (reallocating geometry,
        // rebuilding a scene): a slow device stays slow, and rebuilding every second turns one
        // stutter into a page that never finishes a frame.
        if (once) {
          alive = false;
          cancelAnimationFrame(raf);
          onDegrade(fps);
          return;
        }
        onDegrade(fps);
      }
      frames = 0;
      start = now;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  // `window` shadows the global by design in the signature; keep the timer handle local.
  void window;

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
}
