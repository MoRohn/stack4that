/**
 * Optional in-process scheduler for long-running Node deployments (Docker,
 * Railway, Fly). Vercel deployments use vercel.json crons instead.
 * Enable with PIPELINE_INPROCESS_SCHEDULE=1.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Warm the catalog, the retrieval index and the SSE/architect modules at boot so the
  // first build after a (re)start is as fast as the rest.
  setTimeout(() => {
    void (async () => {
      try {
        const { getIndex } = await import("@/lib/retrieval");
        await getIndex();
        await import("@/lib/architect");
      } catch (err) {
        console.error("[warmup] failed", err);
      }
    })();
  }, 0);
  if (process.env.PIPELINE_INPROCESS_SCHEDULE !== "1") return;
  const { runPipeline } = await import("@/lib/pipeline");
  const hours = Number(process.env.PIPELINE_INTERVAL_HOURS ?? 24);
  const tick = () => runPipeline({ mode: "full", limit: 40 }).catch((err) => console.error("[pipeline] scheduled run failed", err));
  setTimeout(tick, 60_000);
  setInterval(tick, hours * 3600e3);
}
