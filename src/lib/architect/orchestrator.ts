/**
 * The architect pipeline:
 *
 *   request → intent + constraints → requirement graph → per-slot retrieval
 *   → TypeSafe decisions → stack optimization → final architecture,
 *
 * streamed as events so the UI assembles the stack progressively.
 */
import { toUniverseTech } from "@/lib/catalog";
import { getTechnologies, listTechnologies, saveArchitecture } from "@/lib/db/repo";
import { GROUP_ORDER } from "@/lib/taxonomy";
import { getDecisionEngine, type DecisionEngine } from "@/lib/typesafe";
import type { Architecture, Constraint, IntentAnalysis, ProjectContext, Requirement, StackComponent, StackIssue, ThreadTurn } from "@/lib/types";
import { buildSuggestions } from "./suggestions";
import { deriveCriteria } from "./criteria";
import { decideSlot, type SlotDecision } from "./decide";
import type { ArchitectEvent, EmitFn } from "./events";
import { buildAlternatives, explainSelection } from "./explain";
import { analyzeIntent } from "./intent";
import { ANCHOR_SLOTS, optimizeStack } from "./optimizer";
import { buildRequirementGraph } from "./requirements";
import { snippetFor } from "./snippets";
import { PIN_MIN_CONFIDENCE } from "./intent";

export interface ArchitectOptions {
  emit?: EmitFn;
  signal?: AbortSignal;
  /** The conversation so far; earlier turns' requests carry their objectives and constraints forward. */
  thread?: { id?: string; turns: ThreadTurn[] };
  engine?: DecisionEngine;
  /** Skip persistence (tests). */
  persist?: boolean;
}

const PHASE_TEXT: Record<string, string[]> = {
  EXPERIENCE: ["Choosing client frameworks…"],
  API: ["Evaluating backend options…", "Checking authentication…"],
  DATA: ["Evaluating databases…", "Comparing storage options…"],
  AI: ["Comparing model providers…", "Evaluating retrieval…"],
  INGESTION: ["Evaluating queues and workers…"],
  INFRASTRUCTURE: ["Comparing deployment options…", "Checking observability…"],
};

export async function runArchitect(request: string, opts: ArchitectOptions = {}): Promise<Architecture> {
  const started = Date.now();
  const emit: EmitFn = opts.emit ?? (() => {});
  const engine = opts.engine ?? getDecisionEngine();
  const requestId = `arch_${Math.random().toString(36).slice(2, 10)}`;
  const catalog = await listTechnologies();
  const techById = new Map(catalog.map((t) => [t.id, t]));
  emit({ type: "analysis.started", requestId, request, engine: engine.kind, model: engine.kind === "typesafe" ? process.env.TYPESAFE_MODEL ?? "jev-latest" : undefined, catalogSize: catalog.length });
  emit({ type: "progress", phase: "interpreting", message: "Understanding requirements…" });

  // 1. Intent
  const priorTurns = (opts.thread?.turns ?? []).slice(-12);
  const intent = await analyzeIntent(request, engine, { context: priorTurns.map((t) => t.request) }, opts.signal);
  const criteria = deriveCriteria(intent);
  const graph = buildRequirementGraph(intent);
  emit({ type: "requirements.extracted", intent, constraints: intent.constraints, assumptions: intent.assumptions, requirementCount: graph.requirements.length });
  for (const r of graph.requirements) emit({ type: "requirement.created", requirement: r });

  const usage = { calls: 0, inputTokens: 0, candidates: 0, decisions: 0 };
  const projectContext: ProjectContext = {
    request: `${intent.interpretation.enhancedRequest}\n\nThe user's own words: "${request}"`,
    summary: intent.summary,
    productKind: intent.productKind,
    hardConstraints: intent.constraints.filter((c) => c.severity === "hard").map((c) => c.label),
    softPreferences: intent.constraints.filter((c) => c.severity === "soft").map((c) => c.label),
    assumptions: intent.assumptions,
    objectives: intent.interpretation.objectives.map((o) => o.text),
    primaryLanguage: intent.constraints.find((c) => c.kind === "language")?.value,
    cloudPreference: intent.constraints.find((c) => c.kind === "cloud")?.value,
    hostingModel: intent.constraints.find((c) => c.kind === "hosting-model")?.value,
    selectedSoFar: [],
  };

  // Pinned technologies from mentions ("keep"/"use X") are honored by retrieval bonus; nothing else is forced.
  const components: StackComponent[] = [];
  const decisions = new Map<string, SlotDecision>();
  const pinnedMentions = intent.mentions.filter((m) => (m.role === "preferred" || m.role === "existing-keep") && m.confidence >= PIN_MIN_CONFIDENCE);
  const pinnedIds = pinnedMentions.map((m) => m.technologyId);
  const pinnedCaps = new Map(pinnedMentions.filter((m) => m.capability).map((m) => [m.capability!, m.technologyId]));

  emit({ type: "progress", phase: "searching", message: `Searching ${catalog.length.toLocaleString()} technologies…` });

  const runSlot = async (req: Requirement, excludeIds: string[] = []): Promise<StackComponent | undefined> => {
    emit({ type: "retrieval.started", slotId: req.id, label: req.label, catalogSize: catalog.length });
    const sd = await decideSlot(req, projectContext, intent.constraints, criteria, engine, {
      excludeIds,
      pinnedIds,
      signal: opts.signal,
      onCandidates: (cands) => {
        usage.candidates += cands.length;
        emit({ type: "candidate.found", slotId: req.id, candidates: cands.slice(0, 12).map((c) => ({ id: c.tech.id, slug: c.tech.slug, name: c.tech.name, score: Number(c.score.toFixed(3)) })) });
        emit({ type: "decision.started", slotId: req.id, label: req.label, candidateCount: Math.min(cands.length, 10), criteria: criteria.slice(0, 4).map((c) => c.label) });
      },
    });
    decisions.set(req.id, sd);
    usage.decisions += 1;
    usage.calls += sd.decision.decisionMetadata.engine === "typesafe" ? Math.max(1, Math.ceil(sd.decision.decisionMetadata.questionCount / 80)) : 0;
    usage.inputTokens += sd.decision.decisionMetadata.inputTokens ?? 0;
    emit({ type: "decision.completed", slotId: req.id, decision: sd.decision });
    for (const r of sd.ranked.slice(0, 6)) {
      if (sd.selected && r.tech.id === sd.selected.id) continue;
      emit({ type: "technology.rejected", slotId: req.id, technologyId: r.tech.id, slug: r.tech.slug, name: r.tech.name, reason: r.verdict.eliminationReason ?? "lower composite score" });
    }
    if (!sd.selected) return undefined;
    const names = new Map(sd.ranked.map((r) => [r.tech.id, r.tech.name]));
    const u = toUniverseTech(sd.selected);
    emit({ type: "technology.selected", slotId: req.id, group: req.group, technologyId: sd.selected.id, slug: sd.selected.slug, name: sd.selected.name, color: u.color, iconPath: u.iconPath, domain: u.domain, monogram: u.monogram, confidence: sd.decision.confidence });
    const { whyHere, role, tradeoff } = explainSelection(intent, req, sd.selected, sd.decision, intent.constraints, projectContext.selectedSoFar, names);
    const component: StackComponent = {
      slotId: req.id,
      group: req.group,
      slotLabel: req.label,
      role,
      technologyId: sd.selected.id,
      slug: sd.selected.slug,
      name: sd.selected.name,
      color: u.color,
      iconPath: u.iconPath,
      domain: u.domain,
      monogram: u.monogram,
      whyHere,
      tradeoff,
      alternatives: buildAlternatives(sd, sd.selected),
      confidence: sd.decision.confidence,
      criteriaResults: sd.decision.criteriaResults.filter((r) => r.candidateId === sd.selected!.id),
      decisionMetadata: sd.decision.decisionMetadata,
      sources: sd.selected.evidence.slice(0, 8).map((e) => ({ url: e.sourceUrl, type: e.sourceType, claim: e.claimType })),
      optional: !req.required,
      coveredSlots: [],
    };
    return component;
  };

  /** A non-anchor slot already provided by a selected technology is covered by it, not decided separately. */
  const coveredBy = (req: Requirement): StackComponent | undefined => {
    const pinnedForSlot = pinnedCaps.get(req.capability);
    for (const c of components) {
      if (pinnedForSlot && c.technologyId !== pinnedForSlot) continue;
      const t = techById.get(c.technologyId);
      if (!t) continue;
      // A backend platform that ships its own database owns primary persistence.
      if ((req.id === "relational-db" || req.id === "nosql-db") && t.capabilities.includes("backend-as-a-service") && (t.capabilities.includes("relational-db") || t.capabilities.includes("nosql-db"))) return c;
      if (ANCHOR_SLOTS.includes(req.id)) continue;
      if (t.capabilities.includes(req.capability)) return c;
    }
    return undefined;
  };
  const cover = (req: Requirement, by: StackComponent) => {
    by.coveredSlots.push({ slotId: req.id, label: req.label });
    by.role = [by.slotLabel, ...by.coveredSlots.map((x) => x.label)].join(" · ");
    emit({ type: "stack.slot.covered", slotId: req.id, label: req.label, bySlotId: by.slotId, technologyId: by.technologyId, name: by.name });
  };

  // 2. Decide slots group by group (parallel within a group so integration fit accumulates between layers).
  const accept = (c: StackComponent) => {
    components.push(c);
    projectContext.selectedSoFar.push({ slot: c.slotLabel, name: c.name, slug: c.slug });
    c.snippet = snippetFor(c, { request, components, intent });
    emit({ type: "stack.component.ready", component: c });
  };
  for (const group of GROUP_ORDER) {
    const reqs = graph.requirements.filter((r) => r.group === group);
    if (!reqs.length) continue;
    emit({ type: "progress", phase: "deciding", message: PHASE_TEXT[group][0] });
    // Anchor slots first (backend, primary database, hosting, inference) so the rest of the group sees them.
    const anchors = reqs.filter((r) => ANCHOR_SLOTS.includes(r.id));
    const rest = reqs.filter((r) => !ANCHOR_SLOTS.includes(r.id));
    const anchorPending: Requirement[] = [];
    for (const r of anchors) {
      const by = coveredBy(r);
      if (by) cover(r, by);
      else anchorPending.push(r);
    }
    for (const c of await Promise.all(anchorPending.map((r) => runSlot(r)))) if (c) accept(c);
    const pending: Requirement[] = [];
    for (const r of rest) {
      const by = coveredBy(r);
      if (by) cover(r, by);
      else pending.push(r);
    }
    if (pending.length && PHASE_TEXT[group][1]) emit({ type: "progress", phase: "deciding", message: PHASE_TEXT[group][1] });
    const decided = (await Promise.all(pending.map((r) => runSlot(r)))).filter((c): c is StackComponent => Boolean(c));
    // Consolidate: parallel decisions can pick overlapping tools (e.g. two job orchestrators).
    // Prefer the technology that covers the most sibling slots, and let it absorb the ones it provides.
    const pendingIds = new Set(pending.map((r) => r.id));
    const coverCount = (c: StackComponent) => (techById.get(c.technologyId)?.capabilities.filter((cap) => pendingIds.has(cap)).length ?? 0) + c.confidence;
    decided.sort((a, b) => coverCount(b) - coverCount(a));
    for (const c of decided) {
      const req = pending.find((r) => r.id === c.slotId)!;
      const by = coveredBy(req);
      // Only absorb when the covering technology was actually competitive in this slot's own decision.
      const ranked = decisions.get(req.id)?.ranked ?? [];
      const winner = ranked[0]?.verdict.compositeScore ?? 0;
      const coverer = by ? ranked.find((r) => r.tech.id === by.technologyId) : undefined;
      const competitive = Boolean(coverer && !coverer.verdict.eliminated && coverer.verdict.compositeScore >= winner * 0.85);
      if (by && by.technologyId !== c.technologyId && competitive) {
        emit({ type: "stack.component.removed", slotId: c.slotId, technologyId: c.technologyId, reason: `${by.name} already provides ${req.label.toLowerCase()}` });
        cover(req, by);
      } else accept(c);
    }
  }

  // 3. Global optimization
  emit({ type: "progress", phase: "validating", message: "Checking compatibility…" });
  emit({ type: "stack.validation.started", componentCount: components.length });
  const issues: StackIssue[] = [];
  const removed: string[] = [];
  const reevaluated: string[] = [];
  for (let round = 0; round < 2; round++) {
    const opt = await optimizeStack({ intent, projectContext, constraints: intent.constraints, requirements: graph.requirements, components, techById, engine, signal: opts.signal });
    usage.calls += opt.signals.usage.engine === "typesafe" ? 1 : 0;
    usage.inputTokens += opt.signals.usage.inputTokens;
    for (const i of opt.issues) if (!issues.some((x) => x.id === i.id)) issues.push(i);
    for (const rm of opt.removeSlots) {
      const idx = components.findIndex((c) => c.slotId === rm.slotId);
      if (idx >= 0) {
        const [c] = components.splice(idx, 1);
        removed.push(c.slotId);
        projectContext.selectedSoFar = projectContext.selectedSoFar.filter((s) => s.slot !== c.slotLabel);
        const keeper = components.find((k) => k.technologyId === c.technologyId);
        if (keeper) {
          keeper.coveredSlots.push({ slotId: c.slotId, label: c.slotLabel }, ...c.coveredSlots);
          keeper.role = [keeper.slotLabel, ...keeper.coveredSlots.map((x) => x.label)].join(" · ");
        }
        emit({ type: "stack.component.removed", slotId: c.slotId, technologyId: c.technologyId, reason: rm.reason });
      }
    }
    if (!opt.reevaluateSlots.length) break;
    for (const re of opt.reevaluateSlots) {
      const idx = components.findIndex((c) => c.slotId === re.slotId);
      const req = graph.requirements.find((r) => r.id === re.slotId);
      if (idx < 0 || !req) continue;
      const [old] = components.splice(idx, 1);
      projectContext.selectedSoFar = projectContext.selectedSoFar.filter((s) => s.slot !== old.slotLabel);
      emit({ type: "stack.component.removed", slotId: old.slotId, technologyId: old.technologyId, reason: re.reason });
      emit({ type: "progress", phase: "deciding", message: `Re-evaluating ${req.label.toLowerCase()}…` });
      const prevExcluded = decisions.get(re.slotId)?.decision.rejectedCandidateIds.filter((id) => id === old.technologyId) ?? [];
      // The slot itself plus every slot the removed block was covering are decided again.
      const orphaned = [req, ...old.coveredSlots.map((s) => graph.requirements.find((r) => r.id === s.slotId)).filter((r): r is Requirement => Boolean(r))];
      for (const slotReq of orphaned) {
        const by = slotReq.id === req.id ? undefined : coveredBy(slotReq);
        if (by) {
          cover(slotReq, by);
          continue;
        }
        const c = await runSlot(slotReq, slotReq.id === req.id ? [...re.excludeIds, ...prevExcluded] : [old.technologyId]);
        reevaluated.push(slotReq.id);
        if (c) {
          components.push(c);
          projectContext.selectedSoFar.push({ slot: c.slotLabel, name: c.name, slug: c.slug });
          c.snippet = snippetFor(c, { request, components, intent });
          emit({ type: "stack.component.ready", component: c });
        }
      }
    }
  }
  // Refresh snippets now that the final set is known.
  for (const c of components) c.snippet = snippetFor(c, { request, components, intent });
  components.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  emit({ type: "stack.validation.completed", issues, removed, reevaluated });

  const present = new Set(components.map((c) => c.slotId));
  const edges = graph.edges.filter((e) => present.has(e.from) && present.has(e.to));
  traceObjectives(intent, components);
  const architecture: Architecture = {
    id: requestId,
    createdAt: new Date().toISOString(),
    request,
    intent,
    requirementGraph: graph,
    criteria,
    components,
    edges,
    issues,
    assumptions: intent.assumptions,
    thread: {
      id: opts.thread?.id && /^thr_[a-z0-9]{6,16}$/.test(opts.thread.id) ? opts.thread.id : `thr_${Math.random().toString(36).slice(2, 12)}`,
      turns: [...priorTurns, { request, brief: intent.interpretation.enhancedRequest, architectureId: requestId, createdAt: new Date().toISOString() }],
    },
    suggestions: buildSuggestions(intent, components),
    stats: {
      technologiesSearched: catalog.length,
      candidatesConsidered: usage.candidates,
      decisions: usage.decisions,
      typesafeCalls: usage.calls + (intent.engine === "typesafe" ? 1 : 0),
      inputTokens: usage.inputTokens,
      durationMs: Date.now() - started,
      engine: intent.engine,
    },
  };
  if (opts.persist !== false) {
    try {
      await saveArchitecture(architecture);
    } catch (err) {
      console.warn("[architect] could not persist architecture:", (err as Error).message);
    }
  }
  emit({ type: "progress", phase: "complete", message: "Stack assembled" });
  emit({ type: "stack.completed", architecture });
  return architecture;
}

/**
 * Swap one component for a specific alternative and re-validate dependents.
 * Slots whose requirement graph edges touch the swapped slot are re-decided
 * with the new context so integration fit is recomputed.
 */
export async function swapComponent(
  architecture: Architecture,
  slotId: string,
  newTechnologyId: string,
  opts: { emit?: EmitFn; signal?: AbortSignal; engine?: DecisionEngine; persist?: boolean } = {},
): Promise<Architecture> {
  const emit: EmitFn = opts.emit ?? (() => {});
  const engine = opts.engine ?? getDecisionEngine();
  const [tech] = await getTechnologies([newTechnologyId]);
  if (!tech) throw new Error(`Unknown technology ${newTechnologyId}`);
  const req = architecture.requirementGraph.requirements.find((r) => r.id === slotId);
  if (!req) throw new Error(`Unknown slot ${slotId}`);
  const catalog = await listTechnologies();
  const techById = new Map(catalog.map((t) => [t.id, t]));
  const intent = architecture.intent;
  const criteria = architecture.criteria;
  const components = architecture.components.map((c) => ({ ...c }));
  const old = components.find((c) => c.slotId === slotId);
  if (old) emit({ type: "stack.component.removed", slotId, technologyId: old.technologyId, reason: "swapped by user" });
  const constraints: Constraint[] = [
    ...intent.constraints.filter((c) => !(c.kind === "existing-technology" && c.value === `avoid:${tech.slug}`)),
    { id: `c_pin_${tech.slug}`, kind: "existing-technology", value: tech.slug, label: `Use ${tech.name}`, severity: "hard", confidence: 1, source: "explicit" },
  ];
  const brief = architecture.intent.interpretation?.enhancedRequest;
  const projectContext: ProjectContext = {
    request: brief ? `${brief}\n\nThe user's own words: "${architecture.request}"` : architecture.request,
    summary: intent.summary,
    productKind: intent.productKind,
    hardConstraints: constraints.filter((c) => c.severity === "hard").map((c) => c.label),
    softPreferences: constraints.filter((c) => c.severity === "soft").map((c) => c.label),
    assumptions: intent.assumptions,
    objectives: intent.interpretation?.objectives?.map((o) => o.text) ?? [],
    selectedSoFar: components.filter((c) => c.slotId !== slotId).map((c) => ({ slot: c.slotLabel, name: c.name, slug: c.slug })),
  };
  // Decide the swapped slot with the pinned technology (retrieval bonus makes it the top candidate; TypeSafe still evaluates it).
  const sd = await decideSlot(req, projectContext, constraints, criteria, engine, { signal: opts.signal });
  const selected = sd.ranked.find((r) => r.tech.id === tech.id)?.tech ?? tech;
  const names = new Map(sd.ranked.map((r) => [r.tech.id, r.tech.name]));
  const u = toUniverseTech(selected);
  const { whyHere, role, tradeoff } = explainSelection(intent, req, selected, sd.decision, constraints, projectContext.selectedSoFar, names);
  const component: StackComponent = {
    slotId,
    group: req.group,
    slotLabel: req.label,
    role,
    technologyId: selected.id,
    slug: selected.slug,
    name: selected.name,
    color: u.color,
    iconPath: u.iconPath,
    domain: u.domain,
    monogram: u.monogram,
    whyHere: `${whyHere} You chose it explicitly over ${old?.name ?? "the previous selection"}.`,
    tradeoff,
    alternatives: buildAlternatives({ ...sd, selected }, selected).filter((a) => a.technologyId !== selected.id),
    confidence: sd.decision.verdicts.find((v) => v.candidateId === selected.id)?.functionalFit ?? sd.decision.confidence,
    criteriaResults: sd.decision.criteriaResults.filter((r) => r.candidateId === selected.id),
    decisionMetadata: sd.decision.decisionMetadata,
    sources: selected.evidence.slice(0, 8).map((e) => ({ url: e.sourceUrl, type: e.sourceType, claim: e.claimType })),
    optional: !req.required,
    coveredSlots: old?.coveredSlots ?? [],
  };
  const idx = components.findIndex((c) => c.slotId === slotId);
  if (idx >= 0) components[idx] = component;
  else components.push(component);
  emit({ type: "technology.selected", slotId, group: req.group, technologyId: selected.id, slug: selected.slug, name: selected.name, color: u.color, iconPath: u.iconPath, domain: u.domain, monogram: u.monogram, confidence: component.confidence });
  emit({ type: "stack.component.ready", component });

  // Re-evaluate dependent slots (neighbors in the requirement graph) so integration fit reflects the swap.
  const neighbors = new Set<string>();
  for (const e of architecture.requirementGraph.edges) {
    if (e.from === slotId) neighbors.add(e.to);
    if (e.to === slotId) neighbors.add(e.from);
  }
  const dependentSlots = [...neighbors].filter((s) => s !== "hosting" && s !== "ci-cd" && s !== "monitoring" && components.some((c) => c.slotId === s));
  const reevaluated: string[] = [];
  emit({ type: "stack.validation.started", componentCount: components.length });
  for (const depSlot of dependentSlots.slice(0, 4)) {
    const depReq = architecture.requirementGraph.requirements.find((r) => r.id === depSlot);
    const current = components.find((c) => c.slotId === depSlot);
    if (!depReq || !current) continue;
    projectContext.selectedSoFar = components.filter((c) => c.slotId !== depSlot).map((c) => ({ slot: c.slotLabel, name: c.name, slug: c.slug }));
    const dsd = await decideSlot(depReq, projectContext, constraints, criteria, engine, { signal: opts.signal });
    if (dsd.selected && dsd.selected.id !== current.technologyId) {
      emit({ type: "stack.component.removed", slotId: depSlot, technologyId: current.technologyId, reason: `re-evaluated after switching to ${selected.name}` });
      const du = toUniverseTech(dsd.selected);
      const ex = explainSelection(intent, depReq, dsd.selected, dsd.decision, constraints, projectContext.selectedSoFar, new Map(dsd.ranked.map((r) => [r.tech.id, r.tech.name])));
      const nc: StackComponent = {
        ...current,
        technologyId: dsd.selected.id,
        slug: dsd.selected.slug,
        name: dsd.selected.name,
        color: du.color,
        iconPath: du.iconPath,
        domain: du.domain,
        monogram: du.monogram,
        whyHere: ex.whyHere,
        tradeoff: ex.tradeoff,
        alternatives: buildAlternatives(dsd, dsd.selected),
        confidence: dsd.decision.confidence,
        criteriaResults: dsd.decision.criteriaResults.filter((r) => r.candidateId === dsd.selected!.id),
        decisionMetadata: dsd.decision.decisionMetadata,
        sources: dsd.selected.evidence.slice(0, 8).map((e) => ({ url: e.sourceUrl, type: e.sourceType, claim: e.claimType })),
      };
      components[components.findIndex((c) => c.slotId === depSlot)] = nc;
      reevaluated.push(depSlot);
      emit({ type: "technology.selected", slotId: depSlot, group: depReq.group, technologyId: nc.technologyId, slug: nc.slug, name: nc.name, color: nc.color, iconPath: nc.iconPath, domain: du.domain, monogram: nc.monogram, confidence: nc.confidence });
      emit({ type: "stack.component.ready", component: nc });
    }
  }
  const opt = await optimizeStack({ intent, projectContext, constraints, requirements: architecture.requirementGraph.requirements, components, techById, engine, signal: opts.signal });
  const issues = opt.issues.filter((i) => i.kind !== "unnecessary");
  // Merge duplicate technologies (e.g. the swapped-in backend is already the frontend framework).
  for (const rm of opt.removeSlots) {
    const idx = components.findIndex((c) => c.slotId === rm.slotId);
    if (idx < 0) continue;
    const [c] = components.splice(idx, 1);
    const keeper = components.find((k) => k.technologyId === c.technologyId);
    if (keeper) {
      keeper.coveredSlots.push({ slotId: c.slotId, label: c.slotLabel }, ...c.coveredSlots);
      keeper.role = [keeper.slotLabel, ...keeper.coveredSlots.map((x) => x.label)].join(" · ");
    }
    emit({ type: "stack.component.removed", slotId: c.slotId, technologyId: c.technologyId, reason: rm.reason });
  }
  for (const c of components) c.snippet = snippetFor(c, { request: architecture.request, components, intent });
  components.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  emit({ type: "stack.validation.completed", issues, removed: [], reevaluated });
  const present = new Set(components.map((c) => c.slotId));
  const nextId = `arch_${Math.random().toString(36).slice(2, 10)}`;
  if (intent.interpretation?.objectives) traceObjectives(intent, components);
  const turns = architecture.thread?.turns?.length ? architecture.thread.turns.map((t, i, all) => (i === all.length - 1 ? { ...t, architectureId: nextId } : t)) : [{ request: architecture.request, architectureId: nextId, createdAt: new Date().toISOString() }];
  const next: Architecture = {
    ...architecture,
    id: nextId,
    thread: { id: architecture.thread?.id ?? `thr_${Math.random().toString(36).slice(2, 12)}`, turns },
    suggestions: intent.interpretation ? buildSuggestions(intent, components) : [],
    createdAt: new Date().toISOString(),
    components,
    edges: architecture.requirementGraph.edges.filter((e) => present.has(e.from) && present.has(e.to)),
    issues,
    intent: { ...intent, constraints },
  };
  if (opts.persist !== false) {
    try {
      await saveArchitecture(next);
    } catch (err) {
      console.warn("[architect] could not persist architecture:", (err as Error).message);
    }
  }
  emit({ type: "stack.completed", architecture: next });
  return next;
}

/** Record which block delivers each primary objective (directly or by covering its slot). */
function traceObjectives(intent: IntentAnalysis, components: StackComponent[]) {
  for (const o of intent.interpretation.objectives) {
    o.servedBy = undefined;
    if (!o.capability) continue;
    const c = components.find((x) => x.slotId === o.capability || x.coveredSlots.some((s) => s.slotId === o.capability));
    if (c) o.servedBy = { slotId: c.slotId, technologyId: c.technologyId, name: c.name };
  }
}

export type { ArchitectEvent };
