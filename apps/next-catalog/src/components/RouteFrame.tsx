"use client";

/**
 * RouteFrame — the shell every variation renders inside.
 *
 * Provides: a scroll-progress hairline, the catalog wordmark with a live "n / total" counter
 * (useful when a client is clicking through the showroom), the metadata HUD, and the
 * `data-motion-ready` flag that unlocks the shared `will-change` hints.
 */
import { useEffect, useState } from "react";
import type { Variation } from "@catalog/shared";
import CatalogHUD from "./CatalogHUD";
import { hubHref, variations } from "@/lib/catalog";
import styles from "./RouteFrame.module.css";

export default function RouteFrame({ variation, children }: { variation: Variation; children: React.ReactNode }) {
  const [progress, setProgress] = useState(0);
  const [hub, setHub] = useState("/");

  useEffect(() => {
    document.documentElement.dataset.motionReady = "true";
    setHub(hubHref("/"));
  }, []);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const index = variations.findIndex((v) => v.id === variation.id) + 1;

  return (
    <div className={styles.frame} style={{ ["--accent" as string]: variation.accent }}>
      <div className={styles.progressTrack} aria-hidden="true">
        <span className={styles.progressBar} style={{ transform: `scaleX(${progress})` }} />
      </div>

      <header className={styles.chrome}>
        <a className={styles.mark} href={hub}>
          <span className={styles.markDot} aria-hidden="true" />
          THE CATALOG
        </a>
        <span className={styles.counter}>
          {String(index).padStart(2, "0")} / {String(variations.length).padStart(2, "0")}
          <span className={styles.counterSep} aria-hidden="true">
            ·
          </span>
          {variation.discipline}
        </span>
      </header>

      <main className={styles.main}>{children}</main>

      <CatalogHUD variation={variation} />
    </div>
  );
}
