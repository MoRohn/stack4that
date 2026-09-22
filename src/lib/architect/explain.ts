import { LABELS } from "./criteria";
import type { Alternative, Constraint, CriterionId, CriterionResult, DecisionResult, IntentAnalysis, Requirement, Technology } from "@/lib/types";
import type { SlotDecision } from "./decide";

const PRODUCT_PHRASE: Record<string, string> = {
  consumer_app: "consumer app",
  b2b_saas: "SaaS product",
  internal_tool: "internal tool",
  ai_application: "AI application",
  data_platform: "data platform",
  api_product: "API product",
  marketplace: "marketplace",
  ecommerce: "store",
  fintech: "financial product",
  healthcare: "healthcare product",
  developer_tool: "developer tool",
  iot_or_hardware: "device platform",
  other: "product",
};

const CRITERION_PHRASE: Record<CriterionId, string> = {
  "functional-fit": "functional fit",
  "constraint-satisfaction": "constraint satisfaction",
  "integration-fit": "integration with the rest of the stack",
  "developer-experience": "developer experience",
  maturity: "maturity",
  "operational-complexity": "operational simplicity",
  scalability: "scalability",
  performance: "performance",
  cost: "cost efficiency",
  ecosystem: "ecosystem breadth",
  documentation: "documentation quality",
  security: "security and compliance posture",
  "deployment-flexibility": "deployment flexibility",
  "vendor-lock-in": "portability",
  "open-source": "open-source licensing",
  maintenance: "maintenance activity",
  "time-to-market": "time to market",
};

function critScore(results: CriterionResult[], candidateId: string, id: CriterionId) {
  return results.find((r) => r.candidateId === candidateId && r.criterionId === id)?.score;
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function describeTech(t: Technology): string {
  const d = t.shortDescription.replace(/\.$/, "");
  // Avoid "PostgreSQL PostgreSQL is ..."
  return d.toLowerCase().startsWith(t.name.toLowerCase()) ? d : `${t.name}: ${d}`;
}

export function explainSelection(
  intent: IntentAnalysis,
  requirement: Requirement,
  selected: Technology,
  decision: DecisionResult,
  constraints: Constraint[],
  selectedSoFar: Array<{ slot: string; name: string; slug: string }>,
  names: Map<string, string> = new Map(),
): { whyHere: string; role: string; tradeoff: string } {
  const product = PRODUCT_PHRASE[intent.productKind] ?? "product";
  const strongest = decision.explanationInputs.strongestCriteria;
  const hard = constraints.filter((c) => c.severity === "hard");
  const sentences: string[] = [];
  sentences.push(`Your ${product} needs ${lowerFirst(requirement.description.replace(/\.$/, ""))}.`);
  sentences.push(`${describeTech(selected)}.`);

  const reasons: string[] = [];
  if (strongest.length) reasons.push(`it rated highest on ${strongest.map((c) => CRITERION_PHRASE[c]).join(" and ")} for this request`);
  const satisfied: string[] = [];
  for (const c of hard) {
    if (c.kind === "open-source" && selected.openSource) satisfied.push("your open-source requirement");
    if ((c.kind === "self-hosting" || c.kind === "hosting-model") && (selected.deploymentModels.includes("self-hosted") || selected.deploymentModels.includes("on-device"))) satisfied.push(`your ${c.value.replace("-", " ")} deployment requirement`);
    if (c.kind === "cloud" && (selected.supportedClouds.includes(c.value) || selected.slug.includes(c.value))) satisfied.push(`your ${c.value.toUpperCase()} preference`);
    if (c.kind === "language" && selected.supportedLanguages.includes(c.value)) satisfied.push(`your ${c.value} requirement`);
    if (c.kind === "compliance" && selected.compliance.map((x) => x.toUpperCase()).includes(c.value.toUpperCase())) satisfied.push(`your ${c.value} requirement (documented attestation)`);
    if (c.kind === "existing-technology" && c.value === selected.slug) satisfied.push("your existing stack");
    if ((c.kind === "ai" || c.kind === "gpu") && (selected.tags.includes("local") || selected.tags.includes("nvidia") || selected.deploymentModels.includes("on-device"))) satisfied.push("your local/GPU requirement");
  }
  if (satisfied.length) reasons.push(`it satisfies ${[...new Set(satisfied)].join(", ")}`);
  const integrates = selectedSoFar.filter((s) => selected.integrations.includes(s.slug));
  if (integrates.length) reasons.push(`it integrates directly with ${integrates.map((s) => s.name).slice(0, 3).join(", ")}`);
  const budget = constraints.find((c) => c.kind === "budget")?.value;
  if (budget === "minimal" && (selected.freeTier || selected.openSource)) reasons.push(`its ${selected.openSource ? "open-source license" : "free tier"} fits your budget`);
  if (reasons.length) sentences.push(`It was selected because ${reasons.join("; ")}.`);
  const verdict = decision.verdicts.find((v) => v.candidateId === selected.id);
  if (verdict && verdict.selectionProbability > 0) {
    sentences.push(`TypeSafe chose it over the other candidates with ${(verdict.selectionProbability * 100).toFixed(0)}% selection probability.`);
  }

  // Tradeoff: the selected technology's weakest scored criterion, contrasted with an alternative that does better.
  const weakest = decision.explanationInputs.weakestCriterion;
  let tradeoff = "";
  if (weakest) {
    const selScore = critScore(decision.criteriaResults, selected.id, weakest) ?? 0;
    const better = decision.verdicts
      .filter((v) => v.candidateId !== selected.id && !v.eliminated)
      .map((v) => ({ v, s: critScore(decision.criteriaResults, v.candidateId, weakest) ?? 0 }))
      .sort((a, b) => b.s - a.s)[0];
    const betterName = better ? names.get(better.v.candidateId) : undefined;
    if (better && better.s > selScore + 0.1) {
      tradeoff = `Its weakest dimension here is ${CRITERION_PHRASE[weakest]}${betterName ? `, where ${betterName} scores higher` : ""}; it still wins overall on ${strongest.length ? CRITERION_PHRASE[strongest[0]] : "fit"}.`;
    } else {
      tradeoff = `Its weakest dimension for this request is ${CRITERION_PHRASE[weakest]}, though no alternative clearly beats it there.`;
    }
  }
  if (verdict && verdict.unnecessaryComplexity > 0.5) {
    tradeoff += ` ${tradeoff ? "It also" : "It"} adds some operational complexity relative to lighter options.`;
  }
  if (!tradeoff) tradeoff = "No significant tradeoff was identified against the alternatives for this request.";
  return { whyHere: sentences.join(" "), role: requirement.label, tradeoff: tradeoff.trim() };
}

export function buildAlternatives(sd: SlotDecision, selected: Technology, limit = 3): Alternative[] {
  const strongest = sd.decision.explanationInputs.strongestCriteria;
  const results = sd.decision.criteriaResults;
  const out: Alternative[] = [];
  for (const r of sd.ranked) {
    if (r.tech.id === selected.id) continue;
    if (out.length >= limit) break;
    const v = r.verdict;
    // Where does this alternative beat the selected one?
    const wins: CriterionId[] = [];
    const losses: CriterionId[] = [];
    for (const id of new Set(results.filter((x) => x.candidateId === r.tech.id).map((x) => x.criterionId))) {
      const a = critScore(results, r.tech.id, id) ?? 0;
      const s = critScore(results, selected.id, id) ?? 0;
      if (a > s + 0.08) wins.push(id);
      if (s > a + 0.08) losses.push(id);
    }
    let whyNot: string;
    if (v.eliminated) whyNot = `Eliminated: ${v.eliminationReason}.`;
    else if (losses.length) whyNot = `Rated lower on ${losses.slice(0, 2).map((l) => CRITERION_PHRASE[l]).join(" and ")} for this request.`;
    else if (v.functionalFit < (sd.decision.verdicts.find((x) => x.candidateId === selected.id)?.functionalFit ?? 0)) whyNot = "Weaker functional fit for this slot.";
    else whyNot = `Lower overall selection probability (${(v.selectionProbability * 100).toFixed(0)}%).`;
    const whenPreferable = wins.length
      ? `When ${wins.slice(0, 2).map((w) => CRITERION_PHRASE[w]).join(" or ")} matters more than ${strongest.length ? CRITERION_PHRASE[strongest[0]] : "the current priorities"}.`
      : whenByProfile(r.tech, selected);
    out.push({ technologyId: r.tech.id, slug: r.tech.slug, name: r.tech.name, whyNot, whenPreferable, compositeScore: v.compositeScore });
  }
  return out;
}

function whenByProfile(alt: Technology, sel: Technology): string {
  if (alt.openSource && !sel.openSource) return "When you want an open-source, self-hostable option.";
  if (!alt.openSource && sel.openSource && alt.deploymentModels.includes("managed-cloud")) return "When you would rather pay for a fully managed service than operate it.";
  if (alt.deploymentModels.includes("self-hosted") && !sel.deploymentModels.includes("self-hosted")) return "When self-hosting or data control becomes a requirement.";
  if (alt.supportedClouds.length === 1) return `When the stack standardizes on ${alt.supportedClouds[0].toUpperCase()}.`;
  if (alt.maturity === "established" && sel.maturity !== "established") return "When maturity and a long production track record matter more.";
  if (alt.freeTier && !sel.freeTier) return "When a free tier matters more than the other criteria.";
  return "When its particular strengths matter more than the criteria weighted for this request.";
}

export { LABELS };
