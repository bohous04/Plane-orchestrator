import type { NextConfig } from "next";

const config: NextConfig = {
  // Native modules (better-sqlite3) must not be bundled.
  serverExternalPackages: ["better-sqlite3", "pino", "pino-pretty", "thread-stream"],
  // Allow workspace packages to be transpiled by Next.
  transpilePackages: ["@plane-autorun/core"],
};

export default config;
