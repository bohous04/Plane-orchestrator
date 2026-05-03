import { existsSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const ProjectConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be lowercase kebab-case"),
  workspace: z.string().min(1),
  projectName: z.string().min(1),
  identifierPrefix: z.string().regex(/^[A-Z]+$/, "identifierPrefix must be uppercase letters"),

  repo: z.string().refine(isAbsolute, "repo must be absolute"),
  worktreesRoot: z.string().refine(isAbsolute, "worktreesRoot must be absolute"),
  branchBase: z.string().min(1),

  ports: z.array(z.number().int().min(1).max(65535)).min(1),
  concurrency: z.number().int().min(1).max(32),

  runnerAgent: z.string().default("plane-autorun-runner"),
  budgetUsdPerTask: z.number().positive().default(10),
  timeoutMsPerTask: z
    .number()
    .int()
    .min(60_000)
    .default(30 * 60 * 1000),

  tokenEnvVar: z.string().default("PLANE_TOKEN"),
  githubRepo: z.string().regex(/^[^/]+\/[^/]+$/, "githubRepo must be 'org/repo'"),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const AutorunConfigSchema = z.object({
  projects: z.array(ProjectConfigSchema).min(1),
});

export type AutorunConfig = z.infer<typeof AutorunConfigSchema>;

// User-facing helper for projects.config.ts.
export function defineConfig(cfg: AutorunConfig): AutorunConfig {
  return AutorunConfigSchema.parse(cfg);
}

export interface LoadConfigOptions {
  // Absolute path to a TS/JS module that default-exports the config.
  // Defaults to <cwd>/projects.config.ts then projects.config.js.
  configPath?: string;
}

export async function loadConfig(opts: LoadConfigOptions = {}): Promise<{
  config: AutorunConfig;
  configPath: string;
}> {
  const candidates = opts.configPath
    ? [opts.configPath]
    : [
        resolve(process.cwd(), "projects.config.ts"),
        resolve(process.cwd(), "projects.config.js"),
        resolve(process.cwd(), "projects.config.mjs"),
      ];

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No projects.config.{ts,js,mjs} found. Searched:\n  ${candidates.join("\n  ")}`,
    );
  }

  // For .ts: rely on the caller's loader (tsx, vite-node, ts-node).
  // For Next.js dashboard: it ships TS support natively for server modules.
  const url = pathToFileURL(found).href;
  const mod = (await import(url)) as { default?: unknown };
  const raw = mod.default;

  if (!raw || typeof raw !== "object") {
    throw new Error(`${found} must default-export an AutorunConfig object`);
  }

  const config = AutorunConfigSchema.parse(raw);
  return { config, configPath: found };
}

export function findProject(cfg: AutorunConfig, id: string): ProjectConfig | undefined {
  return cfg.projects.find((p) => p.id === id);
}

export function resolveProjectsByCli(
  cfg: AutorunConfig,
  opts: { all?: boolean; workspace?: string; ids?: string[] },
): ProjectConfig[] {
  if (opts.all) return cfg.projects;
  if (opts.workspace) return cfg.projects.filter((p) => p.workspace === opts.workspace);
  if (opts.ids && opts.ids.length > 0) {
    const out: ProjectConfig[] = [];
    for (const id of opts.ids) {
      const p = findProject(cfg, id);
      if (!p) throw new Error(`Unknown project id: ${id}`);
      out.push(p);
    }
    return out;
  }
  return [];
}

// __dirname helper for ESM consumers.
export function moduleDir(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}
