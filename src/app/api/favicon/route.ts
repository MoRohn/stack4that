/**
 * Favicon proxy for technologies without a brand icon. Serves the site's
 * favicon when one exists and 204 otherwise, so the canvas silently falls
 * back to a monogram (no third-party requests or console noise in the client).
 */
export const dynamic = "force-dynamic";

const cache = new Map<string, { body: Uint8Array | null; type: string; at: number }>();
const TTL = 7 * 86400e3;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

export async function GET(request: Request) {
  const domain = (new URL(request.url).searchParams.get("domain") ?? "").toLowerCase();
  if (!DOMAIN.test(domain)) return new Response(null, { status: 400 });
  let hit = cache.get(domain);
  if (!hit || Date.now() - hit.at > TTL) {
    try {
      const res = await fetch(`https://icons.duckduckgo.com/ip3/${domain}.ico`, { signal: AbortSignal.timeout(5000) });
      const type = res.headers.get("content-type") ?? "";
      const body = res.ok && type.startsWith("image/") ? new Uint8Array(await res.arrayBuffer()) : null;
      hit = { body: body && body.byteLength > 0 && body.byteLength < 200_000 ? body : null, type, at: Date.now() };
    } catch {
      hit = { body: null, type: "", at: Date.now() - TTL + 3600e3 }; // retry failures after an hour
    }
    if (cache.size > 5000) cache.clear();
    cache.set(domain, hit);
  }
  if (!hit.body) return new Response(null, { status: 204, headers: { "cache-control": "public, max-age=86400" } });
  return new Response(hit.body.slice().buffer as ArrayBuffer, { headers: { "content-type": hit.type, "cache-control": "public, max-age=604800, immutable" } });
}
