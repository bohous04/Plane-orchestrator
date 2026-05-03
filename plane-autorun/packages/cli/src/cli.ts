#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import { Command } from "commander";
import { resolve } from "node:path";
import {
  loadConfig,
  resolveProjectsByCli,
  runProject,
  events,
  preflight,
  VERSION,
  type ProjectConfig,
  type RunResult,
} from "@plane-autorun/core";

import { runHeadless } from "./headless.js";

loadEnv({ path: resolve(process.cwd(), ".env") });

const program = new Command();
program
  .name("autorun")
  .description("plane-autorun harness CLI")
  .version(VERSION);

program
  .option("--project <ids>", "comma-separated project ids")
  .option("--workspace <slug>", "all projects in this Plane workspace")
  .option("--all", "every project in projects.config.ts")
  .option("--resume <runBranch>", "pick up where the named run left off")
  .option("--dry-run", "snapshot the queue, print, and exit")
  .option("--no-tui", "plain stdout (cron / launchd)")
  .option("--json", "JSON-line output (implies --no-tui)")
  .option("--verbose", "debug logs")
  .action(async (opts) => {
    if (opts.json) opts.tui = false;
    if (opts.verbose) process.env["LOG_LEVEL"] = "debug";

    const { config } = await loadConfig();
    const projects = resolveProjectsByCli(config, {
      ids: opts.project ? String(opts.project).split(",").map((s) => s.trim()) : undefined,
      workspace: opts.workspace,
      all: !!opts.all,
    });

    if (projects.length === 0) {
      console.error("No projects selected. Pass --project, --workspace, or --all.");
      process.exit(2);
    }

    const useTui = opts.tui !== false && !opts.json;

    if (useTui) {
      // The Ink TUI is wired in M6; M5 ships the headless path.
      const { startTui } = await import("./tui/App.js");
      await startTui(projects, { resumeRunBranch: opts.resume, dryRun: !!opts.dryRun });
      return;
    }

    await runHeadless(projects, {
      json: !!opts.json,
      resumeRunBranch: opts.resume,
      dryRun: !!opts.dryRun,
    });
  });

program
  .command("config")
  .description("config helpers")
  .addCommand(
    new Command("check")
      .description("validate projects.config.ts and required env vars")
      .action(async () => {
        const { config, configPath } = await loadConfig();
        console.log(`Loaded ${configPath}`);
        let bad = 0;
        for (const p of config.projects) {
          const token = process.env[p.tokenEnvVar];
          const status = token ? "✓" : "✗";
          console.log(`  ${status} ${p.id} (workspace=${p.workspace}, token=${p.tokenEnvVar})`);
          if (!token) bad++;
        }
        if (bad > 0) {
          console.error(`\n${bad} project(s) have missing tokens.`);
          process.exit(1);
        }
        console.log("\nAll tokens present.");
      }),
  )
  .addCommand(
    new Command("list")
      .description("print resolved config")
      .action(async () => {
        const { config } = await loadConfig();
        for (const p of config.projects) {
          console.log(`${p.id}:`);
          for (const [k, v] of Object.entries(p)) {
            const val = Array.isArray(v) ? `[${v.join(", ")}]` : String(v);
            console.log(`  ${k}: ${val}`);
          }
          console.log("");
        }
      }),
  );

program
  .command("preflight <project>")
  .description("run preflight checks for one project")
  .action(async (id: string) => {
    const { config } = await loadConfig();
    const project = config.projects.find((p: ProjectConfig) => p.id === id);
    if (!project) {
      console.error(`Unknown project: ${id}`);
      process.exit(2);
    }
    const report = await preflight(project.repo, project.branchBase);
    console.log("Binaries on PATH:");
    for (const b of report.binaries) {
      console.log(`  ${b.ok ? "✓" : "✗"} ${b.binary}${b.error ? ` — ${b.error}` : ""}`);
    }
    console.log(`gh auth: ${report.ghAuth.ok ? "✓" : "✗"}`);
    console.log(`repo clean: ${report.repoClean ? "✓" : "✗"}`);
    console.log(`fast-forwardable: ${report.fastForwardable ? "✓" : "✗"}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
