/**
 * Hybrid retrieval: BM25 + semantic + taxonomy + capability + constraint
 * satisfaction + maturity + evidence freshness + adoption signals.
 *
 * Retrieval answers "how relevant might this technology be?" It never
 * decides. It returns ~10-30 candidates per slot for the decision engine.
 */
import { listTechnologies } from "@/lib/db/repo";
import { cosine, getEmbeddingProvider, technologyEmbeddingText } from "@/lib/embeddings";
import { CAPABILITY_BY_ID } from "@/lib/taxonomy";
import type { CandidateSummary, Constraint, ProjectContext, Requirement, Technology } from "@/lib/types";
import { BM25Index } from "./bm25";

interface Index {
  version: string;
  techs: Technology[];
  byId: Map<string, Technology>;
  bm25: BM25Index;
  embeddings: Map<string, number[]>;
}

let index: Index | null = null;

export async function getIndex(): Promise<Index> {
  const techs = await listTechnologies();
  const version = `${techs.length}:${techs.reduce((m, t) => (t.lastUpdatedAt > m ? t.lastUpdatedAt : m), "")}`;
  if (index && index.version === version) return index;
  const provider = getEmbeddingProvider();
  const embeddings = new Map<string, number[]>();
  const missing: Technology[] = [];
  for (const t of techs) {
    if (t.semanticEmbedding && t.embeddingProvider === provider.id && t.semanticEmbedding.length === provider.dimensions) {
      embeddings.set(t.id, t.semanticEmbedding);
    } else {
      missing.push(t);
    }
  }
  if (missing.length) {
    // Compute in-memory (persisted by the pipeline's EMBED stage).
    const vecs = await provider.embed(missing.map(technologyEmbeddingText));
    missing.forEach((t, i) => embeddings.set(t.id, vecs[i]));
  }
  index = {
    version,
    techs,
    byId: new Map(techs.map((t) => [t.id, t])),
    bm25: new BM25Index(techs.map((t) => ({ id: t.id, text: technologyEmbeddingText(t) }))),
    embeddings,
  };
  return index;
}

export function invalidateRetrievalIndex() {
  index = null;
}

export interface RetrievalOptions {
  limit?: number;
  excludeIds?: string[];
}

export interface ScoredCandidate {
  tech: Technology;
  score: number;
  reasons: string[];
  signals: Record<string, number>;
}

const CLOUD_ALIASES: Record<string, string[]> = {
  aws: ["aws", "amazon"],
  gcp: ["gcp", "google"],
  azure: ["azure", "microsoft"],
  cloudflare: ["cloudflare"],
  vercel: ["vercel"],
};

function hardConstraintCheck(t: Technology, constraints: Constraint[], requirement?: Requirement): { ok: boolean; reasons: string[]; bonus: number } {
  const reasons: string[] = [];
  let bonus = 0;
  let ok = true;
  for (const c of constraints) {
    const isHard = c.severity === "hard";
    switch (c.kind) {
      case "open-source": {
        if (c.value === "required") {
          if (t.openSource === true) {
            bonus += 0.15;
            reasons.push("open source");
          } else if (isHard) {
            ok = false;
            reasons.push("not open source");
          }
        } else if (c.value === "preferred" && t.openSource) {
          bonus += 0.08;
        }
        break;
      }
      case "self-hosting":
      case "hosting-model": {
        const wantsSelf = c.value === "self-hosted" || c.value === "local";
        if (wantsSelf) {
          const can = t.deploymentModels.includes("self-hosted") || t.deploymentModels.includes("on-device");
          if (can) {
            bonus += 0.12;
            reasons.push("self-hostable");
          } else if (isHard && t.deploymentModels.length) {
            ok = false;
            reasons.push("managed-only");
          }
        } else if (c.value === "serverless" || c.value === "edge") {
          if (t.deploymentModels.includes("serverless") || t.deploymentModels.includes("edge") || t.deploymentModels.includes("managed-cloud")) bonus += 0.06;
        }
        break;
      }
      case "cloud": {
        const aliases = CLOUD_ALIASES[c.value] ?? [c.value];
        const onCloud = t.supportedClouds.some((x) => aliases.includes(x)) || aliases.some((a) => t.slug.includes(a) || (t.companyName ?? "").toLowerCase().includes(a));
        if (onCloud) {
          bonus += 0.15;
          reasons.push(`${c.value} native`);
        } else if (t.supportedClouds.length && !t.deploymentModels.includes("self-hosted")) {
          // managed service tied to another cloud
          const otherCloud = t.supportedClouds.every((x) => !aliases.includes(x)) && t.supportedClouds.length <= 2;
          if (otherCloud) bonus -= isHard ? 0.4 : 0.15;
        }
        break;
      }
      case "language": {
        // A backend language preference says nothing about the browser or mobile client.
        if (requirement?.group === "EXPERIENCE") break;
        if (t.supportedLanguages.length) {
          if (t.supportedLanguages.includes(c.value)) {
            bonus += 0.12;
            reasons.push(`${c.value} support`);
          } else if (t.type === "framework" || t.type === "library") {
            if (isHard) {
              ok = false;
              reasons.push(`no ${c.value} support`);
            } else bonus -= 0.25;
          }
        }
        break;
      }
      case "compliance": {
        const need = c.value.toUpperCase();
        if (t.compliance.map((x) => x.toUpperCase()).includes(need)) {
          bonus += 0.12;
          reasons.push(`${c.value} documented`);
        } else if (t.type === "service" || t.type === "platform") {
          bonus -= isHard ? 0.12 : 0.05;
        }
        break;
      }
      case "budget": {
        if (c.value === "minimal") {
          if (t.freeTier || t.openSource) {
            bonus += 0.1;
            reasons.push("free tier");
          } else if (t.pricingModel === "enterprise" || t.pricingModel === "subscription") bonus -= 0.15;
        }
        break;
      }
      case "gpu":
      case "ai": {
        if (c.value === "local" || c.value === "nvidia") {
          if (t.tags.includes("nvidia") || t.tags.includes("local") || t.deploymentModels.includes("on-device")) {
            bonus += 0.15;
            reasons.push("runs locally");
          }
        }
        break;
      }
      case "existing-technology": {
        if (t.slug === c.value) {
          bonus += 0.5;
          reasons.push("already in your stack");
        }
        break;
      }
      case "operational-complexity": {
        if (c.value === "minimal" && t.tags.includes("heavy")) bonus -= 0.2;
        if (c.value === "minimal" && (t.deploymentModels.includes("managed-cloud") || t.deploymentModels.includes("serverless"))) bonus += 0.03;
        break;
      }
      case "data-residency":
      case "geography": {
        if (c.value === "eu" && (t.regions.includes("eu") || t.tags.includes("eu"))) {
          bonus += 0.1;
          reasons.push("EU availability");
        }
        break;
      }
      default:
        break;
    }
  }
  return { ok, reasons, bonus };
}

const MATURITY_SCORE: Record<Technology["maturity"], number> = {
  established: 1,
  growing: 0.8,
  emerging: 0.55,
  experimental: 0.3,
  legacy: 0.45,
  unknown: 0.5,
};

export async function retrieveCandidates(
  requirement: Requirement,
  projectContext: ProjectContext,
  constraints: Constraint[],
  opts: RetrievalOptions = {},
): Promise<ScoredCandidate[]> {
  const idx = await getIndex();
  const provider = getEmbeddingProvider();
  const capDef = CAPABILITY_BY_ID.get(requirement.capability);
  const query = `${requirement.queryText} ${requirement.description} ${projectContext.productKind}`;
  const [qvec] = await provider.embed([query]);
  const bm25 = new Map(idx.bm25.search(query, 200).map((r) => [r.id, r.score]));
  const maxBm25 = Math.max(1e-6, ...bm25.values());
  const exclude = new Set(opts.excludeIds ?? []);
  const avoid = new Set(constraints.filter((c) => c.kind === "existing-technology" && c.value.startsWith("avoid:")).map((c) => c.value.slice(6)));

  const scored: ScoredCandidate[] = [];
  for (const t of idx.techs) {
    if (exclude.has(t.id) || avoid.has(t.slug)) continue;
    if (t.status === "sunset" || t.status === "deprecated") continue;
    if (t.type === "protocol") continue; // API styles and specs are not deployable components
    const providesCap = t.capabilities.includes(requirement.capability);
    const catOverlap = t.categories.filter((c) => requirement.categories.includes(c) || capDef?.categories.includes(c)).length;
    // Hard gate: a candidate must provide the capability or live in a matching category.
    if (!providesCap && catOverlap === 0) continue;

    const hc = hardConstraintCheck(t, constraints, requirement);
    if (!hc.ok) continue;
    // A hosted-inference slot should not be filled by a local runtime unless local AI was requested.
    const wantsLocal = constraints.some((c) => (c.kind === "ai" && c.value === "local") || (c.kind === "hosting-model" && (c.value === "local" || c.value === "self-hosted")));
    if (requirement.capability === "llm-inference" && !wantsLocal && t.capabilities.includes("local-inference") && !t.deploymentModels.includes("managed-cloud")) hc.bonus -= 0.35;

    const sem = cosine(qvec, idx.embeddings.get(t.id) ?? []);
    const lex = (bm25.get(t.id) ?? 0) / maxBm25;
    const taxonomy = (providesCap ? 0.6 : 0) + Math.min(0.4, catOverlap * 0.2);
    const maturity = MATURITY_SCORE[t.maturity];
    const adoption = t.repositoryStars ? Math.min(1, Math.log10(t.repositoryStars + 1) / 5.5) : 0.5;
    const freshness = t.lastVerifiedAt ? 1 : t.verificationStatus === "seeded" ? 0.7 : 0.5;
    const confidence = t.confidence;
    const integration = projectContext.selectedSoFar.length
      ? projectContext.selectedSoFar.filter((s) => t.integrations.includes(s.slug) || idx.byId.get(`tech_${s.slug}`)?.integrations.includes(t.slug)).length /
        Math.max(1, projectContext.selectedSoFar.length)
      : 0;

    const score =
      0.3 * taxonomy +
      0.2 * sem +
      0.15 * lex +
      0.1 * maturity +
      0.05 * adoption +
      0.05 * freshness +
      0.05 * confidence +
      0.1 * integration +
      hc.bonus;

    const reasons = [...hc.reasons];
    if (providesCap) reasons.push(`provides ${capDef?.label ?? requirement.capability}`);
    if (integration > 0) reasons.push("integrates with selected components");
    if (lex > 0.5) reasons.push("keyword match");
    scored.push({ tech: t, score, reasons, signals: { taxonomy, sem, lex, maturity, adoption, freshness, integration, constraintBonus: hc.bonus } });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 20);
}

export function toCandidateSummary(c: ScoredCandidate): CandidateSummary {
  const t = c.tech;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    shortDescription: t.shortDescription,
    type: t.type,
    categories: t.categories,
    capabilities: t.capabilities,
    openSource: t.openSource,
    license: t.license,
    deploymentModels: t.deploymentModels,
    supportedClouds: t.supportedClouds,
    supportedLanguages: t.supportedLanguages,
    integrations: t.integrations,
    pricingModel: t.pricingModel,
    freeTier: t.freeTier,
    pricingSummary: t.pricingSummary,
    maturity: t.maturity,
    status: t.status,
    compliance: t.compliance,
    retrievalScore: Number(c.score.toFixed(3)),
    retrievalReasons: c.reasons,
  };
}

/** Free-text search over the catalog (used by the /catalog UI and API). */
export async function searchTechnologies(query: string, limit = 30): Promise<Technology[]> {
  const idx = await getIndex();
  if (!query.trim()) return idx.techs.slice(0, limit);
  const provider = getEmbeddingProvider();
  const [qvec] = await provider.embed([query]);
  const bm = new Map(idx.bm25.search(query, 100).map((r) => [r.id, r.score]));
  const max = Math.max(1e-6, ...bm.values());
  const q = query.toLowerCase();
  return idx.techs
    .map((t) => {
      const name = t.name.toLowerCase();
      const nameHit = name === q || t.slug === q ? 1.4 : name.startsWith(q) ? 1.1 : t.aliases.some((a) => a.toLowerCase().startsWith(q)) ? 0.9 : name.includes(q) || t.aliases.some((a) => a.toLowerCase().includes(q)) ? 0.5 : 0;
      return { t, s: 0.5 * ((bm.get(t.id) ?? 0) / max) + 0.3 * cosine(qvec, idx.embeddings.get(t.id) ?? []) + 0.6 * nameHit };
    })
    .filter((x) => x.s > 0.05)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t);
}

/** Find catalog technologies mentioned by name in free text. */
export async function findMentions(text: string): Promise<Technology[]> {
  const idx = await getIndex();
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ")} `;
  const hits: Technology[] = [];
  for (const t of idx.techs) {
    const base = [t.name, ...t.aliases].map((n) => n.toLowerCase().replace(/\s*\(.*?\)\s*/g, " ").trim());
    // "Apache Kafka" is usually just "Kafka"; "Amazon S3" is usually "S3".
    const stripped = base.map((n) => n.replace(/^(apache|amazon|aws|google cloud|google|microsoft|azure|the)\s+/, "")).filter((n) => n.length >= 4 || /\d/.test(n));
    const names = [...new Set([...base, ...stripped, t.slug.replace(/-/g, " ")])].filter((n) => n.length >= 3 || (n.length === 2 && /\d/.test(n)));
    for (const n of names) {
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(n)}([^a-z0-9]|$)`, "i");
      if (GENERIC.has(n)) {
        // Common words count only as a proper noun mid-sentence ("deploy on Render", not "render the page").
        const proper = n.charAt(0).toUpperCase() + n.slice(1);
        const cap = new RegExp(`[^A-Za-z0-9]${escapeRe(proper)}([^A-Za-z0-9]|$)`);
        if (cap.test(text)) {
          hits.push(t);
          break;
        }
        continue;
      }
      if (re.test(lower)) {
        hits.push(t);
        break;
      }
    }
  }
  return hits;
}

/** Names that are also ordinary English words: only matched when capitalized in the original text. */
const GENERIC = new Set(["go", "swift", "rust", "cron", "system cron / platform cron", "react router", "express", "rails", "render", "modal", "segment", "temporal", "knock", "polar", "convex", "resend", "exa", "ably", "bun", "expo", "remix", "cursor", "vault", "prefect", "sanity", "neon", "mux", "unkey", "graphify", "caveman", "headroom", "strix", "ponytail", "archify"]);

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
