// Direct Plane REST client. No MCP. Confirmed against plane.agent42.cz/api/v1.
//
// Auth: header `x-api-key: <token>` (NOT `Authorization: <token>` as the PRD said).
// Pagination: list endpoints return { results, next_cursor, count, total_count, ... }.
// Loop while next_cursor is non-empty AND next_page_results is true.

import { log } from "./log.js";

export interface PlaneState {
  id: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  color: string;
  sequence: number;
  default: boolean;
  project: string;
  workspace: string;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  workspace: string;
}

export interface PlaneUser {
  id: string;
  email: string;
  display_name: string;
  first_name: string;
  last_name: string;
}

export interface PlaneWorkItem {
  id: string;
  sequence_id: number;
  name: string;
  description_html: string | null;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  state: string; // state UUID
  assignees: string[];
  labels: string[];
  created_at: string;
  updated_at: string;
  project: string;
  workspace: string;
  parent: string | null;
}

export interface PlaneSnapshotItem extends PlaneWorkItem {
  identifier: string; // computed: `${prefix}-${sequence_id}`
  description_text: string; // stripped HTML
  state_name: string;
  state_group: PlaneState["group"];
}

interface PaginatedResponse<T> {
  results: T[];
  next_cursor: string;
  prev_cursor: string;
  next_page_results: boolean;
  count: number;
  total_count: number;
  total_pages: number;
}

export interface PlaneClientOptions {
  workspace: string;
  token: string;
  baseUrl?: string; // default https://plane.agent42.cz/api/v1, override per env
  fetchImpl?: typeof fetch; // for tests
  retryDelayMs?: number; // default 5000
}

export class PlaneClient {
  private readonly workspace: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(opts: PlaneClientOptions) {
    if (!opts.workspace) throw new Error("PlaneClient: workspace required");
    if (!opts.token) throw new Error("PlaneClient: token required");
    this.workspace = opts.workspace;
    this.token = opts.token;
    this.baseUrl =
      opts.baseUrl ?? process.env["PLANE_API_URL"] ?? "https://plane.agent42.cz/api/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 5000;
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const p = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(base + p);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      "x-api-key": this.token,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const doFetch = async (): Promise<Response> => {
      const init: RequestInit = { method, headers };
      if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
      return this.fetchImpl(url, init);
    };

    let res: Response;
    try {
      res = await doFetch();
    } catch (err) {
      log.warn({ err: String(err), url, method }, "plane fetch failed, retrying once");
      await sleep(this.retryDelayMs);
      res = await doFetch();
    }

    if (res.status >= 500) {
      log.warn({ status: res.status, url, method }, "plane 5xx, retrying once");
      await sleep(this.retryDelayMs);
      res = await doFetch();
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new PlaneApiError(method, url, res.status, text);
    }

    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return (await res.text()) as unknown as T;
    return (await res.json()) as T;
  }

  private async *paginate<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    let safetyMax = 100; // hard cap to prevent infinite loops on a misbehaving API
    while (safetyMax-- > 0) {
      const q = { per_page: 100, ...(query ?? {}), ...(cursor ? { cursor } : {}) };
      const page = await this.request<PaginatedResponse<T>>("GET", path, { query: q });
      for (const item of page.results) yield item;
      if (!page.next_page_results || !page.next_cursor) break;
      cursor = page.next_cursor;
    }
  }

  // ---- Public API ----

  async getMe(): Promise<PlaneUser> {
    return this.request<PlaneUser>("GET", "/users/me/");
  }

  async listProjects(): Promise<PlaneProject[]> {
    const out: PlaneProject[] = [];
    for await (const p of this.paginate<PlaneProject>(`/workspaces/${this.workspace}/projects/`)) {
      out.push(p);
    }
    return out;
  }

  async resolveProjectId(projectName: string): Promise<string> {
    const projects = await this.listProjects();
    const match = projects.find((p) => p.name === projectName);
    if (!match) {
      throw new Error(
        `Plane project not found in workspace "${this.workspace}": ${projectName}. ` +
          `Available: ${projects.map((p) => p.name).join(", ")}`,
      );
    }
    return match.id;
  }

  async listStates(projectId: string): Promise<PlaneState[]> {
    const out: PlaneState[] = [];
    for await (const s of this.paginate<PlaneState>(
      `/workspaces/${this.workspace}/projects/${projectId}/states/`,
    )) {
      out.push(s);
    }
    return out;
  }

  async createState(
    projectId: string,
    state: { name: string; group: PlaneState["group"]; color: string },
  ): Promise<PlaneState> {
    return this.request<PlaneState>(
      "POST",
      `/workspaces/${this.workspace}/projects/${projectId}/states/`,
      { body: state },
    );
  }

  // Ensures the two harness states exist; returns the existing-or-created PlaneState for each.
  async ensureStates(
    projectId: string,
    required: ReadonlyArray<{ name: string; group: PlaneState["group"]; color: string }>,
  ): Promise<Record<string, PlaneState>> {
    const existing = await this.listStates(projectId);
    const out: Record<string, PlaneState> = {};
    for (const s of existing) out[s.name] = s;
    for (const r of required) {
      if (!out[r.name]) {
        log.info({ name: r.name, group: r.group }, "Plane: creating missing state");
        out[r.name] = await this.createState(projectId, r);
      }
    }
    return out;
  }

  // Snapshot the queue of work items eligible for autorun: state.name in ("Todo","Backlog"),
  // sorted by priority (urgent>high>medium>low>none) then created_at ascending.
  async snapshotTodoQueue(
    projectId: string,
    identifierPrefix: string,
  ): Promise<PlaneSnapshotItem[]> {
    const [items, states] = await Promise.all([
      this.listAllIssues(projectId),
      this.listStates(projectId),
    ]);
    const stateById = new Map(states.map((s) => [s.id, s]));
    const eligibleStateNames = new Set(["Todo", "Backlog"]);
    const ident = /^[A-Z]+-[0-9]+$/;

    const items2: PlaneSnapshotItem[] = [];
    for (const it of items) {
      const s = stateById.get(it.state);
      if (!s) continue;
      if (!eligibleStateNames.has(s.name)) continue;
      const identifier = `${identifierPrefix}-${it.sequence_id}`;
      if (!ident.test(identifier)) continue;
      items2.push({
        ...it,
        identifier,
        description_text: stripHtml(it.description_html),
        state_name: s.name,
        state_group: s.group,
      });
    }

    return items2.sort(byPriorityThenCreated);
  }

  async listAllIssues(projectId: string): Promise<PlaneWorkItem[]> {
    const out: PlaneWorkItem[] = [];
    for await (const it of this.paginate<PlaneWorkItem>(
      `/workspaces/${this.workspace}/projects/${projectId}/issues/`,
    )) {
      out.push(it);
    }
    return out;
  }

  async updateWorkItemState(
    projectId: string,
    workItemId: string,
    stateId: string,
  ): Promise<void> {
    await this.request("PATCH", `/workspaces/${this.workspace}/projects/${projectId}/issues/${workItemId}/`, {
      body: { state: stateId },
    });
  }

  // Read existing assignees, then PATCH with a unique merged list (PRD §12).
  async updateWorkItemAssignees(
    projectId: string,
    workItemId: string,
    addUserId: string,
  ): Promise<void> {
    const issue = await this.request<PlaneWorkItem>(
      "GET",
      `/workspaces/${this.workspace}/projects/${projectId}/issues/${workItemId}/`,
    );
    const merged = Array.from(new Set([...(issue.assignees ?? []), addUserId]));
    await this.request("PATCH", `/workspaces/${this.workspace}/projects/${projectId}/issues/${workItemId}/`, {
      body: { assignees: merged },
    });
  }

  async createComment(
    projectId: string,
    workItemId: string,
    bodyHtml: string,
  ): Promise<void> {
    await this.request(
      "POST",
      `/workspaces/${this.workspace}/projects/${projectId}/issues/${workItemId}/comments/`,
      { body: { comment_html: bodyHtml, comment_stripped: stripHtml(bodyHtml) } },
    );
  }
}

export class PlaneApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly url: string,
    public readonly status: number,
    public readonly bodyText: string,
  ) {
    super(`Plane API ${method} ${redactToken(url)} -> ${status}: ${bodyText.slice(0, 300)}`);
    this.name = "PlaneApiError";
  }
}

const PRIORITY_ORDER: Record<PlaneWorkItem["priority"], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function byPriorityThenCreated(a: PlaneWorkItem, b: PlaneWorkItem): number {
  const ap = PRIORITY_ORDER[a.priority];
  const bp = PRIORITY_ORDER[b.priority];
  if (ap !== bp) return ap - bp;
  return a.created_at.localeCompare(b.created_at);
}

export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redactToken(s: string): string {
  return s.replace(/(plane_api_)[A-Za-z0-9]+/g, "$1***");
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// The two harness states the orchestrator depends on (PRD §4).
export const REQUIRED_STATES: ReadonlyArray<{
  name: string;
  group: PlaneState["group"];
  color: string;
}> = [
  { name: "Ready for Review", group: "started", color: "#3B82F6" },
  { name: "Blocked / Needs Clarification", group: "unstarted", color: "#EF4444" },
];
