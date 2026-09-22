import { encodeSSE, type ArchitectEvent } from "./events";

/** Wrap an async producer that emits ArchitectEvents into an SSE Response. */
export function sseResponse(run: (emit: (e: ArchitectEvent) => void, signal: AbortSignal) => Promise<unknown>, request: Request): Response {
  const encoder = new TextEncoder();
  const controllerRef: { c?: ReadableStreamDefaultController<Uint8Array>; closed: boolean } = { closed: false };
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort());
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef.c = controller;
      const emit = (e: ArchitectEvent) => {
        if (controllerRef.closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSSE(e)));
        } catch {
          controllerRef.closed = true;
        }
      };
      // keep-alive comments so proxies do not close the stream
      const ka = setInterval(() => {
        if (!controllerRef.closed) {
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            controllerRef.closed = true;
          }
        }
      }, 15000);
      run(emit, abort.signal)
        .catch((err) => emit({ type: "error", message: (err as Error).message ?? String(err), recoverable: false }))
        .finally(() => {
          clearInterval(ka);
          if (!controllerRef.closed) {
            controllerRef.closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        });
    },
    cancel() {
      controllerRef.closed = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
