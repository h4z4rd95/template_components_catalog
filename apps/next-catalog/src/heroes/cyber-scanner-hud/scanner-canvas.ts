/**
 * scanner-canvas.ts — the Canvas2D engine behind Hero_V04_CyberScannerHUD.
 *
 * Deliberately *not* WebGL: this variation proves that a perspective grid, depth-fogged data motes,
 * a sweeping scanline and expanding radar pings are all achievable with a 2D context at 60fps —
 * which matters because it runs everywhere, including locked-down corporate machines.
 *
 * Everything is analytic (no geometry buffers): the floor grid is derived from a 1/z projection each
 * frame, motes are recycled in place, and pings are a fixed-size ring buffer. Nothing allocates inside
 * the render loop.
 */

export interface ScannerHandle {
  destroy(): void;
  /** Fires an expanding radar ping at CSS pixel coordinates. */
  ping(x: number, y: number): void;
  /** 0..1 page progress — drives grid speed, mote energy and scanline frequency. */
  setProgress(value: number): void;
  /** Pointer position in CSS pixels, or null when the pointer leaves. */
  setPointer(x: number | null, y: number | null): void;
  /** Manual intensity multiplier (used by the glitch burst: 0.4 → 2.2). */
  setIntensity(value: number): void;
}

export interface ScannerOptions {
  accent?: string;
  accentAlt?: string;
  grid?: string;
  moteDensity?: number;
  dprCap?: number;
}

interface Mote {
  x: number;
  z: number;
  speed: number;
  size: number;
}

interface Ping {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

export function createScanner(canvas: HTMLCanvasElement, options: ScannerOptions = {}): ScannerHandle {
  const ctx = canvas.getContext("2d", { alpha: true });
  const opts = {
    accent: options.accent ?? "#00f0a8",
    accentAlt: options.accentAlt ?? "#ff2e9a",
    grid: options.grid ?? "rgba(0, 240, 168, 0.32)",
    moteDensity: options.moteDensity ?? 90,
    dprCap: options.dprCap ?? 1.5,
  };

  if (!ctx) {
    return {
      destroy: () => {},
      ping: () => {},
      setProgress: () => {},
      setPointer: () => {},
      setIntensity: () => {},
    };
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let alive = true;

  let progress = 0;
  let intensity = 1;
  let pointerX: number | null = null;
  let pointerY: number | null = null;

  const motes: Mote[] = [];
  const pings: Ping[] = [];
  const PING_LIMIT = 6;

  const random = (a: number, b: number) => a + Math.random() * (b - a);

  const spawnMotes = () => {
    const target = Math.round(opts.moteDensity * (window.devicePixelRatio > 1.5 ? 1 : 0.8));
    motes.length = 0;
    for (let i = 0; i < target; i += 1) {
      motes.push({
        x: random(-1, 1),
        z: random(0.08, 1),
        speed: random(0.05, 0.22),
        size: random(0.6, 2.1),
      });
    }
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, opts.dprCap);
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();
  spawnMotes();

  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener("resize", resize);

  /* ------------------------------------------------------------------ render loop */

  const drawGrid = (horizon: number, t: number) => {
    const { width: w, height: h } = { width, height };
    const speed = 0.16 + progress * 0.5 + (intensity - 1) * 0.3;

    // --- floor: horizontal rules at 1/z spacing, scrolled over time
    ctx.lineWidth = 1;
    const rows = 22;
    for (let i = 0; i < rows; i += 1) {
      const z = ((i + ((t * speed) % 1)) / rows) ** 1.7;
      const y = horizon + (h - horizon) * (z * 0.98);
      if (y < horizon + 0.5) continue;
      const alpha = 0.06 + z * 0.5 * (0.5 + intensity * 0.5);
      ctx.strokeStyle = `rgba(0, 240, 168, ${Math.min(0.65, alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // --- vanishing verticals
    const vanishX = w / 2 + (pointerX === null ? 0 : (pointerX - w / 2) * 0.12);
    const columns = 26;
    for (let i = 0; i <= columns; i += 1) {
      const k = i / columns - 0.5;
      const groundX = vanishX + k * w * 3.2;
      ctx.strokeStyle = `rgba(0, 240, 168, ${(0.05 + Math.abs(k) * 0.06) * (0.6 + intensity * 0.5)})`;
      ctx.beginPath();
      ctx.moveTo(vanishX, horizon);
      ctx.lineTo(groundX, h);
      ctx.stroke();
    }

    // --- horizon bloom
    const bloom = ctx.createLinearGradient(0, horizon - 26, 0, horizon + 26);
    bloom.addColorStop(0, "rgba(0, 240, 168, 0)");
    bloom.addColorStop(0.5, `rgba(0, 240, 168, ${0.16 + intensity * 0.1})`);
    bloom.addColorStop(1, "rgba(0, 240, 168, 0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, horizon - 26, w, 52);

    ctx.strokeStyle = `rgba(180, 255, 230, ${0.35 + intensity * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    ctx.lineTo(w, horizon);
    ctx.stroke();
  };

  const drawMotes = (horizon: number, t: number) => {
    const vanishX = width / 2;
    for (const mote of motes) {
      mote.z -= mote.speed * (0.006 + progress * 0.012) * (1 + (intensity - 1) * 0.5);
      if (mote.z <= 0.04) {
        mote.z = 1;
        mote.x = random(-1, 1);
      }
      const depth = 1 - mote.z;
      const y = horizon + (height - horizon) * (depth * 0.92) + Math.sin(t * 0.6 + mote.x * 6) * 4;
      const x = vanishX + mote.x * width * (0.15 + depth * 0.9);
      const size = mote.size * (0.4 + depth * 1.8);
      const alpha = 0.12 + depth * 0.55;
      ctx.fillStyle = `rgba(200, 255, 235, ${alpha.toFixed(3)})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
  };

  const drawScanline = (t: number, horizon: number) => {
    const period = 3.4 + progress * 2;
    const phase = (t % period) / period;
    const y = horizon - 40 + phase * (height - horizon + 90);
    const trail = ctx.createLinearGradient(0, y - 60, 0, y);
    trail.addColorStop(0, "rgba(0, 240, 168, 0)");
    trail.addColorStop(1, `rgba(0, 240, 168, ${0.13 + intensity * 0.08})`);
    ctx.fillStyle = trail;
    ctx.fillRect(0, y - 60, width, 60);
    ctx.fillStyle = `rgba(210, 255, 240, ${0.5 + intensity * 0.3})`;
    ctx.fillRect(0, y, width, 1);
  };

  const drawPings = (dt: number) => {
    for (let i = pings.length - 1; i >= 0; i -= 1) {
      const ping = pings[i];
      ping.radius += dt * 320;
      ping.alpha -= dt * 0.85;
      if (ping.alpha <= 0.01) {
        pings.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(0, 240, 168, ${ping.alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, ping.radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 46, 154, ${(ping.alpha * 0.5).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(ping.x, ping.y, ping.radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      // crosshair ticks
      ctx.strokeStyle = `rgba(210, 255, 240, ${(ping.alpha * 0.8).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(ping.x - 10, ping.y);
      ctx.lineTo(ping.x - 4, ping.y);
      ctx.moveTo(ping.x + 4, ping.y);
      ctx.lineTo(ping.x + 10, ping.y);
      ctx.moveTo(ping.x, ping.y - 10);
      ctx.lineTo(ping.x, ping.y - 4);
      ctx.moveTo(ping.x, ping.y + 4);
      ctx.lineTo(ping.x, ping.y + 10);
      ctx.stroke();
    }
  };

  const drawPointerReticle = () => {
    if (pointerX === null || pointerY === null) return;
    ctx.strokeStyle = "rgba(255, 46, 154, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(pointerX, pointerY, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  let last = performance.now();
  const frame = (now: number) => {
    if (!alive) return;
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    const t = now / 1000;
    const horizon = height * 0.5 + (progress - 0.5) * height * 0.12;

    // trailing clear → motion blur without a post-processing pass
    ctx.fillStyle = "rgba(3, 6, 7, 0.34)";
    ctx.fillRect(0, 0, width, height);

    drawGrid(horizon, t);
    drawMotes(horizon, t);
    drawScanline(t, horizon);
    drawPings(dt);
    drawPointerReticle();

    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);

  return {
    ping(x: number, y: number) {
      if (pointerX === null && x === 0 && y === 0) return;
      pings.push({ x, y, radius: 4, alpha: 0.85 });
      if (pings.length > PING_LIMIT) pings.shift();
    },
    setProgress(value: number) {
      progress = Math.max(0, Math.min(1, value));
    },
    setPointer(x: number | null, y: number | null) {
      pointerX = x;
      pointerY = y;
    },
    setIntensity(value: number) {
      intensity = Math.max(0.2, Math.min(2.4, value));
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      motes.length = 0;
      pings.length = 0;
    },
  };
}
