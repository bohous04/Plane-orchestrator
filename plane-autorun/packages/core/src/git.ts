import { execa, type ExecaError } from "execa";
import { existsSync } from "node:fs";
import { copyFile, mkdir, symlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { log } from "./log.js";
import type { ProjectConfig } from "./config.js";

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function git(repo: string, args: string[], opts: { quiet?: boolean } = {}): Promise<GitResult> {
  try {
    const r = await execa("git", args, { cwd: repo, all: false });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: 0 };
  } catch (e) {
    const ee = e as ExecaError;
    if (!opts.quiet) {
      log.error(
        { args: args.join(" "), repo, code: ee.exitCode, stderr: ee.stderr?.slice?.(0, 500) },
        "git command failed",
      );
    }
    throw new GitError(args, repo, ee);
  }
}

export class GitError extends Error {
  constructor(
    public readonly args: string[],
    public readonly repo: string,
    public override readonly cause: ExecaError,
  ) {
    super(`git ${args.join(" ")} (in ${repo}) failed: ${cause.shortMessage ?? cause.message}`);
    this.name = "GitError";
  }
}

export async function isRepoClean(repo: string): Promise<boolean> {
  const r = await git(repo, ["status", "--porcelain"]);
  return r.stdout.trim().length === 0;
}

export async function fetch(repo: string, opts: { prune?: boolean } = {}): Promise<void> {
  await git(repo, ["fetch", "origin", ...(opts.prune ? ["--prune"] : [])]);
}

export async function isFastForwardable(repo: string, base: string): Promise<boolean> {
  // After `git fetch`: base..origin/base counts commits we're behind. We can ff-only iff
  // origin/base..base counts zero (we have nothing local that origin doesn't).
  await fetch(repo, { prune: true });
  const r = await git(repo, ["rev-list", "--count", `origin/${base}..${base}`]);
  return r.stdout.trim() === "0";
}

export async function pruneStaleWorktrees(repo: string): Promise<void> {
  await git(repo, ["worktree", "prune"]);
}

// Scan local + remote branches for `<PREFIX>-AUTORUN-<N>`, return next N.
export async function nextRunNumber(repo: string, prefix: string): Promise<number> {
  await fetch(repo, { prune: true });
  const r = await git(repo, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
    "refs/remotes/origin/",
  ]);
  const re = new RegExp(`(?:^|/)${prefix}-AUTORUN-(\\d+)$`);
  let max = 0;
  for (const line of r.stdout.split("\n")) {
    const m = line.trim().match(re);
    if (m && m[1]) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max + 1;
}

export async function createRunBranch(
  repo: string,
  runBranch: string,
  base: string,
): Promise<void> {
  // Keep the main repo's HEAD on `base`. The run branch is checked out only
  // via `addRunbaseWorktree` so the main repo stays free for the user.
  await git(repo, ["switch", base]);
  await git(repo, ["pull", "--ff-only", "origin", base]);
  const r = await git(repo, ["branch", "--list", runBranch]);
  if (r.stdout.trim().length > 0) {
    log.info({ runBranch }, "run branch already exists locally; reusing");
    return;
  }
  await git(repo, ["branch", runBranch, base]);
}

export async function addRunbaseWorktree(
  project: ProjectConfig,
  runBranch: string,
): Promise<string> {
  await mkdir(project.worktreesRoot, { recursive: true });
  const path = join(project.worktreesRoot, runBranch);
  if (existsSync(path)) {
    log.info({ path }, "runbase worktree already exists; reusing");
    return path;
  }
  await git(project.repo, ["worktree", "add", path, runBranch]);
  return path;
}

export async function addTaskWorktree(
  project: ProjectConfig,
  runBranch: string,
  identifier: string,
): Promise<{ worktreePath: string; subBranch: string }> {
  const subBranch = `${runBranch}--${identifier}`;
  const worktreePath = join(project.worktreesRoot, runBranch, identifier);
  await mkdir(join(project.worktreesRoot, runBranch), { recursive: true });

  if (existsSync(worktreePath)) {
    log.info({ worktreePath, subBranch }, "task worktree already exists; reusing");
    return { worktreePath, subBranch };
  }

  // Try to create branch + worktree in one go from the run branch HEAD.
  try {
    await git(project.repo, [
      "worktree",
      "add",
      "-b",
      subBranch,
      worktreePath,
      runBranch,
    ]);
  } catch (e) {
    // Branch may already exist (resume scenario). Retry without -b.
    log.info({ subBranch }, "sub-branch already exists; reusing without -b");
    await git(project.repo, ["worktree", "add", worktreePath, subBranch]);
  }

  return { worktreePath, subBranch };
}

export async function symlinkNodeModules(repo: string, worktreePath: string): Promise<void> {
  const src = join(repo, "node_modules");
  const dest = join(worktreePath, "node_modules");
  if (!existsSync(src)) {
    log.info({ src }, "no node_modules in repo; skipping symlink");
    return;
  }
  if (existsSync(dest)) return; // already linked / present
  try {
    await symlink(src, dest, "dir");
  } catch (e) {
    log.warn({ src, dest, err: String(e) }, "node_modules symlink failed; continuing");
  }
}

export async function copyEnvFile(repo: string, worktreePath: string): Promise<void> {
  const src = join(repo, ".env.local");
  const dest = join(worktreePath, ".env.local");
  if (!existsSync(src)) return;
  if (existsSync(dest)) return;
  try {
    await copyFile(src, dest);
  } catch (e) {
    log.warn({ src, dest, err: String(e) }, ".env.local copy failed; continuing");
  }
}

export interface MergeInput {
  identifier: string;
  subBranch: string;
  status: "success" | "blocked";
}

export interface MergeReport {
  merged: string[]; // sub-branches merged
  conflicts: string[]; // sub-branches that hit a conflict
  skipped: string[]; // BLOCKED sub-branches; not merged
}

export async function mergeSuccessfulSubBranches(
  runbase: string,
  inputs: ReadonlyArray<MergeInput>,
): Promise<MergeReport> {
  // Sort SUCCESS by identifier ascending so reruns produce identical history.
  const successes = inputs
    .filter((i) => i.status === "success")
    .slice()
    .sort((a, b) => a.identifier.localeCompare(b.identifier, undefined, { numeric: true }));

  const merged: string[] = [];
  const conflicts: string[] = [];
  const skipped = inputs.filter((i) => i.status !== "success").map((i) => i.subBranch);

  for (const s of successes) {
    try {
      await git(runbase, [
        "merge",
        "--no-ff",
        "-m",
        `Merge ${s.identifier} (${s.subBranch}) into run branch`,
        s.subBranch,
      ]);
      merged.push(s.subBranch);
    } catch (e) {
      log.error({ subBranch: s.subBranch }, "merge conflict; aborting and continuing");
      // Recover: abort the merge so we can continue with the next sub-branch.
      try {
        await git(runbase, ["merge", "--abort"], { quiet: true });
      } catch {
        // ignore
      }
      conflicts.push(s.subBranch);
    }
  }

  return { merged, conflicts, skipped };
}

export async function push(cwd: string, branch: string): Promise<void> {
  try {
    await git(cwd, ["push", "-u", "origin", branch]);
  } catch (e) {
    log.warn({ cwd, branch }, "push failed; retrying once after 5s");
    await sleep(5000);
    await git(cwd, ["push", "-u", "origin", branch]);
  }
}

export async function deleteWorktree(repo: string, worktreePath: string): Promise<void> {
  // For cleanup paths only (e.g. the M3 demo). The runner-driven flow leaves
  // worktrees in place per PRD §19.
  if (!existsSync(worktreePath)) return;
  try {
    await git(repo, ["worktree", "remove", "--force", worktreePath], { quiet: true });
  } catch (e) {
    log.warn({ worktreePath, err: String(e) }, "worktree remove failed; continuing");
  }
}

export async function deleteLocalBranch(repo: string, branch: string): Promise<void> {
  // For cleanup paths only.
  try {
    await git(repo, ["branch", "-D", branch], { quiet: true });
  } catch {
    // ignore
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Convenience to confirm we can read a worktree's HEAD identifier later.
export async function currentBranch(cwd: string): Promise<string> {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return r.stdout.trim();
}

export async function pathStat(p: string): Promise<{ exists: boolean; isSymlink: boolean }> {
  if (!existsSync(p)) return { exists: false, isSymlink: false };
  const s = await stat(p);
  return { exists: true, isSymlink: s.isSymbolicLink() };
}

export function workspaceHasGh(): boolean {
  // Cheap heuristic; the orchestrator will fail later if gh isn't authed.
  return !!process.env["PATH"];
}

// Re-export useful primitives for orchestrator.
export { resolve as resolvePath };
