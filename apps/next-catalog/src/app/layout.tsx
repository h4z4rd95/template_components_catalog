import type { Metadata, Viewport } from "next";
/* Self-hosted OFL faces bundled by npm — no CDN, no layout shift, works offline. */
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource/archivo-black/latin-400.css";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "The Catalog — Next.js track",
    template: "%s · The Catalog",
  },
  description:
    "A live, scrollable showroom of Awwwards-grade hero sections, navigation systems, loaders, scroll effects and dashboards — each one mixing a different framework, motion engine and GPU technique.",
  applicationName: "The Catalog",
  authors: [{ name: "The Catalog" }],
  keywords: [
    "creative development",
    "webgl",
    "gsap",
    "react three fiber",
    "kinetic typography",
    "interaction design",
    "component catalog",
  ],
  openGraph: {
    title: "The Catalog — Next.js track",
    description: "Awwwards-grade components across Next.js, Nuxt and vanilla stacks.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#050506",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Variations own their own scroll behaviour, so never let the OS zoom-lock fight it.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
