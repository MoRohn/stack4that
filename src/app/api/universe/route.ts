import { gzipSync } from "node:zlib";
import { toUniverseTech } from "@/lib/catalog";
import { listTechnologies } from "@/lib/db/repo";
import { compressedJson } from "@/lib/http";

export const dynamic = "force-dynamic";

let cache: { key: string; json: string; gz: Buffer } | null = null;

export async function GET(request: Request) {
  const techs = await listTechnologies();
  const key = `${techs.length}:${techs.reduce((m, t) => (t.lastUpdatedAt > m ? t.lastUpdatedAt : m), "")}`;
  if (!cache || cache.key !== key) {
    const items = techs.map(toUniverseTech);
    const json = JSON.stringify({ count: items.length, items });
    cache = { key, json, gz: gzipSync(json, { level: 9 }) };
  }
  return compressedJson(request, cache.json, { "cache-control": "public, max-age=300, stale-while-revalidate=3600", etag: `"${key}"` }, cache.gz);
}
