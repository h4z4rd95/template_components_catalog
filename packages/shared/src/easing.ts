/**
 * easing.ts — named easings as plain functions.
 *
 * Deliberately framework-free: GSAP gets the string form (`easing.gsap`), CSS gets the cubic-bezier
 * (`easing.css`), and canvas/rAF loops call the function directly. One source of truth for "buttery".
 */

export type EasingFn = (t: number) => number;

export const easeLinear: EasingFn = (t) => t;
export const easeOutQuad: EasingFn = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad: EasingFn = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOutCubic: EasingFn = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic: EasingFn = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutQuart: EasingFn = (t) => 1 - (1 - t) ** 4;
export const easeOutExpo: EasingFn = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInOutExpo: EasingFn = (t) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;

/** The house "editorial" ease — long, luxurious tail. Used by every luxury-minimal variation. */
export const easeEditorial: EasingFn = (t) => 1 - (1 - t) ** 5;
export const easeOutBack: EasingFn = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

export const easing = {
  linear: easeLinear,
  quad: easeOutQuad,
  inOutQuad: easeInOutQuad,
  cubic: easeOutCubic,
  inOutCubic: easeInOutCubic,
  quart: easeOutQuart,
  expo: easeOutExpo,
  inOutExpo: easeInOutExpo,
  editorial: easeEditorial,
  back: easeOutBack,
} as const;

/**
 * GSAP-flavoured equivalents, so a GSAP timeline and a canvas loop can share intent.
 * (GSAP ships its own `CustomEase`; these strings are its built-ins, matched by feel.)
 */
export const gsapEase = {
  editorial: "expo.out",
  luxury: "power4.out",
  snap: "power3.inOut",
  punch: "back.out(1.7)",
  glide: "power2.inOut",
  none: "none",
} as const;

/** cubic-bezier strings for CSS transitions, tuned to mirror the JS easings above. */
export const cssEase = {
  editorial: "cubic-bezier(0.16, 1, 0.3, 1)",
  luxury: "cubic-bezier(0.22, 1, 0.36, 1)",
  snap: "cubic-bezier(0.65, 0, 0.35, 1)",
  punch: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;
