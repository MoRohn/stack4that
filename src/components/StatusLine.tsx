"use client";
import type { ArchitectState } from "@/lib/client/useArchitect";

export function StatusLine({ state }: { state: ArchitectState }) {
  const busy = state.phase !== "idle" && state.phase !== "complete" && state.phase !== "error";
  if (state.phase === "idle") return null;
  const engineNote = state.model ? `TypeSafe ${state.model}` : "TypeSafe";
  return (
    <div className="pointer-events-none mt-3 flex flex-col items-center gap-1 text-center text-xs text-white/55" aria-live="polite">
      {busy && <span className="s4t-pulse">{state.status || "Working…"}</span>}
      {state.phase === "complete" && state.stats && state.stats.decisions > 0 && (
        <span className="s4t-fade-in">
          {state.stats.decisions} decisions · {state.stats.candidatesConsidered} candidates from {state.stats.technologiesSearched.toLocaleString()} technologies · {(state.stats.durationMs / 1000).toFixed(1)}s · {engineNote}
        </span>
      )}
      {busy && state.decisionsDone > 0 && (
        <span className="text-white/50">
          {state.decisionsDone} decisions · {state.candidatesSeen} candidates · {engineNote}
        </span>
      )}
    </div>
  );
}
