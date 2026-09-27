"use client";

/**
 * menu.ts — the mega-menu's model, built from the catalogue itself.
 *
 * The menu is not a hand-written list of links: it is the manifest. Every group is a discipline,
 * every topic link points at `browse/<discipline>/<topic>/`, and every destination points at
 * `component/<slug>/` — the pages `scripts/pages.mjs` generates. Add a variation to the manifest
 * and it appears in this menu on the next sync, with its Persian title alongside the English one.
 *
 * Links are absolute against the *catalogue root*, never the app root: this variation is served
 * from `…/framework/next/nav/mega-menu-command/`, while the pages it links to live beside it at
 * `…/browse/…`. `hubHref()` resolves that root for dev, local preview and GitHub Pages alike.
 */
import { hubHref, manifest, variations } from "@/lib/catalog";
import type { Bilingual } from "@/lib/skin";

export interface MenuLink {
  id: string;
  label: Bilingual;
  href: string;
  note?: Bilingual;
  accent: string;
}

export interface MenuGroup {
  id: string;
  label: Bilingual;
  blurb: Bilingual;
  /** The discipline's own browse page — where the panel's call to action goes. */
  href: string;
  index: string;
  count: number;
  topics: MenuLink[];
  links: MenuLink[];
}

/** `<catalogue root>/browse/hero/index.html` — a real file, so it also works over file://. */
function catalogueHref(path: string): string {
  return `${hubHref("/")}${path}`.replace(/([^:])\/\/+/g, "$1/");
}

const topicById = new Map(manifest.topics.map((topic) => [topic.id, topic]));

export function buildMenu(): MenuGroup[] {
  return manifest.disciplines
    .filter((discipline) => (discipline.topics ?? []).length > 0)
    .map((discipline, position) => {
      const base = discipline.id.toLowerCase();
      const owned = variations.filter((variation) => variation.discipline === discipline.id);

      const topics: MenuLink[] = (discipline.topics ?? []).map((topicId) => {
        const topic = topicById.get(topicId);
        const count = owned.filter((variation) => variation.topic === topicId).length;
        return {
          id: `${discipline.id}-${topicId}`,
          label: { en: topic?.label ?? topicId, fa: topic?.labelFa ?? topic?.label ?? topicId },
          note: {
            en: `${count} ${count === 1 ? "variation" : "variations"}`,
            fa: `${count} نمونه`,
          },
          href: catalogueHref(`browse/${base}/${topicId}/index.html`),
          accent: owned.find((variation) => variation.topic === topicId)?.accent ?? "#ff4fd8",
        };
      });

      const links: MenuLink[] = owned.map((variation) => ({
        id: variation.id,
        label: { en: variation.title, fa: variation.titleFa ?? variation.title },
        note: { en: variation.stack.slice(0, 2).join(" · "), fa: variation.stack.slice(0, 2).join(" · ") },
        href: catalogueHref(`component/${variation.slug}/index.html`),
        accent: variation.accent,
      }));

      return {
        id: discipline.id,
        href: catalogueHref(`browse/${base}/index.html`),
        label: { en: discipline.label, fa: discipline.labelFa },
        blurb: { en: discipline.blurb, fa: discipline.blurbFa },
        index: String(position + 1).padStart(2, "0"),
        count: owned.length,
        topics,
        links,
      };
    });
}

/** Everything reachable, flattened — what the ⌘K palette searches. */
export interface PaletteEntry {
  id: string;
  label: Bilingual;
  kind: Bilingual;
  href: string;
  keywords: string;
}

export function buildPalette(): PaletteEntry[] {
  const entries: PaletteEntry[] = [];

  for (const group of buildMenu()) {
    entries.push({
      id: `discipline:${group.id}`,
      label: group.label,
      kind: { en: "Discipline", fa: "دیسیپلین" },
      href: catalogueHref(`browse/${group.id.toLowerCase()}/index.html`),
      keywords: `${group.id} ${group.label.en} ${group.label.fa}`.toLowerCase(),
    });
    for (const topic of group.topics) {
      entries.push({
        id: `topic:${topic.id}`,
        label: topic.label,
        kind: { en: `Topic · ${group.label.en}`, fa: `موضوع · ${group.label.fa}` },
        href: topic.href,
        keywords: `${topic.label.en} ${topic.label.fa} topic`.toLowerCase(),
      });
    }
  }

  for (const variation of variations) {
    entries.push({
      id: `component:${variation.id}`,
      label: { en: variation.title, fa: variation.titleFa ?? variation.title },
      kind: { en: variation.id, fa: variation.id },
      href: catalogueHref(`component/${variation.slug}/index.html`),
      keywords: `${variation.id} ${variation.title} ${variation.titleFa ?? ""} ${variation.vibe} ${variation.stack.join(" ")} ${variation.tags.join(" ")}`.toLowerCase(),
    });
  }

  return entries;
}

export { catalogueHref };
