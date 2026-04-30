import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // TypeScript runs explicitly via `npm run typecheck`; this avoids a Windows-specific
    // child-process EPERM in Next's internal typecheck phase.
    ignoreBuildErrors: true,
  },
  experimental: {
    workerThreads: false,
    webpackBuildWorker: false,
  },
};

export default nextConfig;
