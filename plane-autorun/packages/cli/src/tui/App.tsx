import React, { useEffect, useState, useRef } from "react";
import { render, Box, Text, useApp, useInput, useStdin } from "ink";
import Spinner from "ink-spinner";
import {
  events,
  runProject,
  type ProjectConfig,
  type RunResult,
} from "@plane-autorun/core";

import { runHeadless } from "../headless.js";

export interface TuiOptions {
  resumeRunBranch?: string;
  dryRun?: boolean;
}

interface TaskState {
  id: string;
  identifier: string;
  title: string;
  port: number | null;
  status: "queued" | "running" | "success" | "blocked";
  summary?: string;
  costUsd?: number | null;
  durationMs?: number;
  startedAt?: number;
}

interface RunState {
  projectId: string;
  runBranch: string | null;
  queueSize: number;
  startedAt: number | null;
  endedAt: number | null;
  status: "preparing" | "running" | "completed" | "aborted" | "failed";
  succeeded: number;
  blocked: number;
  totalCostUsd: number;
  prUrl: string | null;
}

function App({
  projects,
  opts,
  onDone,
}: {
  projects: ProjectConfig[];
  opts: TuiOptions;
  onDone: (results: RunResult[]) => void;
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [run, setRun] = useState<RunState | null>(null);
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const startedRef = useRef(false);

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) exit();
    },
    { isActive: isRawModeSupported },
  );

  useEffect(() => {
    const onRunStart = (e: {
      runId: string;
      projectId: string;
      runBranch: string;
      queueSize: number;
      startedAt: number;
    }) => {
      setRun({
        projectId: e.projectId,
        runBranch: e.runBranch,
        queueSize: e.queueSize,
        startedAt: e.startedAt,
        endedAt: null,
        status: "running",
        succeeded: 0,
        blocked: 0,
        totalCostUsd: 0,
        prUrl: null,
      });
    };
    const onTaskStart = (e: {
      taskId: string;
      identifier: string;
      title: string;
      port: number;
    }) => {
      setTasks((prev) => {
        const existing = prev.find((t) => t.id === e.taskId);
        if (existing) {
          return prev.map((t) =>
            t.id === e.taskId ? { ...t, status: "running", port: e.port } : t,
          );
        }
        return [
          ...prev,
          {
            id: e.taskId,
            identifier: e.identifier,
            title: e.title,
            port: e.port,
            status: "running",
            startedAt: Date.now(),
          },
        ];
      });
    };
    const onTaskEnd = (e: {
      taskId: string;
      identifier: string;
      status: "success" | "blocked";
      summary: string;
      costUsd: number | null;
      durationMs: number;
    }) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === e.taskId
            ? {
                ...t,
                status: e.status,
                summary: e.summary,
                costUsd: e.costUsd,
                durationMs: e.durationMs,
              }
            : t,
        ),
      );
      setRun((prev) =>
        prev
          ? {
              ...prev,
              succeeded: prev.succeeded + (e.status === "success" ? 1 : 0),
              blocked: prev.blocked + (e.status === "blocked" ? 1 : 0),
              totalCostUsd: prev.totalCostUsd + (e.costUsd ?? 0),
            }
          : prev,
      );
    };
    const onRunEnd = (e: {
      status: "completed" | "aborted" | "failed";
      prUrl: string | null;
      endedAt: number;
    }) => {
      setRun((prev) =>
        prev ? { ...prev, status: e.status, prUrl: e.prUrl, endedAt: e.endedAt } : prev,
      );
    };

    events.on("run:start", onRunStart);
    events.on("task:start", onTaskStart);
    events.on("task:end", onTaskEnd);
    events.on("run:end", onRunEnd);
    return () => {
      events.off("run:start", onRunStart);
      events.off("task:start", onTaskStart);
      events.off("task:end", onTaskEnd);
      events.off("run:end", onRunEnd);
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      const collected: RunResult[] = [];
      for (const project of projects) {
        try {
          const r = await runProject(project, {
            ...(opts.resumeRunBranch ? { resumeRunBranch: opts.resumeRunBranch } : {}),
            ...(opts.dryRun ? { dryRun: true } : {}),
          });
          collected.push(r);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          break;
        }
      }
      setResults(collected);
      setDone(true);
      onDone(collected);
      // Give the user a moment to see the final state, then exit.
      setTimeout(() => exit(), 500);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (opts.dryRun) {
    return (
      <Box flexDirection="column">
        <Text bold>Plane Autorun · dry-run</Text>
        {projects.map((p) => (
          <Text key={p.id}>  · {p.id} ({p.projectName}) — see stdout above</Text>
        ))}
        {done && <Text color="green">Done.</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header run={run} projects={projects} />
      <ProgressBar run={run} tasks={tasks} />
      <TaskList tasks={tasks} />
      {error && <Text color="red">Error: {error}</Text>}
      {done && results.length > 0 && <Summary results={results} />}
      <Text dimColor>q quit · ctrl+c quit</Text>
    </Box>
  );
}

function Header({
  run,
  projects,
}: {
  run: RunState | null;
  projects: ProjectConfig[];
}) {
  const project = projects[0];
  const branch = run?.runBranch ?? "(starting…)";
  return (
    <Box>
      <Text bold>Plane Autorun</Text>
      <Text> · </Text>
      <Text color="cyan">{project?.id ?? "?"}</Text>
      <Text> · </Text>
      <Text color="magenta">{branch}</Text>
    </Box>
  );
}

function ProgressBar({ run, tasks }: { run: RunState | null; tasks: TaskState[] }) {
  if (!run) {
    return (
      <Box>
        <Spinner type="dots" />
        <Text> snapshotting queue…</Text>
      </Box>
    );
  }
  const total = run.queueSize;
  const done = tasks.filter((t) => t.status === "success" || t.status === "blocked").length;
  const ratio = total === 0 ? 0 : done / total;
  const width = 24;
  const filled = Math.floor(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const elapsed = run.startedAt ? Math.round((Date.now() - run.startedAt) / 60_000) : 0;
  const cost = `$${run.totalCostUsd.toFixed(2)}`;

  return (
    <Box>
      <Text>[{bar}] </Text>
      <Text>
        {done}/{total} tasks · {cost} · {elapsed}m elapsed
      </Text>
    </Box>
  );
}

function TaskList({ tasks }: { tasks: TaskState[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {tasks.length === 0 && <Text dimColor>(no tasks yet)</Text>}
      {tasks.map((t) => (
        <Box key={t.id}>
          <Text>{t.identifier.padEnd(10)}</Text>
          <StatusIcon status={t.status} />
          <Text> </Text>
          <Text>{t.title}</Text>
          {t.status === "running" && t.port !== null && (
            <Text dimColor> (running on :{t.port})</Text>
          )}
          {t.summary && (t.status === "success" || t.status === "blocked") && (
            <Text dimColor> · {t.summary}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}

function StatusIcon({ status }: { status: TaskState["status"] }) {
  if (status === "queued") return <Text dimColor>·</Text>;
  if (status === "running") return <Spinner type="dots" />;
  if (status === "success") return <Text color="green">✓</Text>;
  if (status === "blocked") return <Text color="red">✗</Text>;
  return <Text>?</Text>;
}

function Summary({ results }: { results: RunResult[] }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {results.map((r, i) => (
        <Box key={i}>
          <Text bold>Run </Text>
          <Text color="magenta">{r.runBranch ?? "(none)"}</Text>
          <Text>: </Text>
          <Text color="green">{r.succeeded} ok</Text>
          <Text> / </Text>
          <Text color="red">{r.blocked} blocked</Text>
          <Text> · ${r.totalCostUsd.toFixed(2)}</Text>
          {r.prUrl && (
            <>
              <Text> · </Text>
              <Text color="cyan">{r.prUrl}</Text>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

export async function startTui(projects: ProjectConfig[], opts: TuiOptions): Promise<void> {
  // Ink needs a TTY for raw mode (keyboard input). When stdin is not a TTY
  // (cron, piped, < /dev/null), fall back to headless mode automatically.
  if (!process.stdin.isTTY) {
    await runHeadless(projects, { json: false, ...opts });
    return;
  }
  await new Promise<void>((resolve) => {
    const inst = render(
      <App projects={projects} opts={opts} onDone={() => resolve()} />,
    );
    inst.waitUntilExit().then(resolve, resolve);
  });
}

// Headless fallback for callers that don't want the TUI:
export { runHeadless };
