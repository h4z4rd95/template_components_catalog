"use client";

/**
 * ParticleScene — the R3F half of Hero_V03_ParticleMorphField.
 *
 * Everything expensive happens on the GPU: three lattices (torus / helix / sphere) are baked once
 * as vertex attributes and blended inside the vertex shader from a single `uMorph` uniform. The CPU
 * per frame writes only: time, morph, pointer, scroll, fade — five uniforms, no attribute uploads.
 *
 * Drei earns its place here: <PerformanceMonitor> watches real frame times and drops DPR before the
 * visitor ever notices a stutter, and <AdaptiveDpr> applies it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import {
  deviceProfile,
  helixPoints,
  randomScalars,
  spherePoints,
  torusPoints,
  glsl,
  clamp,
  damp,
  type DeviceProfile,
} from "@catalog/shared";

export interface SceneState {
  /** 0 → 1 → 2 continuous morph target, driven by page scroll. */
  morph: number;
  /** 0..1 scroll progress of the whole route. */
  progress: number;
  /** Toggles interaction off for reduced-motion visitors. */
  interactive: boolean;
  /** Live stats pushed back up for the telemetry panel. */
  onStats?: (stats: { fps: number; points: number; tier: string }) => void;
  /** Notifies the overlay which lattice is currently dominant. */
  onStageChange?: (stage: number) => void;
}

const STAGE_EDGES = [0.5, 1.5];

function ParticleCloud({ state, profile }: { state: SceneState; profile: DeviceProfile }) {
  const groupRef = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const { viewport } = useThree();

  const count = profile.particles;

  /* ------------------------------------------------------------------ geometry */
  const geometry = useMemo(() => {
    const base = torusPoints(count, { seed: 11 });
    const helix = helixPoints(count, { seed: 23 });
    const sphere = spherePoints(count, { seed: 37 });
    const scales = randomScalars(count, 0.35, 1, 71);
    const seeds = randomScalars(count, 0, 1, 97);

    const geo = new THREE.BufferGeometry();
    // `position` doubles as the base lattice so Three can still compute bounds & sorting.
    geo.setAttribute("position", new THREE.BufferAttribute(base, 3));
    geo.setAttribute("aBase", new THREE.BufferAttribute(base, 3));
    geo.setAttribute("aHelix", new THREE.BufferAttribute(helix, 3));
    geo.setAttribute("aSphere", new THREE.BufferAttribute(sphere, 3));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.computeBoundingSphere();
    return geo;
  }, [count]);

  /* ------------------------------------------------------------------ material */
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glsl.PARTICLE_VERT,
        fragmentShader: glsl.PARTICLE_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          // Seeded from the incoming state so a reduced-motion / `frameloop="demand"` render
          // still shows the composed frame instead of an un-animated first paint.
          uMorph: { value: state.morph },
          uPointer: { value: new THREE.Vector2(0, 0) },
          uPointerAmp: { value: 0 },
          uSize: { value: profile.mobile ? 2.1 : 1.55 },
          uDpr: { value: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, profile.dpr) },
          uTurbulence: { value: 0.17 },
          uScroll: { value: state.progress },
          uQuality: { value: profile.tier === "ultra" ? 2 : profile.tier === "high" ? 1.6 : 1 },
          uColorA: { value: new THREE.Color("#12236b") },
          uColorB: { value: new THREE.Color("#5b8cff") },
          uColorC: { value: new THREE.Color("#cdf4ff") },
          uOpacity: { value: 0.62 },
          uFade: { value: profile.reducedMotion ? 1 : 0 },
          uRipple: { value: new THREE.Vector3(0, 0, 0) },
          uRippleTime: { value: 10 },
        },
      }),
    // Material is created once per device profile; live values flow through the uniforms,
    // never through a re-instantiation (that would drop the GL program mid-scroll).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  /* ------------------------------------------------------------------ pointers */
  const pointer = useRef({ x: 0, y: 0, active: 0 });
  useEffect(() => {
    if (!state.interactive) return;
    const onMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -((event.clientY / window.innerHeight) * 2 - 1);
      pointer.current.active = 1;
    };
    const onLeave = () => {
      pointer.current.active = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [state.interactive]);

  /* -------------------------------------------------------------- click shockwave */
  const ripple = useRef({ x: 0, y: 0, strength: 0, time: 10 });
  useEffect(() => {
    if (!state.interactive) return;
    const onRipple = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail;
      if (!detail) return;
      // screen px → world units at the z=0 plane
      ripple.current.x = (detail.x / window.innerWidth) * 2 * (viewport.width / 2) - viewport.width / 2;
      ripple.current.y = -((detail.y / window.innerHeight) * 2 * (viewport.height / 2) - viewport.height / 2);
      ripple.current.strength = 1;
      ripple.current.time = 0;
    };
    window.addEventListener("catalog:ripple", onRipple);
    return () => window.removeEventListener("catalog:ripple", onRipple);
  }, [state.interactive, viewport.height, viewport.width]);

  /* ------------------------------------------------------------------- animation */
  const anim = useRef({
    morph: state.morph,
    scroll: state.progress,
    ampX: 0,
    ampY: 0,
    amp: 0,
    stage: state.morph < STAGE_EDGES[0] ? 0 : state.morph < STAGE_EDGES[1] ? 1 : 2,
    fps: 60,
    frames: 0,
    last: performance.now(),
  });

  useFrame((_, delta) => {
    const u = material.uniforms;
    const a = anim.current;
    const dt = Math.min(delta, 1 / 30);

    a.morph = damp(a.morph, state.morph, 3.4, dt);
    a.scroll = damp(a.scroll, state.progress, 2.2, dt);

    // pointer → world space at the z=0 plane, then damped for inertia
    a.ampX = damp(a.ampX, pointer.current.x * (viewport.width / 2), 4.5, dt);
    a.ampY = damp(a.ampY, pointer.current.y * (viewport.height / 2), 4.5, dt);
    a.amp = damp(a.amp, pointer.current.active, 3, dt);

    u.uTime.value += dt;
    u.uMorph.value = a.morph;
    u.uScroll.value = a.scroll;
    u.uPointer.value.set(a.ampX, a.ampY);
    u.uPointerAmp.value = state.interactive ? a.amp : 0;
    u.uFade.value = damp(u.uFade.value as number, 1, 1.2, dt);
    u.uTurbulence.value = 0.12 + a.scroll * 0.12;

    // shockwave: advance its clock, retire it once the ring has left the volume
    const r = ripple.current;
    if (r.strength > 0.002) {
      r.time += dt;
      r.strength = damp(r.strength, 0, 1.1, dt);
      u.uRipple.value.set(r.x, r.y, r.strength);
      u.uRippleTime.value = r.time;
    } else if (r.strength !== 0) {
      r.strength = 0;
      u.uRipple.value.set(0, 0, 0);
    }

    if (groupRef.current) {
      groupRef.current.rotation.y += dt * (0.09 + a.scroll * 0.12);
      groupRef.current.rotation.x = damp(groupRef.current.rotation.x, -a.scroll * 0.32 + a.ampY * 0.02, 2, dt);
      groupRef.current.position.z = damp(groupRef.current.position.z, a.scroll * 0.9, 2, dt);
    }

    // stage announcements for the overlay (torus / helix / sphere)
    const stage = a.morph < STAGE_EDGES[0] ? 0 : a.morph < STAGE_EDGES[1] ? 1 : 2;
    if (stage !== a.stage) {
      a.stage = stage;
      state.onStageChange?.(stage);
    }

    // rolling FPS for the telemetry panel (throttled to ~2Hz)
    a.frames += 1;
    const now = performance.now();
    if (now - a.last > 500) {
      a.fps = (a.frames * 1000) / (now - a.last);
      a.frames = 0;
      a.last = now;
      state.onStats?.({ fps: a.fps, points: count, tier: profile.tier });
    }
  });

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

export default function ParticleScene({ state, profile }: { state: SceneState; profile: DeviceProfile }) {
  // drei's <PerformanceMonitor> walks this down when real frame times slip.
  const [dpr, setDpr] = useState(() => Math.min(profile.dpr, 1.6));

  return (
    <Canvas
      className="catalog-canvas"
      dpr={[1, dpr]}
      frameloop={profile.reducedMotion ? "demand" : "always"}
      camera={{ position: [0, 0, 4.9], fov: 42, near: 0.1, far: 60 }}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        stencil: false,
        depth: true,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.92;
      }}
    >
      <PerformanceMonitor
        onDecline={() => setDpr((current) => Math.max(0.85, Number((current - 0.25).toFixed(2))))}
      />
      <AdaptiveDpr pixelated />
      <ParticleCloud state={state} profile={profile} />
    </Canvas>
  );
}
