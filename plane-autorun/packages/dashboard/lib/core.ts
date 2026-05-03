// Singleton initializer for @plane-autorun/core inside the Next.js server.
// We open the SQLite DB once per Node process and reuse it across requests.
// Config is loaded lazily; the dashboard itself doesn't run orchestration in
// M7 (that comes when the API exposes POST /api/runs in M8/M10).

import { openDb, loadConfig, type Db, type AutorunConfig } from "@plane-autorun/core";
import { resolve } from "node:path";

declare global {
  // eslint-disable-next-line no-var
  var __planeAutorunDb: Db | undefined;
  // eslint-disable-next-line no-var
  var __planeAutorunConfig: AutorunConfig | undefined;
}

// The dashboard runs from packages/dashboard/, but runs.db lives at the
// workspace root by convention (see DECISIONS.md). Resolve there unless
// PLANE_AUTORUN_DB is set explicitly.
function resolveDbPath(): string {
  if (process.env["PLANE_AUTORUN_DB"]) return process.env["PLANE_AUTORUN_DB"];
  return resolve(process.cwd(), "../../runs.db");
}

export function getDb(): Db {
  if (!globalThis.__planeAutorunDb) {
    globalThis.__planeAutorunDb = openDb(resolveDbPath());
  }
  return globalThis.__planeAutorunDb;
}

export async function getConfig(): Promise<AutorunConfig | null> {
  if (globalThis.__planeAutorunConfig) return globalThis.__planeAutorunConfig;
  try {
    // The dashboard runs from packages/dashboard/, but projects.config.ts
    // lives at the workspace root.
    const cfgPath = resolve(process.cwd(), "../../projects.config.ts");
    const { config } = await loadConfig({ configPath: cfgPath });
    globalThis.__planeAutorunConfig = config;
    return config;
  } catch {
    return null;
  }
}
