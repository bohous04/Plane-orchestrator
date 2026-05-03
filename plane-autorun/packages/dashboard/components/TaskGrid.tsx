import Link from "next/link";
import type { TaskRecord } from "@plane-autorun/core";
import { formatDuration, formatCost } from "../lib/format";

const statusClass: Record<TaskRecord["status"], string> = {
  queued: "border-slate-700 text-slate-400",
  running: "border-indigo-500 text-indigo-300",
  success: "border-emerald-500 text-emerald-300",
  blocked: "border-rose-500 text-rose-300",
};

const statusGlyph: Record<TaskRecord["status"], string> = {
  queued: "·",
  running: "⋯",
  success: "✓",
  blocked: "✗",
};

export function TaskGrid({
  runId,
  tasks,
}: {
  runId: string;
  tasks: TaskRecord[];
}) {
  if (tasks.length === 0) {
    return <p className="text-sm text-slate-500">No tasks recorded for this run.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((t) => (
        <Link
          key={t.id}
          href={`/runs/${runId}/tasks/${t.id}`}
          className={`rounded-md border bg-slate-900 p-3 hover:bg-slate-800 transition-colors ${
            statusClass[t.status]
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg">{statusGlyph[t.status]}</span>
            <span className="font-mono text-sm text-slate-200">{t.identifier}</span>
            <span className="ml-auto text-xs text-slate-500">:{t.port}</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-300">{t.title}</p>
          {t.summary && (
            <p className="mt-1 text-xs text-slate-500 line-clamp-2">{t.summary}</p>
          )}
          {t.endedAt && t.startedAt && (
            <p className="mt-1 text-xs text-slate-600">
              {formatDuration(t.endedAt - t.startedAt)}
              {t.costUsd != null && ` · ${formatCost(t.costUsd)}`}
              {t.mergeStatus && ` · merge: ${t.mergeStatus}`}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
