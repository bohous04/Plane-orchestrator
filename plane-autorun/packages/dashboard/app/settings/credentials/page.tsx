import Link from "next/link";
import { getConfig } from "../../../lib/core";
import { CredentialRow, type CredentialEntry } from "../../../components/CredentialRow";

export const dynamic = "force-dynamic";

export default async function CredentialsSettingsPage() {
  const config = await getConfig();

  const entries: CredentialEntry[] = [];
  if (config) {
    const seen = new Set<string>();
    for (const p of config.projects) {
      const key = p.tokenEnvVar;
      const existing = entries.find((e) => e.envVar === key);
      if (existing) {
        existing.usedBy.push(p.id);
        continue;
      }
      seen.add(key);
      entries.push({
        envVar: key,
        isSet: !!process.env[key],
        usedBy: [p.id],
      });
    }
    if (!seen.has("PLANE_API_URL")) {
      entries.push({
        envVar: "PLANE_API_URL",
        isSet: !!process.env["PLANE_API_URL"],
        usedBy: ["(global)"],
      });
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-300">
        ← runs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-slate-100">Credentials</h1>
      <p className="text-sm text-slate-500">
        Saved to <code>.env</code> at the workspace root. The dashboard process picks up the new
        value immediately, but any running CLI must be restarted.
      </p>
      <p className="mt-2 text-xs text-slate-600">
        Only <code>PLANE_*</code> keys are editable from this page. Comments and unrelated keys in{" "}
        <code>.env</code> are preserved.
      </p>

      {entries.length === 0 ? (
        <p className="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          Couldn&rsquo;t load any project config; nothing to manage here.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {entries.map((e) => (
            <CredentialRow key={e.envVar} entry={e} />
          ))}
        </div>
      )}
    </main>
  );
}
