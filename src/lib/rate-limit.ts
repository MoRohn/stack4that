/**
 * Small in-memory sliding-window limiter for the endpoints that spend
 * decision-engine tokens. Per instance; put a shared limiter (e.g. Upstash)
 * in front for multi-instance deployments.
 */
const hits = new Map<string, number[]>();

export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || request.headers.get("x-real-ip") || "local";
}

export function rateLimit(key: string, limit = Number(process.env.ARCHITECT_RATE_LIMIT ?? 20), windowMs = 60_000): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    hits.set(key, list);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - list[0])) / 1000) };
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return { ok: true, retryAfter: 0 };
}

export function tooManyRequests(retryAfter: number): Response {
  return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}
