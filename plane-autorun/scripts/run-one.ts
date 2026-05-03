// M4 demo: spawn the runner against a real worktree and confirm the harness
// can drive `claude` end-to-end. Two modes:
//
//   pnpm exec tsx scripts/run-one.ts <projectId> <DOCH-id>
//     -> uses a small probe prompt that asks claude to emit the three-header
//        contract verbatim. Costs ~$0.50 in tokens, validates spawnRunner +
//        parseRunnerHeaders against real `claude` output.
//
//   pnpm exec tsx scripts/run-one.ts <projectId> <DOCH-id> --stub
//     -> uses the local stub-claude-success.sh; costs nothing. Same result
//        shape as a real run. Useful for smoke tests.
//
// In either mode this creates a real worktree (DOCH-AUTORUN-99 / <DOCH-id>),
// runs the runner against it, prints the result, and leaves the worktree on
// disk per PRD §19. The next M4 commit cleans it up via the M3 dry-run-git
// script.

import { config as loadEnv } from "dotenv";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import {
  loadConfig,
  findProject,
  PlaneClient,
  spawnRunner,
  writePromptFile,
  git,
} from "../packages/core/dist/index.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

const RUN_NUMBER = 99;
const DEMO_BUDGET_USD = 1.0; // probe prompt is tiny; cap aggressively

async function main() {
  const projectId = process.argv[2];
  const identifier = process.argv[3];
  const stub = process.argv.includes("--stub");

  if (!projectId || !identifier) {
    console.error("Usage: pnpm exec tsx scripts/run-one.ts <projectId> <DOCH-id> [--stub]");
    process.exit(2);
  }

  const { config } = await loadConfig();
  const project = findProject(config, projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);

  const token = process.env[project.tokenEnvVar];
  if (!token) throw new Error(`${project.tokenEnvVar} not set`);

  const baseUrl = process.env["PLANE_API_URL"];
  const plane = new PlaneClient({
    workspace: project.workspace,
    token,
    ...(baseUrl ? { baseUrl } : {}),
  });

  console.log(`Resolving Plane project "${project.projectName}"...`);
  const planeProjectId = await plane.resolveProjectId(project.projectName);
  const queue = await plane.snapshotTodoQueue(planeProjectId, project.identifierPrefix);
  const item = queue.find((q) => q.identifier === identifier);
  if (!item) {
    console.error(`No item ${identifier} in queue. First few:`);
    for (const q of queue.slice(0, 5)) console.error(`  ${q.identifier}  ${q.name}`);
    process.exit(2);
  }

  console.log(`  -> ${item.identifier} ${item.name}`);

  // Pre-flight + worktree setup.
  if (!(await git.isRepoClean(project.repo))) {
    console.error(`  ❌ ${project.repo} is not clean.`);
    process.exit(2);
  }
  await git.pruneStaleWorktrees(project.repo);

  const runBranch = `${project.identifierPrefix}-AUTORUN-${RUN_NUMBER}`;
  const runbasePath = join(project.worktreesRoot, runBranch);

  // Best-effort cleanup of any leftover state from a prior aborted demo.
  if (existsSync(join(runbasePath, identifier))) {
    await git.deleteWorktree(project.repo, join(runbasePath, identifier));
  }
  if (existsSync(runbasePath)) await git.deleteWorktree(project.repo, runbasePath);
  await git.deleteLocalBranch(project.repo, `${runBranch}--${identifier}`);
  await git.deleteLocalBranch(project.repo, runBranch);

  await git.createRunBranch(project.repo, runBranch, project.branchBase);
  await git.addRunbaseWorktree(project, runBranch);
  const { worktreePath, subBranch } = await git.addTaskWorktree(project, runBranch, identifier);
  await git.symlinkNodeModules(project.repo, worktreePath);
  await git.copyEnvFile(project.repo, worktreePath);
  console.log(`  ✓ worktree at ${worktreePath} on ${subBranch}`);

  // Build a probe prompt. Real autorun prompts are constructed in M5; for M4
  // we prove the wiring with a minimal one.
  const promptDir = join(runbasePath, ".prompts");
  mkdirSync(promptDir, { recursive: true });
  const promptPath = join(promptDir, `${identifier}.prompt.md`);
  const probePrompt = [
    `You are running a probe of the plane-autorun harness against work item ${item.identifier}.`,
    `Title: ${item.name}`,
    `Priority: ${item.priority}`,
    ``,
    `Do NOT make any code changes. Do NOT run any tools.`,
    `Reply with EXACTLY these three lines, in this order, then end:`,
    `STATUS: SUCCESS`,
    `SUMMARY: harness probe successful`,
    `FILES: none`,
  ].join("\n");
  await writePromptFile(promptPath, probePrompt);

  const logPath = join(runbasePath, ".logs", `${identifier}.log`);
  const outputJsonPath = join(runbasePath, ".outputs", `${identifier}.json`);

  console.log(`\nSpawning runner${stub ? " (stub)" : " (real claude, probe mode)"}...`);
  const stubBin = stub
    ? join(
        process.cwd(),
        "packages/core/test/fixtures/stub-claude-success.sh",
      )
    : undefined;

  const result = await spawnRunner({
    runId: "demo-run",
    taskId: `demo-${identifier}`,
    identifier: item.identifier,
    worktreePath,
    promptPath,
    agent: project.runnerAgent,
    taskName: `autorun-${item.identifier}`,
    budgetUsd: stub ? 1 : DEMO_BUDGET_USD,
    timeoutMs: 5 * 60 * 1000,
    logPath,
    outputJsonPath,
    ...(stubBin ? { claudeBin: stubBin } : {}),
  });

  console.log(`\nResult:`);
  console.log(`  status:    ${result.status}`);
  console.log(`  summary:   ${result.summary}`);
  console.log(`  files:     ${JSON.stringify(result.files)}`);
  console.log(`  cost:      $${(result.costUsd ?? 0).toFixed(4)}`);
  console.log(`  duration:  ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`  exitCode:  ${result.exitCode}`);
  console.log(`  timedOut:  ${result.timedOut}`);
  console.log(`\nLogs at: ${logPath}`);
  console.log(`Output JSON at: ${outputJsonPath}`);
  console.log(`Worktree left in place at: ${worktreePath}`);
  console.log(`(Run scripts/dry-run-git.ts to clean up the test branch.)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
