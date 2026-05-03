// Per-Plane-project configuration. Single source of truth for the harness.
// Filled in at M1 with the real defineConfig helper; placeholder type stub for M0.

export interface ProjectConfigStub {
  id: string;
  workspace: string;
  projectName: string;
  identifierPrefix: string;
  repo: string;
  worktreesRoot: string;
  branchBase: string;
  ports: number[];
  concurrency: number;
  runnerAgent: string;
  budgetUsdPerTask: number;
  timeoutMsPerTask: number;
  tokenEnvVar: string;
  githubRepo: string;
}

const config: { projects: ProjectConfigStub[] } = {
  projects: [
    {
      id: "doch",
      workspace: "test",
      projectName: "Docházkový systém",
      identifierPrefix: "DOCH",

      repo: "/Users/michallenert/My Repositories/chwdirections",
      worktreesRoot: "/Users/michallenert/My Repositories/chwdirections-worktrees",
      branchBase: "main",

      ports: [3055, 3056, 3057, 3058, 3059],
      concurrency: 5,

      runnerAgent: "plane-autorun-runner",
      budgetUsdPerTask: 10,
      timeoutMsPerTask: 30 * 60 * 1000, // 30 min

      tokenEnvVar: "PLANE_TOKEN",
      githubRepo: "LNRTT/chwdirections",
    },
    // To add another project, copy the entry above and adjust:
    //   - id (CLI key, must be unique)
    //   - workspace (Plane workspace slug)
    //   - projectName (Plane project name, exact match)
    //   - identifierPrefix (e.g. "LNRT")
    //   - repo, worktreesRoot, branchBase
    //   - ports (must not overlap with other projects running concurrently)
    //   - tokenEnvVar (defaults to PLANE_TOKEN — override only if a workspace needs a different token)
    //   - githubRepo (org/repo for PR creation)
  ],
};

export default config;
