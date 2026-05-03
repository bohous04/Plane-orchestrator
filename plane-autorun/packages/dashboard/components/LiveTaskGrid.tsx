"use client";

import { useEffect, useState } from "react";
import type { TaskRecord, RunRecord } from "@plane-autorun/core";
import { TaskGrid } from "./TaskGrid";

interface SnapshotPayload {
  run: RunRecord;
  tasks: TaskRecord[];
}

export function LiveTaskGrid({
  runId,
  initialRun,
  initialTasks,
}: {
  runId: string;
  initialRun: RunRecord;
  initialTasks: TaskRecord[];
}) {
  const [run, setRun] = useState<RunRecord>(initialRun);
  const [tasks, setTasks] = useState<TaskRecord[]>(initialTasks);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${runId}/events`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as
          | { kind: "snapshot"; run: RunRecord; tasks: TaskRecord[] }
          | { kind: "task:end"; tasks: TaskRecord[] }
          | { kind: "poll"; run: RunRecord; tasks: TaskRecord[] }
          | { kind: "run:end"; run: RunRecord }
          | { kind: "heartbeat"; t: number }
          | { kind: "task:start"; runId: string };

        if (data.kind === "snapshot" || data.kind === "poll") {
          setRun(data.run);
          setTasks(data.tasks);
        } else if (data.kind === "task:end") {
          setTasks(data.tasks);
        } else if (data.kind === "run:end") {
          setRun(data.run);
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => {
      es.close();
    };
  }, [runId]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            connected ? "bg-emerald-500" : "bg-slate-600"
          }`}
        />
        <span className="text-slate-500">
          {connected ? "live" : "connecting…"} ·{" "}
          <span className="text-emerald-400">{run.succeeded} ok</span> /{" "}
          <span className="text-rose-400">{run.blocked} blocked</span>
        </span>
      </div>
      <TaskGrid runId={runId} tasks={tasks} />
    </div>
  );
}
