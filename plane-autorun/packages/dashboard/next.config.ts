import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
  // Allow workspace packages to be transpiled by Next.
  transpilePackages: ["@plane-autorun/core"],
};

export default config;
