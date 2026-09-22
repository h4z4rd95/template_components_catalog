# The Catalog

> **A live, scrollable showroom of Awwwards-grade web components** — hero sections, navigation systems,
> loaders, scroll effects, footers, UX primitives and dashboard ecosystems. Each variation mixes a
> different framework, motion engine and GPU technique against a distinct aesthetic school, and every
> one is wrapped in a self-documenting **metadata HUD** that states its ID, stack, vibe and interaction
> blueprint.
>
> It is three things at once: an **inspiration playbook**, a **learning tool** (the source is the
> tutorial) and a **client-facing showroom** (filter it, preview live, pick a direction).

```
docs/index.html  →  the hub  →  live iframes of every variation
```

---

## Quick start

```bash
npm install          # installs every workspace (Next track + shared kit)

npm run build        # sync manifest → static-export the framework apps → splice into docs/
npm run preview      # serve docs/ at http://localhost:4173
# or just double-click docs/index.html — the hub is buildless and works from disk

npm test             # manifest sync + CSS-module integrity + typecheck + hub smoke test
npm run dev:next     # run the Next.js track with hot reload at :3000

npm run setup:browser && npm run verify:browser   # real Chromium audit + vision reel
```

**Requirements:** Node ≥ 20.11 (developed on 22), npm ≥ 10. No global tooling, no paid GSAP plugins —
GSAP 3.13+ ships SplitText/Observer free in the public package, and this repo uses them.

---

## Verified state

Six gates, each catching a class of defect the others structurally cannot:

| Gate | Command | What it proves |
| --- | --- | --- |
| Manifest integrity | `npm run catalog:sync` | ids, enums, accents and on-disk source paths are valid |
| CSS-Module integrity | `npm run check:styles` | every `styles.*` reference resolves to a declared class (typos fail *silently* otherwise) |
| Types | `npm run typecheck` | strict TypeScript across the app and the shared kit |
| Showroom runtime | `npm run test:hub` | 23 jsdom assertions: filters, search, deep-links, stage overlay, postMessage relay, iframe caps, missing-build notice |
| Production build | `npm run build` | 8 static routes exported and spliced into `docs/` |
| **Real-browser audit + vision** | `npm run verify:browser` | **actual painted pixels**: 4 breakpoints, WebGL context creation, console/network, `hidden`-attribute leaks, text colliding with chrome, reduced-motion composition — plus an animated capture of every variation |

`npm test` runs gates 1–4 (fast, no browser). The browser gate is separate because it needs a Chromium.

### Real-browser verification & the vision reel

```bash
npm run setup:browser        # provision Chromium 153 (~8s, from npm — no CDN, no apt)
npm run build                # the reel screenshots the built showroom
npm run verify:browser       # audit every route, then screencast/encode each variation
                             #   prints the GPU profile it negotiated (report.json → gpuProfile)
                             #   variations are audited at their real directory URL, never …/index.html
#   → docs/vision/index.html   the reel: animated captures beside their audit results
#   → docs/vision/report.json  machine-readable findings
#   → docs/vision/shots/*.png  stills at three scroll depths + reduced-motion frames

npm run verify:browser:audit           # audit only (fast, no media)
npm run verify:browser -- --only hub   # one target
```

The harness drives a **real interaction script per variation** — pointer arcs to trigger hover physics
(tile recoil, liquid advection, radar pings), eased scroll trajectories, and real clicks to fire the
particle shockwave and the cyber glitch burst — then encodes the screencast to GIF at true playback speed
(timing is measured, never assumed), with ordered dithering and a hard byte budget so a particle-heavy
variation cannot bloat the repository.

**Why a browser gate exists at all.** jsdom has no layout engine. Two of the worst bugs this project has
had were invisible to every other gate: `.stage { display: grid }` silently defeating the `hidden`
attribute (the fullscreen overlay covered the entire hub while types, manifest, CSS bindings and 23 DOM
assertions all passed), and a self-recursive `pump()` that leaked a GPU-backed iframe on every scroll
pass. Both are now regression-guarded in the harness. Thirteen defects were found this way in a single
pass — see `PROGRESS.md`.

---

## What is in the catalog today

**Batch 1 — Hero sections (Next.js track, all `stable`)**

| ID | Aesthetic | Stack | The move |
| --- | --- | --- | --- |
| `Hero_V01_KineticBrutalGrid` | Kinetic Typography · Neo-Brutalism | Next · GSAP timeline + SplitText + Observer · CSS Grid | Type punches in tile-by-tile on a raw board; scrolling skews it; the headline physically recoils from your cursor |
| `Hero_V02_EditorialScrollLock` | Luxury Minimalism · Editorial | Next · ScrollTrigger pin + scrub · Lenis | A 320vh pinned stage where one serif line deconstructs into an editorial grid; one word travels into an image cell |
| `Hero_V03_ParticleMorphField` | Immersive WebGL-First | Next · R3F · Drei · hand-written points shader | 30k GPU points morph torus → helix → sphere; the cursor dents the field; clicking sends a shockwave |
| `Hero_V04_CyberScannerHUD` | Cyberpunk · High-Density UI | Next · Canvas2D perspective engine · GSAP | A boot sequence types itself out over telemetry; hover fires radar pings; fast scrolling detonates a glitch burst |
| `Hero_V05_LiquidChromaGlass` | Chromatic Liquid Gradient · Glassmorphism | Next · raw WebGL2 fragment shader · Motion | A mesh gradient advected by pointer inertia behind real glass panels, with spring-damped parallax |

`catalog/catalog.json` is the single source of truth — the hub cards, the in-variation HUDs, the route
generator and this table all read the same records.

**Batches 2–9** (queued, see `PLAN.md`): Nuxt 4 + TresJS heroes, navigation & mega-menus, loaders and
page transitions, scroll/pinning systems, footers & CTA zones, UX primitives, dashboard ecosystems.

---

## Repository map

```
catalog/catalog.json        single source of truth for every variation
scripts/sync-catalog.mjs    validates the manifest → emits docs/data/* and per-app copies
scripts/check-styles.mjs    catches typo'd CSS-module class names (they fail silently otherwise)
scripts/smoke-hub.mjs       runs docs/ in jsdom and asserts the showroom actually works
scripts/setup-browser.mjs   provisions Chromium from npm (CDN-free) for real-browser verification
scripts/vision.mjs          audits every route in Chromium and captures the animated vision reel
scripts/build-all.mjs       local twin of CI: export apps → splice into docs/framework/
scripts/serve.mjs           zero-dependency static server (binds 0.0.0.0, GitHack-Pages-like paths)

packages/shared             framework-agnostic kit: math, easings, split-text engine, device tiers,
                            procedural point clouds and hand-written GLSL (noise · liquid · particles)

apps/next-catalog           Next.js 16 (App Router, TS, R3F, Drei, GSAP, Lenis, Motion)
docs/                       the Pages root: hub + generated framework exports (git-ignored)
```

### The variation contract

Every variation is one folder, one component, one CSS module, and one manifest entry:

```
apps/next-catalog/src/heroes/<slug>/<PascalName>.tsx   ← the implementation
apps/next-catalog/src/heroes/<slug>/<slug>.module.css  ← its own palette + layout
catalog/catalog.json                                   ← its metadata record
```

**No placeholders, ever.** Each variation ships real copy, a real second section (so scroll behaviour is
demonstrable), keyboard reachability, `prefers-reduced-motion` handling that produces a composed static
frame, and explicit GPU teardown (geometry, materials, contexts, listeners, observers).

---

## Adding a variation

```bash
# 1. build it
apps/next-catalog/src/heroes/my-idea/MyIdea.tsx
apps/next-catalog/src/heroes/my-idea/my-idea.module.css

# 2. register it (id, stack, vibe, interaction blueprint, accent, tags)
#    catalog/catalog.json

# 3. wire the route (one line, inline options — next/dynamic requires a literal)
#    apps/next-catalog/src/components/HeroStage.tsx

# 4. verify + ship
npm test && npm run build && npm run preview
```

The manifest validator fails loudly on a duplicate ID, an unknown discipline, a bad hex accent, or a
`source` path that does not exist — so the catalog cannot drift out of sync with reality.

---

## Deployment

CI (`.github/workflows/deploy.yml`) runs `npm ci` → `npm test` → `npm run build` with
`PAGES_BASE_PATH=/<repo>`, then publishes `docs/` to GitHub Pages.

`docs/framework/*` is **generated, never committed** — the site is always built from source, and the hub
detects a missing build and tells the visitor how to produce it instead of showing a broken frame.

To publish: **Settings → Pages → Source: GitHub Actions**, then push to `main`.

---

## Resuming work

- `PLAN.md` — roadmap, permutation matrix, definition of done, live dashboard, and a *Current Focus*
  section written to be read first after any interruption.
- `PROGRESS.md` — append-only build journal; the last entry always ends with `NEXT:`.

Built with Next.js 16, React 19, Three.js/R3F, GSAP, Motion, Lenis, Canvas2D and raw WebGL2 — no
build-step CSS, no paid plugins, no binary assets.
