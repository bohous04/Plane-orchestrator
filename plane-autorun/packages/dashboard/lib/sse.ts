// Tiny helpers for building SSE responses in Next.js route handlers.
// Format: each message is `data: <JSON>\n\n`; `event:` lines are optional.

export type SseSend = (kind: string, data: unknown) => void;

export interface SseStream {
  response: Response;
  send: SseSend;
}

export function createSseResponse(
  setup: (send: SseSend, signal: AbortSignal, close: () => void) => void | Promise<void>,
  reqSignal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    try {
      controllerRef?.close();
    } catch {
      // already closed
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controllerRef = controller;
      const send: SseSend = (kind, data) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ kind, ...((data as object) ?? {}) })}\n\n`),
          );
        } catch {
          close();
        }
      };
      reqSignal.addEventListener("abort", close);
      try {
        await setup(send, reqSignal, close);
      } catch (e) {
        send("error", { error: String(e) });
        close();
      }
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
