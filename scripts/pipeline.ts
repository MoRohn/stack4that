/* CLI: npm run pipeline -- [--mode full|refresh|discover] [--limit 40] [--sources wikidata,apache,…] [--watch] */
import "./env";
import { ALL_SOURCES, runPipeline, type PipelineMode, type PipelineSource } from "@/lib/pipeline";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function once() {
  const mode = (arg("mode", "full") as PipelineMode) ?? "full";
  const limit = Number(arg("limit", "40"));
  const requested = (arg("sources") ?? "").split(",").map((x) => x.trim()).filter(Boolean) as PipelineSource[];
  const unknown = requested.filter((x) => !ALL_SOURCES.includes(x));
  if (unknown.length) {
    console.error(`Unknown source(s): ${unknown.join(", ")}. Available: ${ALL_SOURCES.join(", ")}`);
    process.exit(2);
  }
  const result = await runPipeline({ mode, limit, sources: requested.length ? requested : undefined, log: (l) => console.log(l) });
  console.log(JSON.stringify({ id: result.id, status: result.status, stats: result.stats, durationMs: result.durationMs }, null, 2));
  return result;
}

async function main() {
  if (process.argv.includes("--watch")) {
    const intervalMs = Number(arg("interval-hours", "24")) * 3600e3;
    for (;;) {
      await once().catch((e) => console.error(e));
      console.log(`next run in ${intervalMs / 3600e3}h`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  const r = await once();
  process.exit(r.status === "completed" ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
