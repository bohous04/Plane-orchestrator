// Print the resolved AutorunConfig as JSON. Used by the dashboard to read
// projects.config.ts without dragging tsx into Next.js's runtime path.

import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const cfgPath =
    process.env["PLANE_AUTORUN_CONFIG"] ?? resolve(process.cwd(), "projects.config.ts");
  const { config } = await loadConfig({ configPath: cfgPath });
  process.stdout.write(JSON.stringify(config));
}

main().catch((err) => {
  process.stderr.write(`dump-config: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
