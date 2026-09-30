# The Catalog Manifest — schema & conventions

`catalog.json` is the **single source of truth** for the whole showroom. The static hub
(`docs/`), the Next.js HUD, the Nuxt HUD and every route generator read this one file, so a
variation is registered exactly once and appears everywhere with no drift.

## Pipeline

```
catalog/catalog.json
        │
        ├─ scripts/sync-catalog.mjs  ──►  docs/data/catalog.json   (fetch)
        │                                 docs/data/catalog.js     (script-tag fallback, works on file://)
        │
        ├─ apps/next-catalog  ──► generateStaticParams() → /hero/<slug>/ routes
        └─ apps/nuxt-catalog  ──► (Batch 2) same contract, Vue HUD
```

Run **`npm run catalog:sync`** after editing the manifest. It validates the file and fails loudly on:

* duplicate or malformed `id`s (must match `^(Hero|Nav|Loader|Scroll|Footer|UX|Dashboard)_V\d{2}_[A-Za-z0-9]+$`),
* unknown `discipline`,
* missing `title` / `stack` / `vibe` / `interaction` / `href`,
* a `source` path that does not exist on disk,
* an `href` that points at a framework build while `status` claims `stable`.

## Naming convention

```
{Discipline}_{V##}_{StyleCodename}
   Hero        V01    KineticBrutalGrid
```

* **Discipline** — one of the seven ids in the `disciplines` array.
* **V##** — a per-discipline, never-reused sequence. Delete a variation and its number retires with it.
* **StyleCodename** — PascalCase description of the *aesthetic + technique*, not the client.

The slug used in URLs is the kebab-case of everything after the discipline:
`Hero_V03_ParticleMorphField → /hero/particle-morph-field/`.

## Field reference

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | ✅ | The canonical component ID shown in the HUD. |
| `discipline` | enum | ✅ | Groups the catalog and drives hub filters. |
| `batch` | number | ✅ | Which delivery batch produced it. |
| `title` | string | ✅ | Human name for the card. |
| `stack` | string[] | ✅ | Rendered as HUD chips — be specific about engines/versions. |
| `vibe` | string | ✅ | The aesthetic school; must map to one of the five in `PLAN.md` §3. |
| `interaction` | string | ✅ | One sentence describing what happens on scroll/hover. |
| `href` | string | ✅ | **Relative** entry point. Relative is deliberate: the same JSON then works from `file://`, from `/` locally, and from `/<repo>/` on Pages. |
| `source` | string | ✅ | Repo path a visitor can open to read the implementation. |
| `status` | `stable` \| `beta` \| `planned` | ✅ | `planned` entries render as ghost cards in the hub. |
| `accent` | hex | ✅ | Per-variation accent burned into the card + HUD. |
| `tags` | string[] | ✅ | Powers hub search & the tag rail. |
| `perf` | object | — | `{ webgl: boolean, assetWeight: "light" \| "medium" \| "heavy" }` — used by the hub’s performance filter. |
