import { getActiveRun, getRun, PipelineBusyError, startRun } from "@/lib/pipeline/runner";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isTypeSafeConfigured, TypeSafeNotConfiguredError } from "@/lib/typesafe";
import type { PipelineMode, PipelineOptions } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const MODES: PipelineMode[] = ["refresh", "discover", "full"];
const SOURCES = ["yc", "cncf", "github", "npm", "wikidata", "apache", "dockerhub", "pypi", "crates"] as const;

/** Optional protection: set PIPELINE_ADMIN_TOKEN to require it (header x-pipeline-token) for launches. */
function authorized(request: Request): boolean {
  const token = process.env.PIPELINE_ADMIN_TOKEN;
  return !token || request.headers.get("x-pipeline-token") === token;
}

export async function POST(request: Request) {
  if (!isTypeSafeConfigured()) return Response.json({ error: new TypeSafeNotConfiguredError().message }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: "A pipeline admin token is required to launch runs.", tokenRequired: true }, { status: 401 });
  const limited = rateLimit(`pipeline:${clientKey(request)}`, 6, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const body = (await request.json().catch(() => ({}))) as { mode?: string; limit?: number; sources?: string[] };
  if (body.mode !== undefined && !MODES.includes(body.mode as PipelineMode)) return Response.json({ error: `mode must be one of: ${MODES.join(", ")}` }, { status: 400 });
  const mode = (body.mode as PipelineMode) ?? "refresh";
  const rawLimit = body.limit ?? 40;
  if (typeof rawLimit !== "number" || !Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > 400) return Response.json({ error: "limit must be a number between 1 and 400" }, { status: 400 });
  const limit = Math.round(rawLimit);
  if (body.sources !== undefined && (!Array.isArray(body.sources) || body.sources.some((x) => !(SOURCES as readonly string[]).includes(x)))) return Response.json({ error: `sources must be a subset of: ${SOURCES.join(", ")}` }, { status: 400 });
  const sources = Array.isArray(body.sources) ? (body.sources.filter((s) => (SOURCES as readonly string[]).includes(s)) as NonNullable<PipelineOptions["sources"]>) : undefined;
  try {
    const { run, alreadyRunning } = await startRun({ mode, limit, sources: sources?.length ? sources : undefined });
    return Response.json({ run, alreadyRunning }, { status: alreadyRunning ? 200 : 202 });
  } catch (err) {
    if (err instanceof PipelineBusyError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

/** Follow a run: ?id=run_… or, without an id, the run currently in progress (if any). */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const run = id ? getRun(id) : getActiveRun();
  if (!run) return Response.json({ run: null, tokenRequired: Boolean(process.env.PIPELINE_ADMIN_TOKEN) }, { status: id ? 404 : 200 });
  return Response.json({ run, tokenRequired: Boolean(process.env.PIPELINE_ADMIN_TOKEN) });
}
