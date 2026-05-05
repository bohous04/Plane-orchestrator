# Plane Autorun Harness — PRD v1

**Owner:** Michal Lenert
**Status:** Ready for implementation
**Target:** Claude Code (Opus / Sonnet)
**Estimated effort:** 1 long weekend for v1 (CLI + TUI + Dashboard with live terminal)

---

## 1. Summary

Replace the current Claude-Code-sub-agent-based `plane-autorun` orchestrator with a TypeScript harness that runs as a normal Node process. Keep the existing `plane-autorun-runner` agent unchanged — it continues to be invoked via `claude -p --agent plane-autorun-runner`. The harness owns everything except the actual code-writing: Plane integration, git/worktree plumbing, child-process orchestration, retries, structured output parsing, merge loop, PR creation.

The harness is multi-project from day one (configured per-Plane-project), ships a pretty Ink-based TUI, and includes a Next.js dashboard with **a live xterm.js terminal view per running task** so the user can see exactly what each Claude Code runner is doing in real time.

This document is prescriptive: paths, schemas, dependencies, API contracts, and acceptance criteria are spelled out. When CC has a real choice to make (e.g. SQLite migration tool), the document picks one.

---

## 2. Background & Motivation

The current setup is two markdown agent files (`plane-autorun.md` orchestrator, `plane-autorun-runner.md` runner) that live in a single repo (`chwdirections`). The orchestrator has three structural problems:

1. **The orchestrator is itself an LLM.** It can decide mid-run that it's done, hit a context pinch and summarize instead of dispatching the next batch, or lose track of the merge step. Claude is good at *deciding* but unreliable at grinding through 30 deterministic steps without losing the thread.
2. **The 10-minute Bash-tool timeout is a hard ceiling.** A runner doing real work (Playwright + a non-trivial fix attempt) gets SIGHUP'd at 600s and is silently demoted to BLOCKED. The orchestrator can't raise this — it's a Claude Code platform limit.
3. **Multi-project is impossible.** Paths, identifier prefix, and ports are hardcoded into `plane-autorun.md`. Adding LNRT.cz or Pohodáři would mean forking the agent file.

The harness fixes all three by being a normal program. The LLM only does the part that needs intelligence (implementing the task inside the worktree).

---

## 3. Goals & Non-Goals

### Goals (must ship in v1)

- **Multi-project.** A single config file lists all Plane projects across all workspaces. CLI selects one, several, or all.
- **Reliable orchestration.** Resumable run state, no time ceiling on individual runners, proper SIGTERM → SIGKILL kill chain, header-parse fallback to BLOCKED.
- **Pretty TUI.** Ink-based progress UI showing the run, per-task status, spinner/check/cross, cost, ETA.
- **Dashboard.** Local Next.js app on the user's headless Mac mini, accessed via Tailscale. Lists runs across projects, drill into a run, drill into a task to see its **live xterm.js terminal**. Settings pages for project config and Plane/GitHub credentials.
- **The runner agent is untouched.** No changes to `plane-autorun-runner.md`. The harness adapts to it, not the other way around.

### Non-goals (explicit v1 cuts)

- **No mid-run requeueing.** Snapshot-once is correct. New Plane tasks added during a run wait for the next trigger.
- **No automatic worktree cleanup.** Leave worktrees on disk for the user to inspect; cleanup is a separate future tool.
- **No multi-tenant dashboard.** Single user, runs locally on the user's machine. Tailscale provides remote access; no public auth layer.
- **No auto-deploy of fixes.** PR is opened as draft; human merges.
- **No support for `mcp__plane__*` (the wrong workspace).** The harness talks Plane REST directly; MCP servers are not used by the harness itself.
- **No keychain integration.** v1 stores secrets in `.env` files (gitignored). Keytar/OS-keychain can come later.
- **No analytics, no telemetry.** This is a personal tool.

---

## 4. Migration: What Stays, What Changes

### Stays

- **`plane-autorun-runner.md`** — same file, same prompt structure, same three-header output contract (`STATUS:` / `SUMMARY:` / `FILES:`).
- **Worktree layout convention** — `<repo>-worktrees/<RUN_BRANCH>/<DOCH-id>/` with symlinked `node_modules` and copied `.env.local`.
- **Run-branch naming** — `<PREFIX>-AUTORUN-<N>` (e.g. `DOCH-AUTORUN-7`, `LNRT-AUTORUN-3`).
- **Sub-branch naming** — `<RUN_BRANCH>--<WORK_ITEM_IDENTIFIER>` (e.g. `DOCH-AUTORUN-7--DOCH-12`). Note the double-dash, not slash.
- **Plane states** — `Ready for Review` (group: started, color: #3B82F6) and `Blocked / Needs Clarification` (group: unstarted, color: #EF4444). Created if missing.

### Changes

- **`plane-autorun.md`** — deleted. Replaced entirely by this harness.
- **MCP-based Plane calls** — replaced with direct REST calls (`fetch` against the Plane API).
- **Bash-tool dispatch with `&` and `wait`** — replaced with `child_process.spawn` and `Promise.all`/`p-limit`.
- **Markdown header parsing** — moved into `parseRunnerOutput()` in TypeScript with proper testing.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CLI (Ink TUI)        Dashboard (Next.js + xterm.js)    │
│       │                          │                       │
│       └──────────┬───────────────┘                       │
│                  │                                       │
│           ┌──────▼──────┐                                │
│           │    @core    │  EventEmitter, orchestrator,   │
│           │   (library) │  Plane client, runner spawn,   │
│           └──────┬──────┘  git ops, SQLite access        │
│                  │                                       │
│        ┌─────────┼──────────┬─────────────┐             │
│        │         │          │             │             │
│   ┌────▼──┐  ┌──▼───┐  ┌───▼────┐   ┌────▼─────┐       │
│   │SQLite │  │ Logs │  │claude  │   │ git CLI  │       │
│   │runs.db│  │  /*  │  │ -p     │   │          │       │
│   └───────┘  └──────┘  └────────┘   └──────────┘       │
└─────────────────────────────────────────────────────────┘
```

Three persistent stores feed every UI:

| Store | Format | Purpose |
|-------|--------|---------|
| `runs.db` | SQLite | Source of truth for runs, tasks, statuses, costs, durations |
| `runs/<branch>/<task>.log` | Append-only text | Raw stdout/stderr from each runner; xterm.js replays/tails |
| In-process `EventEmitter` | RAM | Live events: `run:start`, `task:start`, `task:log`, `task:end`, `run:end`. Browser hooks via SSE; TUI hooks directly. |

**One process model.** The dashboard server *is* the orchestrator runtime. When the user clicks "Start run" in the dashboard, it spawns runners in the same Node process. When the CLI runs locally without a dashboard, the CLI is the runtime. Both import the same `@core` library. SQLite + log files reconcile state if you switch between them.

For v1, do not solve "CLI starts a run, dashboard observes it" — that requires a separate daemon. CLI runs are observed via the TUI; dashboard runs are observed via the browser. They share storage but not live events.

---

## 6. Repository Layout

```
plane-autorun/
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example                    # template; gitignored .env in each runtime package
├── .gitignore                      # node_modules, .env*, runs/, *.db, *.db-journal
├── README.md
├── packages/
│   ├── core/                       # the library — no UI deps
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts            # public API
│   │   │   ├── config.ts           # zod schema, loader
│   │   │   ├── plane.ts            # PlaneClient (REST)
│   │   │   ├── git.ts              # worktree, branch, merge ops via execa
│   │   │   ├── runner.ts           # spawnRunner — the load-bearing piece
│   │   │   ├── orchestrator.ts     # runProject(), the main loop
│   │   │   ├── pool.ts             # PortPool (async semaphore over ports)
│   │   │   ├── db.ts               # better-sqlite3 wrapper + migrations
│   │   │   ├── events.ts           # typed EventEmitter
│   │   │   ├── log.ts              # pino logger
│   │   │   ├── parse.ts            # parseRunnerHeaders()
│   │   │   ├── pr.ts               # gh pr create body builder
│   │   │   └── state.ts            # resumable run state (SQLite-backed)
│   │   └── test/                   # vitest
│   │       ├── parse.test.ts
│   │       ├── pool.test.ts
│   │       └── plane.test.ts       # against a recorded fixture
│   ├── cli/                        # Ink TUI
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── bin/autorun             # node shebang -> dist/cli.js
│   │   └── src/
│   │       ├── cli.ts              # commander entry
│   │       ├── tui/
│   │       │   ├── App.tsx
│   │       │   ├── RunView.tsx
│   │       │   ├── TaskList.tsx
│   │       │   ├── ProgressBar.tsx
│   │       │   └── Summary.tsx
│   │       └── headless.ts         # --no-tui mode for CI/cron
│   └── dashboard/                  # Next.js 15 App Router
│       ├── package.json
│       ├── tsconfig.json
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       ├── postcss.config.mjs
│       ├── app/
│       │   ├── layout.tsx
│       │   ├── page.tsx                          # GET / — runs list
│       │   ├── runs/[runId]/page.tsx             # task grid
│       │   ├── runs/[runId]/tasks/[taskId]/page.tsx  # terminal
│       │   ├── settings/projects/page.tsx
│       │   ├── settings/credentials/page.tsx
│       │   └── api/
│       │       ├── runs/route.ts                 # POST start, GET list
│       │       ├── runs/[runId]/route.ts         # GET detail
│       │       ├── runs/[runId]/events/route.ts  # SSE
│       │       └── tasks/[taskId]/stream/route.ts # SSE for terminal
│       ├── components/
│       │   ├── TerminalView.tsx                  # xterm.js client
│       │   ├── TaskGrid.tsx
│       │   └── RunCard.tsx
│       └── lib/
│           ├── core.ts             # initializes @core singleton for the server
│           └── sse.ts              # SSE helpers
└── projects.config.ts              # the per-project entries
```

Use **pnpm workspaces**. Workspace dependency syntax: `"@plane-autorun/core": "workspace:*"`.

---

## 7. Tech Stack

### Core dependencies

| Package | Why |
|---------|-----|
| `typescript` ^5.6 | Strict mode, target ES2022, NodeNext modules |
| `zod` ^3.23 | Config + API validation |
| `execa` ^9 | Nicer child_process wrapper for git/gh |
| `better-sqlite3` ^11 | Synchronous SQLite, perfect fit for embedded |
| `pino` ^9 | Structured JSON logs |
| `p-limit` ^6 | Concurrency control |
| `dotenv` ^16 | `.env` loading |

### CLI

| Package | Why |
|---------|-----|
| `ink` ^5 | React-for-terminal |
| `react` ^18 | Required by Ink |
| `ink-spinner` ^5 | Loading dots |
| `ink-text-input` ^6 | If interactive prompts ever needed |
| `commander` ^12 | CLI flag parsing |

### Dashboard

| Package | Why |
|---------|-----|
| `next` ^15 | App Router |
| `react` ^18 | Already a dep |
| `tailwindcss` ^3 | Styling |
| `@xterm/xterm` ^5 | Terminal renderer (the `@xterm/*` scope replaced legacy `xterm`) |
| `@xterm/addon-fit` ^0.10 | Resize-to-container |
| `@xterm/addon-web-links` ^0.11 | Clickable URLs in logs |
| `lucide-react` | Icons |

### Dev / test

| Package | Why |
|---------|-----|
| `vitest` ^2 | Tests |
| `@types/node`, `@types/react`, `@types/better-sqlite3` | Types |
| `eslint` + `@typescript-eslint/*` | Linting |
| `tsx` ^4 | Running TS directly during dev |
| `tsup` ^8 | Bundling `core` and `cli` |

### External binaries assumed on PATH

- `git` (>= 2.40 for worktree + porcelain features)
- `gh` (GitHub CLI, authenticated)
- `claude` (Claude Code CLI, authenticated, `claude config get` works)

If any are missing, the harness exits with a clear error at startup.

---

## 8. Configuration

### `projects.config.ts`

The single source of truth for per-project settings. TypeScript so the user gets autocomplete and type errors in their editor.

```ts
// projects.config.ts
import { defineConfig } from "@plane-autorun/core";

export default defineConfig({
  projects: [
    {
      id: "doch",                                            // CLI key, unique
      workspace: "test",                                     // Plane workspace slug
      projectName: "Docházkový systém",                      // matched against Plane project name
      identifierPrefix: "DOCH",                              // e.g. DOCH-12

      repo: "/Users/<you>/Repositories/chwdirections",
      worktreesRoot: "/Users/<you>/Repositories/chwdirections-worktrees",
      branchBase: "main",

      ports: [3055, 3056, 3057, 3058, 3059],
      concurrency: 5,

      runnerAgent: "plane-autorun-runner",
      budgetUsdPerTask: 10,
      timeoutMsPerTask: 30 * 60 * 1000,                      // 30 min, NOT bound by Bash-tool ceiling

      tokenEnvVar: "PLANE_TOKEN_TEST",                       // resolved from .env at runtime
      githubRepo: "LNRTT/chwdirections",                     // for PR URL construction
    },
    // future entries: lnrt, pohodari, ...
  ],
});
```

### Env file (`.env` at workspace root, gitignored)

```bash
# Plane API tokens — one per workspace
PLANE_TOKEN_TEST=plane_api_xxxxxxxxxxxx

# Plane API base — Cloud or self-hosted
PLANE_API_URL=https://api.plane.so/api/v1
# For self-hosted: PLANE_API_URL=https://plane.example.com/api/v1

# GitHub CLI uses gh's own auth; nothing needed here unless we ever bypass gh

# Anthropic key — used by `claude` CLI itself, not by the harness directly,
# but documented here so the user knows it must be set in claude's own config
```

The dashboard's settings page edits this file. Any change requires a process restart for v1 (acceptable; document it).

### Resolving credentials at runtime

- `tokenEnvVar` from project config → looked up in `process.env`
- If missing, log a structured error: `{ project: "doch", error: "PLANE_TOKEN_TEST not set" }` and skip that project (don't crash the whole run).

---

## 9. Data Model (SQLite)

Use `better-sqlite3` with WAL mode. Single file: `runs.db` in the working directory (CLI) or `packages/dashboard/runs.db` (dashboard). Both readers/writers must use WAL; that's the default once you `PRAGMA journal_mode=WAL`.

### Schema

```sql
-- v1 schema. Migration: just check `PRAGMA user_version` and apply if 0.
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  id              TEXT PRIMARY KEY,           -- UUID
  project_id      TEXT NOT NULL,              -- 'doch' from config
  run_branch      TEXT NOT NULL UNIQUE,       -- 'DOCH-AUTORUN-7'
  run_number      INTEGER NOT NULL,           -- 7
  started_at      INTEGER NOT NULL,           -- ms epoch
  ended_at        INTEGER,
  status          TEXT NOT NULL,              -- 'running' | 'completed' | 'aborted' | 'failed'
  total_tasks     INTEGER NOT NULL,
  succeeded       INTEGER NOT NULL DEFAULT 0,
  blocked         INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  pr_url          TEXT,
  worktrees_dir   TEXT NOT NULL,              -- '<root>/DOCH-AUTORUN-7/'
  config_snapshot TEXT NOT NULL               -- JSON of resolved project config
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,        -- UUID
  run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  plane_work_item_id  TEXT NOT NULL,
  identifier          TEXT NOT NULL,           -- 'DOCH-12'
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  sub_branch          TEXT NOT NULL,           -- 'DOCH-AUTORUN-7--DOCH-12'
  worktree_path       TEXT NOT NULL,
  port                INTEGER NOT NULL,
  prompt_path         TEXT NOT NULL,
  log_path            TEXT NOT NULL,
  output_json_path    TEXT NOT NULL,
  status              TEXT NOT NULL,           -- 'queued' | 'running' | 'success' | 'blocked'
  exit_code           INTEGER,
  timed_out           INTEGER NOT NULL DEFAULT 0,
  cost_usd            REAL,
  summary             TEXT,
  files_changed       TEXT,                    -- JSON array
  started_at          INTEGER,
  ended_at            INTEGER,
  merge_status        TEXT                     -- 'merged' | 'conflict' | 'skipped' | NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);

-- credentials_metadata: track which env vars are required for which project,
-- and surface "not set" warnings in the dashboard. Don't store the value.
CREATE TABLE IF NOT EXISTS credentials_status (
  project_id      TEXT PRIMARY KEY,
  token_env_var   TEXT NOT NULL,
  is_set          INTEGER NOT NULL,            -- 0 or 1, refreshed on dashboard load
  last_checked    INTEGER NOT NULL
);

PRAGMA user_version = 1;
```

### `db.ts` API surface

```ts
export interface Db {
  insertRun(run: RunRecord): void;
  updateRunStatus(id: string, patch: Partial<RunRecord>): void;
  insertTask(task: TaskRecord): void;
  updateTaskStatus(id: string, patch: Partial<TaskRecord>): void;
  listRuns(opts?: { projectId?: string; limit?: number }): RunRecord[];
  getRun(id: string): RunRecord | null;
  listTasksForRun(runId: string): TaskRecord[];
  getTask(id: string): TaskRecord | null;
  // resume support
  findRunByBranch(branch: string): RunRecord | null;
  findIncompleteTasks(runId: string): TaskRecord[];
}
```

All writes are synchronous (better-sqlite3 is sync by design). No transactions needed except for `insertRun + insertTasks(...)` which goes inside a single `db.transaction(() => { ... })()`.

---

## 10. Core Library: Orchestrator

### Public API (`packages/core/src/index.ts`)

```ts
export { defineConfig, loadConfig } from "./config.js";
export type { ProjectConfig, AutorunConfig } from "./config.js";

export { runProject, type RunOptions, type RunResult } from "./orchestrator.js";

export { events } from "./events.js";
export type { CoreEvents } from "./events.js";

export { openDb, type Db } from "./db.js";

export { PlaneClient, type PlaneWorkItem, type PlaneState } from "./plane.js";

export { spawnRunner, type RunnerResult } from "./runner.js";
```

### `runProject()` flow

```ts
export async function runProject(
  project: ProjectConfig,
  opts: RunOptions = {}
): Promise<RunResult> {
  // 1. Preflight
  await assertBinariesOnPath();
  await assertRepoClean(project.repo);
  await assertMainFastForwardable(project.repo, project.branchBase);

  // 2. Plane resolve
  const plane = new PlaneClient(project.workspace, getToken(project));
  const planeProjectId = await plane.resolveProjectId(project.projectName);
  const states = await plane.ensureStates(planeProjectId, REQUIRED_STATES);
  const userId = await plane.getMe();

  // 3. Snapshot queue
  const queue = await plane.snapshotTodoQueue(planeProjectId);
  if (queue.length === 0) {
    return { ran: 0, runBranch: null, blocked: 0, succeeded: 0 };
  }

  // 4. Run branch
  const runNumber = await git.nextRunNumber(project.repo, project.identifierPrefix);
  const runBranch = `${project.identifierPrefix}-AUTORUN-${runNumber}`;
  await git.createRunBranch(project.repo, runBranch, project.branchBase);
  const runbase = await git.addRunbaseWorktree(project, runBranch);

  // 5. DB record
  const runId = uuid();
  db.insertRun({ id: runId, projectId: project.id, runBranch, runNumber, status: "running", ... });
  events.emit("run:start", { runId, projectId: project.id, runBranch, queueSize: queue.length });

  // 6. Concurrent runner loop with port pool
  const pool = new PortPool(project.ports);
  const limit = pLimit(project.concurrency);
  const taskRecords: TaskRecord[] = queue.map(/* ... insert into db, emit task:start */);

  const results = await Promise.all(taskRecords.map(t => limit(async () => {
    const port = await pool.acquire();
    try {
      return await processOne(t, port, project, plane, states);
    } finally {
      pool.release(port);
    }
  })));

  // 7. Merge SUCCESS sub-branches into run branch (sorted by identifier)
  await git.mergeSuccessfulSubBranches(runbase, results);
  await git.push(runbase, runBranch);

  // 8. Open draft PR
  const prUrl = await openPullRequest(project, runBranch, results);
  db.updateRunStatus(runId, { status: "completed", prUrl, endedAt: Date.now() });
  events.emit("run:end", { runId, prUrl, succeeded: ..., blocked: ... });

  return { ran: results.length, runBranch, prUrl, succeeded, blocked };
}
```

### `processOne()` per-task contract

For each task:

1. `git.addWorktree(repo, worktreePath, subBranch, runBranch)` — reuse if exists from a resume
2. `fs.symlink(repo/node_modules, worktree/node_modules)` — best-effort, log on failure
3. `fs.copyFile(repo/.env.local, worktree/.env.local)` — only if source exists
4. Write prompt file (see runner section)
5. `events.emit("task:start", ...)` and update Plane assignee + status to "in_progress" if applicable (do this in parallel with the spawn — fire and forget for the Plane side)
6. `await spawnRunner({...})` — logs stream to file + events
7. Parse result, update DB and Plane (state + comment)
8. `events.emit("task:end", { taskId, status, summary, costUsd })`
9. Return record for the merge phase

If any step in 1–4 fails, mark task as BLOCKED with `summary = "Setup failed: <reason>"` and skip the spawn.

---

## 11. Runner Spawn (Critical Component)

This is the file that replaces the Bash-tool dispatch. Get this right and 80% of the orchestrator's reliability problems go away.

### Signature

```ts
// packages/core/src/runner.ts
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { events } from "./events.js";
import { parseRunnerHeaders } from "./parse.js";

export interface SpawnRunnerInput {
  taskId: string;                 // db task id; used for events
  worktreePath: string;
  promptPath: string;             // absolute path; passed via $(cat ...) substitute
  agent: string;                  // "plane-autorun-runner"
  taskName: string;               // "autorun-DOCH-12"
  budgetUsd: number;
  timeoutMs: number;
  logPath: string;                // append-only file for xterm.js replay
  outputJsonPath: string;         // tee target for the JSON result
}

export interface RunnerResult {
  taskId: string;
  exitCode: number;
  timedOut: boolean;
  status: "SUCCESS" | "BLOCKED";
  summary: string;
  files: string[];
  costUsd: number | null;
  rawJson: unknown | null;
  durationMs: number;
}

export async function spawnRunner(input: SpawnRunnerInput): Promise<RunnerResult> { ... }
```

### Implementation requirements

- **Pipe stdout/stderr both to a log file AND to events.** Each chunk:
  ```ts
  child.stdout.on("data", (buf: Buffer) => {
    const chunk = buf.toString("utf8");
    logFile.write(buf);
    events.emit("task:log", { taskId, source: "stdout", chunk });
  });
  ```
- **Capture stdout for JSON parsing.** Concatenate into a string. The runner's final JSON is the *whole stdout*, not a tee.
- **Kill chain:**
  ```ts
  let timedOut = false;
  const softKillTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, input.timeoutMs);
  const hardKillTimer = setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
  }, input.timeoutMs + 5_000);
  ```
- **Argv form, not shell form.** Pass the prompt as an argv entry, not via shell substitution. Read the prompt file at JS level:
  ```ts
  const promptText = await readFile(input.promptPath, "utf8");
  const args = [
    "-p",
    "--agent", input.agent,
    "--output-format", "json",
    "--max-budget-usd", String(input.budgetUsd),
    "--dangerously-skip-permissions",
    "--add-dir", input.worktreePath,
    "--no-session-persistence",
    "--name", input.taskName,
    promptText,    // single positional arg, no shell quoting hell
  ];
  const child = spawn("claude", args, { cwd: input.worktreePath });
  ```
- **Env passthrough.** Inherit `process.env` so `claude` finds its own auth.
- **No detach.** Default `detached: false` — the child dies with the parent.
- **Write both log file AND output JSON file.** Logs are the streamed chunks; the output JSON file is the parsed JSON for inspection. Both serve different purposes.

### Header parsing (`parse.ts`)

```ts
export function parseRunnerHeaders(resultText: string): {
  status: "SUCCESS" | "BLOCKED";
  summary: string;
  files: string[];
} {
  const lines = resultText.split("\n").slice(0, 10);
  const statusM = lines.map(l => l.match(/^\s*STATUS:\s*(SUCCESS|BLOCKED)\s*$/)).find(Boolean);
  const summaryM = lines.map(l => l.match(/^\s*SUMMARY:\s*(.+)$/)).find(Boolean);
  const filesM = lines.map(l => l.match(/^\s*FILES:\s*(.+)$/)).find(Boolean);

  if (!statusM || !summaryM || !filesM) {
    return {
      status: "BLOCKED",
      summary: "Runner produced no structured report; see Plane comment.",
      files: ["unknown"],
    };
  }
  const files = filesM[1] === "none" ? [] : filesM[1].split(",").map(s => s.trim()).filter(Boolean);
  return {
    status: statusM[1] as "SUCCESS" | "BLOCKED",
    summary: summaryM[1].trim().slice(0, 140),
    files,
  };
}
```

### BLOCKED summary table (matches existing orchestrator behavior)

| Condition | summary |
|-----------|---------|
| `timedOut === true` | `"Runner timed out at <N> min; manual re-attempt may be needed."` |
| `exitCode !== 0 && !rawJson` | `"Runner exited code <N>; see output JSON file."` |
| `rawJson?.is_error === true` | `"Runner reported error: <first 100 chars>."` |
| Headers missing in `result` | `"Runner produced no structured report; see Plane comment."` |

---

## 12. Plane API Client

Direct REST. No MCP.

### Auth

Plane Cloud uses `Authorization: <token>` (no `Bearer` prefix). Self-hosted uses the same. Token is per-workspace, comes from `process.env[project.tokenEnvVar]`.

### Endpoints used

Replace `{w}` with workspace slug, `{p}` with Plane project UUID.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/workspaces/{w}/projects/` | Resolve project name → UUID |
| GET | `/users/me/` | Get user UUID for assignee |
| GET | `/workspaces/{w}/projects/{p}/states/` | List states |
| POST | `/workspaces/{w}/projects/{p}/states/` | Create missing states |
| GET | `/workspaces/{w}/projects/{p}/issues/` | Snapshot queue (paginated) |
| PATCH | `/workspaces/{w}/projects/{p}/issues/{id}/` | Update state, assignees |
| POST | `/workspaces/{w}/projects/{p}/issues/{id}/comments/` | Post HTML comment |

### Critical implementation notes

- **Pagination.** Plane returns `next_cursor` style or `?per_page=100&cursor=...`. Loop until `next_cursor` is null.
- **Filter by state group.** Query `?state__group=backlog,unstarted` and **also** filter client-side to `state.name in ("Todo","Backlog")` — Plane's groups can include other states.
- **Sort.** Client-side: priority (urgent>high>medium>low>none), then `created_at` ascending.
- **Identifier validation.** Compute `${prefix}-${sequence_id}`, then assert `^[A-Z]+-[0-9]+$`. Drop malformed.
- **Assignee preservation.** PATCHing `assignees` REPLACES the array. Read existing first, then patch with `unique([...existing, userId])`.
- **Retry policy.** Single retry after 5s on 5xx or network error. Two consecutive failures = log and continue (don't abort the run for one comment).
- **Don't `retrieve_work_item`** — there's a Pydantic bug in Plane's MCP for items with non-empty assignees, but the REST endpoint may have its own quirks; just rely on the snapshot list response which already contains `description_html` and `description_stripped`.

### Comment HTML

Build with template strings. **HTML-escape `<`, `>`, `&` inside `<pre>` blocks** before sending. No emojis. Use clean `<p>`, `<ul><li>`, `<ol><li>`, `<code>`, `<a href="...">`.

---

## 13. Git Operations

All via `execa` for proper stdio capture and exit codes. Wrap each in a typed function.

```ts
// packages/core/src/git.ts
export async function nextRunNumber(repo: string, prefix: string): Promise<number>;
export async function createRunBranch(repo: string, runBranch: string, base: string): Promise<void>;
export async function addRunbaseWorktree(project: ProjectConfig, runBranch: string): Promise<string>;
export async function addTaskWorktree(project: ProjectConfig, runBranch: string, identifier: string): Promise<{ worktreePath: string; subBranch: string }>;
export async function symlinkNodeModules(repo: string, worktreePath: string): Promise<void>;
export async function copyEnvFile(repo: string, worktreePath: string): Promise<void>;
export async function mergeSuccessfulSubBranches(runbase: string, results: ProcessOneResult[]): Promise<MergeReport>;
export async function push(cwd: string, branch: string): Promise<void>;
export async function pruneStaleWorktrees(repo: string): Promise<void>;
export async function isRepoClean(repo: string): Promise<boolean>;
export async function isFastForwardable(repo: string, base: string): Promise<boolean>;
```

### Behaviors that must match the existing orchestrator

- Pre-flight: `git worktree prune`, `git fetch origin --prune`
- Run-branch creation: `git switch <base> && git pull --ff-only origin <base> && git switch -c <runBranch>`
- Run-branch push retry: one retry after 5s before giving up
- Sub-branch reuse on resume: if `git worktree add <path> -b <branch>` fails because branch exists, retry with `git worktree add <path> <branch>` (no `-b`)
- Merge order: SUCCESS results sorted by `identifier` ascending, deterministic across reruns
- On merge conflict: `git merge --abort`, mark task `merge_status = "conflict"`, post Plane comment with manual-resolve instructions
- Per-batch push of `runBranch` so progress is durable on crash. (With concurrent rather than batch processing, push the run branch after every N merges, e.g. every 5 — keeps origin reasonably fresh without thrashing it.)
- Never `--force`, never `--no-verify`, never `--amend`

---

## 14. CLI + TUI

### Flags

```bash
autorun --project doch                 # one project
autorun --project doch,lnrt            # several
autorun --workspace test               # all projects in workspace 'test'
autorun --all                          # every project in projects.config.ts
autorun --resume DOCH-AUTORUN-7        # pick up where we left off

autorun --dry-run                      # snapshot queue, print, exit; don't touch git
autorun --no-tui                       # plain stdout (for cron / launchd)
autorun --json                         # JSON-line output, for piping (implies --no-tui)
autorun --verbose                      # debug logs

autorun config check                   # validate projects.config.ts + env vars; exit non-zero on issues
autorun config list                    # print resolved config
autorun ls                             # list recent runs from SQLite
autorun ls <runBranch>                 # task table for a run
```

### TUI layout

Single-screen, no scrolling, redraws in place. Sketch:

```
Plane Autorun · doch · DOCH-AUTORUN-7
─────────────────────────────────────────────────────────────
[████████████░░░░░░] 12/30 tasks · $4.23 · 18m elapsed · ETA 22m

  DOCH-12   ✓  Add empty-state to /admin/employees
  DOCH-13   ✓  Tighten role guard on /api/employees
  DOCH-14   ⠴  (running on :3055)
  DOCH-15   ⠴  (running on :3056)  ← cursor: press Enter to tail
  DOCH-16   ⠴  (running on :3057)
  DOCH-17   ⠴  (running on :3058)
  DOCH-18   ⠴  (running on :3059)
  DOCH-19   ✗  BLOCKED: Acceptance criteria too vague
  DOCH-20      queued
  ...
─────────────────────────────────────────────────────────────
q quit · ↑↓ navigate · Enter tail logs · b open browser
```

### Implementation

- `<App>` root subscribes to `events` and holds `{ run, tasks }` in state.
- `useEffect(() => events.on("task:start", handler), [])` etc. Clean up on unmount.
- `<TaskList>` maps `tasks` to `<TaskRow>`. Show spinner via `ink-spinner`, ✓ / ✗ as plain text.
- `<ProgressBar>` renders the `[████░░]` bar manually; don't use `ink-progress-bar` if it's unmaintained — easy to do with `█` and `░` characters and `text-clip`.
- Pressing `Enter` on a row pipes that task's log to stdout in a side panel (or, simpler, opens `tail -f <logPath>` in a new pty via `node-pty` — but `node-pty` is heavy; v1 can just exit the TUI and `tail -f` the file).
- Pressing `b` runs `open http://localhost:3000/runs/<runId>` (macOS) so the dashboard opens in the browser at the right page.

### Headless mode (`--no-tui`)

```
[2026-05-03T12:00:00] run:start project=doch branch=DOCH-AUTORUN-7 queue=30
[2026-05-03T12:00:01] task:start id=DOCH-12 port=3055
[2026-05-03T12:03:42] task:end id=DOCH-12 status=success cost=$0.42 dur=3m41s
...
[2026-05-03T12:42:00] run:end branch=DOCH-AUTORUN-7 succeeded=27 blocked=3 cost=$11.40 pr=https://github.com/...
```

One pino JSON line per event when `--json`; pretty when not.

---

## 15. Dashboard

### Pages

| Path | Purpose |
|------|---------|
| `/` | List of recent runs across all projects, status pills, click into any |
| `/runs/[runId]` | Task grid for one run; live updates via SSE |
| `/runs/[runId]/tasks/[taskId]` | xterm.js terminal + metadata sidebar |
| `/settings/projects` | View/edit `projects.config.ts` (read-only on v1; just display the resolved config; *editing comes later*) |
| `/settings/credentials` | View which env vars are set/unset; form to edit `.env` (with restart warning) |

### API routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/runs` | List runs (newest first, optional `?projectId=`) |
| `POST` | `/api/runs` | Start a run. Body: `{ projectId: string, dryRun?: boolean }`. Returns `{ runId, runBranch }` after preflight; the run continues in the background. |
| `GET` | `/api/runs/:runId` | Run + task list |
| `GET` | `/api/runs/:runId/events` | SSE: relays `task:start`, `task:end`, `run:end` for that run |
| `GET` | `/api/tasks/:taskId/stream` | SSE: replays `<logPath>` then tails new chunks via `events.on("task:log", ...)` filtered by taskId |
| `GET` | `/api/config` | Resolved config (for settings page) |
| `GET` | `/api/credentials/status` | Per-project: which env vars are set |

### Live updates: Server-Sent Events

Use SSE not WebSockets. One-way data, native `EventSource` browser support, survives proxies, automatic reconnect. The `Cache-Control: no-cache` and `Content-Type: text/event-stream` headers are essential.

Critical pattern for `/api/tasks/:taskId/stream`:

1. On connection: read the entire log file from disk, push it as one SSE event (so reopening a finished task replays everything).
2. Then attach `events.on("task:log", ...)` with a filter on `taskId`.
3. On `task:end` for that taskId: push a final `{ kind: "end" }` event and close the stream.
4. On client disconnect: detach the event listener (memory leak prevention).

### TerminalView (the headline feature)

```tsx
"use client";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export function TerminalView({ taskId }: { taskId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "ui-monospace, Menlo, Consolas, monospace",
      theme: { background: "#0a0a0a", foreground: "#e5e5e5" },
      convertEol: true,
      scrollback: 50_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current!);
    fit.fit();

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.kind === "end") es.close();
      else if (data.chunk) term.write(data.chunk);
    };

    return () => {
      es.close();
      term.dispose();
      window.removeEventListener("resize", onResize);
    };
  }, [taskId]);

  return <div ref={ref} className="h-[600px] w-full" />;
}
```

### Visual style

Tailwind. Stick to `slate` and a single accent (e.g. `indigo-500` for "running", `emerald-500` for success, `rose-500` for blocked). System font for UI, monospace for code/terminal. Cards: `bg-slate-900 border border-slate-800 rounded-lg p-4`.

Dark mode only on v1 (the user runs Mac, terminals are dark, dashboard is for monitoring).

---

## 16. Credentials & Secrets

### v1 storage

`.env` files. Two locations:

- `<repo-root>/.env` — orchestrator's own env (Plane tokens, Plane API URL)
- The host's user `.env` for `claude` is unaffected — that's `claude config`.

`.gitignore` must include `.env`, `.env.local`, `.env.*.local`. The dashboard never reads `.env` from disk for display except to compute "is this var set"; it only writes to `.env` from the settings form.

### Settings page UX

- Show one row per `tokenEnvVar` mentioned in `projects.config.ts`.
- Status: `set` (don't show value) or `not set` (warn).
- Inline form: a password-masked input + Save button.
- On save: rewrite `.env` preserving comments and other vars; show banner: "Restart `pnpm autorun` or the dashboard server for changes to take effect."

### Out of scope for v1

- Per-user credentials (single-tenant)
- Encrypted at rest (covered by FileVault and the user's own machine security)
- OAuth flows
- Plane SSO

---

## 17. Live Terminal Streaming — End-to-End Detail

This is the highest-risk part of v1. Spec it explicitly.

### Capture (`spawnRunner`)

```ts
const logFile = createWriteStream(input.logPath, { flags: "a" });

const onChunk = (source: "stdout" | "stderr") => (buf: Buffer) => {
  logFile.write(buf);
  events.emit("task:log", { taskId: input.taskId, source, chunk: buf.toString("utf8") });
};

child.stdout.on("data", onChunk("stdout"));
child.stderr.on("data", onChunk("stderr"));
```

### SSE relay

```ts
// dashboard/app/api/tasks/[taskId]/stream/route.ts
export async function GET(req: Request, { params }: { params: { taskId: string } }) {
  const { taskId } = params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      // 1. Replay file
      try {
        const existing = await readFile(getLogPath(taskId), "utf8");
        if (existing) send({ kind: "chunk", chunk: existing });
      } catch { /* log doesn't exist yet, fine */ }

      // 2. Live tail
      const onLog = (e: { taskId: string; chunk: string }) => {
        if (e.taskId !== taskId) return;
        send({ kind: "chunk", chunk: e.chunk });
      };
      const onEnd = (e: { taskId: string }) => {
        if (e.taskId !== taskId) return;
        send({ kind: "end" });
        cleanup();
        controller.close();
      };
      const cleanup = () => {
        events.off("task:log", onLog);
        events.off("task:end", onEnd);
      };
      events.on("task:log", onLog);
      events.on("task:end", onEnd);

      req.signal.addEventListener("abort", () => {
        cleanup();
        try { controller.close(); } catch {}
      });

      // 3. Heartbeat to keep proxies happy
      const hb = setInterval(() => send({ kind: "heartbeat" }), 15_000);
      req.signal.addEventListener("abort", () => clearInterval(hb));
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

### Browser render

xterm.js writes raw bytes including ANSI colors. Claude Code's output uses ANSI colors; they render correctly. No additional parsing required.

### Edge cases the implementation must handle

- Task is already finished when the user opens the page: only the file replay runs, no live events arrive, the stream emits one chunk and one `end` and closes.
- Task is queued but not started: file doesn't exist yet. Stream waits on `task:start` (add another listener, or just wait for the first `task:log`).
- Process crashes mid-stream: SSE connection survives because the file replay already happened; subsequent runs of the same task in a different run get a new taskId.
- Browser tab backgrounded for hours: SSE auto-reconnects; the replay re-runs and the user sees the full history. (To avoid duplicate scrollback, accept that for v1 — dedup is complex.)

---

## 18. Build Order (Milestones)

Each milestone is independently demoable. CC works one at a time and stops to verify with the user.

### M0 — Bootstrap (≈ 1 hour)

- Initialize pnpm workspace, three packages, base `tsconfig`, `.gitignore`, `.env.example`, `README.md`.
- Set up `vitest`, `eslint`, `tsx` scripts.
- `pnpm -r build` succeeds (each package has a `dist/`).
- **Demo:** `pnpm tsc --noEmit` clean across the workspace.

### M1 — Core data plumbing (≈ 3 hours)

- `db.ts` with the schema and the API surface.
- `events.ts` with typed `EventEmitter`.
- `config.ts` with zod schema and `loadConfig`.
- `parse.ts` with `parseRunnerHeaders` + tests.
- `pool.ts` with `PortPool` + tests (fairness, FIFO).
- **Demo:** `pnpm vitest run` — all green.

### M2 — Plane client (≈ 3 hours)

- `PlaneClient` with: `resolveProjectId`, `getMe`, `listStates`, `createState`, `ensureStates`, `snapshotTodoQueue`, `updateWorkItemState`, `updateWorkItemAssignees`, `createComment`.
- Pagination, retry-once-on-5xx.
- Fixture-based tests using recorded JSON.
- **Demo:** `pnpm tsx scripts/snapshot-queue.ts doch` prints the live Plane queue from the user's actual workspace.

### M3 — Git ops (≈ 2 hours)

- All functions in section 13 above.
- Each wrapped in a typed exec via execa with descriptive errors.
- **Demo:** `pnpm tsx scripts/dry-run-git.ts doch` prepares a fake `DOCH-AUTORUN-99` run-branch + 1 worktree, then cleans up. Verifies symlink, env copy, branch creation.

### M4 — `spawnRunner` end-to-end (≈ 4 hours)

- `runner.ts` with the full implementation from section 11.
- Integration test: spawns a fake `claude` script (a bash one-liner emitting the three headers + JSON) and asserts the parsed result.
- Then a real test: pick one DOCH task manually, run the runner against it, observe a working SUCCESS or BLOCKED.
- **Demo:** `pnpm tsx scripts/run-one.ts <DOCH-id>` — runs one real task end-to-end in a real worktree, no orchestrator above it.

### M5 — Orchestrator + headless CLI (≈ 4 hours)

- `orchestrator.ts` wiring everything together.
- `cli.ts` with commander, `--no-tui` mode, `--dry-run`, `--project`.
- **Demo:** `autorun --project doch --no-tui` runs the full queue, opens a draft PR, prints structured progress lines.

### M6 — TUI (≈ 4 hours)

- Ink components per section 14.
- Live updates via `events`.
- **Demo:** Same run as M5 but with the pretty UI.

### M7 — Dashboard skeleton (≈ 4 hours)

- Next.js scaffolding, Tailwind, layout, `/`, `/runs/[runId]`.
- Reads from SQLite (no live updates yet).
- **Demo:** Visit `localhost:3000`, see past runs, click into one, see task list.

### M8 — SSE for run progress (≈ 2 hours)

- `/api/runs/:runId/events`.
- Task grid lights up in real time during a run.
- **Demo:** Start a run via CLI on one terminal; watch the dashboard update live in another.

### M9 — xterm.js task view (≈ 4 hours)

- `/runs/[runId]/tasks/[taskId]/page.tsx` with `<TerminalView>`.
- `/api/tasks/:taskId/stream` with file replay + live tail.
- **Demo:** Click a task during a run, watch its Claude Code output stream into the browser.

### M10 — Settings + credentials (≈ 3 hours)

- `/settings/projects` (read-only).
- `/settings/credentials` with `.env` editor.
- `autorun config check` CLI command.
- **Demo:** Add a new project to `projects.config.ts`, restart, see it appear in the dashboard. Edit the token via UI.

### M11 — Resume support (≈ 2 hours)

- `--resume <runBranch>` reuses existing worktrees, skips completed tasks.
- Run state stored in `runs` + `tasks` tables; resume reads from there.
- **Demo:** Kill a run mid-flight (Ctrl-C), then `autorun --resume DOCH-AUTORUN-7` picks up.

### Totals

≈ **35 hours** of focused work for the full v1. A long weekend if uninterrupted; more realistically two weekends.

---

## 19. Hard Constraints

These are non-negotiable. They mirror the existing orchestrator's hard rules + new harness-specific ones.

1. **Never modify `plane-autorun-runner.md`.** The runner agent's contract is fixed input.
2. **Never push to `main`** in any monitored repo.
3. **Never `--force`-push, never `--no-verify`, never `--amend`.**
4. **Never run `npm install`** in the main repo or any worktree. Worktrees use a symlink to the main `node_modules`.
5. **Never modify `package.json`, `prisma/schema.prisma`, env files, CI workflows, or `Dockerfile`** in the monitored repo from the harness side. (The runner's own do-not-touch list still applies inside the worktree.)
6. **Never delete worktrees.** Leave them for human inspection.
7. **Never log secrets.** Apply the runner's redaction patterns to *anything* the harness pastes into a Plane comment or PR body. Log raw `PLANE_TOKEN_*` values nowhere.
8. **Never use `mcp__plane__*`.** Wrong workspace. The harness uses Plane REST directly.
9. **Always emit events through the `events` singleton.** Don't bypass it; the dashboard depends on every state transition flowing through there.
10. **All file paths in config and DB are absolute.** No relative paths. The dashboard server and CLI may run from different cwds.
11. **One Claude Code child process per task at any time.** Concurrency is enforced by the port pool + `pLimit`.

---

## 20. Acceptance Criteria

A run is correct if and only if:

- **Plane state.** Every task in the snapshotted queue ends up in either `Ready for Review` or `Blocked / Needs Clarification`. No task left in `Todo` / `Backlog` (unless the harness genuinely never reached it due to abort).
- **Plane comments.** Every task has at least one autorun comment with the structured fields (status, summary, branch, manual test steps for SUCCESS; reason and what's needed for BLOCKED).
- **Git state.** `<RUN_BRANCH>` exists on origin. Each SUCCESS task has its sub-branch on origin. SUCCESS sub-branches are merged into `<RUN_BRANCH>` in identifier order. BLOCKED sub-branches are pushed (so users can inspect partial work) but not merged.
- **PR.** One draft PR exists from `<RUN_BRANCH>` to `main` with the structured body.
- **DB.** `runs` row has `status='completed'`, correct counts, `pr_url` set. Every task has a final `status`, `exit_code`, `cost_usd`.
- **Logs.** Every task's `log_path` exists and contains stdout/stderr. Every task's `output_json_path` exists if the runner produced JSON (may be missing/empty for crashed runners — that's fine, mark BLOCKED).
- **Dashboard.** The `/runs/<runId>` page shows the run with correct counts; clicking a task loads its terminal output.
- **TUI.** `autorun --project doch` shows the live UI, exits cleanly on completion, leaves no orphan processes.

A failing run still has a defined outcome:

- Single task crash → that task is BLOCKED, run continues.
- Plane API down → retry once, then continue without the comment (record the failure in DB).
- All Plane API calls fail → still produce the run branch and the PR, but with a body noting Plane was unreachable.
- User Ctrl-C → run state is saved, `--resume` works.

---

## 21. Open Questions for User (Resolve Before M2)

Things CC should ask before starting work, because the answer affects implementation:

1. **Plane instance.** Cloud (`api.plane.so`) or self-hosted (`plane.example.com` or wherever)? The auth header format and base URL depend on this.
2. **Plane API token scope.** Workspace-level or personal? Needed to confirm the env-var-per-workspace design holds across all the user's instances.
3. **Mac mini path.** `/Users/<you>/Repositories/` is the chwdirections root. Do other projects (LNRT, Pohodáři) live under the same parent dir? If so, `worktreesRoot` can default to `<repo>-worktrees` rather than being explicit per project.
4. **Tailscale tailnet name.** For documenting the dashboard URL pattern.
5. **GitHub CLI auth.** Is `gh auth status` already working on the Mac mini's user account?

Defaults to assume if the user doesn't answer:

1. Plane Cloud, `https://api.plane.so/api/v1`.
2. Workspace token; one per workspace via env var.
3. Same parent dir; default `worktreesRoot` to `<repo>-worktrees` sibling.
4. Document `https://autorun.<your-tailnet>.ts.net` as a placeholder.
5. Yes; if `gh auth status` fails at startup, exit with an error directing the user to run `gh auth login`.

---

## 22. Out of Scope (v1) — Explicit Cuts

Document these in the README so future-you doesn't go looking:

- Multi-user dashboard with auth
- OAuth for Plane / GitHub
- Webhook-based Plane triggers ("a new task appeared, autorun it")
- Cross-project parallelism (running DOCH and LNRT autoruns simultaneously)
- Worktree garbage collection
- Cost dashboards, daily summaries, billing alerts
- Slack/Discord notifications on run completion
- Deploy targets (the dashboard is local; Coolify deployment is future work)
- Encrypted secret storage (keytar)
- A Mac menubar app
- Automatic merge of the run PR

These are good ideas. None of them are v1.

---

## 23. README starter (CC writes this last)

The repo's `README.md` should cover, in order:

1. What it is, one paragraph.
2. Prereqs (Node 22+, pnpm, git, gh, claude CLI).
3. Setup (clone, `pnpm install`, copy `.env.example`, fill tokens, edit `projects.config.ts`).
4. Running: `pnpm autorun --project doch`.
5. Dashboard: `pnpm dashboard dev` then `http://localhost:3000`.
6. Where things go (`runs/`, `runs.db`, log paths).
7. Hard rules quick reference (no force push, no `--no-verify`, etc.).
8. Troubleshooting (token not set, gh not authed, claude not found).

---

## 24. First message CC should produce

Before writing any code, CC should reply with:

1. A summary of what it understands the build is.
2. The five questions in section 21, asking for answers.
3. A proposed branch name for the work.
4. Confirmation it will work milestone-by-milestone with checkpoints.

Then wait for the user.
