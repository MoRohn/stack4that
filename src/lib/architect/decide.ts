import { retrieveCandidates, toCandidateSummary, type ScoredCandidate } from "@/lib/retrieval";
import type { DecisionEngine } from "@/lib/typesafe";
import type { CandidateVerdict, Constraint, Criterion, CriterionResult, DecisionResult, ProjectContext, Requirement, Technology } from "@/lib/types";

export interface SlotDecision {
  requirement: Requirement;
  candidates: ScoredCandidate[];
  decision: DecisionResult;
  selected?: Technology;
  ranked: Array<{ tech: Technology; verdict: CandidateVerdict }>;
}

const MAX_CANDIDATES_FOR_DECISION = 10;

export async function decideSlot(
  requirement: Requirement,
  projectContext: ProjectContext,
  constraints: Constraint[],
  criteria: Criterion[],
  engine: DecisionEngine,
  opts: { excludeIds?: string[]; pinnedIds?: string[]; signal?: AbortSignal; onCandidates?: (c: ScoredCandidate[]) => void } = {},
): Promise<SlotDecision> {
  const started = Date.now();
  const candidates = await retrieveCandidates(requirement, projectContext, constraints, { limit: 24, excludeIds: opts.excludeIds });
  opts.onCandidates?.(candidates);
  const shortlist = candidates.slice(0, MAX_CANDIDATES_FOR_DECISION);
  const summaries = shortlist.map(toCandidateSummary);
  const scoredCriteria = criteria.filter((c) => c.id !== "functional-fit" && c.id !== "constraint-satisfaction").slice(0, 4);

  if (shortlist.length === 0) {
    return {
      requirement,
      candidates,
      decision: emptyDecision(requirement, engine.kind, Date.now() - started),
      ranked: [],
    };
  }

  const signals = await engine.decideSlot({ requirement, projectContext, constraints, candidates: summaries, criteria: scoredCriteria }, opts.signal);

  const maxPick = Math.max(1e-6, ...shortlist.map((c) => signals.pick.probabilities[c.tech.id] ?? 0));
  const maxRetrieval = Math.max(1e-6, ...shortlist.map((c) => c.score));
  const weightSum = scoredCriteria.reduce((s, c) => s + c.weight, 0) || 1;
  const criteriaResults: CriterionResult[] = [];
  const verdicts: CandidateVerdict[] = [];
  for (const c of shortlist) {
    const s = signals.perCandidate[c.tech.id];
    const pickP = (signals.pick.probabilities[c.tech.id] ?? 0) / maxPick;
    let critScore = 0;
    for (const crit of scoredCriteria) {
      const r = s?.criteria[crit.id];
      if (r) {
        critScore += crit.weight * r.score;
        criteriaResults.push({ candidateId: c.tech.id, criterionId: crit.id, score: Number(r.score.toFixed(3)), confidence: Number(r.confidence.toFixed(3)), levelLabel: r.level });
      }
    }
    critScore /= weightSum;
    const fit = s?.fit ?? 0.5;
    const hard = s?.hardViolation ?? 0;
    const complexity = s?.complexity ?? 0;
    const composite = 0.4 * pickP + 0.25 * fit + 0.2 * critScore + 0.1 * (1 - complexity) + 0.05 * (c.score / maxRetrieval);
    const eliminated = hard > 0.6 || fit < 0.25;
    verdicts.push({
      candidateId: c.tech.id,
      selectionProbability: Number((signals.pick.probabilities[c.tech.id] ?? 0).toFixed(3)),
      functionalFit: Number(fit.toFixed(3)),
      hardConstraintViolation: Number(hard.toFixed(3)),
      unnecessaryComplexity: Number(complexity.toFixed(3)),
      compositeScore: Number(composite.toFixed(3)),
      eliminated,
      eliminationReason: hard > 0.6 ? "violates a hard constraint" : fit < 0.25 ? "does not satisfy the requirement" : undefined,
    });
  }
  const byId = new Map(shortlist.map((c) => [c.tech.id, c.tech]));
  const ranked = verdicts
    .slice()
    .sort((a, b) => Number(a.eliminated) - Number(b.eliminated) || b.compositeScore - a.compositeScore)
    .map((v) => ({ tech: byId.get(v.candidateId)!, verdict: v }));

  const noneP = signals.pick.probabilities.none_suitable ?? 0;
  // A technology the user explicitly asked for wins its slot unless it clearly violates a hard constraint.
  const pinned = new Set(opts.pinnedIds ?? []);
  const pinnedHit = ranked.find((r) => pinned.has(r.tech.id) && r.verdict.hardConstraintViolation < 0.6);
  if (pinnedHit) {
    pinnedHit.verdict.eliminated = false;
    ranked.splice(ranked.indexOf(pinnedHit), 1);
    ranked.unshift(pinnedHit);
  }
  const top = ranked.find((r) => !r.verdict.eliminated);
  const allWeak = ranked.every((r) => r.verdict.functionalFit < 0.4);
  const selected = top && !(noneP > 0.6 && allWeak) && !(requirement.required === false && noneP > 0.75) ? top.tech : undefined;

  const selectedVerdict = selected ? verdicts.find((v) => v.candidateId === selected.id) : undefined;
  const strongest = selected
    ? scoredCriteria
        .map((c) => ({ id: c.id, score: (criteriaResults.find((r) => r.candidateId === selected.id && r.criterionId === c.id)?.score ?? 0) * c.weight }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.id)
    : [];
  const weakest = selected
    ? scoredCriteria
        .map((c) => ({ id: c.id, score: criteriaResults.find((r) => r.candidateId === selected.id && r.criterionId === c.id)?.score ?? 1 }))
        .sort((a, b) => a.score - b.score)[0]?.id
    : undefined;
  const decisive = constraints.filter((c) => c.severity === "hard").map((c) => c.label);

  const decision: DecisionResult = {
    decisionType: "select-candidate",
    requirementId: requirement.id,
    selectedCandidateIds: selected ? [selected.id] : [],
    rejectedCandidateIds: shortlist.map((c) => c.tech.id).filter((id) => id !== selected?.id),
    confidence: selected ? Number((0.6 * signals.pick.confidence + 0.4 * (selectedVerdict?.functionalFit ?? 0.5)).toFixed(3)) : 0,
    criteriaResults,
    verdicts,
    explanationInputs: { strongestCriteria: strongest.slice(0, 2), weakestCriterion: weakest, decisiveConstraints: decisive },
    decisionMetadata: {
      engine: signals.usage.engine,
      model: signals.usage.model,
      inputTokens: signals.usage.inputTokens,
      outputTokens: signals.usage.outputTokens,
      latencyMs: Date.now() - started,
      questionCount: signals.usage.questionCount,
      noneSuitableProbability: Number(noneP.toFixed(3)),
    },
  };
  return { requirement, candidates, decision, selected, ranked };
}

function emptyDecision(requirement: Requirement, engine: "typesafe", latencyMs: number): DecisionResult {
  return {
    decisionType: "select-candidate",
    requirementId: requirement.id,
    selectedCandidateIds: [],
    rejectedCandidateIds: [],
    confidence: 0,
    criteriaResults: [],
    verdicts: [],
    explanationInputs: { strongestCriteria: [], decisiveConstraints: [] },
    decisionMetadata: { engine, latencyMs, questionCount: 0, noneSuitableProbability: 1 },
  };
}
