import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

/** @type {import('next').NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pg", "typeorm"],
  },
};

/**
 * Keep development and production artifacts separate. Running `next build`
 * while the dev server is open must never replace chunks used by that server.
 * `output: "standalone"` is strictly for production builds.
 */
export default function nextConfig(phase) {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    ...baseConfig,
    ...(isDev ? {} : { output: "standalone" }),
    distDir: isDev ? ".next-dev" : ".next",
  };
}

