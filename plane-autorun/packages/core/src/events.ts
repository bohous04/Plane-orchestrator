import { EventEmitter } from "node:events";

// Event payloads. Keep these stable — both TUI and dashboard SSE depend on them.

export interface RunStartEvent {
  runId: string;
  projectId: string;
  runBranch: string;
  queueSize: number;
  startedAt: number;
}

export interface RunEndEvent {
  runId: string;
  status: "completed" | "aborted" | "failed";
  succeeded: number;
  blocked: number;
  prUrl: string | null;
  totalCostUsd: number;
  endedAt: number;
}

export interface TaskStartEvent {
  runId: string;
  taskId: string;
  identifier: string;
  title: string;
  port: number;
  startedAt: number;
}

export interface TaskLogEvent {
  runId: string;
  taskId: string;
  source: "stdout" | "stderr";
  chunk: string;
}

export interface TaskEndEvent {
  runId: string;
  taskId: string;
  identifier: string;
  status: "success" | "blocked";
  summary: string;
  files: string[];
  costUsd: number | null;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  mergeStatus?: "merged" | "conflict" | "skipped" | null;
  endedAt: number;
}

export interface CoreEvents {
  "run:start": (e: RunStartEvent) => void;
  "run:end": (e: RunEndEvent) => void;
  "task:start": (e: TaskStartEvent) => void;
  "task:log": (e: TaskLogEvent) => void;
  "task:end": (e: TaskEndEvent) => void;
}

class TypedEventEmitter extends EventEmitter {
  override emit<K extends keyof CoreEvents>(
    event: K,
    ...args: Parameters<CoreEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof CoreEvents>(event: K, listener: CoreEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof CoreEvents>(event: K, listener: CoreEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof CoreEvents>(event: K, listener: CoreEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}

// Singleton — the dashboard SSE relays subscribe to this directly.
// The TUI subscribes too. Both share the same EventEmitter instance.
export const events: TypedEventEmitter = new TypedEventEmitter();

// SSE endpoints attach many short-lived listeners; raise the cap.
events.setMaxListeners(200);
