import { describe, it, expect } from "vitest";
import { parseEnv, setEnv } from "../src/envfile.js";

describe("envfile", () => {
  it("parses simple key=value", () => {
    const out = parseEnv("FOO=bar\nBAZ=qux");
    expect(out[0]).toEqual({ raw: "FOO=bar", key: "FOO", value: "bar" });
    expect(out[1]).toEqual({ raw: "BAZ=qux", key: "BAZ", value: "qux" });
  });

  it("preserves comments and blank lines", () => {
    const src = "# leading comment\n\nFOO=bar\n# inline\nBAZ=qux\n";
    const lines = parseEnv(src);
    expect(lines[0]?.raw).toBe("# leading comment");
    expect(lines[0]?.key).toBeUndefined();
    expect(lines[1]?.raw).toBe("");
    expect(lines[3]?.raw).toBe("# inline");
  });

  it("strips surrounding quotes from values", () => {
    expect(parseEnv('A="hello"\nB=\'world\'')).toEqual([
      { raw: 'A="hello"', key: "A", value: "hello" },
      { raw: "B='world'", key: "B", value: "world" },
    ]);
  });

  it("setEnv updates an existing key in place", () => {
    const src = "# c\nFOO=old\nBAR=keep\n";
    const out = setEnv(src, "FOO", "new");
    expect(out).toBe("# c\nFOO=new\nBAR=keep\n");
  });

  it("setEnv appends new keys before trailing blank lines", () => {
    // Input has two trailing newlines (one terminator + one blank).
    // We append the new key on the line before the final blank, then the
    // round-trip preserves both newlines: "FOO=bar\nBAZ=qux\n\n".
    const src = "FOO=bar\n\n";
    const out = setEnv(src, "BAZ", "qux");
    expect(out).toBe("FOO=bar\nBAZ=qux\n\n");
  });

  it("setEnv works on empty content", () => {
    // Empty input is a single empty line; appending writes the new key and
    // re-emits a final newline.
    expect(setEnv("", "X", "1")).toBe("X=1\n");
  });

  it("setEnv preserves comments around the edited key", () => {
    const src = "# top\nFOO=old # not a real comment, that's the value\nBAR=keep\n";
    const out = setEnv(src, "FOO", "new");
    expect(out.split("\n")[1]).toBe("FOO=new");
    expect(out).toContain("# top");
    expect(out).toContain("BAR=keep");
  });
});
