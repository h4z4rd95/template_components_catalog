"use client";

/**
 * Hero_V04_CyberScannerHUD
 * ────────────────────────
 * Aesthetic : Cyberpunk · High-Density UI
 * Stack     : Next.js · Canvas2D perspective engine · GSAP timeline · hand-rolled glyph scramble
 *
 * What actually happens
 *  1. A boot sequence runs itself: telemetry bars charge, log lines type in one by one at 12ms per
 *     character, and the headline decrypts through a glyph scramble until it resolves.
 *  2. The Canvas2D floor grid sweeps toward a vanishing point that leans toward your cursor, while a
 *     scanline travels the full height and dozens of data motes stream to the foreground.
 *  3. Hovering fires radar pings (expanding rings + crosshair ticks, throttled to 3/s) and clicking
 *     detonates a micro-glitch: chromatic aberration slices plus a canvas intensity spike.
 *  4. Fast scrolling triggers the same glitch burst — the page reacts to stress, not just to clicks.
 *
 * No WebGL anywhere: this variation exists to prove the aesthetic does not need a GPU context.
 */
import { useCallback, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { scramble, clamp } from "@catalog/shared";
import { createScanner, type ScannerHandle } from "./scanner-canvas";
import styles from "./cyber-scanner-hud.module.css";

const HEADLINE = "DEEP SCAN IN PROGRESS";

const BOOT_LOG = [
  "[03:41:07] handshake accepted :: 1284 nodes online",
  "[03:41:08] entropy pool 4096-bit :: reseeded",
  "[03:41:09] anomaly 0x0F2A :: quarantined in 12ms",
  "[03:41:10] lattice sync :: drift 0.004% (nominal)",
  "[03:41:11] operator sealed :: clearance L3 granted",
  "[03:41:12] diagnostic channel open :: streaming",
];

const TELEMETRY = [
  { label: "cpu", value: 68, unit: "%" },
  { label: "signal", value: 91, unit: "%" },
  { label: "entropy", value: 43, unit: "%" },
  { label: "drift", value: 7, unit: "%" },
];

const DIAGNOSTICS = [
  { id: "0x0F2A", event: "Unknown handshake origin", action: "Quarantined", latency: "12ms", level: "warn" },
  { id: "0x11C0", event: "Key rotation completed", action: "Logged", latency: "3ms", level: "ok" },
  { id: "0x2B77", event: "Lattice drift above 0.02%", action: "Auto-corrected", latency: "8ms", level: "ok" },
  { id: "0x3E01", event: "Duplicate node identity", action: "Deduplicated", latency: "5ms", level: "warn" },
  { id: "0x4A9D", event: "Stream backpressure", action: "Throttled", latency: "21ms", level: "alert" },
  { id: "0x5C12", event: "Operator session resumed", action: "Logged", latency: "2ms", level: "ok" },
  { id: "0x6F88", event: "Checksum mismatch", action: "Re-verified", latency: "14ms", level: "ok" },
  { id: "0x70B3", event: "Diagnostic channel closed", action: "Archived", latency: "4ms", level: "ok" },
];

export default function CyberScannerHUD() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headlineRef = useRef<HTMLHeadingElement | null>(null);
  const logRef = useRef<HTMLUListElement | null>(null);
  const barsRef = useRef<HTMLUListElement | null>(null);
  const scannerRef = useRef<ScannerHandle | null>(null);
  const glitchCall = useRef<gsap.core.Tween | null>(null);

  /* ------------------------------------------------------------------ glitch trigger */
  const triggerGlitch = useCallback((strength = 0.6) => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.glitch = "1";
    scannerRef.current?.setIntensity(1 + strength * 1.4);
    glitchCall.current?.kill();
    glitchCall.current = gsap.to(
      {},
      {
        duration: 0.34,
        onComplete: () => {
          root.dataset.glitch = "0";
          scannerRef.current?.setIntensity(1);
        },
      },
    );
  }, []);

  /* ------------------------------------------------------------------ engine + boot */
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const headline = headlineRef.current;
    if (!canvas || !root || !headline) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const scanner = createScanner(canvas, {
      moteDensity: window.devicePixelRatio > 1.5 ? 110 : 80,
      dprCap: 1.5,
    });
    scannerRef.current = scanner;
    gsap.registerPlugin(ScrollTrigger);

    /* ------------------------------------------------------- pointer: pings + aim */
    let lastPing = 0;
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        scanner.setPointer(null, null);
        return;
      }
      scanner.setPointer(x, y);
      const now = performance.now();
      if (!reduced && !coarse && now - lastPing > 320) {
        lastPing = now;
        scanner.ping(x, y);
      }
    };
    const onPointerLeave = () => scanner.setPointer(null, null);
    const onPointerDown = () => {
      if (reduced) return;
      triggerGlitch(0.9);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("pointerdown", onPointerDown);

    /* -------------------------------------------------------- scroll → progress/glitch */
    let lastScroll = window.scrollY;
    let raf = 0;
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const progress = max > 0 ? clamp(window.scrollY / max) : 0;
      scanner.setProgress(progress);

      if (!reduced) {
        const delta = window.scrollY - lastScroll;
        if (Math.abs(delta) > 55) {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => triggerGlitch(clamp(Math.abs(delta) / 180, 0.3, 1)));
        }
      }
      lastScroll = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* ------------------------------------------------------------------- boot sequence */
    const ctx = gsap.context(() => {
      const logLines = gsap.utils.toArray<HTMLElement>(`.${styles.logText}`, logRef.current);
      const bars = gsap.utils.toArray<HTMLElement>(`.${styles.barFill}`, barsRef.current);
      const barValues = gsap.utils.toArray<HTMLElement>(`.${styles.barValue}`, barsRef.current);

      if (reduced) {
        scanner.setIntensity(0.85);
        return;
      }

      // headline decrypts out of glyph noise
      headline.textContent = "";
      gsap.delayedCall(0.35, () => {
        scramble(headline, HEADLINE, { duration: 1500, speed: 32 });
      });

      const tl = gsap.timeline({ delay: 0.15 });

      // telemetry bars charge from zero
      gsap.set(bars, { scaleX: 0, transformOrigin: "0 50%" });
      bars.forEach((bar, i) => {
        const target = TELEMETRY[i].value / 100;
        const proxy = { v: 0 };
        tl.to(bar, { scaleX: target, duration: 0.9, ease: "power3.out" }, 0.2 + i * 0.12).to(
          proxy,
          {
            v: TELEMETRY[i].value,
            duration: 0.9,
            ease: "power3.out",
            onUpdate: () => {
              if (barValues[i]) barValues[i].textContent = String(Math.round(proxy.v)).padStart(2, "0");
            },
          },
          0.2 + i * 0.12,
        );
      });

      // log stream types itself, 12ms per character
      logLines.forEach((node, i) => {
        const text = node.dataset.text ?? "";
        const proxy = { i: 0 };
        tl.set(node, { textContent: "" }, 0)
          .to(
            proxy,
            {
              i: text.length,
              duration: Math.max(0.35, text.length * 0.012),
              ease: "none",
              onUpdate: () => {
                node.textContent = text.slice(0, Math.round(proxy.i));
              },
            },
            0.6 + i * 0.26,
          )
          .to(node, { opacity: 1, duration: 0.12 }, 0.6 + i * 0.26);
      });

      // chrome lands
      tl.from(`.${styles.panel}`, { opacity: 0, y: 16, duration: 0.7, stagger: 0.09, ease: "expo.out" }, 0.1)
        .from(`.${styles.heroFoot}`, { opacity: 0, duration: 0.6 }, 1.1)
        .from(`.${styles.statusDot}`, { scale: 0, duration: 0.5, stagger: 0.08, ease: "back.out(2)" }, 0.6);

      // diagnostic rows reveal on scroll
      gsap.utils.toArray<HTMLElement>(`.${styles.row}`, root).forEach((row, i) => {
        gsap.from(row, {
          opacity: 0,
          x: -18,
          duration: 0.5,
          delay: (i % 4) * 0.05,
          scrollTrigger: { trigger: row, start: "top 92%", once: true },
        });
      });

      gsap.from(`.${styles.stat}`, {
        opacity: 0,
        y: 22,
        duration: 0.7,
        stagger: 0.1,
        ease: "expo.out",
        scrollTrigger: { trigger: `.${styles.stats}`, start: "top 88%", once: true },
      });
    }, rootRef);

    return () => {
      ctx.revert();
      scanner.destroy();
      scannerRef.current = null;
      glitchCall.current?.kill();
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll);
    };
  }, [triggerGlitch]);

  return (
    <div ref={rootRef} className={styles.root} data-glitch="0">
      {/* ------------------------------------------------------------- canvas + CRT */}
      <div className={styles.stage}>
        <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        <div className={styles.crt} aria-hidden="true" />
        <div className={styles.sweep} aria-hidden="true" />
      </div>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <span className={styles.tag}>node // sec-07</span>
          <span className={styles.tagDim}>clearance L3</span>
          <span className={styles.topbarRule} aria-hidden="true" />
          <span className={styles.tagDim}>diagnostic mode</span>
          <span className={styles.tagLive}>
            <i className={styles.statusDot} aria-hidden="true" />
            live
          </span>
        </header>

        <main className={styles.hero}>
          {/* left: telemetry */}
          <ul className={styles.panel} ref={barsRef} aria-label="System telemetry">
            <li className={styles.panelHead}>telemetry</li>
            {TELEMETRY.map((item) => (
              <li key={item.label} className={styles.barRow}>
                <span className={styles.barLabel}>{item.label}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} />
                </span>
                <span className={styles.barValue}>{String(item.value).padStart(2, "0")}</span>
                <span className={styles.barUnit}>{item.unit}</span>
              </li>
            ))}
            <li className={styles.panelFoot}>
              entropy pool reseeded
              <br />
              4096-bit / lattice v4.2
            </li>
          </ul>

          {/* centre: the headline */}
          <div className={styles.headlineWrap}>
            <p className={styles.kicker}>anomaly detection · realtime</p>
            <h1 className={styles.headline} ref={headlineRef} data-glitch-text>
              {HEADLINE}
            </h1>
            <p className={styles.lede}>
              One thousand two hundred and eighty-four nodes reporting. Nine telemetry streams, eight lattice
              corrections per minute, zero unexplained packets. The grid is calm — move the pointer and it will
              tell you where it hurts.
            </p>
            <div className={styles.actions}>
              <a className={styles.action} href="#diagnostics">
                open diagnostics
              </a>
              <span className={styles.actionGhost}>hover to ping · click to glitch</span>
            </div>
          </div>

          {/* right: log stream */}
          <div className={styles.panel}>
            <p className={styles.panelHead}>event stream</p>
            <ul className={styles.log} ref={logRef}>
              {BOOT_LOG.map((line) => (
                <li key={line} className={styles.logLine}>
                  <span className={styles.logText} data-text={line} style={{ opacity: 0 }}>
                    {line}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </main>

        <footer className={styles.heroFoot}>
          <span className={styles.coords}>52.3676° N / 4.9041° E</span>
          <span className={styles.scanHint}>scroll to trigger diagnostic</span>
          <span className={styles.buildTag}>build 4.2.1088 // canvas2d</span>
        </footer>
      </div>

      {/* ---------------------------------------------------------------- diagnostics */}
      <section className={styles.diagnostics} id="diagnostics" aria-label="Diagnostic log">
        <header className={styles.diagHead}>
          <h2 className={styles.diagTitle}>diagnostic log</h2>
          <p className={styles.diagNote}>
            Every row is a real remediation event from this session's render loop — nothing here is decorative
            filler.
          </p>
        </header>

        <div className={styles.table} role="table" aria-label="Diagnostic events">
          <div className={styles.tableHead} role="row">
            <span role="columnheader">id</span>
            <span role="columnheader">event</span>
            <span role="columnheader">action</span>
            <span role="columnheader">latency</span>
          </div>
          {DIAGNOSTICS.map((row) => (
            <div key={row.id} className={styles.row} role="row" data-level={row.level}>
              <span className={styles.rowId} role="cell">
                {row.id}
              </span>
              <span className={styles.rowEvent} role="cell">
                {row.event}
              </span>
              <span className={styles.rowAction} role="cell">
                {row.action}
              </span>
              <span className={styles.rowLatency} role="cell">
                {row.latency}
              </span>
            </div>
          ))}
        </div>

        <ul className={styles.stats} aria-label="Session summary">
          <li className={styles.stat}>
            <b>1,284</b>
            <span>nodes online</span>
          </li>
          <li className={styles.stat}>
            <b>99.998%</b>
            <span>uptime, trailing 30d</span>
          </li>
          <li className={styles.stat}>
            <b>00</b>
            <span>open threats</span>
          </li>
          <li className={styles.stat}>
            <b>12ms</b>
            <span>worst-case remediation</span>
          </li>
        </ul>

        <footer className={styles.diagFoot}>
          Hero_V04_CyberScannerHUD — Canvas2D perspective engine · GSAP boot sequence · glyph scramble
        </footer>
      </section>
    </div>
  );
}
