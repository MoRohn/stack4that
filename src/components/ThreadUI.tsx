"use client";
import { useState } from "react";
import type { Constraint, ContextSuggestion, Objective, RequestInterpretation, StackIssue, ThreadTurn } from "@/lib/types";

/** Your words, the brief they became, and how each objective is served. Always visible above the stack. */
export function RequestPanel({
  request,
  interpretation,
  turnNumber,
  busy,
  onOpenBlock,
}: {
  request: string;
  interpretation?: RequestInterpretation;
  turnNumber: number;
  busy: boolean;
  onOpenBlock: (slotId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Your request" className="s4t-fade-in pointer-events-auto mx-4 mt-3 w-[calc(100%-2rem)] max-w-2xl rounded-2xl border border-white/10 bg-[rgba(14,14,18,0.72)] p-3 backdrop-blur-xl">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/55">{turnNumber > 1 ? `You · turn ${turnNumber}` : "You"}</span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug text-white/90">“{request}”</p>
      </div>
      <div className="mt-2 flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 rounded-md bg-gradient-to-r from-[#b77bff]/25 to-[#8ab4ff]/25 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-white/70">
          {interpretation?.vague ? "Interpreted" : "Built from"}
        </span>
        {interpretation ? (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} title="Show the full brief" className={`min-w-0 flex-1 text-left text-[12px] leading-relaxed text-white/60 hover:text-white/75 ${open ? "" : "line-clamp-2"}`}>
            {interpretation.enhancedRequest}
          </button>
        ) : (
          <span className="s4t-pulse text-[12px] text-white/60">{busy ? "Improving your request into a brief…" : ""}</span>
        )}
      </div>
      {interpretation && interpretation.objectives.length > 0 && <ObjectiveList objectives={interpretation.objectives} currentTurn={turnNumber - 1} onOpenBlock={onOpenBlock} building={busy} />}
    </section>
  );
}

function ObjectiveList({ objectives, currentTurn, onOpenBlock, building }: { objectives: Objective[]; currentTurn: number; onOpenBlock: (slotId: string) => void; building: boolean }) {
  return (
    <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Primary objectives">
      {objectives.map((o, i) => {
        const served = o.servedBy;
        const fromEarlier = o.turn < currentTurn;
        const icon = served ? "✓" : o.kind === "constraint" ? "◇" : o.kind === "product" ? "◎" : building ? "…" : "!";
        const tone = served ? "border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-50/90" : o.kind === "capability" && !building ? "border-amber-300/30 bg-amber-300/[0.06] text-amber-50/90" : "border-white/10 bg-white/[0.03] text-white/70";
        const detail = served ? `served by ${served.name}` : o.kind === "constraint" ? "constraint applied" : o.kind === "product" ? "shapes the whole stack" : building ? "being built" : `no block for ${o.capabilityLabel}`;
        const body = (
          <>
            <span className="text-[10px]" aria-hidden>
              {icon}
            </span>
            <span className="max-w-[16rem] truncate">{o.text}</span>
            <span className="text-white/55">· {detail}</span>
            {fromEarlier && <span className="rounded bg-white/[0.06] px-1 text-[9px] uppercase tracking-wider text-white/55">earlier</span>}
          </>
        );
        return (
          <li key={`${o.turn}-${i}`}>
            {served ? (
              <button type="button" onClick={() => onOpenBlock(served.slotId)} title={`“${o.text}” is delivered by ${served.name}. Open it.`} className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition hover:brightness-125 ${tone}`}>
                {body}
              </button>
            ) : (
              <span title={`“${o.text}”`} className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Ways to add context for the next turn. Picking one adds its text to the input. */
export function SuggestionChips({ suggestions, onPick }: { suggestions: ContextSuggestion[]; onPick: (s: ContextSuggestion) => void }) {
  if (!suggestions.length) return null;
  return (
    <div className="s4t-fade-in pointer-events-auto mx-4 mt-2.5 flex w-[calc(100%-2rem)] max-w-2xl flex-wrap items-center gap-1.5" aria-label="Add context">
      <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Add context</span>
      {suggestions.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s)}
          title={s.text}
          className={`rounded-full border px-2.5 py-1 text-[11.5px] transition hover:-translate-y-px ${s.kind === "unknown" ? "border-[#8ab4ff]/25 bg-[#8ab4ff]/[0.06] text-[#cfe0ff] hover:bg-[#8ab4ff]/[0.14]" : s.kind === "feature" ? "border-[#9ef0c6]/25 bg-[#9ef0c6]/[0.05] text-[#d6fbe8] hover:bg-[#9ef0c6]/[0.12]" : "border-white/12 bg-white/[0.04] text-white/70 hover:bg-white/[0.1]"}`}
        >
          + {s.label}
        </button>
      ))}
    </div>
  );
}

/** The conversation so far: every turn, re-openable, plus the constraints and assumptions it produced. */
export function ThreadRail({
  turns,
  pendingTurn,
  currentArchitectureId,
  constraints,
  assumptions,
  issues,
  onOpenTurn,
  busy,
}: {
  turns: ThreadTurn[];
  pendingTurn?: string;
  currentArchitectureId?: string;
  constraints: Constraint[];
  assumptions: string[];
  issues: StackIssue[];
  onOpenTurn: (architectureId: string) => void;
  busy: boolean;
}) {
  const hard = constraints.filter((c) => c.severity === "hard");
  const notes = issues.filter((i) => i.severity !== "info");
  const shown = pendingTurn && !turns.some((t) => t.request === pendingTurn && !t.architectureId) ? [...turns, { request: pendingTurn, createdAt: "", architectureId: undefined, brief: undefined } as ThreadTurn] : turns;
  return (
    <aside aria-label="Thread" className="s4t-fade-in s4t-scroll pointer-events-auto absolute left-5 top-[76px] z-20 hidden max-h-[calc(100dvh-110px)] w-[260px] overflow-y-auto pr-1 text-[11.5px] leading-relaxed text-white/55 xl:block">
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">
        <span>Thread</span>
        <span className="tabular-nums text-white/60">{shown.length} turn{shown.length === 1 ? "" : "s"}</span>
      </div>
      <ol className="relative space-y-2 border-l border-white/10 pl-3">
        {shown.map((t, i) => {
          const current = (t.architectureId && t.architectureId === currentArchitectureId) || (!t.architectureId && busy && i === shown.length - 1);
          const canOpen = Boolean(t.architectureId && t.architectureId !== currentArchitectureId && !busy);
          return (
            <li key={`${i}-${t.request}`} className="relative">
              <span className={`absolute -left-[17px] top-1.5 h-2 w-2 rounded-full ${current ? "bg-gradient-to-br from-[#ffb3f2] to-[#8ab4ff] shadow-[0_0_8px_rgba(183,123,255,0.8)]" : "bg-white/25"}`} />
              <button
                type="button"
                disabled={!canOpen}
                onClick={() => t.architectureId && onOpenTurn(t.architectureId)}
                className={`w-full rounded-lg px-2 py-1.5 text-left transition ${current ? "bg-white/[0.07] text-white/90" : canOpen ? "hover:bg-white/[0.05] hover:text-white/80" : ""}`}
                title={canOpen ? "Open the stack from this turn" : undefined}
              >
                <div className="text-[9.5px] uppercase tracking-[0.18em] text-white/50">
                  Turn {i + 1}
                  {current && busy ? " · building…" : current ? " · current" : canOpen ? " · open" : ""}
                </div>
                <div className="line-clamp-3">“{t.request}”</div>
              </button>
            </li>
          );
        })}
      </ol>
      {hard.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">Hard constraints</div>
          <div className="flex flex-wrap gap-1">
            {hard.map((c) => (
              <span key={c.id} className="rounded-full border border-white/10 px-2 py-0.5 text-white/65">
                {c.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {assumptions.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60 hover:text-white/60">
            {assumptions.length} assumption{assumptions.length > 1 ? "s" : ""} ▸
          </summary>
          <ul className="mt-1 space-y-1">
            {assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {notes.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/50 hover:text-amber-200/80">
            {notes.length} validation note{notes.length > 1 ? "s" : ""} ▸
          </summary>
          <ul className="mt-1 space-y-1">
            {notes.map((n) => (
              <li key={n.id}>{n.message}</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
