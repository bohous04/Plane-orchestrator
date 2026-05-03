import Link from "next/link";
import type { RunRecord } from "@plane-autorun/core";
import { formatDate, formatCost, formatDuration } from "../lib/format";

const statusBadgeClass: Record<string, string> = {
  running: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  aborted: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  failed: "bg-rose-500/20 text-rose-300 border-rose-500/40",
};

export function RunCard({ run }: { run: RunRecord }) {
  const dur = run.endedAt ? formatDuration(run.endedAt - run.startedAt) : "—";
  return (
    <Link
      href={`/runs/${run.id}`}
      className="block rounded-lg border border-slate-800 bg-slate-900 p-4 hover:border-slate-700 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-medium text-slate-100">{run.runBranch}</h2>
          <span
            className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
              statusBadgeClass[run.status] ?? ""
            }`}
          >
            {run.status}
          </span>
        </div>
        <span className="text-sm text-slate-400">{formatDate(run.startedAt)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-400 sm:grid-cols-5">
        <div>
          <span className="text-slate-500">project</span>{" "}
          <span className="text-slate-200">{run.projectId}</span>
        </div>
        <div>
          <span className="text-slate-500">tasks</span>{" "}
          <span className="text-slate-200">{run.totalTasks}</span>
        </div>
        <div>
          <span className="text-slate-500">ok</span>{" "}
          <span className="text-emerald-400">{run.succeeded}</span>
        </div>
        <div>
          <span className="text-slate-500">blocked</span>{" "}
          <span className="text-rose-400">{run.blocked}</span>
        </div>
        <div>
          <span className="text-slate-500">cost</span>{" "}
          <span className="text-slate-200">{formatCost(run.totalCostUsd)}</span>
        </div>
      </div>
      <div className="mt-2 text-xs text-slate-500">
        duration: {dur}
        {run.prUrl && (
          <>
            {" · "}
            <span className="text-cyan-400">{run.prUrl}</span>
          </>
        )}
      </div>
    </Link>
  );
}
