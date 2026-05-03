"use client";

import { useState } from "react";

export interface CredentialEntry {
  envVar: string;
  isSet: boolean;
  usedBy: string[];
}

export function CredentialRow({ entry }: { entry: CredentialEntry }) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSet, setIsSet] = useState(entry.isSet);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/credentials/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envVar: entry.envVar, value }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setIsSet(value.length > 0);
      setSavedAt(Date.now());
      setEditing(false);
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-sm text-slate-100">{entry.envVar}</p>
          <p className="mt-0.5 text-xs text-slate-500">used by: {entry.usedBy.join(", ")}</p>
        </div>
        {isSet ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
            set
          </span>
        ) : (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
            not set
          </span>
        )}
      </div>
      {!editing ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-3 text-xs text-slate-400 underline hover:text-slate-200"
        >
          {isSet ? "replace value" : "set value"}
        </button>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`new value for ${entry.envVar}`}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 placeholder:text-slate-600"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || value.length === 0}
              className="rounded-md bg-indigo-500/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
            >
              {saving ? "saving…" : "save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setValue("");
              }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              cancel
            </button>
            {error && <span className="text-xs text-rose-400">{error}</span>}
            {savedAt && (
              <span className="text-xs text-emerald-400">
                saved · restart `pnpm autorun` to apply elsewhere
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
