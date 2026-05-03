// Seed a sample run + a few tasks into runs.db so the dashboard has data
// to render before any real autorun has happened. Idempotent: drops the
// 'demo-run' row first if it already exists.

import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { openDb } from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

const dbPath = resolve(process.cwd(), "runs.db");
const db = openDb(dbPath);

const RUN_ID = "demo-run-0001";
const RUN_BRANCH = "DOCH-AUTORUN-DEMO";

const now = Date.now();

db.transaction(() => {
  // Best-effort cleanup
  db.raw.prepare("DELETE FROM tasks WHERE run_id = ?").run(RUN_ID);
  db.raw.prepare("DELETE FROM runs WHERE id = ?").run(RUN_ID);

  db.insertRun({
    id: RUN_ID,
    projectId: "doch",
    runBranch: RUN_BRANCH,
    runNumber: 0,
    startedAt: now - 30 * 60 * 1000,
    endedAt: now - 5 * 60 * 1000,
    status: "completed",
    totalTasks: 3,
    succeeded: 2,
    blocked: 1,
    totalCostUsd: 4.85,
    prUrl: "https://github.com/LNRTT/chwdirections/pull/123",
    worktreesDir: "/tmp/demo-worktrees",
    configSnapshot: '{"id":"doch","demo":true}',
  });

  db.insertTask({
    id: "demo-t1",
    runId: RUN_ID,
    planeWorkItemId: "uuid-1",
    identifier: "DOCH-12",
    title: "Add empty-state to /admin/employees",
    description: "When there are no employees, show a welcoming card with a CTA.",
    subBranch: "DOCH-AUTORUN-DEMO--DOCH-12",
    worktreePath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/DOCH-12",
    port: 3055,
    promptPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.prompts/DOCH-12.prompt.md",
    logPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.logs/DOCH-12.log",
    outputJsonPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.outputs/DOCH-12.json",
    status: "success",
    exitCode: 0,
    timedOut: 0,
    costUsd: 1.25,
    summary: "Implemented empty state with illustration and CTA button.",
    filesChanged: '["app/admin/employees/page.tsx","app/admin/employees/empty-state.tsx"]',
    startedAt: now - 28 * 60 * 1000,
    endedAt: now - 23 * 60 * 1000,
    mergeStatus: "merged",
  });

  db.insertTask({
    id: "demo-t2",
    runId: RUN_ID,
    planeWorkItemId: "uuid-2",
    identifier: "DOCH-13",
    title: "Tighten role guard on /api/employees",
    description: "Restrict to admin role only.",
    subBranch: "DOCH-AUTORUN-DEMO--DOCH-13",
    worktreePath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/DOCH-13",
    port: 3056,
    promptPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.prompts/DOCH-13.prompt.md",
    logPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.logs/DOCH-13.log",
    outputJsonPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.outputs/DOCH-13.json",
    status: "success",
    exitCode: 0,
    timedOut: 0,
    costUsd: 0.85,
    summary: "Added role guard middleware to /api/employees endpoints.",
    filesChanged: '["app/api/employees/route.ts","middleware.ts"]',
    startedAt: now - 22 * 60 * 1000,
    endedAt: now - 18 * 60 * 1000,
    mergeStatus: "merged",
  });

  db.insertTask({
    id: "demo-t3",
    runId: RUN_ID,
    planeWorkItemId: "uuid-3",
    identifier: "DOCH-19",
    title: "Refactor billing schema",
    description: "Acceptance criteria mention multi-tenant but no schema discussion.",
    subBranch: "DOCH-AUTORUN-DEMO--DOCH-19",
    worktreePath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/DOCH-19",
    port: 3057,
    promptPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.prompts/DOCH-19.prompt.md",
    logPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.logs/DOCH-19.log",
    outputJsonPath: "/tmp/demo-worktrees/DOCH-AUTORUN-DEMO/.outputs/DOCH-19.json",
    status: "blocked",
    exitCode: 0,
    timedOut: 0,
    costUsd: 2.75,
    summary: "Acceptance criteria too vague — needs human input on tenant model.",
    filesChanged: "[]",
    startedAt: now - 20 * 60 * 1000,
    endedAt: now - 12 * 60 * 1000,
    mergeStatus: "skipped",
  });
});

console.log(`Seeded demo run at ${dbPath}`);
db.close();
