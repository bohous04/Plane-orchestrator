import { describe, it, expect } from "vitest";
import { defineConfig, findProject, resolveProjectsByCli } from "../src/config.js";

const baseProject = {
  id: "doch",
  workspace: "test",
  projectName: "Docházkový systém",
  identifierPrefix: "DOCH",
  repo: "/Users/x/repo",
  worktreesRoot: "/Users/x/repo-worktrees",
  branchBase: "main",
  ports: [3055, 3056],
  concurrency: 2,
  githubRepo: "ORG/repo",
};

describe("defineConfig", () => {
  it("accepts a valid config and applies defaults", () => {
    const cfg = defineConfig({ projects: [baseProject] });
    expect(cfg.projects[0]?.runnerAgent).toBe("plane-autorun-runner");
    expect(cfg.projects[0]?.budgetUsdPerTask).toBe(10);
    expect(cfg.projects[0]?.tokenEnvVar).toBe("PLANE_TOKEN");
  });

  it("rejects relative repo paths", () => {
    expect(() =>
      defineConfig({
        projects: [{ ...baseProject, repo: "./relative" }],
      }),
    ).toThrow();
  });

  it("rejects bad identifierPrefix", () => {
    expect(() =>
      defineConfig({
        projects: [{ ...baseProject, identifierPrefix: "doch" }],
      }),
    ).toThrow();
  });

  it("rejects bad githubRepo", () => {
    expect(() =>
      defineConfig({
        projects: [{ ...baseProject, githubRepo: "no-slash" }],
      }),
    ).toThrow();
  });

  it("rejects empty ports list", () => {
    expect(() =>
      defineConfig({
        projects: [{ ...baseProject, ports: [] }],
      }),
    ).toThrow();
  });
});

describe("findProject + resolveProjectsByCli", () => {
  const cfg = defineConfig({
    projects: [
      baseProject,
      { ...baseProject, id: "lnrt", identifierPrefix: "LNRT", workspace: "ai-agentura" },
    ],
  });

  it("findProject returns matching entry", () => {
    expect(findProject(cfg, "doch")?.id).toBe("doch");
    expect(findProject(cfg, "missing")).toBeUndefined();
  });

  it("--all returns every project", () => {
    expect(resolveProjectsByCli(cfg, { all: true }).length).toBe(2);
  });

  it("--workspace filters", () => {
    expect(resolveProjectsByCli(cfg, { workspace: "test" }).map((p) => p.id)).toEqual(["doch"]);
  });

  it("--project ids resolves in order", () => {
    expect(resolveProjectsByCli(cfg, { ids: ["lnrt", "doch"] }).map((p) => p.id)).toEqual([
      "lnrt",
      "doch",
    ]);
  });

  it("--project unknown throws", () => {
    expect(() => resolveProjectsByCli(cfg, { ids: ["missing"] })).toThrow();
  });
});
