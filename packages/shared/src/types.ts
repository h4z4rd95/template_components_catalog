/** The manifest contract, shared by every consumer (hub, React HUD, Vue HUD, generators). */

export type DisciplineId =
  | "Hero"
  | "Nav"
  | "Loader"
  | "Scroll"
  | "Footer"
  | "UX"
  | "Dashboard"
  | "Commerce"
  | "Site";
export type VariationStatus = "stable" | "beta" | "planned";
export type LocaleId = "en" | "fa";

export interface Discipline {
  id: DisciplineId;
  label: string;
  blurb: string;
  /** Persian label — every discipline carries one, and the sync gate enforces it. */
  labelFa: string;
  blurbFa: string;
  /** Topic ids this discipline publishes, in the order its own pages list them. */
  topics: string[];
}

/** A topic in the catalogue's hierarchy: discipline → topic → variation. */
export interface Topic {
  id: string;
  label: string;
  labelFa: string;
  blurb: string;
  blurbFa: string;
}

export interface Locale {
  id: LocaleId;
  label: string;
  labelFa: string;
  dir: "ltr" | "rtl";
  font: "latin" | "persian";
}

export interface VariationPerf {
  webgl?: boolean;
  assetWeight?: "light" | "medium" | "heavy";
}

export interface Variation {
  id: string;
  discipline: DisciplineId;
  batch: number;
  title: string;
  stack: string[];
  vibe: string;
  interaction: string;
  /** Relative entry point — works from file://, "/" and "/<repo>/" alike. */
  href: string;
  /** Kebab slug derived by the sync script (e.g. "particle-morph-field"). */
  slug: string;
  /** "hero/particle-morph-field/" */
  route: string;
  source: string;
  status: VariationStatus;
  accent: string;
  tags: string[];
  perf?: VariationPerf;
  /** Which topic under the discipline this variation belongs to (e.g. "gpu"). */
  topic?: string;
  /* Persian content. Required for stable variations by the sync gate, optional in the type so a
     planned entry can be registered before its translation is written. */
  titleFa?: string;
  vibeFa?: string;
  interactionFa?: string;
}

export interface CatalogManifest {
  meta: {
    name: string;
    tagline: string;
    repo: string;
    version: string;
    updated: string;
  };
  disciplines: Discipline[];
  variations: Variation[];
  topics: Topic[];
  locales: Locale[];
  defaultLocale: LocaleId;
  /** Shell strings, one dictionary per locale — parity is enforced by the sync gate. */
  ui: Record<string, Record<string, string>>;
  counts: { total: number; stable: number; beta: number; planned: number };
  generatedAt?: string;
}
