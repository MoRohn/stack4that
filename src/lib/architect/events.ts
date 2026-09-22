import type { Architecture, CandidateSummary, Constraint, DecisionResult, IntentAnalysis, Requirement, StackComponent, StackIssue } from "@/lib/types";

export type ArchitectEvent =
  | { type: "analysis.started"; requestId: string; request: string; engine: "typesafe"; model?: string; catalogSize: number }
  | { type: "requirements.extracted"; intent: IntentAnalysis; constraints: Constraint[]; assumptions: string[]; requirementCount: number }
  | { type: "requirement.created"; requirement: Requirement }
  | { type: "retrieval.started"; slotId: string; label: string; catalogSize: number }
  | { type: "candidate.found"; slotId: string; candidates: Array<{ id: string; slug: string; name: string; score: number }> }
  | { type: "decision.started"; slotId: string; label: string; candidateCount: number; criteria: string[] }
  | { type: "decision.completed"; slotId: string; decision: DecisionResult }
  | { type: "technology.selected"; slotId: string; group: StackComponent["group"]; technologyId: string; slug: string; name: string; color: string; iconPath?: string; domain?: string; monogram: string; confidence: number }
  | { type: "technology.rejected"; slotId: string; technologyId: string; slug: string; name: string; reason: string }
  | { type: "stack.component.ready"; component: StackComponent }
  | { type: "stack.component.removed"; slotId: string; technologyId: string; reason: string }
  | { type: "stack.slot.covered"; slotId: string; label: string; bySlotId: string; technologyId: string; name: string }
  | { type: "stack.validation.started"; componentCount: number }
  | { type: "stack.validation.completed"; issues: StackIssue[]; removed: string[]; reevaluated: string[] }
  | { type: "stack.completed"; architecture: Architecture }
  | { type: "progress"; message: string; phase: "interpreting" | "searching" | "deciding" | "assembling" | "validating" | "complete" }
  | { type: "error"; message: string; recoverable: boolean };

export type EmitFn = (event: ArchitectEvent) => void;

export function encodeSSE(event: ArchitectEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export type CandidateSummaryEvent = Pick<CandidateSummary, "id" | "slug" | "name">;
