/** The manifest contract, shared by every consumer (hub, React HUD, Vue HUD, generators). */

export type DisciplineId = "Hero" | "Nav" | "Loader" | "Scroll" | "Footer" | "UX" | "Dashboard";
export type VariationStatus = "stable" | "beta" | "planned";

export interface Discipline {
  id: DisciplineId;
  label: string;
  blurb: string;
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
  counts: { total: number; stable: number; beta: number; planned: number };
  generatedAt?: string;
}
