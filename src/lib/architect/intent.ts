import { findMentions } from "@/lib/retrieval";
import { CAPABILITY_BY_ID } from "@/lib/taxonomy";
import { ARCHETYPE_BY_ID, type Archetype } from "./archetypes";
import type { DecisionEngine, IntentSignals } from "@/lib/typesafe";
import type { Constraint, IntentAnalysis, Objective, RequestInterpretation, TechnologyMention } from "@/lib/types";

const PRODUCT_LABEL: Record<string, string> = {
  consumer_app: "consumer application",
  b2b_saas: "B2B SaaS product",
  internal_tool: "internal tool",
  ai_application: "AI-native application",
  data_platform: "data platform",
  api_product: "API product",
  marketplace: "marketplace",
  ecommerce: "commerce product",
  fintech: "financial product",
  healthcare: "healthcare product",
  developer_tool: "developer tool",
  iot_or_hardware: "connected-device product",
  other: "product",
};

/**
 * A named technology whose most likely role is "keep" or "use" is pinned. Choice confidence
 * measures how peaked the answer is, not the role's probability, so only near-random answers
 * (below this) are ignored.
 */
export const PIN_MIN_CONFIDENCE = 0.3;

export interface IntentOptions {
  /** Earlier turns of the same thread, oldest first. Their objectives and constraints carry forward. */
  context?: string[];
}

// Leading request phrasing ("Build me a", "I need the stack for") is not part of an objective.
// Verbs like "suggest" or "recommend" are only stripped when they ask for a stack, so "suggest due dates" survives.
const BOILERPLATE = /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:(?:build|design|create|make)\s+(?:me\s+|us\s+)?(?=(?:the|a|an|my|our)\b|(?:[\w-]+\s+)?(?:stack|architecture)\b)|(?:i|we)\s+(?:need|want)\s+|help\s+me\s+(?:build|design)\s+|(?:recommend|suggest|propose|give\s+me)\s+(?=(?:a|an|the)\s+(?:[\w-]+\s+)?(?:stack|architecture)))(?:(?:the|a|an)\s+)?(?:(?:best|good|modern|complete)\s+)?(?:(?:tech(?:nology)?|software)\s+)?(?:(?:stack|architecture)\s+)?(?:for\s+)?/i;

/**
 * Split the user's words into candidate objective clauses. Code only splits; TypeSafe decides which
 * clauses are real objectives, and the kept ones are shown verbatim.
 */
export function splitClauses(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).length;
  const parts = trimmed
    // Split on sentences, commas and coordinating words; relative clauses ("features that suggest…") stay whole.
    .split(/(?<=[.!?;])\s+|\n+|,\s+(?:and\s+|but\s+)?|\s+(?:and|but|while|plus)\s+/i)
    .map((p) => p.replace(BOILERPLATE, "").replace(/^[\s,.;:-]+|[\s,.;:!?-]+$/g, "").trim())
    .filter((p) => p.length > 0 && (p.split(/\s+/).length >= 2 || words <= 3));
  return [...new Set(parts.length ? parts : [trimmed])].slice(0, 10);
}

export async function analyzeIntent(request: string, engine: DecisionEngine, opts: IntentOptions = {}, signal?: AbortSignal): Promise<IntentAnalysis> {
  const turns = [...(opts.context ?? []).map((t) => t.trim()).filter(Boolean), request.trim()];
  const fullRequest = turns.length > 1 ? `${turns[0]}\n${turns.slice(1).map((t) => `Additional context: ${t}`).join("\n")}` : turns[0];
  const clauseList: Array<{ text: string; turn: number }> = turns.flatMap((t, turn) => splitClauses(t).map((text) => ({ text, turn })));
  const mentions = await findMentions(fullRequest);
  const signals = await engine.extractIntentSignals(fullRequest, mentions.map((m) => ({ slug: m.slug, name: m.name })), signal, clauseList.map((c) => c.text));
  // Primary objectives, in the user's words. Their capabilities are guaranteed a slot.
  const objectives: Objective[] = [];
  clauseList.forEach((c, i) => {
    const sig = signals.clauses[i];
    if (!sig || sig.objective < 0.5) return;
    const cap = CAPABILITY_BY_ID.has(sig.capability) && sig.capabilityConfidence >= 0.25 ? sig.capability : undefined;
    const kind: Objective["kind"] = cap ? "capability" : sig.capability === "constraint" ? "constraint" : "product";
    objectives.push({ text: c.text, turn: c.turn, confidence: Number(sig.objective.toFixed(2)), capability: cap, capabilityLabel: cap ? CAPABILITY_BY_ID.get(cap)!.label : undefined, kind });
    if (cap) signals.needs[cap] = Math.max(signals.needs[cap] ?? 0, 0.9);
  });
  // "AI-native", "AI-powered", "with AI" reliably imply model inference even when the Noul reads it literally.
  if (/\b(ai|llm|llms|gpt|genai|generative)\b/i.test(fullRequest) && !/\bno ai\b|without ai/i.test(fullRequest)) {
    signals.needs["llm-inference"] = Math.max(signals.needs["llm-inference"] ?? 0, 0.8);
  }
  const constraints: Constraint[] = [];
  const unknowns: string[] = [];
  const assumptions: string[] = [];
  const ch = signals.choices;
  const add = (kind: Constraint["kind"], value: string, label: string, severity: Constraint["severity"], confidence: number, source: Constraint["source"] = "explicit") => {
    constraints.push({ id: `c_${kind}_${value}`.replace(/[^a-z0-9_:-]/gi, "-"), kind, value, label, severity, confidence, source });
  };

  // Budget, team, scale
  if (ch.budget.value !== "unknown") add("budget", ch.budget.value, `Budget: ${ch.budget.value}`, "soft", ch.budget.confidence);
  else {
    unknowns.push("budget");
    assumptions.push("Assuming a moderate budget where free tiers are welcome but not mandatory.");
  }
  if (ch.teamSize.value !== "unknown") add("team-size", ch.teamSize.value, `Team: ${ch.teamSize.value}`, "soft", ch.teamSize.confidence);
  else {
    unknowns.push("team size");
    assumptions.push("Assuming a small team, so operational simplicity is weighted.");
    add("team-size", "small", "Team: small (assumed)", "soft", 0.4, "implicit");
  }
  if (ch.scale.value !== "unknown") add("traffic", ch.scale.value, `Expected scale: ${ch.scale.value}`, "soft", ch.scale.confidence);
  else {
    unknowns.push("expected scale");
    assumptions.push("Assuming modest initial scale with room to grow.");
  }
  if (signals.flags.lowLatency > 0.6) add("latency", "low", "Low latency emphasized", "soft", signals.flags.lowLatency);

  // Hosting & cloud
  if (ch.hosting.value !== "unknown") {
    const hard = ch.hosting.value === "local" || ch.hosting.value === "self_hosted";
    add("hosting-model", ch.hosting.value.replace("_", "-"), `Hosting: ${ch.hosting.value.replace("_", " ")}`, hard ? "hard" : "soft", ch.hosting.confidence);
    if (hard) add("self-hosting", ch.hosting.value === "local" ? "local" : "self-hosted", "Must be self-hostable", "hard", ch.hosting.confidence);
  } else {
    unknowns.push("hosting preference");
    assumptions.push("Assuming managed platforms are acceptable.");
  }
  if (ch.cloud.value !== "unknown" && ch.cloud.value !== "none") add("cloud", ch.cloud.value, `Cloud: ${ch.cloud.value.toUpperCase()}`, ch.cloud.confidence >= 0.6 ? "hard" : "soft", ch.cloud.confidence);
  if (ch.cloud.value === "none") add("vendor-lock-in", "avoid", "Avoid hyperscaler dependence", "soft", ch.cloud.confidence);

  // Open source & lock-in
  if (ch.openSource.value === "required") add("open-source", "required", "Open source required", "hard", ch.openSource.confidence);
  else if (ch.openSource.value === "preferred") add("open-source", "preferred", "Open source preferred", "soft", ch.openSource.confidence);
  if (ch.lockIn.value === "avoid") add("vendor-lock-in", "avoid", "Avoid vendor lock-in", "soft", ch.lockIn.confidence);

  // Language
  if (ch.language.value !== "unknown") add("language", ch.language.value, `Language: ${ch.language.value}`, ch.language.confidence >= 0.7 ? "hard" : "soft", ch.language.confidence);
  else {
    unknowns.push("programming language");
    assumptions.push(signals.needs["llm-inference"] > 0.6 && signals.needs["web-frontend"] < 0.5 ? "Assuming Python for the AI-heavy backend." : "Assuming TypeScript across the stack unless a component needs otherwise.");
    const assumedLang = signals.needs["llm-inference"] > 0.6 && signals.needs["web-frontend"] < 0.5 ? "python" : "typescript";
    add("language", assumedLang, `Language: ${assumedLang} (assumed)`, "soft", 0.35, "implicit");
  }

  // Compliance & residency
  const comp: Array<[string, number]> = [
    ["hipaa", signals.flags.hipaa],
    ["soc2", signals.flags.soc2],
    ["gdpr", signals.flags.gdpr],
    ["pci", signals.flags.pci],
  ];
  const explicitPci = /\bpci\b|cardholder|card data|store cards/i.test(fullRequest);
  for (const [name, p] of comp) if (name === "pci" ? explicitPci || p > 0.9 : p > 0.6) add("compliance", name === "soc2" ? "SOC 2" : name === "pci" ? "PCI DSS" : name.toUpperCase(), `${name === "soc2" ? "SOC 2" : name.toUpperCase()} compliance`, "hard", p);
  if (ch.dataResidency.value !== "none" && ch.dataResidency.value !== "unknown") add("data-residency", ch.dataResidency.value.replace("_region", ""), `Data residency: ${ch.dataResidency.value.toUpperCase()}`, "hard", ch.dataResidency.confidence);

  // AI / GPU
  if (signals.flags.localAi > 0.6) add("ai", "local", "AI must run locally / self-hosted", "hard", signals.flags.localAi);
  if (signals.flags.nvidia > 0.6) add("gpu", "nvidia", "NVIDIA GPU hardware", "hard", signals.flags.nvidia);

  // Time & ops
  if (ch.timeToMarket.value !== "unknown" && ch.timeToMarket.value !== "normal") add("time-to-market", ch.timeToMarket.value, `Time to market: ${ch.timeToMarket.value.replace("_", " ")}`, "soft", ch.timeToMarket.confidence);
  if (ch.opsTolerance.value !== "unknown") add("operational-complexity", ch.opsTolerance.value, `Operational tolerance: ${ch.opsTolerance.value}`, "soft", ch.opsTolerance.confidence);
  if (ch.availability.value === "high") add("availability", "high", "High availability target", "soft", ch.availability.confidence);
  if (signals.needs["ios-client"] > 0.6 || signals.needs["android-client"] > 0.6 || signals.flags.mobileGeneric > 0.6) add("mobile", "required", "Mobile app required", "hard", 0.8);
  if (signals.needs["realtime"] > 0.65) add("realtime", "required", "Realtime delivery required", "soft", signals.needs["realtime"]);

  // Mentions
  const mentionOut: TechnologyMention[] = [];
  for (const m of mentions) {
    const r = signals.mentionRoles[m.slug];
    if (!r) continue;
    const role = r.role.replace(/_/g, "-") as TechnologyMention["role"];
    const capability = m.capabilities.find((cap) => CAPABILITY_BY_ID.has(cap));
    mentionOut.push({ technologyId: m.id, name: m.name, role, confidence: r.confidence, capability });
    if (role === "replace-target" || role === "avoid") add("existing-technology", `avoid:${m.slug}`, `${role === "avoid" ? "Avoid" : "Replace"} ${m.name}`, "hard", r.confidence);
    if (role === "existing-keep" || role === "preferred") add("existing-technology", m.slug, `${role === "preferred" ? "Use" : "Keep"} ${m.name}`, "hard", r.confidence);
  }

  let requestKind = ch.requestKind.value.replace(/_/g, "-") as IntentAnalysis["requestKind"];
  if (mentionOut.some((m) => m.role === "replace-target") && requestKind === "new-stack") requestKind = "replace-component";

  // Every request is accepted. Short or vague ones are completed from the closest product archetype.
  const archetype = ARCHETYPE_BY_ID.get(ch.archetype.value) ?? ARCHETYPE_BY_ID.get("general_web_app")!;
  const strongNeeds = Object.entries(signals.needs).filter(([cap, p]) => p > 0.7 && !CAPABILITY_BY_ID.get(cap)?.baseline).map(([cap]) => cap);
  const explicitConstraints = constraints.filter((c) => c.source === "explicit" && c.kind !== "team-size");
  // Objectives that name a specific capability count as detail: such a request is not vague.
  const specificObjectives = objectives.filter((o) => o.capability && !CAPABILITY_BY_ID.get(o.capability)?.baseline).length;
  const vague = strongNeeds.length + mentionOut.length + explicitConstraints.length + specificObjectives < 3;
  const addedCapabilities: string[] = [];
  if (vague) {
    for (const cap of archetype.capabilities) {
      if ((signals.needs[cap] ?? 0) < 0.9) addedCapabilities.push(cap);
      signals.needs[cap] = Math.max(signals.needs[cap] ?? 0, 0.9);
    }
    assumptions.push(`Your request was brief, so it was interpreted as ${withArticle(archetype.noun)} for ${archetype.audience}. Refine the brief to change that.`);
  }
  const route: RequestInterpretation["route"] =
    requestKind === "replace-component" ? "replace-component" : requestKind === "modify-existing" ? "modify-existing" : requestKind === "question" ? "reference-stack" : "new-stack";
  if (requestKind === "unclear") requestKind = "new-stack";
  if (route === "replace-component" && !mentionOut.some((m) => m.role === "replace-target")) {
    assumptions.push("No specific technology to replace was named, so a complete stack is proposed that you can compare against your current one.");
  }
  const interpretation: RequestInterpretation = {
    original: request,
    context: turns,
    objectives,
    enhancedRequest: composeBrief(request, route, archetype, signals, constraints, mentionOut, vague, objectives),
    archetype: archetype.id,
    archetypeLabel: archetype.noun,
    archetypeConfidence: Number(ch.archetype.confidence.toFixed(2)),
    vague,
    addedCapabilities,
    route,
  };

  const productKind = ch.productKind.value;
  const summary = buildSummary(request, productKind, signals, constraints, ch.archetype.confidence >= 0.35 || vague ? archetype : undefined);

  return {
    request,
    requestKind,
    summary,
    productKind,
    needs: signals.needs,
    constraints,
    unknowns,
    assumptions,
    mentions: mentionOut,
    interpretation,
    engine: signals.usage.engine,
    model: signals.usage.model,
  };
}

function withArticle(noun: string) {
  return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

function listPhrase(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Product-level phrases for capabilities (infrastructure and plumbing are left out of the brief). */
const FEATURE_PHRASE: Record<string, string> = {
  realtime: "real-time updates",
  authentication: "user accounts",
  authorization: "roles and permissions",
  payments: "payments",
  email: "transactional email",
  notifications: "push notifications",
  "api-gateway": "a public developer API",
  "search-engine": "search",
  "object-storage": "file and media storage",
  "vector-db": "semantic search",
  analytics: "product analytics",
  "data-warehouse": "an analytics warehouse",
  "llm-inference": "AI features",
  "ai-orchestration": "AI workflows",
  "ai-evaluation": "AI quality monitoring",
  "gpu-compute": "GPU compute",
  "local-inference": "locally run AI models",
  speech: "voice and speech",
  "image-generation": "image generation",
  "video-generation": "video processing",
  "ocr-documents": "document parsing",
  "web-search-api": "live web data",
  workers: "background processing",
  scheduler: "scheduled jobs",
  streaming: "event streaming",
  etl: "data pipelines",
  "browser-automation": "browser automation",
  telephony: "phone calls",
  ecommerce: "a product catalog and checkout",
  cms: "an editorial CMS",
  maps: "maps and location",
};

const LANGUAGE_NAME: Record<string, string> = { typescript: "TypeScript", python: "Python", go: "Go", rust: "Rust", java: "Java/Kotlin", csharp: "C#/.NET", ruby: "Ruby", php: "PHP", swift: "Swift", elixir: "Elixir" };

/** Plain-English phrase for a constraint, or undefined when it adds nothing to the brief. */
function constraintPhrase(c: Constraint): string | undefined {
  const v = c.value;
  switch (c.kind) {
    case "budget":
      return v === "minimal" ? "a minimal budget" : v === "moderate" ? "a moderate budget" : undefined;
    case "team-size":
      return c.source === "implicit" ? undefined : ({ solo: "a solo developer", small: "a small team", medium: "a mid-size team", large: "a large engineering team" } as Record<string, string>)[v];
    case "traffic":
      return ({ small: "a small initial scale", medium: "moderate scale", large: "large scale" } as Record<string, string>)[v];
    case "latency":
      return "low latency";
    case "hosting-model":
      return ({ "managed-platform": "managed hosting", "own-cloud": "their own cloud account", "self-hosted": "self-hosting", local: "running locally", edge: "edge deployment" } as Record<string, string>)[v];
    case "cloud":
      return v.toUpperCase();
    case "open-source":
      return v === "required" ? "open-source software only" : "open-source software";
    case "vendor-lock-in":
      return "no vendor lock-in";
    case "language":
      return c.source === "implicit" ? undefined : LANGUAGE_NAME[v] ?? v;
    case "compliance":
      return `${v} compliance`;
    case "data-residency":
      return `${v.toUpperCase()} data residency`;
    case "ai":
      return v === "local" ? "AI models running locally" : undefined;
    case "gpu":
      return v === "nvidia" ? "NVIDIA GPUs" : undefined;
    case "time-to-market":
      return v === "urgent" ? "shipping fast" : v === "long_term" ? "long-term robustness" : undefined;
    case "operational-complexity":
      return v === "minimal" ? "minimal operations" : v === "high" ? "full infrastructure control" : undefined;
    case "availability":
      return v === "high" ? "high availability" : undefined;
    default:
      return undefined; // self-hosting, mobile, realtime and technology pins are expressed elsewhere
  }
}

/**
 * Compose the explicit brief from structured judgments (TypeSafe selects, code writes):
 * what is being built, for whom, on which surfaces, with which features and constraints.
 */
function composeBrief(original: string, route: RequestInterpretation["route"], archetype: Archetype, s: IntentSignals, constraints: Constraint[], mentions: TechnologyMention[], vague: boolean, objectives: Objective[]): string {
  const surfaces: string[] = [];
  if (s.needs["web-frontend"] > 0.5) surfaces.push("the web");
  const wantsMobile = s.flags.mobileGeneric > 0.6 || s.needs["ios-client"] > 0.6 || s.needs["android-client"] > 0.6;
  if (wantsMobile && (s.flags.mobileGeneric > 0.6 || (s.needs["ios-client"] > 0.6 && s.needs["android-client"] > 0.6))) surfaces.push("iOS and Android");
  else {
    if (s.needs["ios-client"] > 0.6) surfaces.push("iOS");
    if (s.needs["android-client"] > 0.6) surfaces.push("Android");
  }
  if (s.needs["desktop-client"] > 0.7) surfaces.push("desktop");
  const requested = [
    ...new Set(
      Object.entries(s.needs)
        .filter(([cap, p]) => p > 0.7 && FEATURE_PHRASE[cap])
        .sort((a, b) => b[1] - a[1])
        .map(([cap]) => FEATURE_PHRASE[cap]),
    ),
  ];
  const features = vague ? archetype.features : requested.slice(0, 5);
  const hard = [...new Set(constraints.filter((c) => c.severity === "hard").map(constraintPhrase).filter((x): x is string => Boolean(x)))];
  const soft = [...new Set(constraints.filter((c) => c.severity === "soft").map(constraintPhrase).filter((x): x is string => Boolean(x)))].filter((x) => !hard.includes(x));
  const keep = mentions.filter((m) => (m.role === "existing-keep" || m.role === "preferred") && m.confidence >= PIN_MIN_CONFIDENCE).map((m) => m.name);
  const replace = mentions.filter((m) => m.role === "replace-target" || m.role === "avoid").map((m) => m.name);

  const subject = `${withArticle(archetype.noun)} for ${archetype.audience}${surfaces.length ? ` on ${listPhrase(surfaces)}` : ""}`;
  let lead: string;
  switch (route) {
    case "replace-component":
      lead = replace.length ? `Replace ${listPhrase(replace)} in an existing ${archetype.noun} stack with the best-fitting alternatives` : `Propose a complete stack for ${subject} to compare against an existing one`;
      break;
    case "modify-existing":
      lead = `Adjust the stack for ${subject}`;
      break;
    case "reference-stack":
      lead = `Recommend a reference stack for ${subject}`;
      break;
    default:
      lead = `Design the technology stack for ${subject}`;
  }
  let brief = `${lead}${features.length ? ` with ${listPhrase(features)}` : ""}.`;
  // The user's own objectives lead the brief's requirements, verbatim.
  if (objectives.length) brief += ` Primary objective${objectives.length > 1 ? "s" : ""} in your words: ${objectives.map((o) => `“${o.text}”`).join(", ")}.`;
  if (keep.length) brief += ` Use ${listPhrase(keep)}.`;
  if (replace.length && route !== "replace-component") brief += ` Avoid ${listPhrase(replace)}.`;
  if (hard.length) brief += ` Requirements: ${listPhrase(hard)}.`;
  if (soft.length) brief += ` Optimize for ${listPhrase(soft)}.`;
  void original;
  return brief.charAt(0).toUpperCase() + brief.slice(1);
}

function buildSummary(request: string, productKind: string, s: IntentSignals, constraints: Constraint[], archetype?: Archetype): string {
  const parts: string[] = [];
  const label = archetype?.noun ?? PRODUCT_LABEL[productKind] ?? "product";
  parts.push(`${/^[aeiou]/i.test(label) ? "An" : "A"} ${label}`);
  const surfaces: string[] = [];
  if (s.needs["web-frontend"] > 0.5) surfaces.push("web");
  if (s.needs["ios-client"] > 0.6) surfaces.push("iOS");
  if (s.needs["android-client"] > 0.6) surfaces.push("Android");
  if (s.needs["desktop-client"] > 0.6) surfaces.push("desktop");
  if (surfaces.length) parts.push(`for ${surfaces.join(" and ")}`);
  const feats: string[] = [];
  if (s.needs["llm-inference"] > 0.6) feats.push("AI features");
  if (s.needs["vector-db"] > 0.6) feats.push("semantic retrieval");
  if (s.needs["realtime"] > 0.6) feats.push("realtime updates");
  if (s.needs["payments"] > 0.6) feats.push("payments");
  if (s.needs["scheduler"] > 0.6 || s.needs["queue"] > 0.6) feats.push("background processing");
  if (feats.length) parts.push(`with ${feats.join(", ")}`);
  const hard = constraints.filter((c) => c.severity === "hard").map((c) => c.label.toLowerCase());
  if (hard.length) parts.push(`(constraints: ${hard.join("; ")})`);
  void request;
  return parts.join(" ") + ".";
}
