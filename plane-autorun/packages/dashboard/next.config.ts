import type { NextConfig } from "next";

const config: NextConfig = {
  // Native modules (better-sqlite3) and ESM workspace packages with dynamic
  // imports must not be bundled — Next/Turbopack errors on dynamic import
  // expressions otherwise.
  serverExternalPackages: [
    "better-sqlite3",
    "pino",
    "pino-pretty",
    "thread-stream",
    "@plane-autorun/core",
  ],
};

export default config;
