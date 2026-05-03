# Plane Autorun Harness

A TypeScript harness that drives the `plane-autorun-runner` Claude Code agent across a Plane work-item queue. Replaces the previous LLM-based orchestrator with a deterministic Node process: Plane REST integration, git/worktree plumbing, child-process orchestration, retries, structured output parsing, merge loop, and PR creation. The runner agent itself is unchanged.

> Status: under construction. See `DECISIONS.md` for in-progress trade-offs and `plane-autorun-harness-prd.md` for the full spec.

## Prereqs

- Node 22+
- pnpm 9+ (`brew install pnpm` or `corepack enable`)
- `git` (>= 2.40)
- `gh` CLI, authenticated (`gh auth status` should be green)
- `claude` CLI (Claude Code), authenticated

## Setup

```bash
pnpm install
cp .env.example .env
# fill in PLANE_TOKEN and PLANE_API_URL
$EDITOR projects.config.ts   # adjust per-project entries
```

## Running

```bash
pnpm autorun --project doch --dry-run    # preview the queue without touching git
pnpm autorun --project doch              # full run (TUI)
pnpm autorun --project doch --no-tui     # plain stdout (cron / launchd)
```

## Dashboard

```bash
pnpm dashboard dev
# open http://localhost:3000
```

## Where things go

| Path | Purpose |
|---|---|
| `runs.db` (repo root) | SQLite, source of truth for runs and tasks |
| `runs/<branch>/<task>.log` | Append-only stdout/stderr per task; xterm.js replays this |
| `runs/<branch>/<task>.json` | Parsed runner JSON output |

## Hard rules (mirror PRD §19)

- Never `--force`-push. Never `--no-verify`. Never `--amend`.
- Never `npm install` in the main repo or any worktree (worktrees use a `node_modules` symlink).
- Never modify `plane-autorun-runner.md`.
- Never push to `main` of any monitored repo.
- Never log secrets.

## Troubleshooting

- **`PLANE_TOKEN not set`** — copy `.env.example` to `.env` and fill in.
- **`gh: not found` / `gh auth status` fails** — install GitHub CLI and run `gh auth login`.
- **`claude: not found`** — install Claude Code CLI.
- **`Repo not clean`** — commit or stash work in the monitored repo before starting a run.

## License

Personal tooling.
