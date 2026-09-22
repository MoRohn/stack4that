import type { ArchitectEvent } from "@/lib/architect/events";

/** Consume a server-sent event stream produced by the architect routes. */
export async function consumeSSE(response: Response, onEvent: (e: ArchitectEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain-text error body */
    }
    throw new Error(message || `request failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as ArchitectEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}
