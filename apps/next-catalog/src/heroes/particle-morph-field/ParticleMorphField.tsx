"use client";

/**
 * Hero_V03_ParticleMorphField
 * ───────────────────────────
 * Aesthetic : Immersive WebGL-First
 * Stack     : Next.js · React Three Fiber · Drei · Three.js · hand-written GLSL · GSAP
 *
 * What actually happens
 *  1. 30k GPU points (budgeted per device tier) morph torus → helix → sphere as the page scrolls;
 *     the vertex shader blends the lattices, so the CPU only writes five uniforms per frame.
 *  2. The pointer dents the field with springy inertia — a radial inverse-square displacement that
 *     also lifts points toward the camera.
 *  3. A custom ripple cursor replaces the system pointer: three lagging rings (each with a different
 *     damping constant) trail the true cursor, and a click sends a shockwave through the field.
 *  4. A live telemetry panel reports FPS, point count and the quality tier — this is a learning tool.
 *
 * Reduced motion: the scene renders a single composed helix frame, the cursor is the system pointer,
 * and the copy is set statically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { deviceProfile, clamp, damp, type DeviceProfile } from "@catalog/shared";
import type { SceneState } from "./ParticleScene";
import styles from "./particle-morph-field.module.css";

const ParticleScene = dynamic(() => import("./ParticleScene"), { ssr: false });

const STAGES = [
  { key: "TORUS", note: "the resting form — continuous, closed, calm" },
  { key: "HELIX", note: "the unfold — information becoming structure" },
  { key: "SPHERE", note: "the settle — density without weight" },
];

const NOTES = [
  {
    n: "01",
    title: "Morph on the GPU",
    body: "Three lattices are baked as vertex attributes and blended inside the shader, so a 30k-point transition costs one uniform write instead of a buffer upload.",
  },
  {
    n: "02",
    title: "Pointer as a force",
    body: "The cursor is not a highlight — it is an inverse-square displacement field with damping, which is why the cloud leans, dents and recovers the way a fluid would.",
  },
  {
    n: "03",
    title: "Budgeted beauty",
    body: "Point counts, DPR and shader octaves are chosen from the device tier at mount, and drei's performance monitor steps the pixel ratio down if frames start slipping.",
  },
];

export default function ParticleMorphField() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const cursorLayerRef = useRef<HTMLDivElement | null>(null);
  const ringRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [stage, setStage] = useState(0);
  const [stats, setStats] = useState({ fps: 60, points: 0, tier: "high" });

  const progressRef = useRef(0);
  const morphRef = useRef(0);
  const interactiveRef = useRef(true);

  /* ---------------------------------------------------------------- device profile */
  useEffect(() => {
    const p = deviceProfile();
    setProfile(p);
    interactiveRef.current = !p.reducedMotion && !p.coarsePointer;
    const initialProgress = p.reducedMotion ? 0.35 : 0;
    progressRef.current = initialProgress;
    morphRef.current = p.reducedMotion ? 1.35 : 0;
    setStage(p.reducedMotion ? 1 : 0);
  }, []);

  /* ------------------------------------------------------------------ scroll drive */
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? clamp(window.scrollY / max) : 0;
      progressRef.current = p;
      // 0 → 1 over the first 60% of the route, then 1 → 2 over the rest: two full morphs.
      morphRef.current = clamp(p / 0.6) * 1 + clamp((p - 0.6) / 0.4);
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
  }, [profile]);

  /* ----------------------------------------------------------------- ripple cursor */
  useEffect(() => {
    if (!profile || profile.reducedMotion || profile.coarsePointer) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    const target = { x: window.innerWidth / 2, y: window.innerHeight / 2, down: 0 };
    const state = [
      { x: target.x, y: target.y, lambda: 16 },
      { x: target.x, y: target.y, lambda: 8 },
      { x: target.x, y: target.y, lambda: 4 },
    ];
    let raf = 0;
    let last = performance.now();

    // Visibility is toggled through the DOM instead of React state: a pointermove every few
    // milliseconds must never trigger a re-render of the whole hero.
    const onMove = (event: PointerEvent) => {
      target.x = event.clientX;
      target.y = event.clientY;
      if (cursorLayerRef.current) cursorLayerRef.current.dataset.active = "1";
    };
    const onLeave = () => {
      if (cursorLayerRef.current) cursorLayerRef.current.dataset.active = "0";
    };
    const onDown = () => {
      target.down = 1;
      // A click pushes a shockwave through the point field (scene listens for this event).
      window.dispatchEvent(new CustomEvent("catalog:ripple", { detail: { x: target.x, y: target.y } }));
    };
    const onUp = () => {
      target.down = 0;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      state.forEach((ring, i) => {
        ring.x = damp(ring.x, target.x, ring.lambda, dt);
        ring.y = damp(ring.y, target.y, ring.lambda, dt);
        const node = ringRefs.current[i];
        if (node) {
          const scale = 1 + i * 0.42 + target.down * (0.3 - i * 0.06);
          node.style.transform = `translate3d(${ring.x}px, ${ring.y}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
          node.style.opacity = String(clamp(0.55 - i * 0.13 + target.down * 0.2, 0.08, 1));
        }
      });
      if (cursor) {
        cursor.style.transform = `translate3d(${state[0].x}px, ${state[0].y}px, 0) translate(-50%, -50%) scale(${(1 + target.down * 0.6).toFixed(3)})`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [profile]);

  const handleStats = useCallback((next: { fps: number; points: number; tier: string }) => {
    setStats(next);
  }, []);

  const handleStage = useCallback((next: number) => setStage(next), []);

  /**
   * A live view object, not a snapshot: the scene reads these on every frame, so nothing here
   * may become a stale closure. Getters keep React out of the animation loop entirely.
   */
  const sceneState = useMemo<SceneState>(
    () => ({
      get morph() {
        return morphRef.current;
      },
      get progress() {
        return progressRef.current;
      },
      get interactive() {
        return interactiveRef.current;
      },
      onStats: handleStats,
      onStageChange: handleStage,
    }),
    [handleStage, handleStats],
  );

  const tierLabel = profile?.tier ?? "—";
  const showCursor = !!profile && !profile.reducedMotion && !profile.coarsePointer;

  return (
    <div ref={rootRef} className={styles.root} data-stage={stage}>
      {/* --------------------------------------------------------------- WebGL layer */}
      <div className={styles.canvasLayer} aria-hidden="true">
        {profile ? <ParticleScene state={sceneState} profile={profile} /> : <div className={styles.canvasFallback} />}
        <div className={styles.vignette} />
        <div className={styles.grid} />
      </div>

      {/* ------------------------------------------------------------------ content */}
      <section className={styles.hero} aria-label="Particle morph field hero">
        <p className={styles.eyebrow}>
          Field studies <span aria-hidden="true">/</span> {stats.points ? stats.points.toLocaleString() : "30,000"} points
          <span aria-hidden="true">/</span> GPU morph
        </p>

        {/* The trailing space keeps the accessible text a real sentence: without it the DOM
            string concatenates across the <br> into "a rumour" → "arumour". */}
        <h1 className={styles.title}>
          Every form is a{" "}
          <br />
          <em>rumour</em> of the next.
        </h1>

        <p className={styles.lede}>
          Scroll and the field re-forms: a torus unfolding into a helix, a helix settling into a sphere. Move the
          pointer and it bends around you. Nothing here is a video — it is all one vertex shader and your input.
        </p>

        <div className={styles.stageRow} role="list" aria-label="Morph stages">
          {STAGES.map((s, i) => (
            <div key={s.key} className={styles.stageItem} role="listitem" aria-current={stage === i ? "step" : undefined}>
              <span className={styles.stageIndex}>{String(i + 1).padStart(2, "0")}</span>
              <span className={styles.stageKey}>{s.key}</span>
              <span className={styles.stageNote}>{s.note}</span>
            </div>
          ))}
        </div>

        <div className={styles.scrollHint} aria-hidden="true">
          <span className={styles.scrollHintLine} />
          scroll to morph
        </div>
      </section>

      {/* --------------------------------------------------------------- telemetry */}
      <aside className={styles.telemetry} aria-label="Live render telemetry">
        <p className={styles.telemetryTitle}>render telemetry</p>
        <dl className={styles.telemetryList}>
          <div>
            <dt>fps</dt>
            <dd data-alert={stats.fps < 45 ? "true" : "false"}>{stats.fps.toFixed(0).padStart(2, "0")}</dd>
          </div>
          <div>
            <dt>points</dt>
            <dd>{stats.points ? `${(stats.points / 1000).toFixed(stats.points >= 10000 ? 0 : 1)}k` : "—"}</dd>
          </div>
          <div>
            <dt>tier</dt>
            <dd>{tierLabel}</dd>
          </div>
          <div>
            <dt>stage</dt>
            <dd>{STAGES[stage].key}</dd>
          </div>
        </dl>
        <p className={styles.telemetryNote}>
          Counts adapt to the device at mount; drei steps DPR down if frame times slip.
        </p>
      </aside>

      {/* ------------------------------------------------------------ scroll runways */}
      <section className={styles.notes} aria-label="How this variation works">
        {NOTES.map((note) => (
          <article key={note.n} className={styles.note}>
            <span className={styles.noteNum}>{note.n}</span>
            <h2 className={styles.noteTitle}>{note.title}</h2>
            <p className={styles.noteBody}>{note.body}</p>
          </article>
        ))}
      </section>

      <section className={styles.outro} aria-label="Outro">
        <h2 className={styles.outroTitle}>
          The field keeps its <em>composure</em> — you keep the controls.
        </h2>
        <p className={styles.outroNote}>
          Hero_V03_ParticleMorphField — React Three Fiber · Drei · custom GLSL points shader · GSAP-quality damping
        </p>
      </section>

      {/* ----------------------------------------------------------- custom cursor */}
      {showCursor ? (
        <div className={styles.cursorLayer} ref={cursorLayerRef} data-active="0" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={styles.cursorRing}
              ref={(node) => {
                ringRefs.current[i] = node;
              }}
            />
          ))}
          <span className={styles.cursorDot} ref={cursorRef} />
        </div>
      ) : null}
    </div>
  );
}
