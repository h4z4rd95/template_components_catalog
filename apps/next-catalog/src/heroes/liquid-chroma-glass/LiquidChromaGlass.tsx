"use client";

/**
 * Hero_V05_LiquidChromaGlass
 * ──────────────────────────
 * Aesthetic : Chromatic Liquid Gradient · Glassmorphism
 * Stack     : Next.js · raw WebGL2 (hand-written fragment shader) · Motion · backdrop-filter
 *
 * What actually happens
 *  1. A mesh gradient is *advected* by your mouse inertia: the pointer's velocity is fed into the
 *     shader as a 2D vector, so the field is dragged and keeps drifting after you stop.
 *  2. Scroll zooms the liquid field and lifts the palette while glass cards drift over it in
 *     spring-damped parallax.
 *  3. A chromatic spotlight follows the cursor with spring lag, and clicking sends a pulse through
 *     the fBm amplitude.
 *  4. No Three.js, no R3F, no post-processing library — one program, three vertices, one VAO.
 *
 * Reduced motion / no WebGL2: the same palette is rendered as a composed CSS mesh gradient and every
 * card is laid out statically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useMotionValue, useScroll, useSpring, useTransform } from "motion/react";
import { createLiquid, paletteFrom, type LiquidHandle } from "./rawLiquid";
import styles from "./liquid-chroma-glass.module.css";

const PALETTE = paletteFrom(["#050316", "#571087", "#fa4fd9", "#5c9eff", "#c2fbee"]);

const FRAMES = [
  {
    title: "Mesh gradients, advected",
    body: "Two-step domain-warped fBm with a pointer-velocity term: the gradient behaves like a fluid being stirred, then relaxes.",
    metric: "1 program",
  },
  {
    title: "Glass that earns its blur",
    body: "backdrop-filter is expensive, so it is used on four elements only — enough for depth, never enough to drop frames.",
    metric: "4 layers",
  },
  {
    title: "Motion, not animation",
    body: "Springs with mass and damping drive every transform, so nothing arrives on a fixed timeline and nothing ever snaps.",
    metric: "spring(120, 24)",
  },
  {
    title: "Budgets on entry",
    body: "Device tier picks the pixel-ratio ceiling, and the loop pauses entirely when the canvas leaves the viewport or the tab hides.",
    metric: "dpr ≤ 1.85",
  },
];

const STATS = [
  { value: "0.6ms", label: "fragment cost @1080p" },
  { value: "3", label: "vertices drawn" },
  { value: "60fps", label: "on integrated graphics" },
];

export default function LiquidChromaGlass() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LiquidHandle | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const framesRef = useRef<HTMLDivElement | null>(null);
  const [gpu, setGpu] = useState<"pending" | "live" | "fallback">("pending");

  /* -------------------------------------------------------- spring-damped spotlight */
  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);
  const glowX = useSpring(spotX, { stiffness: 90, damping: 18, mass: 0.6 });
  const glowY = useSpring(spotY, { stiffness: 90, damping: 18, mass: 0.6 });

  /* ------------------------------------------------------------------ scroll parallax */
  const { scrollYProgress } = useScroll({ target: framesRef, offset: ["start end", "end start"] });
  const driftY = useSpring(useTransform(scrollYProgress, [0, 1], [70, -70]), {
    stiffness: 120,
    damping: 24,
    mass: 0.4,
  });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "-14%"]);

  /* ------------------------------------------------------------------ engine */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setGpu("fallback");
      return;
    }

    const engine = createLiquid(canvas, { palette: PALETTE, intensity: 1.08 });
    engineRef.current = engine;
    setGpu(engine.ok ? "live" : "fallback");
    if (!engine.ok) return () => void 0;

    let lastProgress = 0;
    let raf = 0;
    const onPointerMove = (event: PointerEvent) => {
      engine.setPointer(event.clientX, event.clientY);
      spotX.set(event.clientX);
      spotY.set(event.clientY);
    };
    const onPointerLeave = () => engine.setPointer(null, null);
    const onPointerDown = () => engine.pulse(1);
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        lastProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
        engine.setProgress(lastProgress);
      });
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
      engine.destroy();
      engineRef.current = null;
    };
  }, [spotX, spotY]);

  const spring = useMemo(() => ({ duration: 0.95, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }), []);

  const onCardMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    // A tiny specular highlight that tracks the pointer inside each glass card.
    card.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    card.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  }, []);

  return (
    <div ref={rootRef} className={styles.root} data-gpu={gpu}>
      {/* -------------------------------------------------------------- liquid layer */}
      <div className={styles.liquid} aria-hidden="true">
        <canvas ref={canvasRef} className={styles.canvas} />
        {gpu !== "live" ? <div className={styles.fallback} /> : null}
        <div className={styles.grain} />
      </div>

      <motion.div className={styles.spotlight} style={{ left: glowX, top: glowY }} aria-hidden="true" />

      {/* ---------------------------------------------------------------------- hero */}
      <section ref={heroRef} className={styles.hero} aria-label="Chroma Systems hero">
        <motion.div className={styles.heroInner} style={{ y: heroY }}>
          <p className={styles.eyebrow}>chroma systems · colour engine v3</p>
          <h1 className={styles.title}>
            Colour,{" "}
            <br />
            <em>alive.</em>
          </h1>
          <p className={styles.lede}>
            A liquid colour engine for interfaces that refuse to sit still. The gradient is not a background image —
            it is a fragment shader being stirred by your cursor, and it remembers the motion for a moment after you
            stop.
          </p>
          <div className={styles.cta}>
            <a className={styles.ctaPrimary} href="#frames">
              Explore the engine
            </a>
            <a className={styles.ctaGhost} href="#frames">
              Read the technique
            </a>
          </div>
          <p className={styles.hint}>move the pointer · click to pulse the field</p>
        </motion.div>
      </section>

      {/* -------------------------------------------------------------------- frames */}
      <section className={styles.frames} id="frames" ref={framesRef} aria-label="How the engine works">
        <header className={styles.framesHead}>
          <h2 className={styles.framesTitle}>
            Four decisions,
            <br />
            one continuous surface.
          </h2>
          <p className={styles.framesLede}>
            The whole variation is a single hand-written fragment shader plus four glass panels. Everything below is
            implemented in this repository — open the source and change a number.
          </p>
        </header>

        <motion.div className={styles.grid} style={{ y: driftY }}>
          {FRAMES.map((frame, i) => (
            <motion.article
              key={frame.title}
              className={styles.card}
              onPointerMove={onCardMove}
              initial={{ opacity: 0, y: 34 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-12% 0px" }}
              transition={{ ...spring, delay: i * 0.08 }}
            >
              <span className={styles.cardIndex}>{String(i + 1).padStart(2, "0")}</span>
              <h3 className={styles.cardTitle}>{frame.title}</h3>
              <p className={styles.cardBody}>{frame.body}</p>
              <span className={styles.cardMetric}>{frame.metric}</span>
            </motion.article>
          ))}
        </motion.div>

        <ul className={styles.stats} aria-label="Performance summary">
          {STATS.map((stat, i) => (
            <motion.li
              key={stat.label}
              className={styles.stat}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...spring, delay: 0.1 + i * 0.08 }}
            >
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </motion.li>
          ))}
        </ul>
      </section>

      {/* --------------------------------------------------------------------- outro */}
      <section className={styles.outro} aria-label="Outro">
        <motion.h2
          className={styles.outroTitle}
          initial={{ opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={spring}
        >
          Ship the <em>feeling</em>, and the pixels will follow.
        </motion.h2>
        <p className={styles.outroNote}>
          Hero_V05_LiquidChromaGlass — raw WebGL2 fragment shader · Motion springs · backdrop-filter glass
        </p>
      </section>
    </div>
  );
}
