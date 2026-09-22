/**
 * Decision-quality evaluation: realistic requests with expectations a senior
 * architect would hold. Run: npm run eval  (JSON=1 for machine output, ONLY=substring to filter)
 */
import "./env";
import { runArchitect } from "@/lib/architect";
import type { Architecture } from "@/lib/types";

interface Case {
  name: string;
  request: string;
  /** Every group must contain at least one of these slugs somewhere in the stack. */
  mustIncludeAny?: string[][];
  /** None of these slugs may appear. */
  mustExclude?: string[];
  /** Slots that must be present (directly or covered by another block). */
  slots?: string[];
  /** Slots that must NOT be present. */
  noSlots?: string[];
  maxComponents?: number;
  minComponents?: number;
  hardConstraint?: string[]; // constraint kinds expected hard
  requestKind?: string;
  allOpenSource?: boolean;
  /** Expected archetype id, or any of several. */
  archetype?: string[];
  vague?: boolean;
  route?: string;
}

const CASES: Case[] = [
  { name: "ai-news", request: "Build the stack for a real-time AI news application", slots: ["web-frontend", "api-backend", "llm-inference", "hosting", "web-search-api"], minComponents: 7, maxComponents: 15 },
  { name: "hipaa", request: "I need a HIPAA-oriented healthcare SaaS platform", slots: ["authentication", "relational-db", "hosting", "monitoring"], hardConstraint: ["compliance"], mustExclude: ["firebase", "heroku"], maxComponents: 15 },
  { name: "cheap-startup", request: "Build a cheap stack for a two-person startup", maxComponents: 10, mustExclude: ["kubernetes", "datadog", "snowflake", "apache-kafka", "terraform"], noSlots: ["container-orchestration", "streaming", "data-warehouse"] },
  { name: "local-rag", request: "I need a local-first RAG application running on NVIDIA hardware", slots: ["local-inference", "vector-db", "embeddings"], noSlots: ["llm-inference"], mustExclude: ["openai", "pinecone", "anthropic", "vercel"], hardConstraint: ["ai"] },
  { name: "ios-social", request: "What's the best stack for an iOS social network expecting 500,000 users?", slots: ["api-backend", "authentication", "object-storage", "notifications"], mustIncludeAny: [["swift", "expo", "react-native", "flutter"]], mustExclude: ["electron"] },
  { name: "video-pipeline", request: "Build me an autonomous video generation pipeline", slots: ["video-generation", "workers", "object-storage"], mustIncludeAny: [["modal", "replicate", "fal-ai", "runway", "luma-ai", "google-gemini"]] },
  { name: "replace-firebase", request: "Replace Firebase in my existing stack", requestKind: "replace-component", mustExclude: ["firebase", "firebase-auth", "firebase-cloud-messaging"] },
  { name: "aws-fintech", request: "AI-native fintech stack on AWS with PCI compliance for card payments", hardConstraint: ["cloud", "compliance"], slots: ["payments", "relational-db", "llm-inference"], mustExclude: ["google-cloud", "azure", "cloud-sql", "azure-sql", "vercel", "firebase"] },
  { name: "oss-selfhost", request: "Fully open source, self-hosted project management SaaS for teams", allOpenSource: true, hardConstraint: ["open-source"], mustExclude: ["vercel", "clerk", "auth0", "pinecone", "datadog"] },
  { name: "python-ml", request: "Python backend for a document Q&A product over uploaded PDFs, team knows Django", mustIncludeAny: [["django"]], slots: ["ocr-documents", "vector-db", "object-storage"], mustExclude: ["express", "nestjs"] },
  { name: "realtime-collab", request: "A Figma-like real-time collaborative whiteboard for the web", slots: ["realtime", "web-frontend"], noSlots: ["llm-inference", "vector-db"] },
  { name: "ecommerce", request: "Headless e-commerce store for a fashion brand with search and payments", slots: ["ecommerce", "payments", "search-engine", "cms"] },
  { name: "data-platform", request: "Analytics data platform ingesting 50M events per day into a warehouse with dbt", slots: ["data-warehouse", "etl"], mustIncludeAny: [["dbt"]], noSlots: ["ios-client"] },
  { name: "eu-gdpr", request: "B2B SaaS for European customers, data must stay in the EU, GDPR", hardConstraint: ["data-residency", "compliance"] },
  { name: "voice-agent", request: "Voice AI agent that answers phone calls for restaurants", slots: ["speech", "llm-inference", "telephony"], mustIncludeAny: [["twilio", "telnyx", "livekit", "vapi", "retell-ai"]] },
  { name: "pipeline-no-users", request: "A nightly batch pipeline that scrapes competitor prices and writes a report to S3", noSlots: ["authentication", "web-frontend", "payments"], slots: ["scheduler", "object-storage"] },
  { name: "follow-up-oss", request: "Build a cheap stack for a two-person startup. Follow-up: make it entirely open source", allOpenSource: true },
  { name: "greeting", request: "hello", vague: true, minComponents: 4, slots: ["web-frontend", "api-backend", "relational-db", "hosting"] },
  { name: "two-words", request: "todo app", vague: true, archetype: ["todo_productivity"], slots: ["authentication", "relational-db"], minComponents: 5, maxComponents: 10 },
  { name: "one-word", request: "marketplace", archetype: ["marketplace"], slots: ["payments", "search-engine"] },
  { name: "question", request: "What's the best vector database for a RAG app?", route: "reference-stack", slots: ["vector-db", "llm-inference"] },
  { name: "kubernetes-scale", request: "Microservices platform on Kubernetes for a 40-engineer team with Go services and Kafka", mustIncludeAny: [["go", "gin"], ["apache-kafka", "confluent", "redpanda"], ["kubernetes"]], hardConstraint: ["language"] },
];

function slugsOf(a: Architecture) {
  return new Set(a.components.map((c) => c.slug));
}
function slotsOf(a: Architecture) {
  return new Set(a.components.flatMap((c) => [c.slotId, ...c.coveredSlots.map((s) => s.slotId)]));
}

async function main() {
  const only = process.env.ONLY;
  const cases = CASES.filter((c) => !only || c.name.includes(only));
  const { listTechnologies } = await import("@/lib/db/repo");
  const techs = new Map((await listTechnologies()).map((t) => [t.slug, t]));
  const results: Array<{ name: string; ok: boolean; failures: string[]; stack: string[]; ms: number; tokens: number; issues: string[]; brief?: string }> = [];
  const runOne = async (c: Case) => {
    const t0 = Date.now();
    const failures: string[] = [];
    let arch: Architecture;
    try {
      arch = await runArchitect(c.request, { persist: false });
    } catch (e) {
      results.push({ name: c.name, ok: false, failures: [`threw: ${(e as Error).message}`], stack: [], ms: Date.now() - t0, tokens: 0, issues: [] });
      return;
    }
    const slugs = slugsOf(arch);
    const slots = slotsOf(arch);
    for (const group of c.mustIncludeAny ?? []) if (!group.some((s) => slugs.has(s))) failures.push(`missing one of [${group.join(", ")}]`);
    for (const s of c.mustExclude ?? []) if (slugs.has(s)) failures.push(`should exclude ${s}`);
    for (const s of c.slots ?? []) if (!slots.has(s)) failures.push(`missing slot ${s}`);
    for (const s of c.noSlots ?? []) if (slots.has(s)) failures.push(`unexpected slot ${s}`);
    if (c.maxComponents && arch.components.length > c.maxComponents) failures.push(`too many components ${arch.components.length} > ${c.maxComponents}`);
    if (c.minComponents && arch.components.length < c.minComponents) failures.push(`too few components ${arch.components.length} < ${c.minComponents}`);
    for (const k of c.hardConstraint ?? []) if (!arch.intent.constraints.some((x) => x.kind === k && x.severity === "hard")) failures.push(`missing hard constraint ${k}`);
    if (c.requestKind && arch.intent.requestKind !== c.requestKind) failures.push(`requestKind ${arch.intent.requestKind} != ${c.requestKind}`);
    const it = arch.intent.interpretation;
    if (!it?.enhancedRequest || it.enhancedRequest.length < 40) failures.push("no enhanced brief");
    if (arch.components.length === 0) failures.push("request was not built");
    if (c.vague !== undefined && it.vague !== c.vague) failures.push(`vague=${it.vague}, expected ${c.vague}`);
    if (c.archetype && !c.archetype.includes(it.archetype)) failures.push(`archetype ${it.archetype}, expected ${c.archetype.join("|")}`);
    if (c.route && it.route !== c.route) failures.push(`route ${it.route}, expected ${c.route}`);
    if (c.allOpenSource) for (const comp of arch.components) if (techs.get(comp.slug)?.openSource === false) failures.push(`${comp.name} is proprietary`);
    // Universal quality checks
    const ids = arch.components.map((x) => x.technologyId);
    if (new Set(ids).size !== ids.length) failures.push("duplicate technology blocks");
    for (const comp of arch.components) {
      if (!comp.whyHere.includes(comp.name)) failures.push(`${comp.name}: explanation does not name it`);
      if (comp.alternatives.length === 0) failures.push(`${comp.name}: no alternatives`);
      if (/undefined|NaN|\[object/.test(comp.whyHere + comp.tradeoff)) failures.push(`${comp.name}: broken text`);
    }
    results.push({
      name: c.name,
      ok: failures.length === 0,
      failures,
      brief: arch.intent.interpretation?.enhancedRequest ?? "",
      stack: arch.components.map((x) => `${x.slotId}=${x.slug}${x.coveredSlots.length ? `(+${x.coveredSlots.map((s) => s.slotId).join(",")})` : ""}`),
      ms: Date.now() - t0,
      tokens: arch.stats.inputTokens,
      issues: arch.issues.filter((i) => i.severity !== "info").map((i) => i.message),
    });
  };
  // Modest parallelism to respect rate limits.
  for (let i = 0; i < cases.length; i += 4) await Promise.all(cases.slice(i, i + 4).map(runOne));
  results.sort((a, b) => CASES.findIndex((c) => c.name === a.name) - CASES.findIndex((c) => c.name === b.name));
  if (process.env.JSON === "1") {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name.padEnd(18)} ${(r.ms / 1000).toFixed(1)}s ${r.tokens} tok  ${r.stack.join(" ")}`);
      if (process.env.BRIEFS === "1" && r.brief) console.log(`     » ${r.brief}`);
      for (const f of r.failures) console.log(`     ✗ ${f}`);
      for (const i of r.issues) console.log(`     ! ${i}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} cases passed`);
  process.exit(passed === results.length ? 0 : 1);
}
main();
