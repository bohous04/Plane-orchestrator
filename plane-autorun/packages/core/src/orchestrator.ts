import pLimit from "p-limit";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import * as gitOps from "./git.js";
import { events } from "./events.js";
import { log } from "./log.js";
import { PortPool } from "./pool.js";
import { PlaneClient, REQUIRED_STATES, type PlaneSnapshotItem, type PlaneState } from "./plane.js";
import { spawnRunner, writePromptFile } from "./runner.js";
import { openDb, defaultDbPath, type Db } from "./db.js";
import { successComment, blockedComment, mergeConflictComment } from "./comment.js";
import { buildPrBody, createDraftPr } from "./pr.js";
import { preflight, assertPreflight } from "./preflight.js";
import type { ProjectConfig } from "./config.js";
import type { RunRecord, TaskRecord } from "./types.js";

export interface RunOptions {
  dryRun?: boolean;
  resumeRunBranch?: string;
  // For tests: stub claude binary
  claudeBin?: string;
  // For tests: don't actually push or open PR
  skipPushAndPr?: boolean;
  // For tests: an explicit Db instance
  db?: Db;
  // For tests: explicit PlaneClient
  plane?: PlaneClient;
}

export interface RunResult {
  runId: string | null;
  runBranch: string | null;
  prUrl: string | null;
  succeeded: number;
  blocked: number;
  conflicts: number;
  totalCostUsd: number;
  durationMs: number;
  ran: number;
  dryRun: boolean;
}

export async function runProject(
  project: ProjectConfig,
  opts: RunOptions = {},
): Promise<RunResult> {
  const startedAt = Date.now();
  log.info({ project: project.id, dryRun: !!opts.dryRun }, "runProject: start");

  // 1. Preflight
  if (!opts.dryRun) {
    const report = await preflight(project.repo, project.branchBase);
    assertPreflight(report);
  } else {
    // For --dry-run we still want repo-clean check but skip the strict assertion.
    log.info({}, "dry-run: skipping strict preflight assertions");
  }

  // 2. Plane resolve
  const token = process.env[project.tokenEnvVar];
  if (!token) {
    throw new Error(`${project.tokenEnvVar} not set`);
  }
  const baseUrl = process.env["PLANE_API_URL"];
  const plane =
    opts.plane ??
    new PlaneClient({
      workspace: project.workspace,
      token,
      ...(baseUrl ? { baseUrl } : {}),
    });

  log.info({ projectName: project.projectName }, "resolving Plane project");
  const planeProjectId = await plane.resolveProjectId(project.projectName);
  const me = await plane.getMe();
  const userId = me.id;

  // ensureStates: creates the two harness states if missing (skipped on dry-run).
  let stateMap: Record<string, PlaneState>;
  if (opts.dryRun) {
    const existing = await plane.listStates(planeProjectId);
    stateMap = Object.fromEntries(existing.map((s) => [s.name, s]));
  } else {
    stateMap = await plane.ensureStates(planeProjectId, REQUIRED_STATES);
  }

  // 3. Snapshot queue
  const queue = await plane.snapshotTodoQueue(planeProjectId, project.identifierPrefix);
  log.info({ queue: queue.length }, "queue snapshotted");

  if (queue.length === 0) {
    return {
      runId: null,
      runBranch: null,
      prUrl: null,
      succeeded: 0,
      blocked: 0,
      conflicts: 0,
      totalCostUsd: 0,
      durationMs: Date.now() - startedAt,
      ran: 0,
      dryRun: !!opts.dryRun,
    };
  }

  if (opts.dryRun) {
    console.log(`\n[dry-run] ${queue.length} items would be processed for ${project.id}:\n`);
    for (const item of queue) {
      const prio = item.priority.padEnd(7);
      console.log(`  ${item.identifier.padEnd(10)} [${prio}] ${item.name}`);
    }
    console.log(`\n[dry-run] No git operations, no spawns, no DB writes.`);
    return {
      runId: null,
      runBranch: null,
      prUrl: null,
      succeeded: 0,
      blocked: 0,
      conflicts: 0,
      totalCostUsd: 0,
      durationMs: Date.now() - startedAt,
      ran: queue.length,
      dryRun: true,
    };
  }

  // 4. Run branch + DB row
  const db = opts.db ?? openDb(defaultDbPath());
  let runRecord: RunRecord;
  let runBranch: string;
  let runbasePath: string;

  if (opts.resumeRunBranch) {
    const existing = db.findRunByBranch(opts.resumeRunBranch);
    if (!existing) {
      throw new Error(`No run found in DB for branch ${opts.resumeRunBranch}`);
    }
    if (existing.status === "completed") {
      log.info({ runBranch: opts.resumeRunBranch }, "resume target already completed; nothing to do");
      return {
        runId: existing.id,
        runBranch: existing.runBranch,
        prUrl: existing.prUrl,
        succeeded: existing.succeeded,
        blocked: existing.blocked,
        conflicts: 0,
        totalCostUsd: existing.totalCostUsd,
        durationMs: 0,
        ran: 0,
        dryRun: false,
      };
    }
    runRecord = existing;
    runBranch = existing.runBranch;
    // Worktree may already exist; re-acquire path.
    runbasePath = join(project.worktreesRoot, runBranch);
    if (!existsSync(runbasePath)) {
      runbasePath = await gitOps.addRunbaseWorktree(project, runBranch);
    }
  } else {
    const runNumber = await gitOps.nextRunNumber(project.repo, project.identifierPrefix);
    runBranch = `${project.identifierPrefix}-AUTORUN-${runNumber}`;
    await gitOps.createRunBranch(project.repo, runBranch, project.branchBase);
    runbasePath = await gitOps.addRunbaseWorktree(project, runBranch);

    const id = randomUUID();
    runRecord = {
      id,
      projectId: project.id,
      runBranch,
      runNumber,
      startedAt,
      endedAt: null,
      status: "running",
      totalTasks: queue.length,
      succeeded: 0,
      blocked: 0,
      totalCostUsd: 0,
      prUrl: null,
      worktreesDir: runbasePath,
      configSnapshot: JSON.stringify(project),
    };
    db.insertRun(runRecord);
  }

  events.emit("run:start", {
    runId: runRecord.id,
    projectId: project.id,
    runBranch,
    queueSize: queue.length,
    startedAt,
  });

  // 5. Pool + concurrency
  const pool = new PortPool(project.ports);
  const limit = pLimit(project.concurrency);

  // Insert task rows up front (skip ones that already exist on resume).
  const existingTasks = new Map<string, TaskRecord>();
  for (const t of db.listTasksForRun(runRecord.id)) existingTasks.set(t.identifier, t);

  const taskRecords: Array<{ record: TaskRecord; queueItem: PlaneSnapshotItem }> = [];
  db.transaction(() => {
    for (const item of queue) {
      const existing = existingTasks.get(item.identifier);
      if (existing) {
        taskRecords.push({ record: existing, queueItem: item });
        continue;
      }
      const subBranch = `${runBranch}--${item.identifier}`;
      const worktreePath = join(runbasePath, item.identifier);
      const promptPath = join(runbasePath, ".prompts", `${item.identifier}.prompt.md`);
      const logPath = join(runbasePath, ".logs", `${item.identifier}.log`);
      const outputJsonPath = join(runbasePath, ".outputs", `${item.identifier}.json`);
      const port = project.ports[taskRecords.length % project.ports.length] ?? project.ports[0]!;

      const r: TaskRecord = {
        id: randomUUID(),
        runId: runRecord.id,
        planeWorkItemId: item.id,
        identifier: item.identifier,
        title: item.name,
        description: item.description_text,
        subBranch,
        worktreePath,
        port,
        promptPath,
        logPath,
        outputJsonPath,
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
      db.insertTask(r);
      taskRecords.push({ record: r, queueItem: item });
    }
  });

  // 6. Process
  type ProcessResult = {
    record: TaskRecord;
    finalStatus: "success" | "blocked";
    summary: string;
    files: string[];
    costUsd: number | null;
    durationMs: number;
    exitCode: number | null;
    timedOut: boolean;
  };

  const processOne = async (
    rec: TaskRecord,
    item: PlaneSnapshotItem,
  ): Promise<ProcessResult> => {
    const port = await pool.acquire();
    const taskStartedAt = Date.now();
    db.updateTaskStatus(rec.id, { status: "running", port, startedAt: taskStartedAt });

    events.emit("task:start", {
      runId: runRecord.id,
      taskId: rec.id,
      identifier: rec.identifier,
      title: rec.title,
      port,
      startedAt: taskStartedAt,
    });

    try {
      // Prepare worktree
      await gitOps.addTaskWorktree(project, runBranch, rec.identifier);
      await gitOps.symlinkNodeModules(project.repo, rec.worktreePath);
      await gitOps.copyEnvFile(project.repo, rec.worktreePath);

      // Prompt
      const promptBody = buildRunnerPrompt({
        identifier: rec.identifier,
        title: item.name,
        description: item.description_text,
        priority: item.priority,
        port,
      });
      await writePromptFile(rec.promptPath, promptBody);

      // Plane: assignee + state in_progress (best-effort)
      void plane.updateWorkItemAssignees(planeProjectId, rec.planeWorkItemId, userId).catch(
        (e) => log.warn({ taskId: rec.id, err: String(e) }, "assignee update failed"),
      );

      const result = await spawnRunner({
        runId: runRecord.id,
        taskId: rec.id,
        identifier: rec.identifier,
        worktreePath: rec.worktreePath,
        promptPath: rec.promptPath,
        agent: project.runnerAgent,
        taskName: `autorun-${rec.identifier}`,
        budgetUsd: project.budgetUsdPerTask,
        timeoutMs: project.timeoutMsPerTask,
        logPath: rec.logPath,
        outputJsonPath: rec.outputJsonPath,
        ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
      });

      const finalStatus = result.status === "SUCCESS" ? "success" : "blocked";
      const taskEndedAt = Date.now();

      db.updateTaskStatus(rec.id, {
        status: finalStatus,
        exitCode: result.exitCode,
        timedOut: result.timedOut ? 1 : 0,
        costUsd: result.costUsd,
        summary: result.summary,
        filesChanged: JSON.stringify(result.files),
        endedAt: taskEndedAt,
      });

      // Plane state update
      const targetState =
        finalStatus === "success"
          ? stateMap["Ready for Review"]
          : stateMap["Blocked / Needs Clarification"];
      if (targetState) {
        await plane
          .updateWorkItemState(planeProjectId, rec.planeWorkItemId, targetState.id)
          .catch((e) => log.warn({ taskId: rec.id, err: String(e) }, "state update failed"));
      }
      // Plane comment
      const commentHtml =
        finalStatus === "success"
          ? successComment({
              identifier: rec.identifier,
              runBranch,
              subBranch: rec.subBranch,
              summary: result.summary,
              files: result.files,
              prUrl: null, // PR is created at the end of the run
              costUsd: result.costUsd,
              durationMs: result.durationMs,
            })
          : blockedComment({
              identifier: rec.identifier,
              runBranch,
              subBranch: rec.subBranch,
              reason: result.summary,
              costUsd: result.costUsd,
              durationMs: result.durationMs,
            });
      await plane
        .createComment(planeProjectId, rec.planeWorkItemId, commentHtml)
        .catch((e) => log.warn({ taskId: rec.id, err: String(e) }, "comment failed"));

      events.emit("task:end", {
        runId: runRecord.id,
        taskId: rec.id,
        identifier: rec.identifier,
        status: finalStatus,
        summary: result.summary,
        files: result.files,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        endedAt: taskEndedAt,
      });

      return {
        record: rec,
        finalStatus,
        summary: result.summary,
        files: result.files,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    } catch (err) {
      const taskEndedAt = Date.now();
      log.error({ taskId: rec.id, err: String(err) }, "processOne failed; marking BLOCKED");
      db.updateTaskStatus(rec.id, {
        status: "blocked",
        summary: `Setup failed: ${String(err).slice(0, 100)}`,
        endedAt: taskEndedAt,
      });
      events.emit("task:end", {
        runId: runRecord.id,
        taskId: rec.id,
        identifier: rec.identifier,
        status: "blocked",
        summary: `Setup failed: ${String(err).slice(0, 100)}`,
        files: [],
        costUsd: null,
        durationMs: taskEndedAt - taskStartedAt,
        exitCode: null,
        timedOut: false,
        endedAt: taskEndedAt,
      });
      return {
        record: rec,
        finalStatus: "blocked",
        summary: `Setup failed: ${String(err).slice(0, 100)}`,
        files: [],
        costUsd: null,
        durationMs: taskEndedAt - taskStartedAt,
        exitCode: null,
        timedOut: false,
      };
    } finally {
      pool.release(port);
    }
  };

  const results = await Promise.all(
    taskRecords.map(({ record, queueItem }) =>
      record.status === "success" || record.status === "blocked"
        ? Promise.resolve<ProcessResult>({
            record,
            finalStatus: record.status,
            summary: record.summary ?? "",
            files: record.filesChanged ? (JSON.parse(record.filesChanged) as string[]) : [],
            costUsd: record.costUsd,
            durationMs: 0,
            exitCode: record.exitCode,
            timedOut: record.timedOut === 1,
          })
        : limit(() => processOne(record, queueItem)),
    ),
  );

  const totalCostUsd = results.reduce((acc, r) => acc + (r.costUsd ?? 0), 0);

  // 7. Merge SUCCESS into run branch
  const mergeReport = await gitOps.mergeSuccessfulSubBranches(
    runbasePath,
    results.map((r) => ({
      identifier: r.record.identifier,
      subBranch: r.record.subBranch,
      status: r.finalStatus,
    })),
  );
  for (const sb of mergeReport.merged) {
    const r = results.find((x) => x.record.subBranch === sb)!;
    db.updateTaskStatus(r.record.id, { mergeStatus: "merged" });
  }
  for (const sb of mergeReport.conflicts) {
    const r = results.find((x) => x.record.subBranch === sb)!;
    db.updateTaskStatus(r.record.id, { mergeStatus: "conflict" });
    await plane
      .createComment(
        planeProjectId,
        r.record.planeWorkItemId,
        mergeConflictComment(r.record.identifier, runBranch, r.record.subBranch),
      )
      .catch((e) =>
        log.warn({ taskId: r.record.id, err: String(e) }, "merge conflict comment failed"),
      );
  }
  for (const sb of mergeReport.skipped) {
    const r = results.find((x) => x.record.subBranch === sb)!;
    db.updateTaskStatus(r.record.id, { mergeStatus: "skipped" });
  }

  // 8. Push + PR
  let prUrl: string | null = null;
  if (!opts.skipPushAndPr) {
    try {
      await gitOps.push(runbasePath, runBranch);
    } catch (e) {
      log.error({ err: String(e) }, "push failed");
    }
    // Push every sub-branch too so partial work is inspectable.
    for (const r of results) {
      try {
        await gitOps.push(runbasePath, r.record.subBranch);
      } catch {
        // best-effort
      }
    }

    try {
      const succeededRecords = results
        .filter((r) => r.finalStatus === "success" && !mergeReport.conflicts.includes(r.record.subBranch))
        .map((r) => db.getTask(r.record.id)!);
      const blockedRecords = results
        .filter((r) => r.finalStatus === "blocked")
        .map((r) => db.getTask(r.record.id)!);
      const conflictRecords = results
        .filter((r) => mergeReport.conflicts.includes(r.record.subBranch))
        .map((r) => db.getTask(r.record.id)!);

      const body = buildPrBody({
        identifierPrefix: project.identifierPrefix,
        runBranch,
        succeeded: succeededRecords,
        blocked: blockedRecords,
        conflicts: conflictRecords,
        totalCostUsd,
        startedAt,
        endedAt: Date.now(),
      });
      const title = `Autorun ${runBranch} — ${succeededRecords.length}/${results.length} succeeded`;
      prUrl = await createDraftPr({
        cwd: runbasePath,
        baseBranch: project.branchBase,
        headBranch: runBranch,
        title,
        bodyHtml: body,
        draft: true,
      });
    } catch (e) {
      log.error({ err: String(e) }, "PR creation failed");
    }
  }

  // 9. Final DB update
  const succeededCount = results.filter((r) => r.finalStatus === "success").length;
  const blockedCount = results.filter((r) => r.finalStatus === "blocked").length;
  const endedAt = Date.now();
  db.updateRunStatus(runRecord.id, {
    status: "completed",
    succeeded: succeededCount,
    blocked: blockedCount,
    totalCostUsd,
    prUrl,
    endedAt,
  });

  events.emit("run:end", {
    runId: runRecord.id,
    status: "completed",
    succeeded: succeededCount,
    blocked: blockedCount,
    prUrl,
    totalCostUsd,
    endedAt,
  });

  return {
    runId: runRecord.id,
    runBranch,
    prUrl,
    succeeded: succeededCount,
    blocked: blockedCount,
    conflicts: mergeReport.conflicts.length,
    totalCostUsd,
    durationMs: endedAt - startedAt,
    ran: results.length,
    dryRun: false,
  };
}

interface RunnerPromptInput {
  identifier: string;
  title: string;
  description: string;
  priority: string;
  port: number;
}

function buildRunnerPrompt(input: RunnerPromptInput): string {
  return [
    `You are the plane-autorun-runner agent processing one work item.`,
    ``,
    `Work item: ${input.identifier}`,
    `Title: ${input.title}`,
    `Priority: ${input.priority}`,
    `Allocated port for dev server (if needed): ${input.port}`,
    ``,
    `Description:`,
    input.description || "(no description)",
    ``,
    `Implement the change inside the current worktree. When done, your final`,
    `output MUST start with these three lines, on their own lines, in this order:`,
    `STATUS: SUCCESS|BLOCKED`,
    `SUMMARY: <one-line description, <140 chars>`,
    `FILES: <comma-separated changed files, or "none">`,
  ].join("\n");
}
