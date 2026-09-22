import { runPipeline, type PipelineMode } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? process.env.PIPELINE_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization") ?? "";
  const url = new URL(request.url);
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const mode = (url.searchParams.get("mode") ?? "full") as PipelineMode;
  const limit = Number(url.searchParams.get("limit") ?? (mode === "full" ? 40 : 80));
  const run = await runPipeline({ mode, limit });
  return Response.json({ run });
}

export const GET = handle;
export const POST = handle;
