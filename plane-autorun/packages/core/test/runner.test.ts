import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { mkdtempSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { events } from "../src/events.js";
import { spawnRunner } from "../src/runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FX_DIR = join(__dirname, "fixtures");

const SUCCESS_BIN = join(FX_DIR, "stub-claude-success.sh");
const BLOCKED_BIN = join(FX_DIR, "stub-claude-blocked.sh");
const ERROR_BIN = join(FX_DIR, "stub-claude-error.sh");
const NO_HEADERS_BIN = join(FX_DIR, "stub-claude-no-headers.sh");
const HANG_BIN = join(FX_DIR, "stub-claude-hang.sh");

beforeAll(() => {
  for (const b of [SUCCESS_BIN, BLOCKED_BIN, ERROR_BIN, NO_HEADERS_BIN, HANG_BIN]) {
    chmodSync(b, 0o755);
  }
});

let tmp: string;
beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "runner-"));
});

async function makeInput(overrides: Partial<Parameters<typeof spawnRunner>[0]> = {}) {
  const promptPath = join(tmp, "prompt.md");
  await writeFile(promptPath, "Stub prompt body.\n");
  return {
    runId: "run-1",
    taskId: "task-1",
    identifier: "DOCH-12",
    worktreePath: tmp,
    promptPath,
    agent: "plane-autorun-runner",
    taskName: "autorun-DOCH-12",
    budgetUsd: 1,
    timeoutMs: 5_000,
    logPath: join(tmp, "task.log"),
    outputJsonPath: join(tmp, "task.json"),
    ...overrides,
  };
}

describe("spawnRunner", () => {
  it("parses SUCCESS from stub claude", async () => {
    const input = await makeInput({ claudeBin: SUCCESS_BIN });
    const out = await spawnRunner(input);
    expect(out.status).toBe("SUCCESS");
    expect(out.summary).toBe("stub task done");
    expect(out.files).toEqual(["stub.ts"]);
    expect(out.exitCode).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(out.costUsd).toBe(0.42);
  });

  it("parses BLOCKED from stub claude", async () => {
    const input = await makeInput({ claudeBin: BLOCKED_BIN });
    const out = await spawnRunner(input);
    expect(out.status).toBe("BLOCKED");
    expect(out.summary).toBe("ambiguity in spec");
    expect(out.files).toEqual([]);
    expect(out.costUsd).toBe(0.1);
  });

  it("BLOCKED on is_error=true with error message", async () => {
    const input = await makeInput({ claudeBin: ERROR_BIN });
    const out = await spawnRunner(input);
    expect(out.status).toBe("BLOCKED");
    expect(out.summary).toMatch(/sandbox blew up/);
    expect(out.exitCode).toBe(1);
  });

  it("BLOCKED with default summary when headers are missing", async () => {
    const input = await makeInput({ claudeBin: NO_HEADERS_BIN });
    const out = await spawnRunner(input);
    expect(out.status).toBe("BLOCKED");
    expect(out.summary).toMatch(/no structured report/i);
  });

  it("emits task:log events for each chunk", async () => {
    const chunks: string[] = [];
    const handler = (e: { taskId: string; chunk: string }) => {
      if (e.taskId === "task-1") chunks.push(e.chunk);
    };
    events.on("task:log", handler);
    try {
      const input = await makeInput({ claudeBin: SUCCESS_BIN });
      await spawnRunner(input);
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join("")).toMatch(/working/);
    } finally {
      events.off("task:log", handler);
    }
  });

  it("writes log file and output json file", async () => {
    const input = await makeInput({ claudeBin: SUCCESS_BIN });
    await spawnRunner(input);
    const { readFile } = await import("node:fs/promises");
    const log = await readFile(input.logPath, "utf8");
    expect(log).toMatch(/working/);
    const json = JSON.parse(await readFile(input.outputJsonPath, "utf8"));
    expect(json.is_error).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("kills hung process via SIGTERM then SIGKILL", async () => {
    const input = await makeInput({
      claudeBin: HANG_BIN,
      timeoutMs: 200, // very short
    });
    const out = await spawnRunner(input);
    expect(out.timedOut).toBe(true);
    expect(out.status).toBe("BLOCKED");
    expect(out.summary).toMatch(/timed out/i);
  }, 15_000);
});
