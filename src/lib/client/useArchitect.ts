"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchitectEvent } from "@/lib/architect/events";
import type { Architecture, Constraint, ContextSuggestion, IntentAnalysis, StackComponent, StackIssue, ThreadTurn } from "@/lib/types";
import { consumeSSE } from "./stream";

export type Phase = "idle" | "interpreting" | "searching" | "deciding" | "assembling" | "validating" | "complete" | "error";

export interface ArchitectState {
  phase: Phase;
  status: string;
  request: string;
  intent?: IntentAnalysis;
  constraints: Constraint[];
  assumptions: string[];
  components: Record<string, StackComponent>;
  order: string[];
  issues: StackIssue[];
  architecture?: Architecture;
  error?: string;
  engine?: "typesafe";
  model?: string;
  catalogSize?: number;
  decisionsDone: number;
  candidatesSeen: number;
  stats?: Architecture["stats"];
  /** The conversation this stack belongs to. */
  thread?: Architecture["thread"];
  /** Words of a turn that is still being built (shown right away in the thread). */
  pendingTurn?: string;
  /** True while a follow-up is reshaping an existing stack. */
  continuing: boolean;
  suggestions: ContextSuggestion[];
}

const initial: ArchitectState = { phase: "idle", status: "", request: "", constraints: [], assumptions: [], components: {}, order: [], issues: [], decisionsDone: 0, candidatesSeen: 0, continuing: false, suggestions: [] };

export function useArchitect(onEvent?: (e: ArchitectEvent) => void) {
  const [state, setState] = useState<ArchitectState>(initial);
  const abortRef = useRef<AbortController | null>(null);
  const handlerRef = useRef(onEvent);
  const stateRef = useRef(state);
  useEffect(() => {
    handlerRef.current = onEvent;
    stateRef.current = state;
  });

  const apply = useCallback((e: ArchitectEvent) => {
    handlerRef.current?.(e);
    setState((s) => {
      switch (e.type) {
        case "analysis.started":
          return { ...s, phase: "interpreting", engine: e.engine, model: e.model, catalogSize: e.catalogSize, error: undefined };
        case "progress":
          return { ...s, phase: e.phase, status: e.message };
        case "requirements.extracted":
          return { ...s, intent: e.intent, constraints: e.constraints, assumptions: e.assumptions };
        case "candidate.found":
          return { ...s, candidatesSeen: s.candidatesSeen + e.candidates.length };
        case "decision.completed":
          return { ...s, decisionsDone: s.decisionsDone + 1 };
        case "stack.component.ready": {
          const components = { ...s.components, [e.component.slotId]: e.component };
          const order = s.order.includes(e.component.slotId) ? s.order : [...s.order, e.component.slotId];
          return { ...s, components, order, phase: s.phase === "complete" ? "complete" : "assembling" };
        }
        case "stack.component.removed": {
          const components = { ...s.components };
          delete components[e.slotId];
          return { ...s, components, order: s.order.filter((x) => x !== e.slotId) };
        }
        case "stack.validation.completed":
          return { ...s, issues: e.issues };
        case "stack.completed": {
          const components: Record<string, StackComponent> = {};
          for (const c of e.architecture.components) components[c.slotId] = c;
          return { ...s, phase: "complete", status: "", architecture: e.architecture, components, order: e.architecture.components.map((c) => c.slotId), issues: e.architecture.issues, stats: e.architecture.stats, thread: e.architecture.thread, suggestions: e.architecture.suggestions ?? [], intent: e.architecture.intent, pendingTurn: undefined, continuing: false };
        }
        case "error":
          return e.recoverable ? { ...s, status: e.message } : { ...s, phase: "error", error: e.message };
        default:
          return s;
      }
    });
  }, []);

  /**
   * Build a stack. With `continueThread`, the current thread's turns go along so objectives and
   * constraints carry forward, and the current stack stays on screen while it is re-evaluated.
   */
  const run = useCallback(
    async (request: string, opts: { continueThread?: boolean; thread?: { id?: string; turns: ThreadTurn[] } } = {}) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const current = stateRef.current;
      const thread = opts.thread ?? (opts.continueThread ? current.thread : undefined);
      setState((s) => {
        const base = opts.continueThread
          ? { ...s, phase: "interpreting" as Phase, status: "Reshaping the stack with your context…", error: undefined, decisionsDone: 0, candidatesSeen: 0, continuing: true }
          : { ...initial, engine: s.engine, catalogSize: s.catalogSize, phase: "interpreting" as Phase, status: "Understanding requirements…" };
        return { ...base, request, pendingTurn: request };
      });
      try {
        const res = await fetch("/api/architect/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, thread }), signal: ac.signal });
        await consumeSSE(res, apply, ac.signal);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setState((s) => ({ ...s, phase: "error", error: (err as Error).message, continuing: false }));
      }
    },
    [apply],
  );

  const swap = useCallback(
    async (architecture: Architecture, slotId: string, technologyId: string) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setState((s) => ({ ...s, phase: "deciding", status: "Re-evaluating dependent components…" }));
      try {
        const res = await fetch("/api/architect/swap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ architectureId: architecture.id, architecture, slotId, technologyId }), signal: ac.signal });
        await consumeSSE(res, apply, ac.signal);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setState((s) => ({ ...s, phase: "error", error: (err as Error).message }));
      }
    },
    [apply],
  );

  const load = useCallback(
    (architecture: Architecture) => {
      const components: Record<string, StackComponent> = {};
      for (const c of architecture.components) components[c.slotId] = c;
      setState({ ...initial, phase: "complete", thread: architecture.thread, suggestions: architecture.suggestions ?? [], request: architecture.request, intent: architecture.intent, constraints: architecture.intent.constraints, assumptions: architecture.assumptions, architecture, components, order: architecture.components.map((c) => c.slotId), issues: architecture.issues, stats: architecture.stats, engine: architecture.stats.engine });
    },
    [],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...initial, engine: s.engine, catalogSize: s.catalogSize }));
  }, []);

  return { state, run, swap, load, reset };
}
