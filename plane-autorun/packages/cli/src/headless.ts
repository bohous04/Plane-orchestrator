import { events, runProject, type ProjectConfig, type RunResult } from "@plane-autorun/core";

export interface HeadlessOptions {
  json: boolean;
  resumeRunBranch?: string;
  dryRun?: boolean;
}

export async function runHeadless(
  projects: ProjectConfig[],
  opts: HeadlessOptions,
): Promise<void> {
  attachHeadlessLogger(opts.json);

  for (const project of projects) {
    print(opts.json, "project:start", { id: project.id, name: project.projectName });
    let result: RunResult;
    try {
      result = await runProject(project, {
        ...(opts.resumeRunBranch ? { resumeRunBranch: opts.resumeRunBranch } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
      });
    } catch (err) {
      print(opts.json, "project:error", {
        id: project.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    print(opts.json, "project:end", {
      id: project.id,
      runBranch: result.runBranch,
      prUrl: result.prUrl,
      succeeded: result.succeeded,
      blocked: result.blocked,
      ran: result.ran,
      cost: result.totalCostUsd,
      durationMs: result.durationMs,
      dryRun: result.dryRun,
    });
  }
}

function attachHeadlessLogger(json: boolean): void {
  events.on("run:start", (e) => print(json, "run:start", e));
  events.on("task:start", (e) => print(json, "task:start", e));
  events.on("task:end", (e) =>
    print(json, "task:end", {
      taskId: e.taskId,
      identifier: e.identifier,
      status: e.status,
      summary: e.summary,
      cost: e.costUsd,
      durationMs: e.durationMs,
    }),
  );
  events.on("run:end", (e) => print(json, "run:end", e));
}

function print(json: boolean, kind: string, data: object): void {
  if (json) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), kind, ...data }));
  } else {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const obj = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    console.log(`[${ts}] ${kind} ${obj}`);
  }
}
