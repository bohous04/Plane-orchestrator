// Integration test for --resume. Sets up a real tmp git repo, pre-seeds the
// DB with a partial run state (1 succeeded task, 1 still-queued task), runs
// the orchestrator with resumeRunBranch + a stub claude binary, and asserts
// that only the queued task gets re-processed.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { execaSync } from "execa";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runProject } from "../src/orchestrator.js";
import { openDb } from "../src/db.js";
import { defineConfig } from "../src/config.js";
import type { ProjectConfig } from "../src/config.js";
import type { TaskRecord } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STUB_CLAUDE = join(__dirname, "fixtures", "stub-claude-success.sh");

let tmp: string;
let project: ProjectConfig;
const RUN_BRANCH = "TEST-AUTORUN-1";
const RUN_ID = "resume-run-1";

function gitInit(repoDir: string) {
  execaSync("git", ["init", "-b", "main"], { cwd: repoDir });
  execaSync("git", ["config", "user.email", "test@local"], { cwd: repoDir });
  execaSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "# test\n");
  execaSync("git", ["add", "."], { cwd: repoDir });
  execaSync("git", ["commit", "-m", "init"], { cwd: repoDir });
  // Need an origin to satisfy isFastForwardable; use a bare repo as origin.
  const bare = repoDir + ".bare";
  mkdirSync(bare, { recursive: true });
  execaSync("git", ["init", "--bare", "-b", "main"], { cwd: bare });
  execaSync("git", ["remote", "add", "origin", bare], { cwd: repoDir });
  execaSync("git", ["push", "-u", "origin", "main"], { cwd: repoDir });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "resume-"));
  chmodSync(STUB_CLAUDE, 0o755);
  const repoDir = join(tmp, "repo");
  mkdirSync(repoDir, { recursive: true });
  gitInit(repoDir);
  project = defineConfig({
    projects: [
      {
        id: "test-proj",
        workspace: "test",
        projectName: "Test",
        identifierPrefix: "TEST",
        repo: repoDir,
        worktreesRoot: join(tmp, "worktrees"),
        branchBase: "main",
        ports: [4055, 4056],
        concurrency: 2,
        githubRepo: "ORG/repo",
      },
    ],
  }).projects[0]!;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

class StubPlane {
  workspace: string;
  constructor(workspace: string) {
    this.workspace = workspace;
  }
  async getMe() {
    return { id: "stub-user", email: "test@local", display_name: "test", first_name: "t", last_name: "t" };
  }
  async resolveProjectId() {
    return "stub-plane-project-id";
  }
  async listStates() {
    return [
      { id: "s1", name: "Ready for Review", group: "started" as const, color: "#fff", sequence: 1, default: false, project: "p", workspace: "w" },
      { id: "s2", name: "Blocked / Needs Clarification", group: "unstarted" as const, color: "#fff", sequence: 2, default: false, project: "p", workspace: "w" },
    ];
  }
  async ensureStates() {
    return {
      "Ready for Review": { id: "s1", name: "Ready for Review", group: "started" as const, color: "#fff", sequence: 1, default: false, project: "p", workspace: "w" },
      "Blocked / Needs Clarification": { id: "s2", name: "Blocked / Needs Clarification", group: "unstarted" as const, color: "#fff", sequence: 2, default: false, project: "p", workspace: "w" },
    };
  }
  async snapshotTodoQueue() {
    return [
      {
        id: "wid-1",
        sequence_id: 1,
        name: "Task 1 (already done)",
        description_html: "<p>desc</p>",
        priority: "medium" as const,
        state: "todo",
        assignees: [],
        labels: [],
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
        project: "p",
        workspace: "w",
        parent: null,
        identifier: "TEST-1",
        description_text: "desc",
        state_name: "Todo",
        state_group: "unstarted" as const,
      },
      {
        id: "wid-2",
        sequence_id: 2,
        name: "Task 2 (still queued)",
        description_html: "<p>desc</p>",
        priority: "medium" as const,
        state: "todo",
        assignees: [],
        labels: [],
        created_at: "2026-01-02",
        updated_at: "2026-01-02",
        project: "p",
        workspace: "w",
        parent: null,
        identifier: "TEST-2",
        description_text: "desc",
        state_name: "Todo",
        state_group: "unstarted" as const,
      },
    ];
  }
  async listAllIssues() {
    return [];
  }
  async updateWorkItemState() {}
  async updateWorkItemAssignees() {}
  async createComment() {}
}

describe("--resume", () => {
  it("preserves completed tasks and re-processes incomplete ones", async () => {
    process.env["PLANE_TOKEN"] = "stub-token";
    const dbPath = join(tmp, "runs.db");
    const db = openDb(dbPath);

    // Seed: one completed run with 1 success task (TEST-1) and 1 queued task (TEST-2).
    db.insertRun({
      id: RUN_ID,
      projectId: project.id,
      runBranch: RUN_BRANCH,
      runNumber: 1,
      startedAt: Date.now() - 60_000,
      endedAt: null,
      status: "running",
      totalTasks: 2,
      succeeded: 1,
      blocked: 0,
      totalCostUsd: 0.5,
      prUrl: null,
      worktreesDir: join(project.worktreesRoot, RUN_BRANCH),
      configSnapshot: JSON.stringify(project),
    });
    const successTask: TaskRecord = {
      id: "task-already-done",
      runId: RUN_ID,
      planeWorkItemId: "wid-1",
      identifier: "TEST-1",
      title: "Task 1 (already done)",
      description: "desc",
      subBranch: `${RUN_BRANCH}--TEST-1`,
      worktreePath: join(project.worktreesRoot, RUN_BRANCH, "TEST-1"),
      port: 4055,
      promptPath: join(project.worktreesRoot, RUN_BRANCH, ".prompts", "TEST-1.prompt.md"),
      logPath: join(project.worktreesRoot, RUN_BRANCH, ".logs", "TEST-1.log"),
      outputJsonPath: join(project.worktreesRoot, RUN_BRANCH, ".outputs", "TEST-1.json"),
      status: "success",
      exitCode: 0,
      timedOut: 0,
      costUsd: 0.5,
      summary: "(seeded) already done",
      filesChanged: '["a.txt"]',
      startedAt: Date.now() - 50_000,
      endedAt: Date.now() - 40_000,
      mergeStatus: null,
    };
    db.insertTask(successTask);

    // Pre-create the run branch in git (resume expects it to exist).
    execaSync("git", ["branch", RUN_BRANCH, "main"], { cwd: project.repo });

    const result = await runProject(project, {
      db,
      plane: new StubPlane("test") as unknown as import("../src/plane.js").PlaneClient,
      claudeBin: STUB_CLAUDE,
      resumeRunBranch: RUN_BRANCH,
      skipPushAndPr: true,
    });

    expect(result.runBranch).toBe(RUN_BRANCH);
    expect(result.ran).toBe(2);

    const tasks = db.listTasksForRun(RUN_ID);
    expect(tasks).toHaveLength(2);

    const t1 = tasks.find((t) => t.identifier === "TEST-1")!;
    const t2 = tasks.find((t) => t.identifier === "TEST-2")!;

    // TEST-1 was already success — must NOT have been re-run. Its summary
    // and started/ended timestamps stay the seeded ones.
    expect(t1.status).toBe("success");
    expect(t1.summary).toBe("(seeded) already done");

    // TEST-2 was queued — should now be success (stub claude returns SUCCESS).
    expect(t2.status).toBe("success");
    expect(t2.summary).toBe("stub task done");

    // Run should be marked completed.
    const run = db.getRun(RUN_ID)!;
    expect(run.status).toBe("completed");
    expect(run.succeeded).toBe(2);
    expect(run.blocked).toBe(0);
    db.close();
  }, 30_000);

  it("returns early when the run is already completed", async () => {
    const dbPath = join(tmp, "runs.db");
    const db = openDb(dbPath);
    db.insertRun({
      id: "completed-run",
      projectId: project.id,
      runBranch: "TEST-AUTORUN-99",
      runNumber: 99,
      startedAt: Date.now() - 60_000,
      endedAt: Date.now(),
      status: "completed",
      totalTasks: 0,
      succeeded: 0,
      blocked: 0,
      totalCostUsd: 0,
      prUrl: "https://x/y/z",
      worktreesDir: "/tmp",
      configSnapshot: "{}",
    });
    const result = await runProject(project, {
      db,
      plane: new StubPlane("test") as unknown as import("../src/plane.js").PlaneClient,
      resumeRunBranch: "TEST-AUTORUN-99",
      skipPushAndPr: true,
    });
    expect(result.ran).toBe(0);
    expect(result.runId).toBe("completed-run");
    expect(result.prUrl).toBe("https://x/y/z");
    db.close();
  });
});
