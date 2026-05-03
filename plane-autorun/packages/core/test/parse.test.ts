import { describe, it, expect } from "vitest";
import { parseRunnerHeaders } from "../src/parse.js";

describe("parseRunnerHeaders", () => {
  it("parses canonical SUCCESS output", () => {
    const out = parseRunnerHeaders(
      `STATUS: SUCCESS
SUMMARY: Added empty-state component to admin/employees
FILES: app/admin/employees/page.tsx, app/admin/employees/empty-state.tsx`,
    );
    expect(out).toEqual({
      status: "SUCCESS",
      summary: "Added empty-state component to admin/employees",
      files: [
        "app/admin/employees/page.tsx",
        "app/admin/employees/empty-state.tsx",
      ],
    });
  });

  it("parses canonical BLOCKED output", () => {
    const out = parseRunnerHeaders(
      `STATUS: BLOCKED
SUMMARY: Acceptance criteria too vague to implement.
FILES: none`,
    );
    expect(out).toEqual({
      status: "BLOCKED",
      summary: "Acceptance criteria too vague to implement.",
      files: [],
    });
  });

  it("treats FILES: none case-insensitively", () => {
    const out = parseRunnerHeaders(
      `STATUS: SUCCESS
SUMMARY: x
FILES: NONE`,
    );
    expect(out.files).toEqual([]);
  });

  it("tolerates leading whitespace and CRLF", () => {
    const out = parseRunnerHeaders(
      `   STATUS: SUCCESS\r\n  SUMMARY: ok\r\n FILES: a.ts, b.ts\r\n`,
    );
    expect(out).toEqual({
      status: "SUCCESS",
      summary: "ok",
      files: ["a.ts", "b.ts"],
    });
  });

  it("falls back to BLOCKED when headers are missing", () => {
    const out = parseRunnerHeaders("This runner produced totally unrelated output.\nNo headers.\n");
    expect(out.status).toBe("BLOCKED");
    expect(out.summary).toMatch(/no structured report/i);
    expect(out.files).toEqual(["unknown"]);
  });

  it("falls back to BLOCKED when only some headers are present", () => {
    const out = parseRunnerHeaders(`STATUS: SUCCESS\nFILES: x.ts`);
    expect(out.status).toBe("BLOCKED");
  });

  it("truncates summaries longer than 140 characters", () => {
    const long = "x".repeat(300);
    const out = parseRunnerHeaders(
      `STATUS: SUCCESS\nSUMMARY: ${long}\nFILES: a.ts`,
    );
    expect(out.summary.length).toBe(140);
  });

  it("ignores headers that appear past the lookahead", () => {
    const lines = Array.from({ length: 50 }, () => "noise");
    const text = `${lines.join("\n")}\nSTATUS: SUCCESS\nSUMMARY: x\nFILES: a.ts`;
    const out = parseRunnerHeaders(text);
    expect(out.status).toBe("BLOCKED");
  });

  it("skips invalid status values, falls back", () => {
    const out = parseRunnerHeaders(
      `STATUS: MAYBE\nSUMMARY: ok\nFILES: a.ts`,
    );
    expect(out.status).toBe("BLOCKED");
  });

  it("trims and filters empty entries from FILES list", () => {
    const out = parseRunnerHeaders(
      `STATUS: SUCCESS\nSUMMARY: ok\nFILES: a.ts,, b.ts ,  ,c.ts`,
    );
    expect(out.files).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
});
