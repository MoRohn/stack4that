/**
 * TypeSafeDecisionEngine: every judgment in the architect that needs semantic
 * understanding is phrased as a TypeSafe question (Choice / Score / Noul)
 * over explicit state. Candidate IDs always come from the catalog; TypeSafe
 * only decides among them.
 */
import { choice, noul, score, type Questions } from "@typesafe-ai/sdk";
import { ARCHETYPES } from "@/lib/architect/archetypes";
import { CAPABILITIES } from "@/lib/taxonomy";
import type { CandidateSummary, Constraint, Criterion, ProjectContext, Requirement, StackComponent } from "@/lib/types";
import { askTypeSafeChunked, typeSafeModel } from "./client";
import { CRITERION_LEVELS, type DecisionEngine, type EngineUsage, type IntentSignals, type SlotDecisionSignals, type StackValidationSignals } from "./contracts";

const CHOICES = {
  requestKind: {
    new_stack: "The user wants a complete technology stack or architecture designed for a product or system they describe",
    replace_component: "The user wants to replace, swap or migrate away from one specific technology in an existing stack",
    modify_existing: "The user wants to change an existing stack in some way (cheaper, open source, different cloud, more scale) without naming a single component to replace",
    question: "The user asks a general question about technology rather than requesting an architecture",
    unclear: "The request is too vague or off-topic to design anything",
  },
  productKind: {
    consumer_app: "A consumer-facing app (social, news, media, lifestyle, games)",
    b2b_saas: "A business SaaS product with accounts, teams and subscriptions",
    internal_tool: "An internal tool or back-office system",
    ai_application: "A product whose core value is AI (assistant, RAG, agents, generation)",
    data_platform: "A data platform, analytics or pipeline system",
    api_product: "A developer-facing API or platform",
    marketplace: "A two-sided marketplace",
    ecommerce: "An online store or commerce product",
    fintech: "Financial services, payments or banking",
    healthcare: "Healthcare, medical or patient-facing software",
    developer_tool: "A tool for developers",
    iot_or_hardware: "Connected devices, robotics or hardware telemetry",
    other: "None of the above",
  },
  budget: {
    minimal: "Cheap, free, bootstrapped, side project, 'as cheap as possible', tiny startup budget",
    moderate: "A normal startup or small business budget; cost matters but is not the top priority",
    generous: "Enterprise, well-funded, or cost explicitly not a concern",
    unknown: "Budget is not stated or implied",
  },
  scale: {
    small: "Prototype, MVP, personal project, internal tool, or under roughly 10,000 users",
    medium: "Growing product, tens to a few hundred thousand users, or moderate data volumes",
    large: "Hundreds of thousands to millions of users, high traffic, or large data volumes (e.g. 100k+ items per day)",
    unknown: "Scale is not stated or implied",
  },
  teamSize: {
    solo: "One person",
    small: "Two to five people or 'small team' or 'startup'",
    medium: "A team of roughly six to thirty engineers",
    large: "A large engineering organization or platform team",
    unknown: "Team size is not stated or implied",
  },
  hosting: {
    managed_platform: "Wants a managed platform (PaaS, BaaS, 'no DevOps', serverless) so the team runs nothing",
    own_cloud: "Wants to run on a major cloud (AWS, GCP, Azure) with its own infrastructure",
    self_hosted: "Wants to self-host on its own servers, on-prem, or bare metal",
    local: "Wants to run locally on a laptop or on the user's own hardware (local-first, offline)",
    edge: "Wants edge or serverless deployment close to users",
    unknown: "Not stated or implied",
  },
  cloud: {
    aws: "AWS or Amazon Web Services is required or preferred",
    gcp: "Google Cloud or GCP is required or preferred",
    azure: "Microsoft Azure is required or preferred",
    cloudflare: "Cloudflare is required or preferred",
    vercel: "Vercel is required or preferred",
    none: "The user explicitly avoids big cloud providers",
    unknown: "No cloud preference stated",
  },
  openSource: {
    required: "Must be open source, self-hostable, no proprietary services ('entirely open source', 'only OSS')",
    preferred: "Prefers open source but does not require it",
    indifferent: "Explicitly does not care, or prefers managed proprietary services",
    unknown: "Not stated",
  },
  language: {
    typescript: "TypeScript or JavaScript / Node.js",
    python: "Python",
    go: "Go",
    rust: "Rust",
    java: "Java or Kotlin on the JVM",
    csharp: "C# / .NET",
    ruby: "Ruby",
    php: "PHP",
    swift: "Swift only (Apple platforms)",
    elixir: "Elixir",
    unknown: "No programming language preference stated",
  },
  timeToMarket: {
    urgent: "Needs to ship very fast: MVP, hackathon, 'quickly', 'this week', 'as fast as possible'",
    normal: "No special urgency",
    long_term: "Building for the long term where robustness beats speed",
    unknown: "Not stated",
  },
  dataResidency: {
    us: "Data must stay in the United States",
    eu: "Data must stay in the EU or Europe (GDPR residency)",
    other_region: "Data must stay in another named region or country",
    none: "No residency requirement stated",
  },
  lockIn: {
    avoid: "Explicitly wants to avoid vendor lock-in or proprietary platforms",
    accept: "Explicitly fine with a single vendor for simplicity",
    unknown: "Not stated",
  },
  opsTolerance: {
    minimal: "Wants minimal operations: no Kubernetes, no servers to manage, 'we do not have DevOps'",
    moderate: "Comfortable running some infrastructure",
    high: "Has a platform team, wants full control, or asks for Kubernetes",
    unknown: "Not stated",
  },
  availability: {
    standard: "Normal availability is fine",
    high: "High availability, multi-region, 'always on', mission critical, or 99.9%+ is stated",
    unknown: "Not stated",
  },
} as const;

const MENTION_ROLES = {
  existing_keep: "The technology is already part of the user's stack and should stay",
  replace_target: "The user wants to replace or move away from this technology",
  avoid: "The user does not want this technology used",
  preferred: "The user wants this technology to be used in the new stack",
  incidental: "The technology is mentioned only as context or comparison",
} as const;

function usageOf(kind: "typesafe", res: { model?: string; usage: { inputTokens: number; outputTokens: number }; latencyMs: number; questionCount: number }, calls = 1): EngineUsage {
  return { engine: kind, model: res.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, latencyMs: res.latencyMs, questionCount: res.questionCount, calls };
}

export class TypeSafeDecisionEngine implements DecisionEngine {
  readonly kind = "typesafe" as const;

  async extractIntentSignals(request: string, mentions: Array<{ slug: string; name: string }>, signal?: AbortSignal, clauses: string[] = []): Promise<IntentSignals> {
    const questions: Questions = {};
    for (const cap of CAPABILITIES) {
      questions[`need_${cap.id}`] = noul(cap.needQuestion, { true: cap.needYes, false: cap.needNo });
    }
    questions.requestKind = choice("What kind of request is `request`?", CHOICES.requestKind);
    questions.productKind = choice("What kind of product does `request` describe?", CHOICES.productKind);
    questions.archetype = choice(
      "Which kind of product is `request` most likely asking to build? Pick the closest match even when the request is very short, vague or only a few words.",
      Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.criterion])),
    );
    questions.budget = choice("What budget posture does `request` express?", CHOICES.budget);
    questions.scale = choice("What scale of usage does `request` state or imply?", CHOICES.scale);
    questions.teamSize = choice("What team size does `request` state or imply?", CHOICES.teamSize);
    questions.hosting = choice("What hosting or deployment model does `request` state or imply?", CHOICES.hosting);
    questions.cloud = choice("Which cloud provider does `request` require or prefer?", CHOICES.cloud);
    questions.openSource = choice("What open-source preference does `request` express?", CHOICES.openSource);
    questions.language = choice("Which programming language or runtime does `request` require or prefer for the backend?", CHOICES.language);
    questions.timeToMarket = choice("How urgent is time to market in `request`?", CHOICES.timeToMarket);
    questions.dataResidency = choice("Does `request` state a data residency requirement?", CHOICES.dataResidency);
    questions.lockIn = choice("What vendor lock-in tolerance does `request` express?", CHOICES.lockIn);
    questions.opsTolerance = choice("How much operational complexity is the team in `request` willing to take on?", CHOICES.opsTolerance);
    questions.availability = choice("What availability target does `request` state or imply?", CHOICES.availability);
    questions.hipaa = noul("Does `request` require HIPAA compliance or handle protected health information?", { true: "HIPAA, PHI, healthcare patient data, medical records are mentioned", false: "No healthcare data or HIPAA mention" });
    questions.soc2 = noul("Does `request` require SOC 2 or equivalent enterprise security certification?", { true: "SOC 2, enterprise customers, security audits or 'enterprise-ready' are mentioned", false: "No such requirement" });
    questions.gdpr = noul("Does `request` require GDPR compliance or EU privacy handling?", { true: "GDPR, EU users, European privacy law are mentioned", false: "No such requirement" });
    questions.pci = noul("Does `request` involve handling card payments in a way that requires PCI DSS scope?", { true: "Card processing, banking, fintech or PCI are mentioned", false: "No card data handling" });
    questions.localAi = noul("Does `request` require AI models to run locally, offline or on the user's own hardware?", { true: "Local, offline, on-device, self-hosted models, own GPU, 'local-first'", false: "Hosted APIs are acceptable" });
    questions.nvidia = noul("Does `request` mention NVIDIA GPUs, CUDA or specific GPU hardware?", { true: "NVIDIA, CUDA, RTX, H100, A100 or GPU hardware is named", false: "No GPU hardware mentioned" });
    questions.lowLatency = noul("Does `request` emphasize low latency or real-time responsiveness as a requirement?", { true: "Real-time, instant, low latency, sub-second is emphasized", false: "Latency is not emphasized" });
    questions.mobileGeneric = noul("Does `request` ask for a mobile app without specifying iOS or Android?", { true: "'mobile app' or 'mobile' without naming a platform", false: "A platform is named or no mobile app is wanted" });
    questions.hasUsers = noul("Does the product in `request` have end users with accounts?", { true: "Users sign up, log in, subscribe or have personal data", false: "No user accounts (internal pipeline, anonymous tool)" });
    for (const m of mentions) {
      questions[`mention_${m.slug}`] = choice({ technology: m.name, question: "What role does `technology` play in `request`?" }, MENTION_ROLES);
    }
    // Objectives: which of the user's own clauses state something the product must do, have or satisfy.
    const capabilityOptions: Record<string, string> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, `${c.label}: ${c.description}`]));
    capabilityOptions.none = "No single architecture capability; it describes the product as a whole or a business goal";
    capabilityOptions.constraint = "Not a capability: it states a constraint or preference (budget, team size, scale, hosting, cloud, language, compliance, timeline)";
    clauses.forEach((clause, i) => {
      questions[`clause_obj_${i}`] = noul(
        { clause, question: "Within `request`, does `clause` state something the user wants the product or its technology stack to do, have, handle or satisfy?" },
        { true: "It is a real objective or requirement (a feature, a workload, a constraint, a target platform or the product itself)", false: "It is filler, politeness, or a question word without a requirement" },
      );
      questions[`clause_cap_${i}`] = choice({ clause, question: "Which architecture capability is most essential to deliver `clause` for the product in `request`?" }, capabilityOptions);
    });
    const res = await askTypeSafeChunked({ request }, questions, 110, signal);
    const a = res.answers as Record<string, { type: string; noul?: number; choice?: string; confidence?: number }>;
    const needs: Record<string, number> = {};
    for (const cap of CAPABILITIES) needs[cap.id] = a[`need_${cap.id}`]?.noul ?? 0;
    const ch = (k: string) => ({ value: a[k]?.choice ?? "unknown", confidence: a[k]?.confidence ?? 0 });
    const mentionRoles: IntentSignals["mentionRoles"] = {};
    for (const m of mentions) {
      const ans = a[`mention_${m.slug}`];
      if (ans?.choice) mentionRoles[m.slug] = { role: ans.choice, confidence: ans.confidence ?? 0 };
    }
    return {
      needs,
      choices: {
        requestKind: ch("requestKind"),
        archetype: { ...ch("archetype"), probabilities: (a.archetype as { probabilities?: Record<string, number> } | undefined)?.probabilities ?? {} },
        productKind: ch("productKind"),
        budget: ch("budget"),
        scale: ch("scale"),
        teamSize: ch("teamSize"),
        hosting: ch("hosting"),
        cloud: ch("cloud"),
        openSource: ch("openSource"),
        language: ch("language"),
        timeToMarket: ch("timeToMarket"),
        dataResidency: ch("dataResidency"),
        lockIn: ch("lockIn"),
        opsTolerance: ch("opsTolerance"),
        availability: ch("availability"),
      },
      flags: {
        hipaa: a.hipaa?.noul ?? 0,
        soc2: a.soc2?.noul ?? 0,
        gdpr: a.gdpr?.noul ?? 0,
        pci: a.pci?.noul ?? 0,
        localAi: a.localAi?.noul ?? 0,
        nvidia: a.nvidia?.noul ?? 0,
        lowLatency: a.lowLatency?.noul ?? 0,
        mobileGeneric: a.mobileGeneric?.noul ?? 0,
        hasUsers: a.hasUsers?.noul ?? 0,
      },
      mentionRoles,
      clauses: clauses.map((_, i) => ({
        objective: a[`clause_obj_${i}`]?.noul ?? 0,
        capability: a[`clause_cap_${i}`]?.choice ?? "none",
        capabilityConfidence: a[`clause_cap_${i}`]?.confidence ?? 0,
      })),
      usage: usageOf("typesafe", res, Math.ceil(Object.keys(questions).length / 110)),
    };
  }

  async decideSlot(
    input: { requirement: Requirement; projectContext: ProjectContext; constraints: Constraint[]; candidates: CandidateSummary[]; criteria: Criterion[] },
    signal?: AbortSignal,
  ): Promise<SlotDecisionSignals> {
    const { requirement, projectContext, candidates, criteria } = input;
    const state = {
      request: projectContext.request,
      project: {
        summary: projectContext.summary,
        kind: projectContext.productKind,
        primary_objectives: projectContext.objectives,
        hard_constraints: projectContext.hardConstraints,
        preferences: projectContext.softPreferences,
        assumptions: projectContext.assumptions,
        already_selected: projectContext.selectedSoFar.map((s) => `${s.name} (${s.slot})`),
      },
      slot: { name: requirement.label, requirement: requirement.description },
      candidates: candidates.map((c) => ({
        name: c.name,
        summary: c.shortDescription,
        type: c.type,
        open_source: c.openSource ?? "unknown",
        license: c.license ?? "unknown",
        deployment: c.deploymentModels,
        clouds: c.supportedClouds,
        languages: c.supportedLanguages,
        pricing: c.pricingSummary ?? c.pricingModel,
        free_tier: c.freeTier ?? "unknown",
        maturity: c.maturity,
        compliance: c.compliance,
        integrations: c.integrations.slice(0, 12),
      })),
    };
    const pickCriteria: Record<string, string> = {};
    candidates.forEach((c, i) => {
      pickCriteria[c.id] = `candidates[${i}] ${c.name}: ${c.shortDescription}`;
    });
    pickCriteria.none_suitable = "None of the candidates should fill this slot for this project";

    const questions: Questions = {
      pick: choice(
        `Which candidate should fill the "${requirement.label}" slot (\`slot.requirement\`) for the project described in \`request\`, best serving \`project.primary_objectives\` within \`project.hard_constraints\`, \`project.preferences\` and \`project.already_selected\`?`,
        pickCriteria,
      ),
    };
    const scoredCriteria = criteria.slice(0, 4);
    candidates.forEach((c, i) => {
      const ref = `\`candidates[${i}]\` (${c.name})`;
      questions[`fit_${c.id}`] = noul(`Does ${ref} satisfy the requirement in \`slot.requirement\` for the project in \`request\`?`, {
        true: "It provides this capability well for this project",
        false: "It does not provide this capability, or provides it poorly for this project",
      });
      questions[`hard_${c.id}`] = noul(`Would selecting ${ref} violate any of the hard constraints listed in \`project.hard_constraints\`?`, {
        true: "It contradicts at least one hard constraint (for example it is proprietary when open source is required, or tied to a cloud the project must avoid)",
        false: "It is compatible with every hard constraint, or there are no hard constraints",
      });
      questions[`complex_${c.id}`] = noul(`Would ${ref} add operational complexity that the project in \`request\` does not need, given the team size and scale in \`project\`?`, {
        true: "It is heavier than the project warrants (extra infrastructure to run, steep setup) relative to simpler candidates",
        false: "Its complexity is appropriate for the project",
      });
      for (const crit of scoredCriteria) {
        const def = CRITERION_LEVELS[crit.id];
        questions[`crit_${crit.id}_${c.id}`] = score(`${def.question} Judge ${ref} for the project in \`request\` and the slot \`slot.requirement\`.`, def.levels);
      }
    });

    const res = await askTypeSafeChunked(state, questions, 80, signal);
    const a = res.answers as Record<string, { type: string; noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number>; score?: number; legend?: Record<string, string> }>;
    const pickAns = a.pick;
    const perCandidate: SlotDecisionSignals["perCandidate"] = {};
    for (const c of candidates) {
      const crit: Record<string, { score: number; confidence: number; level: string }> = {};
      for (const cr of scoredCriteria) {
        const ans = a[`crit_${cr.id}_${c.id}`];
        if (ans && typeof ans.score === "number") {
          const maxLevel = CRITERION_LEVELS[cr.id].levels.length - 1;
          const nearest = Math.round(ans.score);
          crit[cr.id] = { score: ans.score / maxLevel, confidence: ans.confidence ?? 0, level: ans.legend?.[String(nearest)] ?? "" };
        }
      }
      perCandidate[c.id] = {
        fit: a[`fit_${c.id}`]?.noul ?? 0.5,
        hardViolation: a[`hard_${c.id}`]?.noul ?? 0,
        complexity: a[`complex_${c.id}`]?.noul ?? 0,
        criteria: crit,
      };
    }
    return {
      pick: {
        candidateId: (pickAns?.choice as string) ?? "none_suitable",
        probabilities: pickAns?.probabilities ?? {},
        confidence: pickAns?.confidence ?? 0,
      },
      perCandidate,
      usage: usageOf("typesafe", res, Math.ceil(Object.keys(questions).length / 80)),
    };
  }

  async validateStack(
    input: { request: string; projectContext: ProjectContext; components: StackComponent[]; pairs: Array<{ a: string; b: string; reason: "overlap" | "integration" }>; optionalSlots: string[] },
    signal?: AbortSignal,
  ): Promise<StackValidationSignals> {
    const { request, projectContext, components, pairs, optionalSlots } = input;
    const bySlot = new Map(components.map((c) => [c.slotId, c]));
    const state = {
      request,
      primary_objectives: projectContext.objectives,
      hard_constraints: projectContext.hardConstraints,
      team_and_scale: projectContext.assumptions,
      stack: components.map((c) => ({ slot: c.slotLabel, technology: c.name, role: c.role })),
    };
    const questions: Questions = {
      oversized: score("Considering `request` and `stack`, how much larger is this stack than the smallest coherent architecture that satisfies the request?", [
        "Minimal: every component is necessary",
        "Slightly more than needed: one component could be dropped",
        "Noticeably oversized: several components could be dropped or merged",
        "Far too large for the request",
      ]),
    };
    for (const slotId of optionalSlots) {
      const c = bySlot.get(slotId);
      if (!c) continue;
      questions[`needed_${slotId}`] = noul(
        `Given \`request\`, \`primary_objectives\` and the other components in \`stack\`, does this architecture genuinely need a dedicated "${c.slotLabel}" component (currently ${c.name}) rather than leaving it out or relying on another selected component?`,
        {
          true: "The request clearly needs this capability and no other selected component already covers it adequately",
          false: "The request does not need it, or another selected component already covers it well enough",
        },
      );
    }
    for (const p of pairs) {
      const a = bySlot.get(p.a);
      const b = bySlot.get(p.b);
      if (!a || !b) continue;
      const key = `${p.a}|${p.b}`;
      if (p.reason === "overlap") {
        questions[`redundant_${key}`] = noul(`In \`stack\`, do ${a.name} (${a.slotLabel}) and ${b.name} (${b.slotLabel}) duplicate the same capability such that one of them is unnecessary for \`request\`?`, {
          true: "They overlap substantially; one could be removed without losing needed capability",
          false: "They serve distinct purposes in this architecture",
        });
      }
      questions[`compatible_${key}`] = noul(`Can ${a.name} (${a.slotLabel}) and ${b.name} (${b.slotLabel}) be used together in the same architecture for \`request\` without a deployment, runtime, language or vendor conflict?`, {
        true: "They work together with standard integration",
        false: "They conflict (incompatible runtime, deployment model, language ecosystem, or mutually exclusive vendors)",
      });
    }
    const res = await askTypeSafeChunked(state, questions, 80, signal);
    const a = res.answers as Record<string, { noul?: number; score?: number }>;
    const slotNecessary: Record<string, number> = {};
    for (const slotId of optionalSlots) slotNecessary[slotId] = a[`needed_${slotId}`]?.noul ?? 1;
    const pairCompatible: Record<string, number> = {};
    const pairRedundant: Record<string, number> = {};
    for (const p of pairs) {
      const key = `${p.a}|${p.b}`;
      if (a[`compatible_${key}`]) pairCompatible[key] = a[`compatible_${key}`].noul ?? 1;
      if (a[`redundant_${key}`]) pairRedundant[key] = a[`redundant_${key}`].noul ?? 0;
    }
    return { slotNecessary, pairCompatible, pairRedundant, oversized: (a.oversized?.score ?? 0) / 3, usage: usageOf("typesafe", res) };
  }
}

export { typeSafeModel };
