// M3 demo: drive the git ops library against the real chwdirections repo,
// but stay LOCAL only — no `git push`, no merges into main, no Plane calls.
//
// Steps:
//   1. Pre-flight: assert clean, ensure ff with origin/main, prune worktrees.
//   2. Pick run number = 99 (won't collide with real autoruns).
//   3. Create run branch + run-base worktree.
//   4. Add a fake task worktree for identifier DOCH-XX-DRYRUN-99.
//   5. Verify node_modules is symlinked, .env.local is copied (if source exists).
//   6. Tear down — remove worktrees, delete local run + sub branch.
//
// Cleanup is best-effort. If something fails midway, you can still re-run with
// the same run number; the harness's reuse logic will pick up where it left off.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { lstatSync, existsSync } from "node:fs";
import {
  loadConfig,
  findProject,
  git,
} from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

const RUN_NUMBER = 99;
const FAKE_IDENTIFIER = "DOCH-DRYRUN-99";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: pnpm exec tsx scripts/dry-run-git.ts <projectId>");
    process.exit(2);
  }

  const { config } = await loadConfig();
  const project = findProject(config, id);
  if (!project) throw new Error(`Unknown project: ${id}`);

  console.log(`Pre-flight: checking ${project.repo}`);
  const clean = await git.isRepoClean(project.repo);
  if (!clean) {
    console.error(`  ❌ repo is not clean. Commit or stash first.`);
    process.exit(2);
  }
  console.log(`  ✓ repo clean`);

  const ff = await git.isFastForwardable(project.repo, project.branchBase);
  console.log(`  ${ff ? "✓" : "ℹ"} ${project.branchBase} can ${ff ? "" : "NOT "}fast-forward to origin/${project.branchBase}`);

  await git.pruneStaleWorktrees(project.repo);
  console.log(`  ✓ pruned stale worktrees`);

  const runBranch = `${project.identifierPrefix}-AUTORUN-${RUN_NUMBER}`;
  console.log(`\nCreating run branch ${runBranch}`);

  // Roll back any leftover state from a prior failed run.
  const runbasePath = `${project.worktreesRoot}/${runBranch}`;
  const taskPath = `${runbasePath}/${FAKE_IDENTIFIER}`;
  const subBranch = `${runBranch}--${FAKE_IDENTIFIER}`;

  if (existsSync(taskPath)) await git.deleteWorktree(project.repo, taskPath);
  if (existsSync(runbasePath)) await git.deleteWorktree(project.repo, runbasePath);
  await git.deleteLocalBranch(project.repo, subBranch);
  await git.deleteLocalBranch(project.repo, runBranch);

  await git.createRunBranch(project.repo, runBranch, project.branchBase);
  console.log(`  ✓ created ${runBranch}`);

  const runbase = await git.addRunbaseWorktree(project, runBranch);
  console.log(`  ✓ runbase worktree at ${runbase}`);

  console.log(`\nAdding task worktree for ${FAKE_IDENTIFIER}`);
  const { worktreePath, subBranch: sb } = await git.addTaskWorktree(
    project,
    runBranch,
    FAKE_IDENTIFIER,
  );
  console.log(`  ✓ ${sb} -> ${worktreePath}`);

  console.log(`\nLinking node_modules + copying .env.local`);
  await git.symlinkNodeModules(project.repo, worktreePath);
  await git.copyEnvFile(project.repo, worktreePath);

  const nm = `${worktreePath}/node_modules`;
  if (existsSync(nm)) {
    const isLink = lstatSync(nm).isSymbolicLink();
    console.log(`  ${isLink ? "✓" : "ℹ"} node_modules ${isLink ? "is symlink" : "exists (not a link)"}`);
  } else {
    console.log(`  ℹ no node_modules in repo, skipped`);
  }

  const envExists = existsSync(`${worktreePath}/.env.local`);
  console.log(`  ${envExists ? "✓" : "ℹ"} .env.local ${envExists ? "copied" : "(no source, skipped)"}`);

  // Verify branch
  const cur = await git.currentBranch(worktreePath);
  console.log(`  ✓ task worktree is on branch ${cur}`);

  console.log(`\nTearing down`);
  await git.deleteWorktree(project.repo, worktreePath);
  await git.deleteWorktree(project.repo, runbase);
  await git.deleteLocalBranch(project.repo, subBranch);
  await git.deleteLocalBranch(project.repo, runBranch);
  console.log(`  ✓ removed worktrees and branches`);
  console.log(`\nM3 demo OK.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
