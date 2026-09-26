import Link from "next/link";
import { counts, disciplines, variations } from "@/lib/catalog";
import styles from "./index.module.css";

/**
 * The Next.js track's own index — a dense, brutal index of every variation exported by this app.
 * The visual hub (docs/index.html) is the primary showroom; this page exists so a direct visitor
 * to /framework/next/ still lands somewhere intentional.
 */
export default function NextTrackIndex() {
  const heroes = variations.filter((v) => v.discipline === "Hero");

  return (
    <div className={styles.index}>
      <header className={styles.header}>
        <p className={styles.kicker}>The Catalog — Next.js track</p>
        <h1 className={styles.title}>
          Static exports,
          <br />
          kinetic behaviour.
        </h1>
        <p className={styles.lede}>
          {counts.total} variations registered in the manifest, {heroes.length} of them heroes in this app. Each one is
          a full page: real copy, real physics, real scroll behaviour — open one and scroll.
        </p>
        <div className={styles.stats}>
          <span>
            <b>{String(counts.total).padStart(2, "0")}</b> variations
          </span>
          <span>
            <b>{String(counts.stable).padStart(2, "0")}</b> stable
          </span>
          <span>
            <b>{String(disciplines.length).padStart(2, "0")}</b> disciplines planned
          </span>
        </div>
      </header>

      <ul className={styles.list}>
        {heroes.map((v, i) => (
          <li key={v.id} className={styles.item} style={{ ["--accent" as string]: v.accent }}>
            <Link href={`/hero/${v.slug}/`} className={styles.link}>
              <span className={styles.num}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.body}>
                <span className={styles.id}>{v.id}</span>
                <span className={styles.vibe}>{v.vibe}</span>
                <span className={styles.note}>{v.interaction}</span>
              </span>
              <span className={styles.stack}>
                {v.stack.slice(0, 3).map((tech) => (
                  <em key={tech}>{tech}</em>
                ))}
              </span>
              <span className={styles.go} aria-hidden="true">
                ↗
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className={styles.footer}>
        <p>
          Looking for the full showroom? The hub lives at <code>docs/index.html</code> in the repository root and
          indexes every track.
        </p>
      </footer>
    </div>
  );
}
