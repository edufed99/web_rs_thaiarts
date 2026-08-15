import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["pg", "typeorm"],
  },
  async rewrites() {
    const modelServiceUrl = (
      process.env.MODEL_SERVICE_URL || "http://127.0.0.1:8001"
    ).replace(/\/+$/, "");
    return {
      beforeFiles: [],
      afterFiles: [],
      // Application Backend route handlers win first. Unmigrated API paths
      // retain their public contract through the private service during cutover.
      fallback: [
        {
          source: "/api/:path*",
          destination: `${modelServiceUrl}/:path*`,
        },
      ],
    };
  },
};

/**
 * Keep development and production artifacts separate. Running `next build`
 * while the dev server is open must never replace chunks used by that server.
 */
export default function nextConfig(phase) {
  return {
    ...baseConfig,
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
