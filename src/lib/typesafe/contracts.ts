/**
 * Internal, engine-agnostic contracts. The architect code depends on these,
 * never on raw TypeSafe response shapes.
 */
import type { CandidateSummary, Criterion, CriterionId, Requirement, ProjectContext, Constraint, StackComponent } from "@/lib/types";

export interface EngineUsage {
  engine: "typesafe";
  model?: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  questionCount: number;
  calls: number;
}

export interface IntentSignals {
  needs: Record<string, number>;
  choices: {
    requestKind: { value: string; confidence: number };
    archetype: { value: string; confidence: number; probabilities: Record<string, number> };
    productKind: { value: string; confidence: number };
    budget: { value: string; confidence: number };
    scale: { value: string; confidence: number };
    teamSize: { value: string; confidence: number };
    hosting: { value: string; confidence: number };
    cloud: { value: string; confidence: number };
    openSource: { value: string; confidence: number };
    language: { value: string; confidence: number };
    timeToMarket: { value: string; confidence: number };
    dataResidency: { value: string; confidence: number };
    lockIn: { value: string; confidence: number };
    opsTolerance: { value: string; confidence: number };
    availability: { value: string; confidence: number };
  };
  flags: {
    hipaa: number;
    soc2: number;
    gdpr: number;
    pci: number;
    localAi: number;
    nvidia: number;
    lowLatency: number;
    mobileGeneric: number;
    hasUsers: number;
  };
  mentionRoles: Record<string, { role: string; confidence: number }>;
  /** Per candidate clause: is it an objective, and which capability does it most need. */
  clauses: Array<{ objective: number; capability: string; capabilityConfidence: number }>;
  usage: EngineUsage;
}

export interface SlotDecisionSignals {
  pick: { candidateId: string | "none_suitable"; probabilities: Record<string, number>; confidence: number };
  perCandidate: Record<
    string,
    {
      fit: number;
      hardViolation: number;
      complexity: number;
      criteria: Record<string, { score: number; confidence: number; level: string }>;
    }
  >;
  usage: EngineUsage;
}

export interface StackValidationSignals {
  slotNecessary: Record<string, number>;
  pairCompatible: Record<string, number>;
  pairRedundant: Record<string, number>;
  oversized: number;
  usage: EngineUsage;
}

export interface DecisionEngine {
  readonly kind: "typesafe";
  extractIntentSignals(request: string, mentions: Array<{ slug: string; name: string }>, signal?: AbortSignal, clauses?: string[]): Promise<IntentSignals>;
  decideSlot(
    input: {
      requirement: Requirement;
      projectContext: ProjectContext;
      constraints: Constraint[];
      candidates: CandidateSummary[];
      criteria: Criterion[];
    },
    signal?: AbortSignal,
  ): Promise<SlotDecisionSignals>;
  validateStack(
    input: {
      request: string;
      projectContext: ProjectContext;
      components: StackComponent[];
      pairs: Array<{ a: string; b: string; reason: "overlap" | "integration" }>;
      optionalSlots: string[];
    },
    signal?: AbortSignal,
  ): Promise<StackValidationSignals>;
}

export const CRITERION_LEVELS: Record<CriterionId, { label: string; question: string; levels: [string, string, string, string] }> = {
  "functional-fit": {
    label: "Functional fit",
    question: "How completely does the candidate provide what this slot's requirement asks for, for this specific project?",
    levels: [
      "Does not really provide this capability; would need major workarounds",
      "Provides a partial or awkward version of the capability",
      "Provides the capability well with minor gaps",
      "Provides exactly this capability and is a natural, purpose-built fit",
    ],
  },
  "constraint-satisfaction": {
    label: "Constraint satisfaction",
    question: "How well does the candidate satisfy the project's stated hard constraints and soft preferences?",
    levels: ["Conflicts with a hard constraint", "Satisfies hard constraints but ignores most preferences", "Satisfies hard constraints and most preferences", "Satisfies every stated constraint and preference"],
  },
  "integration-fit": {
    label: "Integration fit",
    question: "How naturally does the candidate integrate with the components already selected for this project?",
    levels: ["Awkward or unsupported with the selected components", "Works but requires custom glue", "Has official integrations with the selected components", "Designed to be used together with the selected components"],
  },
  "developer-experience": {
    label: "Developer experience",
    question: "How productive would a small team be with this candidate for this project?",
    levels: ["Steep learning curve and heavy boilerplate", "Usable but requires significant setup", "Good docs, quick start and helpful tooling", "Exceptional developer experience; teams ship quickly"],
  },
  maturity: {
    label: "Maturity",
    question: "How mature and battle-tested is the candidate for production use of this kind?",
    levels: ["Experimental or unproven in production", "Young but used in production by some teams", "Widely used in production with a stable ecosystem", "Industry standard with years of production track record"],
  },
  "operational-complexity": {
    label: "Operational simplicity",
    question: "How little operational burden (setup, upgrades, scaling, on-call) does the candidate impose on this project's team?",
    levels: ["Heavy: requires dedicated infrastructure expertise to run", "Moderate: needs regular operational attention", "Light: mostly managed with occasional attention", "Negligible: fully managed or embedded, nothing to operate"],
  },
  scalability: {
    label: "Scalability",
    question: "How well would the candidate scale to the traffic and data volumes implied by the project?",
    levels: ["Would struggle at the implied scale", "Scales with significant effort or cost", "Scales comfortably to the implied load", "Scales far beyond the implied load with little effort"],
  },
  performance: {
    label: "Performance",
    question: "How well does the candidate meet the latency and throughput needs implied by the project?",
    levels: ["Too slow for the implied needs", "Adequate for typical use", "Fast for the implied workload", "Best-in-class performance for this workload"],
  },
  cost: {
    label: "Cost efficiency",
    question: "How cost-efficient is the candidate for this project's budget and expected usage?",
    levels: ["Expensive relative to the budget with no free path", "Affordable but costs grow quickly", "Free tier or low cost covers the expected usage", "Free or near-free at the expected usage"],
  },
  ecosystem: {
    label: "Ecosystem",
    question: "How strong is the candidate's ecosystem of libraries, integrations and community for this project's needs?",
    levels: ["Thin ecosystem; many things must be built", "Growing ecosystem with gaps", "Large ecosystem covering most needs", "Dominant ecosystem where everything integrates"],
  },
  documentation: {
    label: "Documentation",
    question: "How good is the candidate's documentation for the tasks this project needs?",
    levels: ["Sparse or outdated", "Adequate reference docs", "Thorough docs with guides", "Excellent docs, guides and examples"],
  },
  security: {
    label: "Security & compliance",
    question: "How well does the candidate support the security and compliance posture the project requires?",
    levels: ["Lacks the required security or compliance controls", "Basic security; compliance would need extra work", "Strong security posture and relevant certifications", "Purpose-built for regulated, high-security workloads"],
  },
  "deployment-flexibility": {
    label: "Deployment flexibility",
    question: "How well does the candidate support the deployment model the project needs (self-hosted, cloud, edge, on-device)?",
    levels: ["Cannot be deployed the way the project needs", "Deployable with constraints", "Supports the needed deployment model well", "Runs anywhere the project could need"],
  },
  "vendor-lock-in": {
    label: "Portability",
    question: "How easy would it be to move away from the candidate later if the project needed to?",
    levels: ["Deeply proprietary; migration would be a rewrite", "Proprietary with some portable pieces", "Standards-based with moderate switching cost", "Open standard or open source; trivially replaceable"],
  },
  "open-source": {
    label: "Open source",
    question: "How well does the candidate satisfy a preference for open-source software?",
    levels: ["Closed and proprietary", "Source-available with restrictions", "Open-source core with proprietary cloud", "Fully open source under a permissive license"],
  },
  maintenance: {
    label: "Maintenance & activity",
    question: "How actively maintained is the candidate?",
    levels: ["Stagnant or deprecated", "Slow release cadence", "Actively maintained", "Very active with frequent releases and a healthy community"],
  },
  "time-to-market": {
    label: "Time to market",
    question: "How quickly could this team get to a working product using the candidate for this slot?",
    levels: ["Weeks of setup before value", "Days of setup", "Hours to a working integration", "Minutes to a working integration"],
  },
};
