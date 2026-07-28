/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Backend is a separate process; frontend never imports Python or reads CSV.
  env: {
    NEXT_PUBLIC_API_BASE_URL:
      process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080",
  },
};

export default nextConfig;