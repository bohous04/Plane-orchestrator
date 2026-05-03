// Parse the three-header contract emitted by plane-autorun-runner:
//   STATUS: SUCCESS|BLOCKED
//   SUMMARY: <one-line description>
//   FILES:   <comma-separated list, or "none">
// The runner is required to produce these as the first lines of its result.

export type RunnerStatus = "SUCCESS" | "BLOCKED";

export interface ParsedHeaders {
  status: RunnerStatus;
  summary: string;
  files: string[];
}

const HEADER_LOOKAHEAD = 30;
const SUMMARY_MAX = 140;

export function parseRunnerHeaders(resultText: string): ParsedHeaders {
  const lines = resultText.split(/\r?\n/).slice(0, HEADER_LOOKAHEAD);

  let status: RunnerStatus | null = null;
  let summary: string | null = null;
  let filesRaw: string | null = null;

  for (const line of lines) {
    if (status === null) {
      const m = line.match(/^\s*STATUS:\s*(SUCCESS|BLOCKED)\s*$/);
      if (m && m[1]) {
        status = m[1] as RunnerStatus;
        continue;
      }
    }
    if (summary === null) {
      const m = line.match(/^\s*SUMMARY:\s*(.+?)\s*$/);
      if (m && m[1]) {
        summary = m[1];
        continue;
      }
    }
    if (filesRaw === null) {
      const m = line.match(/^\s*FILES:\s*(.+?)\s*$/);
      if (m && m[1]) {
        filesRaw = m[1];
        continue;
      }
    }
    if (status && summary && filesRaw) break;
  }

  if (!status || !summary || !filesRaw) {
    return {
      status: "BLOCKED",
      summary: "Runner produced no structured report; see Plane comment.",
      files: ["unknown"],
    };
  }

  const files =
    filesRaw.trim().toLowerCase() === "none"
      ? []
      : filesRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  return {
    status,
    summary: summary.slice(0, SUMMARY_MAX),
    files,
  };
}
