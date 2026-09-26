"use client";

/**
 * Hero_V02_EditorialScrollLock
 * ────────────────────────────
 * Aesthetic : Luxury Minimalism · Editorial
 * Stack     : Next.js · GSAP ScrollTrigger (pin + scrub) · Lenis smooth scroll · CSS Grid
 *
 * What actually happens
 *  1. A 320vh stage is scroll-locked: the viewport pins on a single elegant line of serif type.
 *  2. Scrubbing deconstructs that line — its words drift apart, one of them travels into an
 *     editorial image grid and becomes a caption, the rest dissolve to a ghosted watermark.
 *  3. The image cells wipe open on a stagger with a gentle parallax each, then the credits,
 *     progress rail and rules compose the final frame.
 *
 * Lenis owns the scroll so every 1px of wheel becomes ~0.09 of a lerped pixel — the "buttery"
 * in luxury minimalism is literally this number.
 *
 * Reduced motion: no Lenis, no pin. The final editorial frame simply exists.
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import styles from "./editorial-scroll-lock.module.css";

const CAPTIONS = [
  { fig: "Fig. 01", title: "Travertine bench", meta: "Carrara · 2024 · hand-honed", tone: "stone" },
  { fig: "Fig. 02", title: "Olive wool throw", meta: "Puglia · 2023 · undyed", tone: "olive" },
  { fig: "Fig. 03", title: "Graphite console", meta: "Kyoto · 2024 · 6mm steel", tone: "graphite" },
  { fig: "Fig. 04", title: "Bone porcelain", meta: "Limoges · 1962 · réédition", tone: "bone" },
];

const STEPS = ["Form", "Material", "Light", "Restraint"];

const COLLECTION = [
  {
    name: "Série Basse",
    kind: "Seating",
    year: "2025",
    note: "Four proportions, one horizon. Hand-honed travertine on a blackened steel spine.",
    tone: "stone",
  },
  {
    name: "Maison Lumen",
    kind: "Lighting",
    year: "2024",
    note: "A 1200mm alabaster diffuser that behaves like a slow sunrise at 2400K.",
    tone: "bone",
  },
  {
    name: "Atelier Noir",
    kind: "Storage",
    year: "2024",
    note: "Graphite carcass, invisible hinges, interiors lined in undyed olive wool.",
    tone: "graphite",
  },
];

export default function EditorialScrollLock() {
  const stageRef = useRef<HTMLElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const gridRef = useRef<HTMLUListElement | null>(null);
  const railRef = useRef<HTMLOListElement | null>(null);
  const collectionRef = useRef<HTMLUListElement | null>(null);
  const quoteRef = useRef<HTMLQuoteElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const headline = headlineRef.current;
    const grid = gridRef.current;
    if (!stage || !headline || !grid) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    gsap.registerPlugin(ScrollTrigger);

    const words = gsap.utils.toArray<HTMLElement>(`.${styles.word}`, headline);
    const cells = gsap.utils.toArray<HTMLElement>(`.${styles.cell}`, grid);
    const shots = gsap.utils.toArray<HTMLElement>(`.${styles.shot}`, grid);
    const stepDots = gsap.utils.toArray<HTMLElement>(`.${styles.stepDot}`, railRef.current);
    const captions = gsap.utils.toArray<HTMLElement>(`.${styles.caption}`, grid);

    let lenis: Lenis | null = null;
    let tickerFn: ((time: number) => void) | null = null;

    /* ---------------------------------------------------------------- smooth scroll */
    if (!reduced) {
      lenis = new Lenis({
        lerp: 0.085,
        wheelMultiplier: 0.9,
        touchMultiplier: 1.6,
        smoothWheel: true,
      });
      lenis.on("scroll", ScrollTrigger.update);
      tickerFn = (time: number) => lenis?.raf(time * 1000);
      gsap.ticker.add(tickerFn);
      gsap.ticker.lagSmoothing(0);
    }

    const ctx = gsap.context(() => {
      if (reduced) return;

      /* --------------------------------------------------- the scroll-locked stage */
      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: stage,
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
          invalidateOnRefresh: true, // re-measure the morph target on resize
        },
      });

      // 01 — words arrive, one by one, from their mask
      gsap.set(words, { yPercent: 118, opacity: 0 });
      gsap.set(shots, { clipPath: "inset(0% 0% 100% 0%)", scale: 1.14 });
      gsap.set(captions, { yPercent: 40, opacity: 0 });
      gsap.set(stepDots, { scale: 0.4, opacity: 0.25 });

      tl.to(words, { yPercent: 0, opacity: 1, duration: 0.16, stagger: 0.03, ease: "expo.out" }, 0)
        .to(stepDots[0], { scale: 1, opacity: 1, duration: 0.05 }, 0.02)

        // 02 — the ghosting: type steps back, structure steps forward
        .to(
          words,
          {
            opacity: 0.1,
            yPercent: (i: number) => (i % 2 === 0 ? -14 : 12),
            duration: 0.3,
            stagger: 0.015,
          },
          0.34,
        )
        .to(stepDots[1], { scale: 1, opacity: 1, duration: 0.06 }, 0.4)

        // 03 — the grid wipes open with parallax inside each frame
        .to(shots, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.26, stagger: 0.05, ease: "expo.inOut" }, 0.4)
        .to(shots, { scale: 1, duration: 0.4, stagger: 0.05 }, 0.42)
        .to(stepDots[2], { scale: 1, opacity: 1, duration: 0.06 }, 0.62)

        // 04 — captions settle, the frame is complete
        .to(captions, { yPercent: 0, opacity: 1, duration: 0.18, stagger: 0.04 }, 0.66)
        .to(stepDots[3], { scale: 1, opacity: 1, duration: 0.06 }, 0.8)
        // explicit fromTo: the sheet keeps the rules visible by default so the reduced-motion
        // composition still reads as an editorial frame.
        .fromTo(
          `.${styles.rule}`,
          { scaleX: 0, transformOrigin: "0 50%" },
          { scaleX: 1, duration: 0.2, stagger: 0.04 },
          0.8,
        );

      /* ------------------------------- one word travels into the grid as a caption */
      const traveller = words[words.length - 2]; // the word "loud"
      const target = cells[1];
      if (traveller && target) {
        // Function-based values, not a pre-computed snapshot: combined with the ScrollTrigger's
        // `invalidateOnRefresh`, the travel distance is re-measured on every resize so the word
        // always lands exactly on the image cell.
        const delta = (axis: "x" | "y") => () => {
          const w = traveller.getBoundingClientRect();
          const c = target.getBoundingClientRect();
          return axis === "x" ? c.left + 28 - w.left : c.top + c.height * 0.42 - w.top;
        };
        tl.to(
          traveller,
          {
            x: delta("x"),
            y: delta("y"),
            scale: 0.34,
            color: "#F4F0E7",
            duration: 0.3,
            ease: "expo.inOut",
          },
          0.44,
        );
      }

      /* ---------------------------------------- cell parallax + collection reveals */
      cells.forEach((cell, i) => {
        gsap.fromTo(
          shots[i],
          { yPercent: -6 },
          {
            yPercent: 6,
            ease: "none",
            scrollTrigger: { trigger: cell, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });

      gsap.utils.toArray<HTMLElement>(`.${styles.piece}`, collectionRef.current).forEach((piece, i) => {
        gsap.from(piece, {
          y: 60,
          opacity: 0,
          duration: 1.1,
          ease: "expo.out",
          delay: i * 0.08,
          scrollTrigger: { trigger: piece, start: "top 88%", once: true },
        });
      });

      // Element refs, not selector strings: this block lives *outside* the context's scope
      // element, so a scoped selector would silently match nothing.
      if (quoteRef.current) {
        gsap.from(quoteRef.current, {
          opacity: 0,
          y: 30,
          duration: 1.2,
          ease: "expo.out",
          scrollTrigger: { trigger: quoteRef.current, start: "top 85%", once: true },
        });
      }
    }, stageRef);

    /* Fonts change metrics — re-measure once they land so the morph stays exact. */
    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => ScrollTrigger.refresh());
    }

    return () => {
      ctx.revert();
      if (tickerFn) gsap.ticker.remove(tickerFn);
      lenis?.destroy();
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, []);

  return (
    <>
      <section ref={stageRef} className={styles.stage} aria-label="Atelier Morand — editorial hero">
        <div className={styles.pin}>
          <div className={styles.meta}>
            <span className={styles.metaMark}>Atelier Morand</span>
            <span className={styles.metaRule} aria-hidden="true" />
            <span className={styles.metaNote}>Maison depuis 1962 · Paris — Milano</span>
          </div>

          <h1 ref={headlineRef} className={styles.headline}>
            <span className={styles.mask}>
              <span className={styles.word}>Quiet</span>
            </span>{" "}
            <span className={styles.mask}>
              <span className={styles.word}>objects,</span>
            </span>{" "}
            <span className={styles.mask}>
              <span className={styles.word}>made</span>
            </span>{" "}
            <span className={styles.mask}>
              <span className={styles.word}>loud</span>
            </span>
            <br />
            <span className={styles.mask}>
              <span className={`${styles.word} ${styles.wordItalic}`}>by</span>
            </span>{" "}
            <span className={styles.mask}>
              <span className={`${styles.word} ${styles.wordItalic}`}>time.</span>
            </span>
          </h1>

          <ul ref={gridRef} className={styles.grid} aria-label="Selected works">
            {CAPTIONS.map((cap, i) => (
              <li key={cap.fig} className={styles.cell} data-tone={cap.tone} data-index={i}>
                <div className={styles.shot} role="img" aria-label={`${cap.title} — ${cap.meta}`} />
                <p className={styles.caption}>
                  <span className={styles.fig}>{cap.fig}</span>
                  <span className={styles.capTitle}>{cap.title}</span>
                  <span className={styles.capMeta}>{cap.meta}</span>
                </p>
              </li>
            ))}
          </ul>

          <ol ref={railRef} className={styles.rail} aria-hidden="true">
            {STEPS.map((step) => (
              <li key={step} className={styles.step}>
                <span className={styles.stepDot} />
                <span className={styles.stepLabel}>{step}</span>
              </li>
            ))}
          </ol>

          <span className={`${styles.rule} ${styles.ruleTop}`} aria-hidden="true" />
          <span className={`${styles.rule} ${styles.ruleBottom}`} aria-hidden="true" />

          <p className={styles.hint} aria-hidden="true">
            Scroll to deconstruct
          </p>
        </div>
      </section>

      <section className={styles.collection} aria-label="The collection">
        <header className={styles.collectionHead}>
          <h2 className={styles.collectionTitle}>
            The <em>2025</em> collection
          </h2>
          <p className={styles.collectionLede}>
            Nine pieces, three materials, one belief: an object should reveal itself slowly, and then never need to
            explain itself again.
          </p>
        </header>

        <ul ref={collectionRef} className={styles.pieces}>
          {COLLECTION.map((piece) => (
            <li key={piece.name} className={styles.piece}>
              <div className={styles.pieceShot} data-tone={piece.tone} aria-hidden="true" />
              <div className={styles.pieceBody}>
                <p className={styles.pieceKind}>
                  {piece.kind} — {piece.year}
                </p>
                <h3 className={styles.pieceName}>{piece.name}</h3>
                <p className={styles.pieceNote}>{piece.note}</p>
              </div>
            </li>
          ))}
        </ul>

        <blockquote ref={quoteRef} className={styles.quote}>
          “We do not design furniture. We design the four seconds after someone sits down.”
          <cite>— Camille Morand, Atelier Morand</cite>
        </blockquote>

        <footer className={styles.foot}>
          <span>Atelier Morand · 14 rue de Turenne, Paris</span>
          <span>Hero_V02_EditorialScrollLock — ScrollTrigger pin + scrub · Lenis</span>
        </footer>
      </section>
    </>
  );
}
