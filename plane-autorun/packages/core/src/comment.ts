// HTML comment builders for Plane work-item comments. No emojis. Escape any
// untrusted strings (titles, summaries, branch names from config can be
// trusted but free-text from runners must be escaped).

import { escapeHtml } from "./plane.js";

export interface SuccessCommentInput {
  identifier: string;
  runBranch: string;
  subBranch: string;
  summary: string;
  files: string[];
  prUrl: string | null;
  costUsd: number | null;
  durationMs: number;
  manualTestSteps?: string[];
}

export interface BlockedCommentInput {
  identifier: string;
  runBranch: string;
  subBranch: string;
  reason: string;
  needs?: string;
  costUsd: number | null;
  durationMs: number;
}

export function successComment(input: SuccessCommentInput): string {
  const files =
    input.files.length === 0
      ? "<li>(no files reported)</li>"
      : input.files.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("");
  const pr = input.prUrl
    ? `<p>PR: <a href="${escapeHtml(input.prUrl)}">${escapeHtml(input.prUrl)}</a></p>`
    : "";
  const tests =
    input.manualTestSteps && input.manualTestSteps.length > 0
      ? `<p><strong>Manual test steps:</strong></p><ol>${input.manualTestSteps
          .map((s) => `<li>${escapeHtml(s)}</li>`)
          .join("")}</ol>`
      : "";
  return [
    `<p><strong>autorun: SUCCESS</strong></p>`,
    `<p>${escapeHtml(input.summary)}</p>`,
    `<p>Branch: <code>${escapeHtml(input.subBranch)}</code> (run: <code>${escapeHtml(input.runBranch)}</code>)</p>`,
    `<p><strong>Files changed:</strong></p>`,
    `<ul>${files}</ul>`,
    pr,
    tests,
    `<p><em>Cost: $${(input.costUsd ?? 0).toFixed(3)} · Duration: ${formatDuration(input.durationMs)}</em></p>`,
  ]
    .filter(Boolean)
    .join("");
}

export function blockedComment(input: BlockedCommentInput): string {
  return [
    `<p><strong>autorun: BLOCKED</strong></p>`,
    `<p>${escapeHtml(input.reason)}</p>`,
    input.needs
      ? `<p><strong>What's needed:</strong> ${escapeHtml(input.needs)}</p>`
      : "",
    `<p>Branch (with partial work, if any): <code>${escapeHtml(input.subBranch)}</code> (run: <code>${escapeHtml(input.runBranch)}</code>)</p>`,
    `<p><em>Cost: $${(input.costUsd ?? 0).toFixed(3)} · Duration: ${formatDuration(input.durationMs)}</em></p>`,
  ]
    .filter(Boolean)
    .join("");
}

export function mergeConflictComment(
  identifier: string,
  runBranch: string,
  subBranch: string,
): string {
  return [
    `<p><strong>autorun: SUCCESS but MERGE CONFLICT</strong></p>`,
    `<p>The runner finished successfully but the resulting sub-branch could not be auto-merged into the run branch.</p>`,
    `<p>To resolve manually:</p>`,
    `<ol>`,
    `<li><code>git checkout ${escapeHtml(runBranch)}</code></li>`,
    `<li><code>git merge ${escapeHtml(subBranch)}</code></li>`,
    `<li>Resolve conflicts and commit.</li>`,
    `</ol>`,
  ].join("");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${rs}s`;
}
