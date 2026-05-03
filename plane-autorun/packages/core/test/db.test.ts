import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/db.js";
import type { RunRecord, TaskRecord } from "../src/types.js";

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "padb-"));
  db = openDb(join(tmpDir, "runs.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleRun: RunRecord = {
  id: "run-1",
  projectId: "doch",
  runBranch: "DOCH-AUTORUN-1",
  runNumber: 1,
  startedAt: 1_700_000_000_000,
  endedAt: null,
  status: "running",
  totalTasks: 2,
  succeeded: 0,
  blocked: 0,
  totalCostUsd: 0,
  prUrl: null,
  worktreesDir: "/tmp/wt",
  configSnapshot: '{"id":"doch"}',
};

const sampleTask: TaskRecord = {
  id: "task-1",
  runId: "run-1",
  planeWorkItemId: "uuid-1",
  identifier: "DOCH-12",
  title: "Add empty-state",
  description: "...",
  subBranch: "DOCH-AUTORUN-1--DOCH-12",
  worktreePath: "/tmp/wt/DOCH-12",
  port: 3055,
  promptPath: "/tmp/wt/DOCH-12.prompt.md",
  logPath: "/tmp/wt/DOCH-12.log",
  outputJsonPath: "/tmp/wt/DOCH-12.json",
  status: "queued",
  exitCode: null,
  timedOut: 0,
  costUsd: null,
  summary: null,
  filesChanged: null,
  startedAt: null,
  endedAt: null,
  mergeStatus: null,
};

describe("openDb", () => {
  it("inserts and retrieves a run", () => {
    db.insertRun(sampleRun);
    const got = db.getRun("run-1");
    expect(got).toEqual(sampleRun);
  });

  it("inserts and retrieves a task", () => {
    db.insertRun(sampleRun);
    db.insertTask(sampleTask);
    const got = db.getTask("task-1");
    expect(got).toEqual(sampleTask);
  });

  it("updates partial run fields", () => {
    db.insertRun(sampleRun);
    db.updateRunStatus("run-1", { status: "completed", succeeded: 2, prUrl: "https://x" });
    const got = db.getRun("run-1");
    expect(got?.status).toBe("completed");
    expect(got?.succeeded).toBe(2);
    expect(got?.prUrl).toBe("https://x");
  });

  it("updates partial task fields", () => {
    db.insertRun(sampleRun);
    db.insertTask(sampleTask);
    db.updateTaskStatus("task-1", { status: "success", costUsd: 0.42, summary: "ok" });
    const got = db.getTask("task-1");
    expect(got?.status).toBe("success");
    expect(got?.costUsd).toBe(0.42);
    expect(got?.summary).toBe("ok");
  });

  it("findRunByBranch round-trips", () => {
    db.insertRun(sampleRun);
    expect(db.findRunByBranch("DOCH-AUTORUN-1")?.id).toBe("run-1");
    expect(db.findRunByBranch("nope")).toBeNull();
  });

  it("findIncompleteTasks returns only queued/running", () => {
    db.insertRun(sampleRun);
    db.insertTask(sampleTask);
    db.insertTask({ ...sampleTask, id: "task-2", identifier: "DOCH-13", status: "success" });
    const incomplete = db.findIncompleteTasks("run-1");
    expect(incomplete.map((t) => t.id)).toEqual(["task-1"]);
  });

  it("listRuns filters by projectId", () => {
    db.insertRun(sampleRun);
    db.insertRun({ ...sampleRun, id: "run-2", projectId: "lnrt", runBranch: "LNRT-AUTORUN-1" });
    expect(db.listRuns({ projectId: "doch" }).map((r) => r.id)).toEqual(["run-1"]);
    expect(db.listRuns({ projectId: "lnrt" }).map((r) => r.id)).toEqual(["run-2"]);
    expect(db.listRuns().length).toBe(2);
  });

  it("transaction wraps multiple writes", () => {
    db.transaction(() => {
      db.insertRun(sampleRun);
      db.insertTask(sampleTask);
      db.insertTask({ ...sampleTask, id: "task-2", identifier: "DOCH-13" });
    });
    expect(db.listTasksForRun("run-1").length).toBe(2);
  });

  it("upserts credential status", () => {
    db.upsertCredentialStatus({
      projectId: "doch",
      tokenEnvVar: "PLANE_TOKEN",
      isSet: true,
      lastChecked: 1,
    });
    db.upsertCredentialStatus({
      projectId: "doch",
      tokenEnvVar: "PLANE_TOKEN",
      isSet: false,
      lastChecked: 2,
    });
    const list = db.listCredentialStatus();
    expect(list.length).toBe(1);
    expect(list[0]?.isSet).toBe(false);
    expect(list[0]?.lastChecked).toBe(2);
  });
});
