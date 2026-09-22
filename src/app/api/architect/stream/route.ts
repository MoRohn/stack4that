import { runArchitect } from "@/lib/architect";
import { sseResponse } from "@/lib/architect/sse";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isTypeSafeConfigured, TypeSafeNotConfiguredError } from "@/lib/typesafe";
import type { ThreadTurn } from "@/lib/types";
import { withSessionKey } from "@/lib/typesafe/session-key";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Body {
  request?: string;
  thread?: { id?: unknown; turns?: unknown };
}

/** Earlier turns come from the client: keep only well-formed, bounded text. */
function sanitizeThread(raw: Body["thread"]): { id?: string; turns: ThreadTurn[] } | undefined {
  if (!raw || !Array.isArray(raw.turns)) return undefined;
  const turns: ThreadTurn[] = [];
  for (const t of raw.turns.slice(-12)) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.request !== "string" || !r.request.trim()) continue;
    turns.push({
      request: r.request.trim().slice(0, 2000),
      brief: typeof r.brief === "string" ? r.brief.slice(0, 3000) : undefined,
      architectureId: typeof r.architectureId === "string" && /^arch_[a-z0-9]{4,16}$/.test(r.architectureId) ? r.architectureId : undefined,
      createdAt: typeof r.createdAt === "string" && !Number.isNaN(Date.parse(r.createdAt)) ? r.createdAt : new Date().toISOString(),
    });
  }
  return { id: typeof raw.id === "string" ? raw.id : undefined, turns };
}

async function handle(request: Request, body: Body) {
  return withSessionKey(() => architect(request, body));
}

async function architect(request: Request, body: Body) {
  if (!isTypeSafeConfigured()) return Response.json({ error: new TypeSafeNotConfiguredError().message }, { status: 503 });
  const limited = rateLimit(`architect:${clientKey(request)}`);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const text = (body.request ?? "").trim();
  if (!text) return Response.json({ error: "request is required" }, { status: 400 });
  if (text.length > 2000) return Response.json({ error: "request is too long" }, { status: 400 });
  const thread = sanitizeThread(body.thread);
  return sseResponse((emit, signal) => runArchitect(text, { emit, signal, thread }), request);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 60_000) return Response.json({ error: "request body too large" }, { status: 413 });
  let body: Body = {};
  try {
    body = JSON.parse(raw || "{}") as Body;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  return handle(request, body);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handle(request, { request: url.searchParams.get("q") ?? "" });
}
