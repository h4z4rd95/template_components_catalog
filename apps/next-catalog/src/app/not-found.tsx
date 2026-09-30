import type { Metadata } from "next";
import Link from "next/link";
import styles from "./not-found.module.css";

/**
 * The app's own 404 — the page a visitor lands on when a route inside the Next track does not
 * exist.
 *
 * It exists because its absence was visible: the static export shipped Next's built-in apology
 * ("404 · This page could not be found", thirty-three characters of text), which is a strange thing
 * to be handed by a catalogue whose whole argument is that every page in it was designed. A visitor
 * who mistypes a variation's slug is exactly the visitor worth routing back into the showroom.
 *
 * It is deliberately framework-free: no client component, no motion, no canvas. It has to render
 * when everything else is broken.
 */
export const metadata: Metadata = {
  title: "Not found",
  description: "That route is not part of the catalogue — here is the way back in.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <p className={styles.kicker}>The Catalog · 404</p>

      <h1 className={styles.title}>
        This route is <em>not</em> in the manifest.
      </h1>

      <p className={styles.body}>
        The catalogue is generated from <code>catalog/catalog.json</code>, so every page it has is
        listed there — and this address is not one of them. The likely causes are a renamed
        variation, a slug that lost a hyphen, or a link from an older build.
      </p>

      <div className={styles.actions}>
        {/* A plain anchor, not `<Link>`: on a static export the hub lives outside this app's
            router, and a client-side navigation cannot reach it. */}
        <a className={styles.primary} href="../../">
          Open the catalogue
        </a>
        <a className={styles.secondary} href="./">
          The Next track home
        </a>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Where this came from</dt>
          <dd>framework/next</dd>
        </div>
        <div>
          <dt>What to try</dt>
          <dd>the hub&rsquo;s search, or the discipline menus</dd>
        </div>
        <div>
          <dt>Source of truth</dt>
          <dd>catalog/catalog.json</dd>
        </div>
      </dl>

      <footer className={styles.foot}>
        <span>
          Built as a learning tool, a playbook and a client-facing showroom — every variation
          bilingual, dual-theme and gated.
        </span>
        <Link className={styles.link} href="/">
          Back to the start
        </Link>
      </footer>
    </main>
  );
}
