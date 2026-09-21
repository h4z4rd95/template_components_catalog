"use client";

/**
 * HeroStage — maps a slug to its variation component and renders it inside RouteFrame.
 *
 * Every hero is code-split and client-only (`ssr: false`): WebGL canvases, GSAP timelines and
 * Lenis instances have no meaningful server render, and shipping their HTML twice would only
 * cost bytes. The fallback below is a real, styled placeholder — never a blank screen.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { useEffect } from "react";
import type { Variation } from "@catalog/shared";
import RouteFrame from "./RouteFrame";
import styles from "./HeroStage.module.css";

const StageSkeleton = () => (
  <div className={styles.skeleton} role="status" aria-live="polite">
    <span className={styles.skeletonBar} />
    <span className={styles.skeletonText}>mounting variation…</span>
  </div>
);

/**
 * NOTE: `next/dynamic`'s options object must be an inline literal — the compiler statically
 * analyses the call and rejects a shared `options` variable ("must be an object literal").
 * Repetition here is the price of code-splitting; each entry stays a one-liner on purpose.
 */
const HEROES: Record<string, ComponentType> = {
  "kinetic-brutal-grid": dynamic(() => import("@/heroes/kinetic-brutal-grid/KineticBrutalGrid"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
  "editorial-scroll-lock": dynamic(() => import("@/heroes/editorial-scroll-lock/EditorialScrollLock"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
  "particle-morph-field": dynamic(() => import("@/heroes/particle-morph-field/ParticleMorphField"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
  "cyber-scanner-hud": dynamic(() => import("@/heroes/cyber-scanner-hud/CyberScannerHUD"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
  "liquid-chroma-glass": dynamic(() => import("@/heroes/liquid-chroma-glass/LiquidChromaGlass"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
};

export default function HeroStage({ variation }: { variation: Variation }) {
  const Hero = HEROES[variation.slug];

  // Each variation paints its own full-bleed palette, so the document background must follow.
  useEffect(() => {
    const previous = document.body.style.background;
    document.body.style.background = "#050506";
    return () => {
      document.body.style.background = previous;
    };
  }, []);

  if (!Hero) {
    return (
      <RouteFrame variation={variation}>
        <div className={styles.missing}>
          <h1>{variation.id}</h1>
          <p>
            This variation is registered in the manifest but has no component yet. Add it to{" "}
            <code>src/components/HeroStage.tsx</code> and re-run <code>npm run catalog:sync</code>.
          </p>
        </div>
      </RouteFrame>
    );
  }

  return (
    <RouteFrame variation={variation}>
      <Hero />
    </RouteFrame>
  );
}
