/* CLI: npm run architect -- "Build the stack for a real-time AI news application" */
import "./env";
import { runArchitect } from "@/lib/architect";

async function main() {
  const request = process.argv.slice(2).join(" ") || "Build the stack for a real-time AI news application";
  const verbose = process.env.VERBOSE === "1";
  const arch = await runArchitect(request, {
    emit: (e) => {
      if (e.type === "progress") console.log(`[${e.phase}] ${e.message}`);
      else if (e.type === "requirements.extracted") console.log(`intent: ${e.intent.summary}\nconstraints: ${e.constraints.map((c) => `${c.label} (${c.severity})`).join("; ")}\nrequirements: ${e.requirementCount}`);
      else if (e.type === "technology.selected") console.log(`  + ${e.group.padEnd(14)} ${e.slotId.padEnd(22)} → ${e.name} (${(e.confidence * 100).toFixed(0)}%)`);
      else if (e.type === "stack.component.removed") console.log(`  - ${e.slotId}: ${e.reason}`);
      else if (e.type === "error") console.log(`! ${e.message}`);
      else if (verbose && e.type === "candidate.found") console.log(`    candidates ${e.slotId}: ${e.candidates.map((c) => c.name).join(", ")}`);
    },
    persist: false,
  });
  console.log("\nissues:");
  for (const i of arch.issues) console.log(`  [${i.severity}] ${i.message}`);
  console.log("\nstats:", arch.stats);
  if (verbose) for (const c of arch.components) console.log(`\n## ${c.name} (${c.slotLabel})\n${c.whyHere}\nTRADEOFF: ${c.tradeoff}\nALT: ${c.alternatives.map((a) => `${a.name}: ${a.whyNot} / ${a.whenPreferable}`).join(" | ")}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
