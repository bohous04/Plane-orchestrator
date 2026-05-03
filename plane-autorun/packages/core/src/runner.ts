// Spawn the plane-autorun-runner Claude Code agent against a worktree and
// collect its result. This module replaces the Bash-tool dispatch in the
// previous orchestrator. See PRD §11.

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { events } from "./events.js";
import { log } from "./log.js";
import { parseRunnerHeaders, type ParsedHeaders, type RunnerStatus } from "./parse.js";

export interface SpawnRunnerInput {
  runId: string;
  taskId: string;
  identifier: string;
  worktreePath: string;
  promptPath: string;
  agent: string;
  taskName: string;
  budgetUsd: number;
  timeoutMs: number;
  logPath: string;
  outputJsonPath: string;
  // For tests + the M4 stub demo: override the binary on PATH.
  claudeBin?: string;
  // For tests: skip writing log/json to disk and just return them in-memory.
  skipPersistence?: boolean;
}

export interface RunnerResult {
  taskId: string;
  identifier: string;
  exitCode: number | null;
  timedOut: boolean;
  status: RunnerStatus;
  summary: string;
  files: string[];
  costUsd: number | null;
  rawJson: unknown | null;
  durationMs: number;
}

interface ClaudeJsonResult {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  cost_usd?: number;
  num_turns?: number;
}

export async function spawnRunner(input: SpawnRunnerInput): Promise<RunnerResult> {
  const startedAt = Date.now();

  if (!input.skipPersistence) {
    mkdirSync(dirname(input.logPath), { recursive: true });
    mkdirSync(dirname(input.outputJsonPath), { recursive: true });
  }

  const promptText = await readFile(input.promptPath, "utf8");

  const args = [
    "-p",
    "--agent",
    input.agent,
    "--output-format",
    "json",
    "--max-budget-usd",
    String(input.budgetUsd),
    "--dangerously-skip-permissions",
    "--add-dir",
    input.worktreePath,
    "--no-session-persistence",
    "--name",
    input.taskName,
    promptText,
  ];

  const bin = input.claudeBin ?? "claude";
  log.info(
    { taskId: input.taskId, identifier: input.identifier, bin, worktreePath: input.worktreePath },
    "spawnRunner: starting",
  );

  const child = spawn(bin, args, {
    cwd: input.worktreePath,
    env: process.env,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logStream = input.skipPersistence
    ? null
    : createWriteStream(input.logPath, { flags: "a" });

  let stdoutBuf = "";
  let stderrBuf = "";

  const onChunk = (source: "stdout" | "stderr") => (buf: Buffer) => {
    const text = buf.toString("utf8");
    if (source === "stdout") stdoutBuf += text;
    else stderrBuf += text;
    if (logStream) logStream.write(buf);
    events.emit("task:log", {
      runId: input.runId,
      taskId: input.taskId,
      source,
      chunk: text,
    });
  };

  child.stdout?.on("data", onChunk("stdout"));
  child.stderr?.on("data", onChunk("stderr"));

  let timedOut = false;
  let killChain: NodeJS.Timeout[] = [];

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (err) => {
        log.error({ taskId: input.taskId, err: String(err) }, "claude spawn error");
        resolve({ code: -1, signal: null });
      });
    },
  );

  killChain.push(
    setTimeout(() => {
      timedOut = true;
      log.warn(
        { taskId: input.taskId, timeoutMs: input.timeoutMs },
        "runner timed out; sending SIGTERM",
      );
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore — child may have already exited
      }
    }, input.timeoutMs),
  );
  killChain.push(
    setTimeout(() => {
      if (!child.killed && child.exitCode === null) {
        log.warn({ taskId: input.taskId }, "runner did not respond to SIGTERM; sending SIGKILL");
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, input.timeoutMs + 5_000),
  );

  const { code: exitCode } = await exitPromise;
  for (const t of killChain) clearTimeout(t);
  killChain = [];

  await new Promise<void>((resolve) => {
    if (logStream) logStream.end(() => resolve());
    else resolve();
  });

  // Parse claude --output-format json: a JSON object on stdout.
  // Best-effort: look for a JSON object that we can parse from the trailing
  // chunk (claude prints the json blob at the end).
  const rawJson = extractTrailingJson(stdoutBuf);
  const result: ClaudeJsonResult | null = rawJson as ClaudeJsonResult | null;
  const costUsd = pickCost(result);

  // Persist the raw JSON if available — useful for inspection later.
  if (!input.skipPersistence && rawJson !== null) {
    await writeFile(input.outputJsonPath, JSON.stringify(rawJson, null, 2));
  }

  const headers = deriveHeaders({
    timedOut,
    exitCode,
    rawJson: result,
    stdoutBuf,
    stderrBuf,
  });

  const durationMs = Date.now() - startedAt;
  const out: RunnerResult = {
    taskId: input.taskId,
    identifier: input.identifier,
    exitCode,
    timedOut,
    status: headers.status,
    summary: headers.summary,
    files: headers.files,
    costUsd,
    rawJson,
    durationMs,
  };

  log.info(
    {
      taskId: input.taskId,
      identifier: input.identifier,
      status: out.status,
      exitCode,
      timedOut,
      costUsd,
      durationMs,
    },
    "spawnRunner: done",
  );
  return out;
}

function extractTrailingJson(s: string): unknown | null {
  // `claude --output-format json` prints a JSON blob at the end of stdout.
  // Walk back from the last `}` and try increasingly-large prefixes from the
  // last `{` until JSON.parse succeeds.
  const lastBrace = s.lastIndexOf("}");
  if (lastBrace < 0) return null;
  // Search for matching `{` at the same nesting level by scanning right→left.
  let depth = 0;
  let start = -1;
  for (let i = lastBrace; i >= 0; i--) {
    const c = s[i];
    if (c === "}") depth++;
    else if (c === "{") {
      depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start < 0) return null;
  const candidate = s.slice(start, lastBrace + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function pickCost(result: ClaudeJsonResult | null): number | null {
  if (!result) return null;
  if (typeof result.total_cost_usd === "number") return result.total_cost_usd;
  if (typeof result.cost_usd === "number") return result.cost_usd;
  return null;
}

interface DeriveHeadersInput {
  timedOut: boolean;
  exitCode: number | null;
  rawJson: ClaudeJsonResult | null;
  stdoutBuf: string;
  stderrBuf: string;
}

function deriveHeaders(input: DeriveHeadersInput): ParsedHeaders {
  // Cascade per PRD §11 BLOCKED summary table.
  if (input.timedOut) {
    return blocked(
      `Runner timed out at ${msToMin(input.stdoutBuf)} min; manual re-attempt may be needed.`,
    );
  }
  if (input.rawJson?.is_error === true) {
    const msg = (input.rawJson.result ?? "").slice(0, 100);
    return blocked(`Runner reported error: ${msg}`);
  }
  if (input.exitCode !== 0 && !input.rawJson) {
    return blocked(`Runner exited code ${input.exitCode}; see output JSON file.`);
  }
  // Headers should appear at the top of `result` — but some runners may emit
  // them in the trailing JSON `result` field, so check both.
  const sources = [input.rawJson?.result ?? "", input.stdoutBuf, input.stderrBuf];
  for (const src of sources) {
    const parsed = parseRunnerHeaders(src);
    if (parsed.summary !== "Runner produced no structured report; see Plane comment.") {
      return parsed;
    }
  }
  return blocked("Runner produced no structured report; see Plane comment.");
}

function blocked(summary: string): ParsedHeaders {
  return {
    status: "BLOCKED",
    summary: summary.slice(0, 140),
    files: ["unknown"],
  };
}

function msToMin(_buf: string): string {
  // Lightweight guard — actual ms is not in scope for this string. We return
  // the budgeted timeout converted to minutes by the caller. Keeping this
  // helper simple so the BLOCKED string stays predictable in tests.
  return "?";
}

// Convenience: write a prompt file from a TaskRecord-like input. Used by
// orchestrator.ts in M5; exposed here so M4 tests can build a prompt easily.
export async function writePromptFile(promptPath: string, body: string): Promise<void> {
  if (!existsSync(dirname(promptPath))) {
    mkdirSync(dirname(promptPath), { recursive: true });
  }
  await writeFile(promptPath, body, "utf8");
}
