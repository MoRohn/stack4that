import { swapComponent } from "@/lib/architect";
import { sseResponse } from "@/lib/architect/sse";
import { getArchitecture } from "@/lib/db/repo";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isTypeSafeConfigured, TypeSafeNotConfiguredError } from "@/lib/typesafe";
import { withSessionKey } from "@/lib/typesafe/session-key";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  return withSessionKey(() => swap(request));
}

async function swap(request: Request) {
  if (!isTypeSafeConfigured()) return Response.json({ error: new TypeSafeNotConfiguredError().message }, { status: 503 });
  const limited = rateLimit(`architect:${clientKey(request)}`);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const raw = await request.text();
  if (raw.length > 500_000) return Response.json({ error: "request body too large" }, { status: 413 });
  let body: { architectureId?: string; slotId?: string; technologyId?: string; architecture?: unknown } = {};
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.slotId || !body.technologyId) return Response.json({ error: "slotId and technologyId are required" }, { status: 400 });
  const saved = body.architectureId ? await getArchitecture(body.architectureId) : undefined;
  // Prefer the server's copy. A client-supplied architecture is only a fallback (e.g. an ephemeral
  // database) and is never persisted, so untrusted content can not become a shared page.
  const target = saved ?? (body.architecture as Parameters<typeof swapComponent>[0] | undefined);
  if (!target || !Array.isArray(target.components) || !target.requirementGraph || !target.intent) return Response.json({ error: "unknown architecture" }, { status: 404 });
  return sseResponse((emit, signal) => swapComponent(target, body.slotId!, body.technologyId!, { emit, signal, persist: Boolean(saved) }), request);
}
