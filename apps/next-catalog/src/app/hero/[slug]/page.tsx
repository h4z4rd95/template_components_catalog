import type { Metadata } from "next";
import { notFound } from "next/navigation";
import HeroStage from "@/components/HeroStage";
import { bySlug, variations } from "@/lib/catalog";

/**
 * Static hero route: /hero/<slug>/ → exported as hero/<slug>/index.html.
 * Slugs come from the manifest, so a new variation needs exactly one edit (the manifest)
 * plus its component — routing, metadata and the HUD all follow.
 */
export function generateStaticParams() {
  return variations
    .filter((v) => v.discipline === "Hero" && v.status !== "planned")
    .map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const variation = bySlug(slug);
  if (!variation) return { title: "Not found" };
  return {
    title: variation.id,
    description: `${variation.vibe} — ${variation.interaction}`,
    openGraph: {
      title: `${variation.id} · ${variation.title}`,
      description: variation.interaction,
    },
  };
}

export const dynamicParams = false;

export default async function HeroVariationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const variation = bySlug(slug);
  if (!variation) notFound();
  return <HeroStage variation={variation} />;
}
