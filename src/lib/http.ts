import { gzipSync } from "node:zlib";

/** JSON response gzip-compressed when the client accepts it (route handlers are not compressed by Next). */
export function compressedJson(request: Request, body: string | Buffer, headers: Record<string, string> = {}, gz?: Buffer): Response {
  const accepts = /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
  const base = { "content-type": "application/json; charset=utf-8", vary: "accept-encoding", ...headers };
  if (!accepts) return new Response(typeof body === "string" ? body : new Uint8Array(body), { headers: base });
  const zipped = gz ?? gzipSync(typeof body === "string" ? Buffer.from(body) : body, { level: 6 });
  return new Response(new Uint8Array(zipped), { headers: { ...base, "content-encoding": "gzip" } });
}
