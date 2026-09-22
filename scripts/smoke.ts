/* End-to-end smoke test against a running server: npm run smoke [-- http://stack4that:3333] */
const base = process.argv[2] ?? process.env.SMOKE_URL ?? "http://stack4that:3333";

async function sse(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`${path} → ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) events.push(JSON.parse(line.slice(5)));
    }
  }
  return events;
}

async function main() {
  const health = await (await fetch(`${base}/api/health`)).json();
  console.log("health:", JSON.stringify(health));
  const universe = await (await fetch(`${base}/api/universe`)).json();
  console.log(`universe: ${universe.count} technologies, ${universe.items.filter((i: { iconPath?: string }) => i.iconPath).length} with brand icons`);
  const t0 = Date.now();
  const events = await sse("/api/architect/stream", { request: "Build the stack for a real-time AI news application" });
  const types = events.map((e) => e.type);
  const completed = events.find((e) => e.type === "stack.completed") as { architecture: { id: string; components: Array<{ name: string; slotLabel: string; slotId: string; alternatives: Array<{ technologyId: string; name: string }> }>; stats: unknown } } | undefined;
  if (!completed) throw new Error(`no stack.completed; last events: ${types.slice(-5).join(", ")}`);
  console.log(`stream: ${events.length} events in ${((Date.now() - t0) / 1000).toFixed(1)}s; first component at event #${types.indexOf("stack.component.ready")}`);
  console.log("stack:", completed.architecture.components.map((c) => `${c.slotLabel} → ${c.name}`).join(" | "));
  console.log("stats:", JSON.stringify(completed.architecture.stats));
  const saved = await (await fetch(`${base}/api/stacks/${completed.architecture.id}`)).json();
  if (!saved.architecture) throw new Error("architecture was not persisted");
  const first = completed.architecture.components.find((c) => c.alternatives.length);
  if (first) {
    const swapEvents = await sse("/api/architect/swap", { architectureId: completed.architecture.id, slotId: first.slotId, technologyId: first.alternatives[0].technologyId });
    const done = swapEvents.find((e) => e.type === "stack.completed") as { architecture: { components: Array<{ slotId: string; name: string; coveredSlots: Array<{ slotId: string }> }> } } | undefined;
    if (!done) throw new Error("swap did not complete");
    const holder = done.architecture.components.find((c) => c.slotId === first.slotId || c.coveredSlots.some((s) => s.slotId === first.slotId));
    if (!holder) throw new Error(`slot ${first.slotId} disappeared after swap`);
    console.log(`swap: ${first.slotId} → ${holder.name}${holder.slotId !== first.slotId ? ` (merged into its ${holder.slotId} block)` : ""} (${swapEvents.length} events)`);
  }
  const tech = await (await fetch(`${base}/api/technologies/postgresql`)).json();
  console.log(`technology detail: ${tech.technology.name}, ${tech.technology.evidence.length} evidence records`);
  for (const path of ["/", "/catalog", "/pipeline", `/s/${completed.architecture.id}`]) {
    const r = await fetch(`${base}${path}`);
    console.log(`${path} → ${r.status}`);
    if (!r.ok) throw new Error(`${path} failed`);
  }
  console.log("SMOKE OK");
}
main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
