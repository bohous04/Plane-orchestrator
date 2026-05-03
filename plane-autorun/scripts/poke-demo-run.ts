// Mutate a task in the demo run to simulate progress, used for the M8
// SSE smoke test.

import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { openDb } from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

const db = openDb(resolve(process.cwd(), "runs.db"));

const status = process.argv[2] ?? "running";
const taskId = process.argv[3] ?? "demo-t1";

db.updateTaskStatus(taskId, {
  status: status as "queued" | "running" | "success" | "blocked",
  endedAt: status === "success" || status === "blocked" ? Date.now() : null,
});
console.log(`task ${taskId} -> ${status}`);
db.close();
