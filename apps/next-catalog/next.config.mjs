/**
 * next.config.mjs — static export for GitHub Pages.
 *
 * basePath comes from the environment so the *same* source builds for
 *   · local preview  (NEXT_BASE_PATH=""          → served at /)
 *   · GitHub Pages   (NEXT_BASE_PATH="/<repo>/framework/next")
 *
 * Catalog hrefs are relative, so nothing in the hub needs rewriting when the basePath changes.
 */
const basePath = process.env.NEXT_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  // @catalog/shared ships raw TS on purpose (see packages/shared/package.json)
  transpilePackages: ["@catalog/shared"],
  experimental: {
    optimizePackageImports: ["@react-three/drei", "motion"],
  },
  // Static export has no image optimizer or ISR; make that explicit for future contributors.
  devIndicators: false,
};

export default nextConfig;
