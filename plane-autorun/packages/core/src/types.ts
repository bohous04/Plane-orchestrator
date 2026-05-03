// Shared types between db, orchestrator, runner.

export type RunStatus = "running" | "completed" | "aborted" | "failed";
export type TaskStatus = "queued" | "running" | "success" | "blocked";
export type MergeStatus = "merged" | "conflict" | "skipped" | null;

export interface RunRecord {
  id: string;
  projectId: string;
  runBranch: string;
  runNumber: number;
  startedAt: number;
  endedAt: number | null;
  status: RunStatus;
  totalTasks: number;
  succeeded: number;
  blocked: number;
  totalCostUsd: number;
  prUrl: string | null;
  worktreesDir: string;
  configSnapshot: string; // JSON
}

export interface TaskRecord {
  id: string;
  runId: string;
  planeWorkItemId: string;
  identifier: string;
  title: string;
  description: string;
  subBranch: string;
  worktreePath: string;
  port: number;
  promptPath: string;
  logPath: string;
  outputJsonPath: string;
  status: TaskStatus;
  exitCode: number | null;
  timedOut: 0 | 1;
  costUsd: number | null;
  summary: string | null;
  filesChanged: string | null; // JSON array
  startedAt: number | null;
  endedAt: number | null;
  mergeStatus: MergeStatus;
}
