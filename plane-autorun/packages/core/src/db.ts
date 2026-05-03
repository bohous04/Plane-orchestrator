import Database, { type Database as DatabaseT, type Statement } from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { RunRecord, TaskRecord, RunStatus, MergeStatus } from "./types.js";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  run_branch      TEXT NOT NULL UNIQUE,
  run_number      INTEGER NOT NULL,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  status          TEXT NOT NULL,
  total_tasks     INTEGER NOT NULL,
  succeeded       INTEGER NOT NULL DEFAULT 0,
  blocked         INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  pr_url          TEXT,
  worktrees_dir   TEXT NOT NULL,
  config_snapshot TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  plane_work_item_id  TEXT NOT NULL,
  identifier          TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  sub_branch          TEXT NOT NULL,
  worktree_path       TEXT NOT NULL,
  port                INTEGER NOT NULL,
  prompt_path         TEXT NOT NULL,
  log_path            TEXT NOT NULL,
  output_json_path    TEXT NOT NULL,
  status              TEXT NOT NULL,
  exit_code           INTEGER,
  timed_out           INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL,
  summary             TEXT,
  files_changed       TEXT,
  started_at          INTEGER,
  ended_at            INTEGER,
  merge_status        TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

CREATE TABLE IF NOT EXISTS credentials_status (
  project_id      TEXT PRIMARY KEY,
  token_env_var   TEXT NOT NULL,
  is_set          INTEGER NOT NULL,
  last_checked    INTEGER NOT NULL
);
`;

interface RunRow {
  id: string;
  project_id: string;
  run_branch: string;
  run_number: number;
  started_at: number;
  ended_at: number | null;
  status: string;
  total_tasks: number;
  succeeded: number;
  blocked: number;
  total_cost_usd: number;
  pr_url: string | null;
  worktrees_dir: string;
  config_snapshot: string;
}

interface TaskRow {
  id: string;
  run_id: string;
  plane_work_item_id: string;
  identifier: string;
  title: string;
  description: string;
  sub_branch: string;
  worktree_path: string;
  port: number;
  prompt_path: string;
  log_path: string;
  output_json_path: string;
  status: string;
  exit_code: number | null;
  timed_out: number;
  cost_usd: number | null;
  summary: string | null;
  files_changed: string | null;
  started_at: number | null;
  ended_at: number | null;
  merge_status: string | null;
}

function rowToRun(r: RunRow): RunRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    runBranch: r.run_branch,
    runNumber: r.run_number,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status as RunStatus,
    totalTasks: r.total_tasks,
    succeeded: r.succeeded,
    blocked: r.blocked,
    totalCostUsd: r.total_cost_usd,
    prUrl: r.pr_url,
    worktreesDir: r.worktrees_dir,
    configSnapshot: r.config_snapshot,
  };
}

function rowToTask(r: TaskRow): TaskRecord {
  return {
    id: r.id,
    runId: r.run_id,
    planeWorkItemId: r.plane_work_item_id,
    identifier: r.identifier,
    title: r.title,
    description: r.description,
    subBranch: r.sub_branch,
    worktreePath: r.worktree_path,
    port: r.port,
    promptPath: r.prompt_path,
    logPath: r.log_path,
    outputJsonPath: r.output_json_path,
    status: r.status as TaskRecord["status"],
    exitCode: r.exit_code,
    timedOut: r.timed_out === 0 ? 0 : 1,
    costUsd: r.cost_usd,
    summary: r.summary,
    filesChanged: r.files_changed,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    mergeStatus: (r.merge_status as MergeStatus) ?? null,
  };
}

export interface CredentialStatus {
  projectId: string;
  tokenEnvVar: string;
  isSet: boolean;
  lastChecked: number;
}

export interface Db {
  insertRun(run: RunRecord): void;
  updateRunStatus(id: string, patch: Partial<RunRecord>): void;
  insertTask(task: TaskRecord): void;
  updateTaskStatus(id: string, patch: Partial<TaskRecord>): void;
  listRuns(opts?: { projectId?: string; limit?: number }): RunRecord[];
  getRun(id: string): RunRecord | null;
  listTasksForRun(runId: string): TaskRecord[];
  getTask(id: string): TaskRecord | null;
  findRunByBranch(branch: string): RunRecord | null;
  findIncompleteTasks(runId: string): TaskRecord[];
  upsertCredentialStatus(s: CredentialStatus): void;
  listCredentialStatus(): CredentialStatus[];
  transaction<T>(fn: () => T): T;
  close(): void;
  raw: DatabaseT;
}

const RUN_COLUMN_MAP: Record<keyof RunRecord, string> = {
  id: "id",
  projectId: "project_id",
  runBranch: "run_branch",
  runNumber: "run_number",
  startedAt: "started_at",
  endedAt: "ended_at",
  status: "status",
  totalTasks: "total_tasks",
  succeeded: "succeeded",
  blocked: "blocked",
  totalCostUsd: "total_cost_usd",
  prUrl: "pr_url",
  worktreesDir: "worktrees_dir",
  configSnapshot: "config_snapshot",
};

const TASK_COLUMN_MAP: Record<keyof TaskRecord, string> = {
  id: "id",
  runId: "run_id",
  planeWorkItemId: "plane_work_item_id",
  identifier: "identifier",
  title: "title",
  description: "description",
  subBranch: "sub_branch",
  worktreePath: "worktree_path",
  port: "port",
  promptPath: "prompt_path",
  logPath: "log_path",
  outputJsonPath: "output_json_path",
  status: "status",
  exitCode: "exit_code",
  timedOut: "timed_out",
  costUsd: "cost_usd",
  summary: "summary",
  filesChanged: "files_changed",
  startedAt: "started_at",
  endedAt: "ended_at",
  mergeStatus: "merge_status",
};

function buildPatchSql<T>(
  table: string,
  columnMap: Record<keyof T, string>,
  patch: Partial<T>,
): { sql: string; values: unknown[] } | null {
  const entries = Object.entries(patch as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return null;
  const cols = entries.map(([k]) => `${columnMap[k as keyof T]} = ?`);
  const values = entries.map(([, v]) => v);
  return {
    sql: `UPDATE ${table} SET ${cols.join(", ")} WHERE id = ?`,
    values,
  };
}

export function openDb(dbPath: string): Db {
  const abs = resolve(dbPath);
  const dir = dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const raw = new Database(abs);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const currentVersion = (raw.pragma("user_version", { simple: true }) as number) ?? 0;
  if (currentVersion === 0) {
    raw.exec(SCHEMA_SQL);
    raw.pragma(`user_version = ${SCHEMA_VERSION}`);
  } else if (currentVersion !== SCHEMA_VERSION) {
    throw new Error(
      `runs.db schema version is ${currentVersion}, expected ${SCHEMA_VERSION}. ` +
        `No migration available — back up runs.db and delete to recreate.`,
    );
  }

  const stmts = {
    insertRun: raw.prepare<[
      string, string, string, number, number, number | null, string,
      number, number, number, number, string | null, string, string,
    ]>(
      `INSERT INTO runs (
        id, project_id, run_branch, run_number, started_at, ended_at, status,
        total_tasks, succeeded, blocked, total_cost_usd, pr_url, worktrees_dir, config_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insertTask: raw.prepare<[
      string, string, string, string, string, string, string, string, number,
      string, string, string, string, number | null, number, number | null, string | null,
      string | null, number | null, number | null, string | null,
    ]>(
      `INSERT INTO tasks (
        id, run_id, plane_work_item_id, identifier, title, description,
        sub_branch, worktree_path, port, prompt_path, log_path, output_json_path,
        status, exit_code, timed_out, cost_usd, summary, files_changed,
        started_at, ended_at, merge_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    listRunsAll: raw.prepare<[number]>(
      `SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`,
    ),
    listRunsByProject: raw.prepare<[string, number]>(
      `SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`,
    ),
    getRun: raw.prepare<[string]>(`SELECT * FROM runs WHERE id = ?`),
    findRunByBranch: raw.prepare<[string]>(`SELECT * FROM runs WHERE run_branch = ?`),
    listTasksForRun: raw.prepare<[string]>(
      `SELECT * FROM tasks WHERE run_id = ? ORDER BY identifier ASC`,
    ),
    getTask: raw.prepare<[string]>(`SELECT * FROM tasks WHERE id = ?`),
    findIncompleteTasks: raw.prepare<[string]>(
      `SELECT * FROM tasks WHERE run_id = ? AND status IN ('queued','running') ORDER BY identifier ASC`,
    ),
    upsertCredentialStatus: raw.prepare<[string, string, number, number]>(
      `INSERT INTO credentials_status (project_id, token_env_var, is_set, last_checked)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         token_env_var = excluded.token_env_var,
         is_set = excluded.is_set,
         last_checked = excluded.last_checked`,
    ),
    listCredentialStatus: raw.prepare(
      `SELECT * FROM credentials_status ORDER BY project_id`,
    ),
  } as const;

  // Hold any cached UPDATE statements so we don't reprepare each call.
  const updateCache = new Map<string, Statement>();
  function getOrPrepare(sql: string): Statement {
    let s = updateCache.get(sql);
    if (!s) {
      s = raw.prepare(sql);
      updateCache.set(sql, s);
    }
    return s;
  }

  return {
    raw,
    insertRun(r: RunRecord) {
      stmts.insertRun.run(
        r.id, r.projectId, r.runBranch, r.runNumber, r.startedAt, r.endedAt, r.status,
        r.totalTasks, r.succeeded, r.blocked, r.totalCostUsd, r.prUrl, r.worktreesDir, r.configSnapshot,
      );
    },
    insertTask(t: TaskRecord) {
      stmts.insertTask.run(
        t.id, t.runId, t.planeWorkItemId, t.identifier, t.title, t.description,
        t.subBranch, t.worktreePath, t.port, t.promptPath, t.logPath, t.outputJsonPath,
        t.status, t.exitCode, t.timedOut, t.costUsd, t.summary, t.filesChanged,
        t.startedAt, t.endedAt, t.mergeStatus,
      );
    },
    updateRunStatus(id: string, patch: Partial<RunRecord>) {
      const built = buildPatchSql<RunRecord>("runs", RUN_COLUMN_MAP, patch);
      if (!built) return;
      getOrPrepare(built.sql).run(...built.values, id);
    },
    updateTaskStatus(id: string, patch: Partial<TaskRecord>) {
      const built = buildPatchSql<TaskRecord>("tasks", TASK_COLUMN_MAP, patch);
      if (!built) return;
      getOrPrepare(built.sql).run(...built.values, id);
    },
    listRuns(opts?: { projectId?: string; limit?: number }): RunRecord[] {
      const limit = opts?.limit ?? 100;
      const rows = opts?.projectId
        ? (stmts.listRunsByProject.all(opts.projectId, limit) as RunRow[])
        : (stmts.listRunsAll.all(limit) as RunRow[]);
      return rows.map(rowToRun);
    },
    getRun(id: string) {
      const row = stmts.getRun.get(id) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    },
    listTasksForRun(runId: string) {
      const rows = stmts.listTasksForRun.all(runId) as TaskRow[];
      return rows.map(rowToTask);
    },
    getTask(id: string) {
      const row = stmts.getTask.get(id) as TaskRow | undefined;
      return row ? rowToTask(row) : null;
    },
    findRunByBranch(branch: string) {
      const row = stmts.findRunByBranch.get(branch) as RunRow | undefined;
      return row ? rowToRun(row) : null;
    },
    findIncompleteTasks(runId: string) {
      const rows = stmts.findIncompleteTasks.all(runId) as TaskRow[];
      return rows.map(rowToTask);
    },
    upsertCredentialStatus(s: CredentialStatus) {
      stmts.upsertCredentialStatus.run(
        s.projectId, s.tokenEnvVar, s.isSet ? 1 : 0, s.lastChecked,
      );
    },
    listCredentialStatus(): CredentialStatus[] {
      const rows = stmts.listCredentialStatus.all() as Array<{
        project_id: string;
        token_env_var: string;
        is_set: number;
        last_checked: number;
      }>;
      return rows.map((r) => ({
        projectId: r.project_id,
        tokenEnvVar: r.token_env_var,
        isSet: r.is_set === 1,
        lastChecked: r.last_checked,
      }));
    },
    transaction<T>(fn: () => T): T {
      return raw.transaction(fn)();
    },
    close() {
      raw.close();
    },
  };
}

export function defaultDbPath(): string {
  return process.env["PLANE_AUTORUN_DB"] ?? resolve(process.cwd(), "runs.db");
}
