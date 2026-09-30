import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NavStage from "@/components/NavStage";
import { bySlug, variations } from "@/lib/catalog";

/**
 * Static nav route: /nav/<slug>/ → exported as nav/<slug>/index.html.
 * Slugs come from the manifest, so a new navigation variation needs exactly one manifest entry
 * plus its component — routing, metadata and the HUD all follow.
 */
export function generateStaticParams() {
  return variations
    .filter((v) => v.discipline === "Nav" && v.status !== "planned")
    .map((v) => ({ slug: v.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const variation = bySlug(slug);
  if (!variation) return { title: "Not found" };
  return {
    title: variation.id,
    description: `${variation.vibe} — ${variation.interaction}`,
    openGraph: { title: `${variation.id} · ${variation.title}`, description: variation.interaction },
  };
}

export const dynamicParams = false;

export default async function NavVariationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const variation = bySlug(slug);
  if (!variation) notFound();
  return <NavStage variation={variation} />;
}
