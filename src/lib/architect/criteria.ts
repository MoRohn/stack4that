import type { Criterion, CriterionId, IntentAnalysis } from "@/lib/types";

/**
 * Criteria weights are derived from the request. There is no universal score:
 * "cheap MVP" and "banking infrastructure" weigh the same technology
 * differently.
 */
export function deriveCriteria(intent: IntentAnalysis): Criterion[] {
  const w = new Map<CriterionId, { weight: number; rationale: string[] }>();
  const bump = (id: CriterionId, delta: number, why: string) => {
    const cur = w.get(id) ?? { weight: 0.3, rationale: [] };
    cur.weight = cur.weight + delta;
    cur.rationale.push(why);
    w.set(id, cur);
  };
  // Baseline: every stack cares a little about these.
  bump("maturity", 0.15, "production readiness");
  bump("developer-experience", 0.15, "team productivity");
  bump("operational-complexity", 0.15, "keep the stack runnable");
  bump("ecosystem", 0.05, "integration breadth");

  const c = (kind: string) => intent.constraints.find((x) => x.kind === kind);
  const budget = c("budget")?.value;
  if (budget === "minimal") {
    bump("cost", 0.8, "you asked for a cheap stack");
    bump("time-to-market", 0.3, "small budgets favor fast delivery");
    bump("operational-complexity", 0.15, "no budget for operations");
  } else if (budget === "generous") {
    bump("scalability", 0.15, "well-funded projects grow");
  }
  const team = c("team-size")?.value;
  if (team === "solo" || team === "small") {
    bump("developer-experience", 0.35, "small team");
    bump("operational-complexity", 0.25, "small team cannot run heavy infrastructure");
    bump("time-to-market", 0.2, "small teams need to ship");
  }
  if (team === "large") bump("scalability", 0.15, "large organization");

  const scale = c("traffic")?.value;
  if (scale === "large") {
    bump("scalability", 0.55, "expected scale is large");
    bump("performance", 0.35, "high traffic");
    bump("maturity", 0.2, "scale needs proven technology");
  } else if (scale === "medium") {
    bump("scalability", 0.25, "moderate growth expected");
  }
  if (c("latency")) {
    bump("performance", 0.4, "low latency was emphasized");
  }
  const compliance = intent.constraints.filter((x) => x.kind === "compliance");
  if (compliance.length) {
    bump("security", 0.6, `compliance: ${compliance.map((x) => x.value.toUpperCase()).join(", ")}`);
    bump("maturity", 0.3, "regulated workloads need proven vendors");
    bump("ecosystem", 0.1, "auditability");
  }
  const oss = c("open-source")?.value;
  if (oss === "required") {
    bump("open-source", 0.7, "must be open source");
    bump("deployment-flexibility", 0.35, "self-hostable");
    bump("vendor-lock-in", 0.3, "avoid proprietary services");
  } else if (oss === "preferred") {
    bump("open-source", 0.4, "open source preferred");
  }
  const hosting = c("hosting-model")?.value ?? c("self-hosting")?.value;
  if (hosting === "local" || hosting === "self-hosted") {
    bump("deployment-flexibility", 0.6, `must run ${hosting}`);
    bump("open-source", 0.3, "self-hosting favors open source");
  }
  if (c("gpu")) bump("deployment-flexibility", 0.3, "specific hardware");
  if (c("vendor-lock-in")?.value === "avoid") bump("vendor-lock-in", 0.6, "you want to avoid lock-in");
  if (c("time-to-market")?.value === "urgent") {
    bump("time-to-market", 0.6, "you need to ship fast");
    bump("developer-experience", 0.2, "speed");
  }
  if (c("operational-complexity")?.value === "minimal") bump("operational-complexity", 0.3, "you want minimal operations");
  if (c("cloud")) bump("integration-fit", 0.3, `${c("cloud")?.value} preference`);
  if (intent.productKind === "ai_application" || intent.needs["llm-inference"] > 0.6) bump("ecosystem", 0.15, "AI ecosystem breadth");
  if (c("availability")?.value === "high") {
    bump("maturity", 0.25, "high availability");
    bump("scalability", 0.2, "high availability");
  }
  bump("integration-fit", 0.2, "coherent stack");

  const max = Math.max(...[...w.values()].map((v) => v.weight), 1);
  const list = [...w.entries()].map(([id, v]) => ({ id, label: LABELS[id], weight: Number((v.weight / max).toFixed(2)), rationale: v.rationale.join("; ") }));
  list.sort((a, b) => b.weight - a.weight);
  return list;
}

export const LABELS: Record<CriterionId, string> = {
  "functional-fit": "Functional fit",
  "constraint-satisfaction": "Constraint satisfaction",
  "integration-fit": "Integration fit",
  "developer-experience": "Developer experience",
  maturity: "Maturity",
  "operational-complexity": "Operational simplicity",
  scalability: "Scalability",
  performance: "Performance",
  cost: "Cost efficiency",
  ecosystem: "Ecosystem",
  documentation: "Documentation",
  security: "Security & compliance",
  "deployment-flexibility": "Deployment flexibility",
  "vendor-lock-in": "Portability",
  "open-source": "Open source",
  maintenance: "Maintenance",
  "time-to-market": "Time to market",
};
