# Decisions Log

One entry per non-trivial choice or blocker that came up while building this. Format:

```
## M<n>: <topic>
Options: (a) ..., (b) ...
Chose: (a) — reasoning
```

---

## Pre-M0: Plane API base URL

Options:
- (a) Plane Cloud `https://api.plane.so/api/v1` (PRD default)
- (b) Self-hosted `https://plane.agent42.cz/api/v1` (from user's MCP config)

Chose: **(b)**. The `~/.claude.json` plane MCP entries point at `https://plane.agent42.cz` for both `ai-agentura` and `test` workspaces. Hardcoded in `.env.example` and `projects.config.ts`.

---

## Pre-M0: Plane token env var naming

Options:
- (a) One env var per workspace (`PLANE_TOKEN_TEST`, `PLANE_TOKEN_AIAGENTURA`) per PRD §8
- (b) Single `PLANE_TOKEN` shared across workspaces

Chose: **(b)**. The user's MCP config uses one personal token for both workspaces. The `tokenEnvVar` field stays per-project so the design can split later if needed, but the default everywhere is `PLANE_TOKEN`.

---

## Pre-M0: SQLite location

Options:
- (a) Per-package: `runs.db` next to CLI cwd, separate `packages/dashboard/runs.db` (literal PRD §9)
- (b) Single `runs.db` at repo root, both packages resolve to it

Chose: **(b)**. PRD §5 explicitly says SQLite + log files reconcile state between CLI and dashboard, which only works if they point at the same file. Resolved via an env var `PLANE_AUTORUN_DB` with a default of `<repo-root>/runs.db`.

User mentioned hosting the DB on Coolify for the dashboard — that's a future deployment concern, deferred to v2. v1 dashboard is local-only and the orchestrator runtime *is* the dashboard server (PRD §5).

---

## Pre-M0: Project scaffolding scope

Options:
- (a) Scaffold only `doch` with a comment showing how to add more
- (b) Stub out `lnrt` and `pohodari` placeholder entries

Chose: **(a)**. Confirmed by user.

---

## Pre-M0: M4 demo — real Plane workspace task

Options:
- (a) Stubbed `claude` only; defer real-task demo to human
- (b) Pick one DOCH task and run for real

Chose: **(b)**. Confirmed by user ("I want you to test if it works, so do it"). Will pick the smallest-blast-radius task in the DOCH `Todo`/`Backlog` queue, run it once, then leave the worktree on disk for inspection.

---

## Pre-M0: Branch strategy

Single `main` branch on this fresh repo. One commit per milestone (`M0: Bootstrap`, `M1: ...`, etc). No force-push, no rebase.

---

## M2: Plane auth header

PRD §12 says `Authorization: <token>` (no `Bearer`). Probing the live API at `plane.agent42.cz` shows that header is rejected and the server expects **`x-api-key: <token>`** instead. PRD is wrong; implementation uses `x-api-key`. Confirmed against `/users/me/`, `/workspaces/test/projects/`, `/states/`, `/issues/`.

---

## M2: Description stripping

PRD §12 mentions that the snapshot list response carries `description_html` and `description_stripped`. The live API only returns `description_html` (and `description_text: null`). I added a small `stripHtml` helper to derive plain text locally. Good enough for runner prompts and Plane comments; not a full HTML parser.

---

## M5: full non-dry-run is gated on the runner agent file

The orchestrator's full path (Plane state writes, runner spawns × 44, merges, push, draft PR) is only useful with the real `plane-autorun-runner` agent. Without it (see M4 entry below) every task would BLOCK with "no structured report". Per user session rules I'm not running the full non-dry-run end-to-end against the live Plane workspace anyway.

The M5 demo I shipped is `pnpm autorun --project doch --no-tui --dry-run`, which exercises everything that matters for verification: preflight, Plane resolve, queue snapshot, sort, and emits the planned execution to stdout without a single git/spawn/Plane-write side effect. The non-dry-run path is type-checked and unit-test-covered (orchestrator imports git, runner, Plane client all of which are tested) but not end-to-end demoed.

---

## M4: plane-autorun-runner agent file is missing

PRD §4 says `plane-autorun-runner.md` "stays — same file, same prompt structure". Searching the filesystem turns up no such agent definition (not in `chwdirections/.claude/agents/`, not in `~/.claude/agents/`, not anywhere). The only agent installed locally is `chaos-tester.md`.

STATUS: PARTIAL — needs human.

What I did:
- spawnRunner is fully implemented per PRD §11 (kill chain, log+JSON tee, header parse, BLOCKED fallbacks).
- Integration test exercises everything via a stub `claude` shell script that emits the three-header contract.
- Skipped the "real DOCH task" demo because invoking `claude -p --agent plane-autorun-runner` would fail with "agent not found".

To unblock the live demo, install or create `plane-autorun-runner.md` at `~/.claude/agents/plane-autorun-runner.md` (or in `chwdirections/.claude/agents/`). Once installed, `pnpm exec tsx scripts/run-one.ts <DOCH-id>` should work against a real worktree.

---

## M2: Workspace symlink for tsx scripts

The `scripts/` directory needs `package.json` with `"type": "module"` so tsx doesn't treat it as CJS. Scripts import from the compiled `packages/core/dist/index.js` rather than `@plane-autorun/core` because the workspace symlink isn't resolvable from outside any package context. Acceptable: scripts/ is dev-only.
