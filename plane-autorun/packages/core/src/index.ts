// Public API of @plane-autorun/core.

export const VERSION = "0.1.0";

export { defineConfig, loadConfig, findProject, resolveProjectsByCli, moduleDir } from "./config.js";
export type { ProjectConfig, AutorunConfig, LoadConfigOptions } from "./config.js";

export { events } from "./events.js";
export type {
  CoreEvents,
  RunStartEvent,
  RunEndEvent,
  TaskStartEvent,
  TaskLogEvent,
  TaskEndEvent,
} from "./events.js";

export { openDb, defaultDbPath } from "./db.js";
export type { Db, CredentialStatus } from "./db.js";

export { parseRunnerHeaders } from "./parse.js";
export type { ParsedHeaders, RunnerStatus } from "./parse.js";

export { PortPool } from "./pool.js";

export * as git from "./git.js";
export { GitError } from "./git.js";
export type { MergeInput, MergeReport } from "./git.js";

export { spawnRunner, writePromptFile } from "./runner.js";
export type { SpawnRunnerInput, RunnerResult } from "./runner.js";

export { runProject } from "./orchestrator.js";
export type { RunOptions, RunResult } from "./orchestrator.js";

export { preflight, assertPreflight, PreflightError } from "./preflight.js";
export type { PreflightReport, BinaryCheck } from "./preflight.js";

export { successComment, blockedComment, mergeConflictComment } from "./comment.js";
export { buildPrBody, createDraftPr } from "./pr.js";

export { parseEnv, setEnv, writeEnvKey } from "./envfile.js";
export type { EnvLine } from "./envfile.js";

export { PlaneClient, PlaneApiError, REQUIRED_STATES, stripHtml, escapeHtml } from "./plane.js";
export type {
  PlaneClientOptions,
  PlaneProject,
  PlaneState,
  PlaneUser,
  PlaneWorkItem,
  PlaneSnapshotItem,
} from "./plane.js";

export { log } from "./log.js";
export type { Logger } from "./log.js";

export type {
  RunRecord,
  TaskRecord,
  RunStatus,
  TaskStatus,
  MergeStatus,
} from "./types.js";
