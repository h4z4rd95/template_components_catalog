"use client";

/**
 * NavStage — the Nav discipline's counterpart to HeroStage.
 *
 * Same contract: a slug maps to a code-split, client-only variation, rendered inside RouteFrame so
 * it gets the HUD, the progress hairline and the "n / total" counter. Kept as its own registry
 * rather than one giant map so each discipline states its own variations in one readable place.
 */
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { Variation } from "@catalog/shared";
import RouteFrame from "./RouteFrame";
import styles from "./HeroStage.module.css";

const StageSkeleton = () => (
  <div className={styles.skeleton} role="status" aria-live="polite">
    <span className={styles.skeletonBar} />
    <span className={styles.skeletonText}>mounting variation…</span>
  </div>
);

const NAVS: Record<string, ComponentType> = {
  "mega-menu-command": dynamic(() => import("@/nav/mega-menu-command/MegaMenuCommand"), {
    ssr: false,
    loading: () => <StageSkeleton />,
  }),
};

export default function NavStage({ variation }: { variation: Variation }) {
  const Nav = NAVS[variation.slug];

  if (!Nav) {
    return (
      <RouteFrame variation={variation}>
        <div className={styles.missing}>
          <h1>{variation.id}</h1>
          <p>
            This variation is registered in the manifest but has no component yet. Add it to{" "}
            <code>src/components/NavStage.tsx</code> and re-run <code>npm run catalog:sync</code>.
          </p>
        </div>
      </RouteFrame>
    );
  }

  return (
    <RouteFrame variation={variation}>
      <Nav />
    </RouteFrame>
  );
}
