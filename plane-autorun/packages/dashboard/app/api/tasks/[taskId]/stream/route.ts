// SSE for one task's terminal: replays the log file once, then tails new
// chunks via the in-process events EventEmitter and a low-frequency file
// poller for cross-process runs (PRD §17).

import { events } from "@plane-autorun/core";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getDb } from "../../../../../lib/core";
import { createSseResponse } from "../../../../../lib/sse";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;

  return createSseResponse(async (send, signal, close) => {
    const db = getDb();
    const task = db.getTask(taskId);
    if (!task) {
      send("error", { error: "task not found" });
      close();
      return;
    }

    const logPath = task.logPath;
    let lastSize = 0;

    if (existsSync(logPath)) {
      try {
        const text = await readFile(logPath, "utf8");
        if (text.length > 0) send("chunk", { chunk: text });
        // lastSize must be byte-length (matches fs.stat .size), NOT char length —
        // multi-byte chars (e.g. ellipsis '…') would cause the poller to re-read
        // the trailing bytes on first tick.
        lastSize = Buffer.byteLength(text, "utf8");
      } catch (e) {
        send("error", { error: `failed to read log: ${String(e)}` });
      }
    }

    // Live tail via in-process events.
    const onLog = (e: { taskId: string; chunk: string }) => {
      if (e.taskId !== taskId) return;
      send("chunk", { chunk: e.chunk });
      lastSize += Buffer.byteLength(e.chunk, "utf8");
    };
    const onEnd = (e: { taskId: string }) => {
      if (e.taskId !== taskId) return;
      send("end", {});
      cleanup();
      close();
    };
    events.on("task:log", onLog);
    events.on("task:end", onEnd);

    // Cross-process file poller — read any bytes appended since lastSize.
    const poll = setInterval(async () => {
      if (!existsSync(logPath)) return;
      try {
        const s = await stat(logPath);
        if (s.size <= lastSize) return;
        const fs = await import("node:fs");
        const fd = fs.openSync(logPath, "r");
        try {
          const buf = Buffer.alloc(s.size - lastSize);
          fs.readSync(fd, buf, 0, buf.length, lastSize);
          send("chunk", { chunk: buf.toString("utf8") });
          lastSize = s.size;
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        // ignore transient FS errors
      }
    }, 1000);

    const hb = setInterval(() => send("heartbeat", { t: Date.now() }), 15_000);

    const cleanup = () => {
      events.off("task:log", onLog);
      events.off("task:end", onEnd);
      clearInterval(poll);
      clearInterval(hb);
    };

    signal.addEventListener("abort", cleanup);
  }, req.signal);
}
