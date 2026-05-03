import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PlaneClient, PlaneApiError, stripHtml, escapeHtml, REQUIRED_STATES } from "../src/plane.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FX = join(__dirname, "fixtures", "plane");

const projectsJson = readFileSync(join(FX, "projects.json"), "utf8");
const statesJson = readFileSync(join(FX, "states.json"), "utf8");
const issuesJson = readFileSync(join(FX, "issues-page1.json"), "utf8");
const meJson = readFileSync(join(FX, "users-me.json"), "utf8");

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(routes: Record<string, () => { status?: number; body: string | object }>): {
  fetchImpl: typeof fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, headers, body });

    // First exact-path match wins.
    const found = Object.keys(routes).find((p) => url.includes(p));
    if (!found) {
      return new Response(`no route for ${url}`, { status: 404 });
    }
    const out = routes[found]!();
    const status = out.status ?? 200;
    const responseBody = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
    return new Response(responseBody, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

const baseOpts = (fetchImpl: typeof fetch) => ({
  workspace: "test",
  token: "plane_api_TEST",
  baseUrl: "https://plane.agent42.cz/api/v1",
  fetchImpl,
  retryDelayMs: 1, // keep tests fast
});

describe("PlaneClient", () => {
  it("getMe parses user response", async () => {
    const { fetchImpl, calls } = makeFetch({
      "/users/me/": () => ({ body: meJson }),
    });
    const c = new PlaneClient(baseOpts(fetchImpl));
    const me = await c.getMe();
    expect(me.id).toBe("6d2ea97e-abcf-423e-8d71-e64127c7d53c");
    expect(me.email).toBe("michal@agent42.cz");
    expect(calls[0]?.headers["x-api-key"]).toBe("plane_api_TEST");
  });

  it("resolveProjectId matches by name (Czech included)", async () => {
    const { fetchImpl } = makeFetch({
      "/workspaces/test/projects/": () => ({ body: projectsJson }),
    });
    const c = new PlaneClient(baseOpts(fetchImpl));
    const id = await c.resolveProjectId("Docházkový systém");
    expect(id).toBe("7f795ffa-ac93-4f40-87b2-7cb96f4bbb39");
  });

  it("resolveProjectId throws on missing project", async () => {
    const { fetchImpl } = makeFetch({
      "/workspaces/test/projects/": () => ({ body: projectsJson }),
    });
    const c = new PlaneClient(baseOpts(fetchImpl));
    await expect(c.resolveProjectId("Does Not Exist")).rejects.toThrow(/not found/);
  });

  it("listStates returns all states", async () => {
    const { fetchImpl } = makeFetch({
      "/states/": () => ({ body: statesJson }),
    });
    const c = new PlaneClient(baseOpts(fetchImpl));
    const states = await c.listStates("pid");
    expect(states.map((s) => s.name).sort()).toEqual([
      "Backlog",
      "Cancelled",
      "Done",
      "In Progress",
      "Todo",
    ]);
  });

  it("ensureStates creates the two missing harness states", async () => {
    const created: Array<Record<string, unknown>> = [];
    const { fetchImpl } = makeFetch({
      "/states/": () => {
        // GET returns existing, POST returns echo.
        return { body: statesJson };
      },
    });
    // Wrap fetch to handle POST creates explicitly.
    const wrapped: typeof fetch = (async (input: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        const body = JSON.parse(String(init!.body));
        created.push(body);
        return new Response(JSON.stringify({ ...body, id: `new-${created.length}` }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return fetchImpl(input as unknown as Request, init);
    }) as unknown as typeof fetch;

    const c = new PlaneClient({ ...baseOpts(fetchImpl), fetchImpl: wrapped });
    const out = await c.ensureStates("pid", REQUIRED_STATES);
    expect(out["Backlog"]?.name).toBe("Backlog"); // existing
    expect(out["Ready for Review"]?.name).toBe("Ready for Review"); // created
    expect(out["Blocked / Needs Clarification"]?.name).toBe("Blocked / Needs Clarification");
    expect(created.map((c) => c["name"])).toEqual([
      "Ready for Review",
      "Blocked / Needs Clarification",
    ]);
  });

  it("snapshotTodoQueue filters and sorts by priority then created_at", async () => {
    const { fetchImpl } = makeFetch({
      "/issues/": () => ({ body: issuesJson }),
      "/states/": () => ({ body: statesJson }),
    });
    const c = new PlaneClient(baseOpts(fetchImpl));
    const queue = await c.snapshotTodoQueue("pid", "DOCH");
    expect(queue.length).toBe(44); // 43 backlog + 1 todo
    expect(queue[0]?.priority).toBe("urgent");
    // priority groups should appear in order
    const priorities = queue.map((q) => q.priority);
    const order = ["urgent", "high", "medium", "low", "none"];
    let lastIdx = -1;
    for (const p of priorities) {
      const idx = order.indexOf(p);
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
    // identifier shape
    for (const q of queue) {
      expect(q.identifier).toMatch(/^DOCH-\d+$/);
    }
    // every item carries derived state metadata
    for (const q of queue) {
      expect(["Todo", "Backlog"]).toContain(q.state_name);
    }
  });

  it("retries once on 5xx then succeeds", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls++;
      if (calls === 1) {
        return new Response("oops", { status: 502 });
      }
      return new Response(meJson, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const c = new PlaneClient({ workspace: "test", token: "t", fetchImpl, retryDelayMs: 1 });
    const me = await c.getMe();
    expect(calls).toBe(2);
    expect(me.id).toBe("6d2ea97e-abcf-423e-8d71-e64127c7d53c");
  });

  it("throws PlaneApiError on 4xx without retry", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls++;
      return new Response("forbidden", {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const c = new PlaneClient({ workspace: "test", token: "t", fetchImpl, retryDelayMs: 1 });
    await expect(c.getMe()).rejects.toBeInstanceOf(PlaneApiError);
    expect(calls).toBe(1);
  });

  it("redacts plane_api_ tokens in error messages", () => {
    const e = new PlaneApiError(
      "GET",
      "https://x/issues/?token=plane_api_secret123",
      500,
      "boom",
    );
    expect(e.message).not.toContain("secret123");
    expect(e.message).toContain("plane_api_***");
  });
});

describe("stripHtml", () => {
  it("strips tags but keeps line breaks reasonably", () => {
    expect(stripHtml("<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
    expect(stripHtml("<ul><li>one</li><li>two</li></ul>")).toMatch(/one\s+two/);
  });
  it("decodes basic entities", () => {
    expect(stripHtml("a &amp; b &lt; c")).toBe("a & b < c");
  });
  it("returns empty for null/undefined", () => {
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});

describe("escapeHtml", () => {
  it("escapes the dangerous five", () => {
    expect(escapeHtml(`<script>"&'</script>`)).toBe(
      "&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;",
    );
  });
});
