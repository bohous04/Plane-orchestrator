// M2 demo: print the live Plane queue for a project.
//
// Usage: pnpm tsx scripts/snapshot-queue.ts <projectId>
// Reads PLANE_TOKEN + PLANE_API_URL from .env.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
// Use the compiled output so tsx doesn't have to resolve workspace exports.
import { loadConfig, findProject, PlaneClient } from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: pnpm tsx scripts/snapshot-queue.ts <projectId>");
    process.exit(2);
  }

  const { config } = await loadConfig();
  const project = findProject(config, id);
  if (!project) {
    console.error(`Unknown project id: ${id}`);
    console.error(`Available: ${config.projects.map((p) => p.id).join(", ")}`);
    process.exit(2);
  }

  const token = process.env[project.tokenEnvVar];
  if (!token) {
    console.error(`${project.tokenEnvVar} not set in .env`);
    process.exit(2);
  }

  const baseUrl = process.env["PLANE_API_URL"];
  const client = new PlaneClient({
    workspace: project.workspace,
    token,
    ...(baseUrl ? { baseUrl } : {}),
  });

  console.log(`Resolving Plane project "${project.projectName}" in workspace "${project.workspace}"...`);
  const planeProjectId = await client.resolveProjectId(project.projectName);
  console.log(`  -> ${planeProjectId}`);

  console.log(`Snapshotting Todo + Backlog queue (sorted by priority, then created_at)...`);
  const queue = await client.snapshotTodoQueue(planeProjectId, project.identifierPrefix);

  console.log(`\n${queue.length} item(s):\n`);
  for (const item of queue) {
    const prio = item.priority.padEnd(7);
    console.log(`  ${item.identifier.padEnd(10)} [${item.state_name.padEnd(8)}] [${prio}] ${item.name}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
