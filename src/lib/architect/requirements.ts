import { CAPABILITIES, CAPABILITY_BY_ID, GROUP_ORDER } from "@/lib/taxonomy";
import type { IntentAnalysis, Requirement, RequirementGraph } from "@/lib/types";
import { PIN_MIN_CONFIDENCE } from "./intent";

const OPTIONAL_THRESHOLD = 0.7;
const BASELINE_THRESHOLD = 0.3;

/**
 * Turn an intent analysis into an architecture requirement graph. Each
 * requirement is a slot that retrieval fills with candidates.
 */
export function buildRequirementGraph(intent: IntentAnalysis): RequirementGraph {
  const needs = { ...intent.needs };
  const c = (kind: string) => intent.constraints.find((x) => x.kind === kind)?.value;
  const hosting = c("hosting-model");
  const cloud = c("cloud");
  const language = c("language");
  const local = c("ai") === "local" || hosting === "local";
  const oss = c("open-source") === "required";

  // Mobile resolution: prefer one cross-platform slot when both platforms or a generic "mobile app" is wanted.
  const ios = needs["ios-client"] ?? 0;
  const android = needs["android-client"] ?? 0;
  const xplat = needs["cross-platform-mobile"] ?? 0;
  const wantsBoth = ios > OPTIONAL_THRESHOLD && android > OPTIONAL_THRESHOLD;
  // The cross-platform question is conditional ("would one codebase serve both?"), so it only counts when mobile is wanted.
  const mobileWanted = Boolean(c("mobile")) || ios > OPTIONAL_THRESHOLD || android > OPTIONAL_THRESHOLD;
  if (mobileWanted && (wantsBoth || (xplat > OPTIONAL_THRESHOLD && ios < 0.8 && android < 0.8) || (c("mobile") && ios < OPTIONAL_THRESHOLD && android < OPTIONAL_THRESHOLD))) {
    needs["cross-platform-mobile"] = Math.max(xplat, 0.8);
    needs["ios-client"] = 0;
    needs["android-client"] = 0;
  } else {
    needs["cross-platform-mobile"] = 0;
  }

  // Local AI: the inference slot becomes local serving; no separate hosted slot, no GPU cloud unless asked.
  if (local) {
    needs["local-inference"] = Math.max(needs["local-inference"] ?? 0, 0.9);
    needs["llm-inference"] = 0;
    if (!/gpu cloud|serverless gpu|rent/i.test(intent.request)) needs["gpu-compute"] = Math.min(needs["gpu-compute"] ?? 0, 0.4);
  } else {
    needs["local-inference"] = Math.min(needs["local-inference"] ?? 0, 0.5);
  }
  // Vector retrieval implies embeddings; orchestration & evaluation imply inference.
  if ((needs["vector-db"] ?? 0) > OPTIONAL_THRESHOLD) needs["embeddings"] = Math.max(needs["embeddings"] ?? 0, 0.8);
  if ((needs["embeddings"] ?? 0) > OPTIONAL_THRESHOLD && (needs["vector-db"] ?? 0) < OPTIONAL_THRESHOLD) needs["vector-db"] = Math.max(needs["vector-db"] ?? 0, 0.65);
  if ((needs["ai-orchestration"] ?? 0) > OPTIONAL_THRESHOLD && (needs["llm-inference"] ?? 0) < 0.5 && !local) needs["llm-inference"] = 0.8;
  if ((needs["llm-inference"] ?? 0) < 0.5 && (needs["local-inference"] ?? 0) < 0.5) {
    needs["ai-orchestration"] = 0;
    needs["ai-evaluation"] = 0;
  }
  // Workers imply a queue only when no durable-execution product will cover both; keep both slots and let the optimizer prune.
  if ((needs["workers"] ?? 0) > OPTIONAL_THRESHOLD) needs["queue"] = Math.max(needs["queue"] ?? 0, 0.65);
  // Streaming only when clearly large-scale; otherwise the queue covers it.
  if ((needs["streaming"] ?? 0) > OPTIONAL_THRESHOLD && c("traffic") !== "large") needs["streaming"] = 0.5;
  // ORM only when there is a relational database and an app backend, and only when strongly indicated.
  if ((needs["relational-db"] ?? 0) < BASELINE_THRESHOLD || (needs["api-backend"] ?? 0) < BASELINE_THRESHOLD) needs["orm"] = 0;
  else needs["orm"] = Math.min(needs["orm"] ?? 0, 0.65);
  // ETL / warehouse / analytics only when clearly a data product or explicitly requested.
  if (intent.productKind !== "data_platform") {
    needs["etl"] = Math.min(needs["etl"] ?? 0, /\b(etl|elt|data pipelines?|warehouse|dbt|lakehouse)\b/i.test(intent.request) ? 1 : 0.6);
    needs["data-warehouse"] = Math.min(needs["data-warehouse"] ?? 0, /\b(warehouse|analytics platform|bi|reporting|olap)\b/i.test(intent.request) ? 1 : 0.6);
  }
  // Auth only when the product clearly has users (pipelines and internal batch systems do not).
  if ((intent.needs["authentication"] ?? 0) < 0.55) needs["authentication"] = 0;
  // CDN is implicit in Vercel/Cloudflare/Netlify hosting.
  if (hosting === "managed-platform" || cloud === "vercel" || cloud === "cloudflare") needs["cdn"] = Math.min(needs["cdn"] ?? 0, 0.5);
  // IaC and secrets only for own-cloud/self-hosted/compliance situations.
  const compliance = intent.constraints.some((x) => x.kind === "compliance");
  if (!(hosting === "own-cloud" || hosting === "self-hosted" || cloud === "aws" || cloud === "gcp" || cloud === "azure" || compliance)) {
    needs["infrastructure-as-code"] = Math.min(needs["infrastructure-as-code"] ?? 0, 0.5);
    needs["secrets"] = Math.min(needs["secrets"] ?? 0, 0.5);
  }
  // Container orchestration only for high ops tolerance.
  if (c("operational-complexity") !== "high" && !/kubernetes|k8s/i.test(intent.request)) needs["container-orchestration"] = Math.min(needs["container-orchestration"] ?? 0, 0.5);
  // Compliance automation and testing only when compliance is required or scale is large.
  if (!compliance) needs["compliance-automation"] = Math.min(needs["compliance-automation"] ?? 0, 0.5);
  if (!compliance && c("traffic") !== "large") needs["testing"] = Math.min(needs["testing"] ?? 0, 0.5);
  // Pure pipelines: no frontend.
  if (intent.productKind === "data_platform" && intent.needs["web-frontend"] < 0.5) needs["web-frontend"] = intent.needs["web-frontend"];
  // Technologies the user explicitly wants or already runs always get their slot, overriding the demotions above.
  for (const m of intent.mentions) {
    if ((m.role === "preferred" || m.role === "existing-keep") && m.capability && m.confidence >= PIN_MIN_CONFIDENCE) needs[m.capability] = Math.max(needs[m.capability] ?? 0, 0.95);
  }

  const requirements: Requirement[] = [];
  for (const cap of CAPABILITIES) {
    const p = needs[cap.id] ?? 0;
    const threshold = cap.baseline ? BASELINE_THRESHOLD : OPTIONAL_THRESHOLD;
    if (p < threshold) continue;
    requirements.push({
      id: cap.id,
      group: cap.group,
      label: cap.label,
      capability: cap.id,
      description: describe(cap.id, intent, { hosting, cloud, language, local, oss }),
      required: Boolean(cap.baseline) || p >= 0.85,
      probability: Number(p.toFixed(2)),
      dependsOn: cap.dependsOn ?? [],
      queryText: cap.query + (local && (cap.id === "embeddings" || cap.id === "vector-db") ? " local self-hosted" : ""),
      categories: cap.categories,
    });
  }
  requirements.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || b.probability - a.probability);

  const ids = new Set(requirements.map((r) => r.id));
  const edges: RequirementGraph["edges"] = [];
  const link = (from: string, to: string, relation: string) => {
    if (ids.has(from) && ids.has(to)) edges.push({ from, to, relation });
  };
  for (const client of ["web-frontend", "ios-client", "android-client", "cross-platform-mobile", "desktop-client"]) link(client, "api-backend", "calls");
  link("api-backend", "authentication", "uses");
  link("api-backend", "authorization", "enforces");
  link("api-backend", "relational-db", "persists to");
  link("api-backend", "nosql-db", "persists to");
  link("api-backend", "orm", "queries via");
  link("orm", "relational-db", "maps");
  link("api-backend", "cache", "caches in");
  link("api-backend", "object-storage", "stores files in");
  link("api-backend", "search-engine", "searches");
  link("api-backend", "realtime", "pushes via");
  link("api-backend", "payments", "bills via");
  link("api-backend", "email", "sends via");
  link("api-backend", "notifications", "notifies via");
  link("api-backend", "llm-inference", "calls");
  link("api-backend", "local-inference", "calls");
  link("api-backend", "ai-orchestration", "orchestrates with");
  link("ai-orchestration", "llm-inference", "calls");
  link("ai-orchestration", "local-inference", "calls");
  link("ai-orchestration", "vector-db", "retrieves from");
  link("embeddings", "vector-db", "feeds");
  link("api-backend", "vector-db", "queries");
  link("llm-inference", "ai-evaluation", "traced by");
  link("local-inference", "gpu-compute", "runs on");
  link("llm-inference", "gpu-compute", "runs on");
  link("api-backend", "queue", "enqueues");
  link("queue", "workers", "feeds");
  link("scheduler", "workers", "triggers");
  link("scheduler", "queue", "triggers");
  link("workers", "llm-inference", "calls");
  link("workers", "embeddings", "computes");
  link("workers", "web-search-api", "fetches from");
  link("workers", "ocr-documents", "parses with");
  link("workers", "browser-automation", "drives");
  link("streaming", "workers", "feeds");
  link("etl", "data-warehouse", "loads");
  link("api-backend", "hosting", "deployed on");
  link("web-frontend", "hosting", "deployed on");
  link("workers", "hosting", "deployed on");
  link("hosting", "cdn", "fronted by");
  link("hosting", "container-orchestration", "runs on");
  link("ci-cd", "hosting", "deploys to");
  link("monitoring", "api-backend", "observes");
  link("infrastructure-as-code", "hosting", "provisions");
  link("secrets", "api-backend", "supplies");
  link("api-backend", "feature-flags", "reads");
  link("api-backend", "maps", "uses");
  link("api-backend", "speech", "calls");
  link("telephony", "api-backend", "streams calls to");
  link("telephony", "speech", "transcribes with");
  link("api-backend", "image-generation", "calls");
  link("api-backend", "video-generation", "calls");
  link("workers", "video-generation", "renders with");
  link("api-backend", "ecommerce", "uses");
  link("api-backend", "api-gateway", "fronted by");
  link("web-frontend", "cms", "reads from");
  link("api-backend", "analytics", "tracks to");
  link("web-frontend", "analytics", "tracks to");
  link("compliance-automation", "hosting", "audits");
  link("testing", "ci-cd", "runs in");
  link("dns", "cdn", "routes to");
  return { requirements, edges };
}

function describe(cap: string, intent: IntentAnalysis, ctx: { hosting?: string; cloud?: string; language?: string; local: boolean; oss: boolean }): string {
  const def = CAPABILITY_BY_ID.get(cap)!;
  const product = intent.summary.replace(/\.$/, "");
  const scale = intent.constraints.find((c) => c.kind === "traffic")?.value;
  switch (cap) {
    case "web-frontend":
      return `A web user interface for ${product}${ctx.language ? `, ideally in the ${ctx.language} ecosystem` : ""}.`;
    case "api-backend":
      return `An application backend / API that serves the clients, owns business logic and talks to the data and AI layers${ctx.language ? ` (preferred language: ${ctx.language})` : ""}.`;
    case "authentication":
      return "User sign-up, login and session management for the product's users.";
    case "relational-db":
      return `Primary transactional persistence for users, accounts and application data${scale === "large" ? " at large scale" : ""}.`;
    case "cache":
      return "In-memory cache for hot data, sessions, rate limits and ephemeral state.";
    case "vector-db":
      return `Vector similarity search over embeddings for semantic retrieval${ctx.local ? ", running locally alongside the app" : ""}.`;
    case "embeddings":
      return `Embedding generation for the content that must be semantically retrievable${ctx.local ? ", computed locally without a hosted API" : ""}.`;
    case "llm-inference":
      return `Access to a large language model for the product's generative and understanding features${ctx.cloud ? ` (cloud preference: ${ctx.cloud})` : ""}.`;
    case "local-inference":
      return "Serving language and embedding models locally on the user's own hardware, without a hosted API.";
    case "gpu-compute":
      return "GPU compute for model serving, fine-tuning or media generation.";
    case "queue":
      return "Asynchronous job distribution between the API and background workers.";
    case "workers":
      return "Durable background execution for ingestion, processing and AI jobs with retries.";
    case "scheduler":
      return "Recurring scheduled jobs (ingestion runs, digests, maintenance).";
    case "hosting":
      return `Deployment target for the application${ctx.hosting ? ` (${ctx.hosting.replace("-", " ")})` : ""}${ctx.cloud ? ` on ${ctx.cloud.toUpperCase()}` : ""}.`;
    case "monitoring":
      return "Error tracking, logs and metrics for production operation.";
    case "ci-cd":
      return "Source control and a build/deploy pipeline for the team.";
    case "object-storage":
      return "Durable storage for uploaded and generated files and media.";
    case "realtime":
      return "Pushing live updates to connected clients.";
    default:
      return `${def.description} for ${product}.`;
  }
}
