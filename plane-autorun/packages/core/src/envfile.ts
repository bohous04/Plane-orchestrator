// Tiny .env editor that preserves comments and existing key order. Only used
// by the dashboard's credentials form.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface EnvLine {
  raw: string;
  key?: string;
  value?: string;
}

const KEY_VALUE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

export function parseEnv(content: string): EnvLine[] {
  return content.split(/\r?\n/).map((raw) => {
    const m = raw.match(KEY_VALUE_RE);
    if (!m) return { raw };
    return { raw, key: m[1], value: stripQuotes(m[2] ?? "") };
  });
}

function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function setEnv(content: string, key: string, value: string): string {
  const lines = parseEnv(content);
  let found = false;
  const out = lines.map((l) => {
    if (l.key === key) {
      found = true;
      return { raw: `${key}=${value}`, key, value };
    }
    return l;
  });
  if (!found) {
    // Append before any trailing blank lines
    let appendIdx = out.length;
    while (appendIdx > 0 && out[appendIdx - 1]!.raw === "") appendIdx--;
    out.splice(appendIdx, 0, { raw: `${key}=${value}`, key, value });
  }
  return out.map((l) => l.raw).join("\n");
}

export async function writeEnvKey(path: string, key: string, value: string): Promise<void> {
  const original = existsSync(path) ? await readFile(path, "utf8") : "";
  const next = setEnv(original, key, value);
  await writeFile(path, next, "utf8");
}
