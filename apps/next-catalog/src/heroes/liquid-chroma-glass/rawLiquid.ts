/**
 * rawLiquid.ts — a dependency-free WebGL2 engine for one fullscreen fragment shader.
 *
 * Why hand-rolled instead of Three/R3F? Because this variation's whole claim is "raw GPU technique":
 * one program, one VAO, three vertices, no scene graph, no matrix math on the CPU. The entire visual
 * comes from `LIQUID_FRAG` in @catalog/shared (domain-warped fBm + pointer advection).
 *
 * The class owns: context creation, resize with DPR clamping, the rAF loop, uniform plumbing,
 * visibility/intersection pausing, context-loss recovery and teardown. Nothing leaks.
 */
import { glsl, clamp, damp, deviceProfile } from "@catalog/shared";

export interface LiquidHandle {
  destroy(): void;
  /** Pointer in CSS px (null when it leaves), used for the advection vector. */
  setPointer(x: number | null, y: number | null): void;
  /** 0..1 route progress → zooms the field and lifts the palette. */
  setProgress(value: number): void;
  /** 0..1 transient pulse (used on click). */
  pulse(strength?: number): void;
  /** Reports whether the GPU path is live (false → the CSS fallback should show). */
  readonly ok: boolean;
}

export interface LiquidPalette {
  c1: [number, number, number];
  c2: [number, number, number];
  c3: [number, number, number];
  c4: [number, number, number];
  c5: [number, number, number];
}

export const DEFAULT_PALETTE: LiquidPalette = {
  c1: [0.02, 0.01, 0.14], // deep indigo
  c2: [0.34, 0.06, 0.52], // violet
  c3: [0.98, 0.31, 0.85], // magenta
  c4: [0.36, 0.62, 1.0], // azure
  c5: [0.76, 0.98, 0.93], // mint highlight
};

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.replace("#", "");
  const n = Number.parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const paletteFrom = (hexes: [string, string, string, string, string]): LiquidPalette => ({
  c1: hexToRgb(hexes[0]),
  c2: hexToRgb(hexes[1]),
  c3: hexToRgb(hexes[2]),
  c4: hexToRgb(hexes[3]),
  c5: hexToRgb(hexes[4]),
});

export function createLiquid(
  canvas: HTMLCanvasElement,
  { palette = DEFAULT_PALETTE, intensity = 1 }: { palette?: LiquidPalette; intensity?: number } = {},
): LiquidHandle {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    return {
      destroy: () => {},
      setPointer: () => {},
      setProgress: () => {},
      pulse: () => {},
      ok: false,
    };
  }

  const tier = deviceProfile().tier;
  const dprCap = tier === "low" ? 1 : tier === "medium" ? 1.25 : tier === "high" ? 1.6 : 1.85;

  /* ------------------------------------------------------------------ program */
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("shader allocation failed");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`shader compile error: ${log}`);
    }
    return shader;
  };

  let program: WebGLProgram;
  try {
    const vert = compile(gl.VERTEX_SHADER, glsl.LIQUID_VERT);
    const frag = compile(gl.FRAGMENT_SHADER, glsl.LIQUID_FRAG);
    program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
    }
  } catch (error) {
    // Deliberately quiet: an unavailable GPU is an expected environment, not an application fault,
    // and the CSS mesh-gradient fallback is a designed state (see LiquidChromaGlass), not an error.
    if (process.env.NODE_ENV === "development") {
      console.info("[liquid-chroma-glass] using the CSS gradient fallback:", error);
    }
    return { destroy: () => {}, setPointer: () => {}, setProgress: () => {}, pulse: () => {}, ok: false };
  }

  gl.useProgram(program);

  /* --------------------------------------------------------------- uniform lookup */
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    time: uniform("uTime"),
    resolution: uniform("uResolution"),
    pointer: uniform("uPointer"),
    velocity: uniform("uVelocity"),
    scroll: uniform("uScroll"),
    intensity: uniform("uIntensity"),
    bass: uniform("uBass"),
    c1: uniform("uC1"),
    c2: uniform("uC2"),
    c3: uniform("uC3"),
    c4: uniform("uC4"),
    c5: uniform("uC5"),
  };

  gl.uniform3fv(u.c1, palette.c1);
  gl.uniform3fv(u.c2, palette.c2);
  gl.uniform3fv(u.c3, palette.c3);
  gl.uniform3fv(u.c4, palette.c4);
  gl.uniform3fv(u.c5, palette.c5);

  // A single VAO with no attributes: the vertex shader builds its triangle from gl_VertexID.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  /* ------------------------------------------------------------------ state */
  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let alive = true;
  let visible = true;

  const pointer = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, active: 0, tActive: 0 };
  const velocity = { x: 0, y: 0, lastX: 0.5, lastY: 0.5, lastTime: performance.now() };
  let progress = 0;
  let progressTarget = 0;
  let pulseValue = 0;
  let masterIntensity = intensity;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    width = Math.max(1, Math.floor(rect.width * dpr));
    height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  resize();
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  window.addEventListener("resize", resize);

  // Pause the loop when the variation is off-screen or the tab is hidden: free battery, no jank.
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
        })
      : null;
  io?.observe(canvas);
  const onVisibility = () => {
    visible = !document.hidden;
  };
  document.addEventListener("visibilitychange", onVisibility);

  /* ------------------------------------------------------------------ loop */
  let last = performance.now();
  const frame = (now: number) => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    if (visible) {
      // smoothed pointer + inertia vector (uv/sec), the soul of the effect
      pointer.x = damp(pointer.x, pointer.tx, 7, dt);
      pointer.y = damp(pointer.y, pointer.ty, 7, dt);
      pointer.active = damp(pointer.active, pointer.tActive, 4, dt);
      const vx = ((pointer.x - velocity.lastX) / Math.max(dt, 1e-4)) * 0.012;
      const vy = ((pointer.y - velocity.lastY) / Math.max(dt, 1e-4)) * 0.012;
      velocity.x = damp(velocity.x, clamp(vx, -0.6, 0.6), 5, dt);
      velocity.y = damp(velocity.y, clamp(vy, -0.6, 0.6), 5, dt);
      velocity.lastX = pointer.x;
      velocity.lastY = pointer.y;

      progress = damp(progress, progressTarget, 3, dt);
      pulseValue = damp(pulseValue, 0, 1.6, dt);

      gl.uniform1f(u.time, now / 1000);
      gl.uniform2f(u.resolution, width, height);
      gl.uniform2f(u.pointer, pointer.x, pointer.y);
      gl.uniform2f(u.velocity, velocity.x + pulseValue * 0.35, velocity.y);
      gl.uniform1f(u.scroll, progress);
      gl.uniform1f(u.intensity, masterIntensity * (0.9 + pointer.active * 0.1));
      gl.uniform1f(u.bass, pulseValue);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  /* ------------------------------------------------------------------ context loss */
  const onContextLost = (event: Event) => {
    event.preventDefault();
    alive = false;
    cancelAnimationFrame(raf);
  };
  canvas.addEventListener("webglcontextlost", onContextLost);

  return {
    ok: true,
    setPointer(x, y) {
      if (x === null || y === null) {
        pointer.tActive = 0;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      pointer.tx = clamp((x - rect.left) / Math.max(rect.width, 1));
      pointer.ty = clamp(1 - (y - rect.top) / Math.max(rect.height, 1));
      pointer.tActive = 1;
    },
    setProgress(value) {
      progressTarget = clamp(value);
    },
    pulse(strength = 1) {
      pulseValue = clamp(pulseValue + strength, 0, 2);
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      gl.bindVertexArray(null);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
