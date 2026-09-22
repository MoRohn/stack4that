/**
 * Stack optimizer: after individual slot decisions, validate the whole set.
 * Code handles what code can check exactly (duplicate capabilities, language
 * mismatch, cloud conflicts, complexity budget). TypeSafe judges the
 * semantic questions (is this slot really needed here, are these two
 * compatible, are these two redundant).
 */
import type { DecisionEngine } from "@/lib/typesafe";
import type { Constraint, IntentAnalysis, ProjectContext, Requirement, StackComponent, StackIssue, Technology } from "@/lib/types";

export interface OptimizerInput {
  intent: IntentAnalysis;
  projectContext: ProjectContext;
  constraints: Constraint[];
  requirements: Requirement[];
  components: StackComponent[];
  techById: Map<string, Technology>;
  engine: DecisionEngine;
  signal?: AbortSignal;
}

export interface OptimizerResult {
  issues: StackIssue[];
  removeSlots: Array<{ slotId: string; reason: string }>;
  reevaluateSlots: Array<{ slotId: string; excludeIds: string[]; reason: string }>;
  signals: Awaited<ReturnType<DecisionEngine["validateStack"]>>;
}

const CLOUD_OWNERS: Record<string, string> = {
  aws: "aws",
  "amazon-s3": "aws",
  "amazon-rds": "aws",
  dynamodb: "aws",
  "amazon-sqs": "aws",
  "amazon-ses": "aws",
  "amazon-bedrock": "aws",
  "aws-api-gateway": "aws",
  "aws-secrets-manager": "aws",
  "amazon-cloudfront": "aws",
  "aws-route-53": "aws",
  "aws-cdk": "aws",
  "google-cloud": "gcp",
  "cloud-sql": "gcp",
  bigquery: "gcp",
  "google-cloud-storage": "gcp",
  "google-pubsub": "gcp",
  "vertex-ai": "gcp",
  firebase: "gcp",
  "firebase-auth": "gcp",
  azure: "azure",
  "azure-sql": "azure",
  "azure-blob-storage": "azure",
  "azure-openai": "azure",
};

export const ANCHOR_SLOTS = ["api-backend", "relational-db", "hosting", "llm-inference", "local-inference", "web-frontend"];

export async function optimizeStack(input: OptimizerInput): Promise<OptimizerResult> {
  const { components, techById, requirements, constraints, projectContext } = input;
  const issues: StackIssue[] = [];
  const removeSlots: OptimizerResult["removeSlots"] = [];
  const reevaluateSlots: OptimizerResult["reevaluateSlots"] = [];
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const compBySlot = new Map(components.map((c) => [c.slotId, c]));

  // 1. Missing required layers
  const coveredSlotIds = new Set(components.flatMap((c) => c.coveredSlots.map((x) => x.slotId)));
  for (const r of requirements) {
    if (r.required && !compBySlot.has(r.id) && !coveredSlotIds.has(r.id)) {
      issues.push({ id: `missing_${r.id}`, severity: "warning", kind: "missing-layer", message: `No suitable technology was found for ${r.label}.`, slotIds: [r.id] });
    }
  }

  // 2. Capability overlap pairs (code) -> candidates for TypeSafe redundancy judgment
  const pairs: Array<{ a: string; b: string; reason: "overlap" | "integration" }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      const a = components[i];
      const b = components[j];
      const ta = techById.get(a.technologyId);
      const tb = techById.get(b.technologyId);
      if (!ta || !tb) continue;
      const key = `${a.slotId}|${b.slotId}`;
      if (seen.has(key)) continue;
      // Overlap: one technology already provides the other's slot capability.
      const aCoversB = ta.capabilities.includes(b.slotId) || ta.id === tb.id;
      const bCoversA = tb.capabilities.includes(a.slotId);
      if (aCoversB || bCoversA) {
        pairs.push({ a: a.slotId, b: b.slotId, reason: "overlap" });
        seen.add(key);
      }
    }
  }
  // Integration pairs: adjacent in the requirement graph edges (limit for token budget)
  const edgesToCheck = input.requirements.length ? [] : [];
  void edgesToCheck;

  // 3. Same technology in two slots -> merge (keep the anchor / required / most probable slot)
  const byTech = new Map<string, StackComponent[]>();
  for (const c of components) byTech.set(c.technologyId, [...(byTech.get(c.technologyId) ?? []), c]);
  for (const [, comps] of byTech) {
    if (comps.length > 1) {
      const rank = (c: StackComponent) => (ANCHOR_SLOTS.includes(c.slotId) ? 100 : 0) + (reqById.get(c.slotId)?.required ? 10 : 0) + (reqById.get(c.slotId)?.probability ?? 0);
      const sorted = comps.slice().sort((a, b) => rank(b) - rank(a));
      for (const extra of sorted.slice(1)) {
        removeSlots.push({ slotId: extra.slotId, reason: `${extra.name} already fills the ${sorted[0].slotLabel} slot and covers ${extra.slotLabel}.` });
        issues.push({ id: `merge_${extra.slotId}`, severity: "info", kind: "duplicate-capability", message: `${extra.name} covers both ${sorted[0].slotLabel} and ${extra.slotLabel}; merged into one block.`, slotIds: [sorted[0].slotId, extra.slotId], resolution: "merged" });
      }
    }
  }

  // 3b. Two backend-as-a-service platforms (Supabase + Convex + Firebase...) never belong in one stack.
  const baas = components.filter((c) => techById.get(c.technologyId)?.capabilities.includes("backend-as-a-service"));
  const distinctBaas = [...new Map(baas.map((c) => [c.technologyId, c])).values()];
  if (distinctBaas.length > 1) {
    const keep = distinctBaas.slice().sort((a, b) => (ANCHOR_SLOTS.includes(a.slotId) ? -1 : 0) - (ANCHOR_SLOTS.includes(b.slotId) ? -1 : 0) || b.confidence - a.confidence)[0];
    for (const c of baas) {
      if (c.technologyId === keep.technologyId) continue;
      issues.push({ id: `baas_${c.slotId}`, severity: "warning", kind: "vendor-conflict", message: `${c.name} and ${keep.name} are both backend platforms; one platform should own the backend.`, slotIds: [c.slotId, keep.slotId], resolution: "re-evaluated" });
      if (!reevaluateSlots.some((r) => r.slotId === c.slotId)) reevaluateSlots.push({ slotId: c.slotId, excludeIds: [c.technologyId], reason: `overlaps with ${keep.name}` });
    }
  }

  // 3c. A backend platform picked for one side capability (storage, auth) while a different database is primary splits the data layer.
  const primaryDb = compBySlot.get("relational-db") ?? compBySlot.get("nosql-db");
  if (primaryDb) {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (!t || c.technologyId === primaryDb.technologyId || !t.capabilities.includes("backend-as-a-service")) continue;
      if (c.slotId === "api-backend") continue;
      issues.push({ id: `baas_split_${c.slotId}`, severity: "info", kind: "vendor-conflict", message: `${c.name} was chosen only for ${c.slotLabel.toLowerCase()} while ${primaryDb.name} holds the data; a focused service is simpler.`, slotIds: [c.slotId, primaryDb.slotId], resolution: "re-evaluated" });
      if (!reevaluateSlots.some((r) => r.slotId === c.slotId)) reevaluateSlots.push({ slotId: c.slotId, excludeIds: [c.technologyId], reason: `split data layer with ${primaryDb.name}` });
    }
  }

  // 4. Cloud vendor conflicts (code)
  const cloudPref = constraints.find((c) => c.kind === "cloud")?.value;
  const owners = new Map<string, string[]>();
  for (const c of components) {
    const owner = CLOUD_OWNERS[c.slug];
    if (owner) owners.set(owner, [...(owners.get(owner) ?? []), c.slotId]);
  }
  if (owners.size > 1) {
    const [primary] = [...owners.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    for (const [cloud, slots] of owners) {
      if (cloud === primary) continue;
      for (const slotId of slots) {
        const comp = compBySlot.get(slotId)!;
        issues.push({ id: `vendor_${slotId}`, severity: "warning", kind: "vendor-conflict", message: `${comp.name} is a ${cloud.toUpperCase()} service while the rest of the stack is on ${primary.toUpperCase()}.`, slotIds: [slotId], resolution: "re-evaluated with the primary cloud" });
        reevaluateSlots.push({ slotId, excludeIds: [comp.technologyId], reason: `cloud conflict with ${primary}` });
      }
    }
  }
  if (cloudPref) {
    for (const [cloud, slots] of owners) {
      if (cloud !== cloudPref) {
        for (const slotId of slots) {
          if (reevaluateSlots.some((r) => r.slotId === slotId)) continue;
          const comp = compBySlot.get(slotId)!;
          issues.push({ id: `cloudpref_${slotId}`, severity: "warning", kind: "vendor-conflict", message: `${comp.name} is tied to ${cloud.toUpperCase()} but you asked for ${cloudPref.toUpperCase()}.`, slotIds: [slotId], resolution: "re-evaluated" });
          reevaluateSlots.push({ slotId, excludeIds: [comp.technologyId], reason: `not on preferred cloud ${cloudPref}` });
        }
      }
    }
  }

  // 5. Language / runtime compatibility (code)
  const lang = constraints.find((c) => c.kind === "language" && c.severity === "hard")?.value;
  if (lang) {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (!t) continue;
      if ((t.type === "framework" || t.type === "library") && t.supportedLanguages.length && !t.supportedLanguages.includes(lang) && c.group !== "EXPERIENCE") {
        issues.push({ id: `lang_${c.slotId}`, severity: "warning", kind: "language-incompatible", message: `${c.name} does not target ${lang}, which you required.`, slotIds: [c.slotId], resolution: "re-evaluated" });
        reevaluateSlots.push({ slotId: c.slotId, excludeIds: [c.technologyId], reason: `language mismatch (${lang})` });
      }
    }
  }
  // Framework/library runtime coherence: backend framework language vs. worker/ORM libraries.
  const backend = compBySlot.get("api-backend");
  const backendTech = backend ? techById.get(backend.technologyId) : undefined;
  if (backendTech && backendTech.supportedLanguages.length) {
    for (const slotId of ["orm", "workers", "queue", "ai-orchestration"]) {
      const c = compBySlot.get(slotId);
      const t = c ? techById.get(c.technologyId) : undefined;
      if (!c || !t || t.type !== "library") continue;
      if (t.supportedLanguages.length && !t.supportedLanguages.some((l) => backendTech.supportedLanguages.includes(l))) {
        issues.push({ id: `runtime_${slotId}`, severity: "warning", kind: "language-incompatible", message: `${c.name} is a ${t.supportedLanguages.join("/")} library but the backend (${backend!.name}) runs ${backendTech.supportedLanguages.slice(0, 2).join("/")}.`, slotIds: [slotId, "api-backend"], resolution: "re-evaluated" });
        reevaluateSlots.push({ slotId, excludeIds: [c.technologyId], reason: `runtime mismatch with ${backend!.name}` });
      }
    }
  }

  // 6. Deployment model contradictions (code)
  const selfHost = constraints.find((c) => (c.kind === "self-hosting" || c.kind === "hosting-model") && (c.value === "self-hosted" || c.value === "local") && c.severity === "hard");
  if (selfHost) {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (!t || !t.deploymentModels.length) continue;
      if (!t.deploymentModels.some((d) => d === "self-hosted" || d === "on-device" || d === "desktop")) {
        issues.push({ id: `deploy_${c.slotId}`, severity: "error", kind: "deployment-incompatible", message: `${c.name} is managed-only, but the stack must be ${selfHost.value}.`, slotIds: [c.slotId], resolution: "re-evaluated" });
        if (!reevaluateSlots.some((r) => r.slotId === c.slotId)) reevaluateSlots.push({ slotId: c.slotId, excludeIds: [c.technologyId], reason: "not self-hostable" });
      }
    }
  }
  // Open-source contradiction
  const ossHard = constraints.find((c) => c.kind === "open-source" && c.value === "required" && c.severity === "hard");
  if (ossHard) {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (t && t.openSource === false) {
        issues.push({ id: `oss_${c.slotId}`, severity: "error", kind: "compliance-contradiction", message: `${c.name} is proprietary, but you required open source.`, slotIds: [c.slotId], resolution: "re-evaluated" });
        if (!reevaluateSlots.some((r) => r.slotId === c.slotId)) reevaluateSlots.push({ slotId: c.slotId, excludeIds: [c.technologyId], reason: "not open source" });
      }
    }
  }
  // Compliance: managed services without the required certification
  for (const comp of constraints.filter((c) => c.kind === "compliance" && c.severity === "hard")) {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (!t || t.openSource || (t.type !== "service" && t.type !== "platform")) continue;
      if (!t.compliance.map((x) => x.toUpperCase()).includes(comp.value.toUpperCase())) {
        issues.push({ id: `comp_${comp.value}_${c.slotId}`, severity: "warning", kind: "compliance-contradiction", message: `${c.name} has no documented ${comp.value} attestation in the knowledge base; verify before handling regulated data.`, slotIds: [c.slotId] });
      }
    }
  }
  // Budget contradiction
  const budget = constraints.find((c) => c.kind === "budget")?.value;
  if (budget === "minimal") {
    for (const c of components) {
      const t = techById.get(c.technologyId);
      if (t && t.freeTier === false && !t.openSource) {
        issues.push({ id: `budget_${c.slotId}`, severity: "info", kind: "budget-contradiction", message: `${c.name} has no free tier; consider it against your minimal budget.`, slotIds: [c.slotId] });
      }
    }
  }

  // 7. Semantic validation via the decision engine
  const optionalSlots = components.filter((c) => c.optional).map((c) => c.slotId);
  const signals = await input.engine.validateStack({ request: projectContext.request, projectContext, components, pairs, optionalSlots }, input.signal);
  // Blocks that deliver one of the user's primary objectives are never dropped as "unnecessary".
  const objectiveSlots = new Set(input.intent.interpretation.objectives.map((o) => o.capability).filter(Boolean) as string[]);
  for (const [slotId, p] of Object.entries(signals.slotNecessary)) {
    const comp = compBySlot.get(slotId);
    if (!comp || removeSlots.some((r) => r.slotId === slotId)) continue;
    if (objectiveSlots.has(slotId) || comp.coveredSlots.some((c) => objectiveSlots.has(c.slotId))) continue;
    if (p < 0.5) {
      removeSlots.push({ slotId, reason: `The request does not need a dedicated ${comp.slotLabel.toLowerCase()} component.` });
      issues.push({ id: `unnecessary_${slotId}`, severity: "info", kind: "unnecessary", message: `${comp.name} (${comp.slotLabel}) was dropped: not needed for this request (necessity ${(p * 100).toFixed(0)}%).`, slotIds: [slotId], resolution: "removed" });
    }
  }
  for (const [key, p] of Object.entries(signals.pairRedundant)) {
    const [a, b] = key.split("|");
    if (p > 0.6) {
      // Drop the optional / lower-probability slot of the pair.
      const ra = reqById.get(a);
      const rb = reqById.get(b);
      const drop = (ra?.required ? 1 : 0) - (rb?.required ? 1 : 0) !== 0 ? (ra?.required ? b : a) : (ra?.probability ?? 0) >= (rb?.probability ?? 0) ? b : a;
      const keep = drop === a ? b : a;
      if (!removeSlots.some((r) => r.slotId === drop) && !removeSlots.some((r) => r.slotId === keep)) {
        removeSlots.push({ slotId: drop, reason: `${compBySlot.get(keep)?.name} already covers ${compBySlot.get(drop)?.slotLabel.toLowerCase()}.` });
        issues.push({ id: `dup_${key}`, severity: "info", kind: "duplicate-capability", message: `${compBySlot.get(keep)?.name} already covers ${compBySlot.get(drop)?.slotLabel}; ${compBySlot.get(drop)?.name} removed.`, slotIds: [a, b], resolution: "removed" });
      }
    }
  }
  for (const [key, p] of Object.entries(signals.pairCompatible)) {
    const [a, b] = key.split("|");
    if (p < 0.35 && !removeSlots.some((r) => r.slotId === a || r.slotId === b)) {
      const rb = reqById.get(b);
      const target = rb?.required ? a : b;
      const comp = compBySlot.get(target)!;
      issues.push({ id: `incompat_${key}`, severity: "warning", kind: "incompatible", message: `${compBySlot.get(a)?.name} and ${compBySlot.get(b)?.name} may conflict (compatibility ${(p * 100).toFixed(0)}%).`, slotIds: [a, b], resolution: "re-evaluated" });
      if (!reevaluateSlots.some((r) => r.slotId === target)) reevaluateSlots.push({ slotId: target, excludeIds: [comp.technologyId], reason: `incompatible with ${compBySlot.get(target === a ? b : a)?.name}` });
    }
  }
  if (signals.oversized > 0.6) {
    issues.push({ id: "oversized", severity: "info", kind: "excessive-complexity", message: "The stack is larger than the request strictly needs; optional components are marked so you can drop them.", slotIds: components.filter((c) => c.optional).map((c) => c.slotId) });
  }
  const remaining = components.length - removeSlots.length;
  if (remaining > 14) {
    issues.push({ id: "burden", severity: "warning", kind: "operational-burden", message: `${remaining} components is a lot to operate for this team; consider consolidating onto platforms that bundle capabilities.`, slotIds: [] });
  }
  return { issues, removeSlots, reevaluateSlots, signals };
}
