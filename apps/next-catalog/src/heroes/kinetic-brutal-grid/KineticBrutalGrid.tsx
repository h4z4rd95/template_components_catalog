"use client";

/**
 * Hero_V01_KineticBrutalGrid
 * ──────────────────────────
 * Aesthetic : Kinetic Typography · Neo-Brutalism
 * Stack     : Next.js · GSAP timeline + ScrollTrigger + Observer · shared split engine · CSS Grid
 *
 * What actually happens
 *  1. On mount a GSAP timeline punches ~14 letter tiles up from the baseline, hairline grid included,
 *     then the rail, spec sheet and CTA land in sequence.
 *  2. The banded marquee runs forever and its `timeScale` is driven by real scroll velocity, so
 *     flicking the page makes the tape scream and settling makes it purr.
 *  3. Scrolling skews the whole board and scatters the letters vertically (scrubbed).
 *  4. Observer tracks the pointer: letters physically recoil from the cursor and spring back —
 *     the headline behaves like a physical object, not text.
 *
 * Reduced motion: the composition renders fully composed and static; only the marquee is dropped.
 */
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Observer } from "gsap/Observer";
import { splitText, clamp, damp } from "@catalog/shared";
import styles from "./kinetic-brutal-grid.module.css";

const TAPE = [
  "BRUTAL BY DESIGN",
  "✳",
  "KINETIC TYPE",
  "✳",
  "RAW GRID",
  "✳",
  "DUTCH DIRECTNESS",
  "✳",
  "NO SOFT EDGES",
  "✳",
];

const SPEC = [
  { label: "Intro", value: 9, unit: "00ms" },
  { label: "Stagger", value: 24, unit: "ms" },
  { label: "Skew scrub", value: 18, unit: "deg" },
  { label: "Tiles", value: 13, unit: "unit" },
];

const CAPABILITIES = [
  { n: "01", title: "Kinetic type systems", note: "Type that behaves like matter: mass, recoil, rhythm." },
  { n: "02", title: "Brutal grid architecture", note: "Raw structure first — every rule visible on purpose." },
  { n: "03", title: "Motion specifications", note: "We hand clients the easing table, not just the video." },
  { n: "04", title: "Design engineering", note: "The prototype is the deliverable. Production-ready on day one." },
  { n: "05", title: "Art direction", note: "One idea, executed without negotiation until it lands." },
  { n: "06", title: "Performance budgets", note: "60fps on a mid-range Android or we keep working." },
];

export default function KineticBrutalGrid() {
  const heroRef = useRef<HTMLElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const tapeRef = useRef<HTMLDivElement | null>(null);
  const specRef = useRef<HTMLUListElement | null>(null);
  const asideRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLDivElement | null>(null);
  const tapeSectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const headline = headlineRef.current;
    const board = boardRef.current;
    const tape = tapeRef.current;
    if (!headline || !board || !tape) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ---- kinetic split -----------------------------------------------------
    const split = splitText(headline, {
      by: "chars",
      className: styles.glyph,
      ariaText: "No soft edges.",
    });
    const glyphs = split.targets;

    gsap.registerPlugin(ScrollTrigger, Observer);

    const ctx = gsap.context(() => {
      const tapeItems = gsap.utils.toArray<HTMLElement>(`.${styles.tapeItem}`, tape);

      if (!reduced) {
        // ---- 1. the punch-in -------------------------------------------------
        const tl = gsap.timeline({ defaults: { ease: "power4.out" } });

        tl.set(glyphs, { yPercent: 118, rotate: 7, opacity: 0 })
          .to(glyphs, { yPercent: 0, rotate: 0, opacity: 1, duration: 0.9, stagger: 0.024 }, 0.15)
          .from(`.${styles.railItem}`, { yPercent: 120, opacity: 0, duration: 0.7, stagger: 0.05 }, 0.1)
          .from(asideRef.current, { xPercent: 8, opacity: 0, duration: 1, ease: "expo.out" }, 0.5)
          .from(specRef.current?.children ?? [], { y: 18, opacity: 0, duration: 0.6, stagger: 0.06 }, 0.62)
          .from(ctaRef.current, { y: 24, opacity: 0, duration: 0.8 }, 0.75)
          .from(
            `.${styles.rule}`,
            { scaleX: 0, transformOrigin: "0 50%", duration: 1.1, ease: "expo.inOut", stagger: 0.08 },
            0.05,
          );

        // ---- spec sheet numbers count up -------------------------------------
        gsap.utils.toArray<HTMLElement>(`.${styles.specValue}`, specRef.current).forEach((node) => {
          const target = Number(node.dataset.value ?? 0);
          const counter = { v: 0 };
          tl.to(
            counter,
            {
              v: target,
              duration: 1,
              ease: "power2.out",
              onUpdate: () => {
                node.textContent = String(Math.round(counter.v)).padStart(2, "0");
              },
            },
            0.7,
          );
        });

        // ---- 2. marquee: infinite, velocity-sensitive -------------------------
        const marquee = gsap.to(tape, { xPercent: -50, duration: 26, ease: "none", repeat: -1 });
        let timeScale = 1;
        let velocity = 0;

        ScrollTrigger.create({
          trigger: document.documentElement,
          start: "top top",
          end: "bottom bottom",
          onUpdate: (self) => {
            velocity = self.getVelocity();
          },
        });

        gsap.ticker.add(() => {
          const boost = clamp(Math.abs(velocity) / 900, 0, 5.5);
          velocity = damp(velocity, 0, 6, gsap.ticker.deltaRatio(60) / 60);
          const desired = (velocity < 0 ? -1 : 1) * (1 + boost);
          timeScale = damp(timeScale, desired, 4, gsap.ticker.deltaRatio(60) / 60);
          marquee.timeScale(timeScale);
        });
      }

      // ---- 3. scroll: the board skews, the letters scatter -------------------
      if (!reduced) {
        gsap.to(board, {
          rotate: -1.4,
          yPercent: -4,
          ease: "none",
          scrollTrigger: {
            trigger: heroRef.current,
            start: "top top",
            end: "bottom top",
            scrub: 0.7,
          },
        });

        gsap.to(glyphs, {
          yPercent: (i: number) => ((i % 3) - 1) * 26,
          opacity: 0.62,
          stagger: { each: 0.012, from: "random" },
          ease: "power1.inOut",
          scrollTrigger: {
            trigger: heroRef.current,
            start: "top top",
            end: "bottom top",
            scrub: 1,
          },
        });

        // capability tiles arrive in batches as the tape section scrolls in
        gsap.set(`.${styles.capability}`, { y: 34, opacity: 0 });
        ScrollTrigger.batch(`.${styles.capability}`, {
          start: "top 88%",
          onEnter: (batch) =>
            gsap.to(batch, { y: 0, opacity: 1, duration: 0.75, ease: "expo.out", stagger: 0.07 }),
          once: true,
        });

        gsap.from(tapeSectionRef.current, {
          rotate: 1.2,
          ease: "none",
          scrollTrigger: {
            trigger: tapeSectionRef.current,
            start: "top bottom",
            end: "top center",
            scrub: true,
          },
        });
      }

      // ---- 4. Observer: the headline recoils from the pointer ----------------
      if (!reduced && !window.matchMedia("(pointer: coarse)").matches) {
        let lastRun = 0;
        const RADIUS = 190;

        const springBack = () => {
          gsap.to(glyphs, {
            x: 0,
            y: 0,
            rotate: 0,
            duration: 1.2,
            ease: "elastic.out(1, 0.6)",
            stagger: 0.012,
          });
        };

        // If the pointer rests, the letters settle home on their own.
        const settle = gsap.delayedCall(1.6, springBack);

        const recoil = (clientX: number, clientY: number, deltaX: number, deltaY: number) => {
          const now = performance.now();
          if (now - lastRun < 32) return; // ~2 frames between passes: cheap and smooth
          lastRun = now;

          glyphs.forEach((glyph) => {
            const rect = glyph.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = cx - clientX;
            const dy = cy - clientY;
            const dist = Math.hypot(dx, dy);
            if (dist > RADIUS) return;
            const force = (1 - dist / RADIUS) ** 2;
            gsap.to(glyph, {
              x: dx * force * 0.42 + deltaX * force * 2.4,
              y: dy * force * 0.42 + deltaY * force * 2.4,
              rotate: force * (dx > 0 ? 6 : -6),
              duration: 0.55,
              ease: "power3.out",
              overwrite: "auto",
            });
          });
        };

        const observer = Observer.create({
          target: window,
          type: "pointer",
          onMove: (self) => {
            // Observer types x/y as optional (they are absent for non-pointer event types).
            const { x, y, deltaX = 0, deltaY = 0 } = self;
            if (x === undefined || y === undefined) return;
            recoil(x, y, deltaX, deltaY);
            settle.restart(true);
          },
          onHoverEnd: springBack,
        });

        return () => {
          observer.kill();
          gsap.killTweensOf(glyphs);
        };
      }
    }, heroRef);

    // `split.revert()` must run after the context to avoid orphan <span>s in the DOM.
    return () => {
      ctx.revert();
      split.revert();
    };
  }, []);

  return (
    <>
      <section ref={heroRef} className={styles.hero} aria-label="No soft edges — studio hero">
        <div className={styles.topbar}>
          <span className={styles.railItem}>Studio Härt</span>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.railItem}>Est. 2014 · Rotterdam</span>
          <span className={styles.rule} aria-hidden="true" />
          <span className={styles.railItem}>52.3676° N</span>
        </div>

        <div className={styles.board} ref={boardRef}>
          <div className={styles.boardGrid}>
            <h1 ref={headlineRef} className={styles.headline}>
              {"NO\nSOFT\nEDGES."}
            </h1>

            <div className={styles.aside} ref={asideRef}>
              <p className={styles.asideLead}>
                We build kinetic type systems for brands that refuse to sit still. Raw structure, engineered motion,
                zero decoration that cannot defend itself.
              </p>

              <ul className={styles.spec} ref={specRef}>
                {SPEC.map((item) => (
                  <li key={item.label} className={styles.specRow}>
                    <span className={styles.specLabel}>{item.label}</span>
                    <span className={styles.specValueWrap}>
                      <span className={styles.specValue} data-value={item.value}>
                        {String(item.value).padStart(2, "0")}
                      </span>
                      <span className={styles.specUnit}>{item.unit}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <div className={styles.cta} ref={ctaRef}>
                <a className={styles.ctaPrimary} href="#capabilities">
                  See the work
                  <span aria-hidden="true">↗</span>
                </a>
                <a className={styles.ctaGhost} href="#capabilities">
                  Motion spec (PDF)
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.tape} ref={tapeRef}>
            {[0, 1].map((group) => (
              <div className={styles.tapeGroup} key={group}>
                {TAPE.map((word, i) => (
                  <span key={`${group}-${i}`} className={styles.tapeItem} data-alt={i % 4 === 1 ? "true" : "false"}>
                    {word}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={tapeSectionRef} className={styles.tapeSection} id="capabilities" aria-label="Capabilities">
        <div className={styles.tapeHead}>
          <h2 className={styles.tapeTitle}>
            Structure first.
            <br />
            Then noise.
          </h2>
          <p className={styles.tapeLede}>
            Six disciplines, one grid, one motion language. Hover a letter above and it moves — that reflex is the
            whole practice in miniature.
          </p>
        </div>

        <ul className={styles.capabilities}>
          {CAPABILITIES.map((cap) => (
            <li key={cap.n} className={styles.capability}>
              <span className={styles.capNum}>{cap.n}</span>
              <h3 className={styles.capTitle}>{cap.title}</h3>
              <p className={styles.capNote}>{cap.note}</p>
            </li>
          ))}
        </ul>

        <footer className={styles.foot}>
          <span>© {new Date().getFullYear()} Studio Härt</span>
          <span className={styles.footMeta}>Hero_V01_KineticBrutalGrid — GSAP timeline · ScrollTrigger · Observer</span>
        </footer>
      </section>
    </>
  );
}
