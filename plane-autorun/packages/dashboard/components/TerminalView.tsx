"use client";

import { useEffect, useRef } from "react";

export function TerminalView({ taskId }: { taskId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let es: EventSource | null = null;
    let onResize: (() => void) | null = null;

    (async () => {
      // xterm only runs in the browser; lazy-load to keep bundles small.
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ]);
      // CSS is served via the @xterm/xterm package.
      // @ts-expect-error - side effect import
      await import("@xterm/xterm/css/xterm.css");

      if (disposed || !ref.current) return;

      term = new Terminal({
        fontSize: 13,
        fontFamily: "ui-monospace, Menlo, Consolas, monospace",
        theme: { background: "#0a0a0a", foreground: "#e5e5e5" },
        convertEol: true,
        scrollback: 50_000,
        cursorBlink: false,
      });
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(ref.current);
      try {
        fit.fit();
      } catch {
        // initial fit can fail if the parent has zero width; ignore
      }

      onResize = () => {
        try {
          fit?.fit();
        } catch {
          // ignore
        }
      };
      window.addEventListener("resize", onResize);

      es = new EventSource(`/api/tasks/${taskId}/stream`);
      es.onmessage = (ev) => {
        if (!term) return;
        try {
          const data = JSON.parse(ev.data) as
            | { kind: "chunk"; chunk: string }
            | { kind: "end" }
            | { kind: "heartbeat"; t: number }
            | { kind: "error"; error: string };
          if (data.kind === "chunk") {
            term.write(data.chunk);
          } else if (data.kind === "end") {
            term.writeln("");
            term.writeln("[90m[runner ended][0m");
            es?.close();
          } else if (data.kind === "error") {
            term.writeln(`[31m[error] ${data.error}[0m`);
          }
        } catch {
          // ignore
        }
      };
    })();

    return () => {
      disposed = true;
      es?.close();
      term?.dispose();
      if (onResize) window.removeEventListener("resize", onResize);
    };
  }, [taskId]);

  return (
    <div
      ref={ref}
      className="h-[600px] w-full overflow-hidden rounded-md border border-slate-800 bg-[#0a0a0a] p-2"
    />
  );
}
