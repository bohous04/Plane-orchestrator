import Link from "next/link";
import { getConfig } from "../../../lib/core";

export const dynamic = "force-dynamic";

export default async function ProjectsSettingsPage() {
  const config = await getConfig();

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-300">
        ← runs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-slate-100">Projects</h1>
      <p className="text-sm text-slate-500">
        Read-only view of <code>projects.config.ts</code>. Edit the file on disk and restart the
        dashboard to apply changes.
      </p>

      {!config ? (
        <p className="mt-6 rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          Couldn&rsquo;t load <code>projects.config.ts</code> from the workspace root.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {config.projects.map((p) => (
            <article
              key={p.id}
              className="rounded-lg border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-medium text-slate-100">{p.id}</h2>
                <span className="text-sm text-slate-400">
                  {p.workspace} · {p.identifierPrefix}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-300">{p.projectName}</p>
              <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                <Field label="repo" value={p.repo} />
                <Field label="worktrees root" value={p.worktreesRoot} />
                <Field label="branch base" value={p.branchBase} />
                <Field label="github repo" value={p.githubRepo} />
                <Field label="ports" value={p.ports.join(", ")} />
                <Field label="concurrency" value={String(p.concurrency)} />
                <Field
                  label="budget per task"
                  value={`$${p.budgetUsdPerTask.toFixed(2)}`}
                />
                <Field
                  label="timeout per task"
                  value={`${Math.round(p.timeoutMsPerTask / 60_000)}m`}
                />
                <Field label="runner agent" value={p.runnerAgent} />
                <Field label="token env var" value={p.tokenEnvVar} />
              </dl>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200 truncate">{value}</dd>
    </div>
  );
}
