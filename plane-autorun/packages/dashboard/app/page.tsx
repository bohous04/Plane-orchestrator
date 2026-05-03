import Link from "next/link";
import { getDb } from "../lib/core";
import { RunCard } from "../components/RunCard";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const runs = db.listRuns({ limit: 100 });

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Plane Autorun</h1>
          <p className="text-sm text-slate-500">
            {runs.length} run{runs.length === 1 ? "" : "s"} recorded
          </p>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link className="text-slate-400 hover:text-slate-200" href="/settings/projects">
            Projects
          </Link>
          <Link className="text-slate-400 hover:text-slate-200" href="/settings/credentials">
            Credentials
          </Link>
        </nav>
      </header>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center">
          <p className="text-slate-300">No runs yet.</p>
          <p className="mt-2 text-sm text-slate-500">
            Trigger one with{" "}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">
              pnpm autorun --project doch
            </code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      )}
    </main>
  );
}
