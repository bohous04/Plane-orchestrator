// Singleton initializer for @plane-autorun/core inside the Next.js server.
// We open the SQLite DB once per Node process and reuse it across requests.
// Config is loaded lazily; the dashboard itself doesn't run orchestration in
// M7 (that comes when the API exposes POST /api/runs in M8/M10).

import { openDb, type Db, type AutorunConfig } from "@plane-autorun/core";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";

// Next loads .env from packages/dashboard by default, but the .env we care
// about (PLANE_TOKEN, PLANE_API_URL) lives at the workspace root.
loadEnv({ path: resolve(process.cwd(), "../../.env") });

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

// Reading projects.config.ts inside Next requires a TS loader (tsx). Bundling
// `import(filePath)` for a .ts module triggers either the bundler "expression
// too dynamic" complaint (turbopack) or Node's lack of a TS loader (webpack).
// Workaround: shell out to tsx via a tiny dump-config.ts script and parse the
// JSON it prints. The result is cached globally so we only pay this once.
function loadConfigViaSubprocess(workspaceRoot: string): AutorunConfig | null {
  const tsxBin = resolve(workspaceRoot, "node_modules/.bin/tsx");
  const dumpScript = resolve(workspaceRoot, "scripts/dump-config.ts");
  try {
    const stdout = execFileSync(tsxBin, [dumpScript], {
      cwd: workspaceRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout) as AutorunConfig;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[dashboard] dump-config failed: ${String(e).slice(0, 300)}`);
    return null;
  }
}

export async function getConfig(): Promise<AutorunConfig | null> {
  if (globalThis.__planeAutorunConfig) return globalThis.__planeAutorunConfig;
  const workspaceRoot = resolve(process.cwd(), "../..");
  const cfg = loadConfigViaSubprocess(workspaceRoot);
  if (cfg) globalThis.__planeAutorunConfig = cfg;
  return cfg;
}
