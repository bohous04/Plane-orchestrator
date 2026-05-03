import { execa } from "execa";
import { isRepoClean, isFastForwardable } from "./git.js";

export interface BinaryCheck {
  binary: string;
  ok: boolean;
  error: string | null;
}

export async function checkBinariesOnPath(): Promise<BinaryCheck[]> {
  const checks = await Promise.all([
    probe("git", ["--version"]),
    probe("gh", ["--version"]),
    probe("claude", ["--version"]),
  ]);
  return checks;
}

async function probe(binary: string, args: string[]): Promise<BinaryCheck> {
  try {
    await execa(binary, args);
    return { binary, ok: true, error: null };
  } catch (e) {
    return {
      binary,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function checkGhAuth(): Promise<{ ok: boolean; error: string | null }> {
  try {
    await execa("gh", ["auth", "status"]);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface PreflightReport {
  binaries: BinaryCheck[];
  ghAuth: { ok: boolean; error: string | null };
  repoClean: boolean;
  fastForwardable: boolean;
}

export async function preflight(repo: string, base: string): Promise<PreflightReport> {
  const [binaries, ghAuth, repoClean, ff] = await Promise.all([
    checkBinariesOnPath(),
    checkGhAuth(),
    isRepoClean(repo),
    isFastForwardable(repo, base).catch(() => false),
  ]);
  return { binaries, ghAuth, repoClean, fastForwardable: ff };
}

export class PreflightError extends Error {
  constructor(message: string, public readonly report: PreflightReport) {
    super(message);
    this.name = "PreflightError";
  }
}

export function assertPreflight(report: PreflightReport): void {
  const failures: string[] = [];
  for (const b of report.binaries) {
    if (!b.ok) failures.push(`${b.binary} not on PATH or failed --version: ${b.error}`);
  }
  if (!report.ghAuth.ok) {
    failures.push(`gh auth status failed; run "gh auth login": ${report.ghAuth.error}`);
  }
  if (!report.repoClean) {
    failures.push("repo is not clean — commit or stash before starting a run");
  }
  if (!report.fastForwardable) {
    failures.push("base branch cannot fast-forward to origin — pull or rebase first");
  }
  if (failures.length > 0) {
    throw new PreflightError(`Preflight failed:\n  - ${failures.join("\n  - ")}`, report);
  }
}
