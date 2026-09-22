/**
 * Context suggestions for the next turn of a thread: what is still unknown, plausible
 * features the stack does not have yet, and common directions. Chosen in code from the
 * TypeSafe-derived intent; the user picks, edits and submits them.
 */
import type { ContextSuggestion, IntentAnalysis, StackComponent } from "@/lib/types";
import { ARCHETYPE_BY_ID } from "./archetypes";

const UNKNOWN_SUGGESTIONS: Record<string, ContextSuggestion[]> = {
  budget: [
    { label: "Keep it cheap", text: "Keep the cost as low as possible.", kind: "unknown" },
    { label: "Budget is flexible", text: "Budget is not a concern; optimize for reliability.", kind: "unknown" },
  ],
  "expected scale": [
    { label: "~1M users", text: "Expect around 1 million users.", kind: "unknown" },
    { label: "Under 1,000 users", text: "Start small, under 1,000 users.", kind: "unknown" },
  ],
  "team size": [
    { label: "Solo developer", text: "I am a solo developer.", kind: "unknown" },
    { label: "Team of 10", text: "We are a team of 10 engineers.", kind: "unknown" },
  ],
  "hosting preference": [
    { label: "Run on AWS", text: "It must run on AWS.", kind: "unknown" },
    { label: "Self-host it", text: "Everything must be self-hosted.", kind: "unknown" },
  ],
  "programming language": [
    { label: "Python backend", text: "Use Python for the backend.", kind: "unknown" },
    { label: "TypeScript everywhere", text: "Use TypeScript everywhere.", kind: "unknown" },
  ],
};

const FEATURE_SUGGESTIONS: Array<{ cap: string; s: ContextSuggestion }> = [
  { cap: "payments", s: { label: "Add payments", text: "Add subscriptions and payments.", kind: "feature" } },
  { cap: "cross-platform-mobile", s: { label: "Add mobile apps", text: "Add iOS and Android apps.", kind: "feature" } },
  { cap: "llm-inference", s: { label: "Add AI features", text: "Add AI features powered by an LLM.", kind: "feature" } },
  { cap: "realtime", s: { label: "Real-time updates", text: "Updates must appear in real time.", kind: "feature" } },
  { cap: "search-engine", s: { label: "Add search", text: "Add full-text search.", kind: "feature" } },
  { cap: "notifications", s: { label: "Push notifications", text: "Add push notifications.", kind: "feature" } },
  { cap: "analytics", s: { label: "Product analytics", text: "Add product analytics.", kind: "feature" } },
  { cap: "object-storage", s: { label: "File uploads", text: "Users upload files and images.", kind: "feature" } },
  { cap: "email", s: { label: "Email", text: "Send transactional emails.", kind: "feature" } },
];

export function buildSuggestions(intent: IntentAnalysis, components: StackComponent[]): ContextSuggestion[] {
  const present = new Set(components.flatMap((c) => [c.slotId, ...c.coveredSlots.map((s) => s.slotId)]));
  if (present.has("ios-client") || present.has("android-client")) present.add("cross-platform-mobile");
  if (present.has("local-inference")) present.add("llm-inference");
  const has = (kind: string, value?: string) => intent.constraints.some((c) => c.kind === kind && (value === undefined || c.value === value) && c.source === "explicit");
  const archetype = ARCHETYPE_BY_ID.get(intent.interpretation.archetype);
  const out: ContextSuggestion[] = [];

  // 1. What is still unknown (most useful context first).
  for (const unknown of ["expected scale", "budget", "hosting preference", "team size", "programming language"]) {
    if (!intent.unknowns.includes(unknown)) continue;
    out.push(...(UNKNOWN_SUGGESTIONS[unknown] ?? []));
    if (out.length >= 4) break;
  }
  const unknownCount = Math.min(out.length, 4);
  out.length = unknownCount;

  // 2. Plausible features the stack does not have yet.
  const features = FEATURE_SUGGESTIONS.filter(({ cap }) => !present.has(cap) && ((intent.needs[cap] ?? 0) > 0.15 || archetype?.capabilities.includes(cap))).slice(0, 3);
  out.push(...features.map((f) => f.s));

  // 3. Common directions.
  const directions: ContextSuggestion[] = [];
  if (!has("open-source", "required")) directions.push({ label: "Make it open source", text: "Use only open-source, self-hostable components.", kind: "direction" });
  if (!intent.constraints.some((c) => c.kind === "compliance")) directions.push({ label: "Enterprise-ready", text: "We sell to enterprises and need SOC 2 compliance.", kind: "direction" });
  if (!has("budget", "minimal")) directions.push({ label: "Cut the cost", text: "Cut the cost wherever possible.", kind: "direction" });
  if (!has("traffic", "large")) directions.push({ label: "Optimize for scale", text: "Optimize for high scale and availability.", kind: "direction" });
  out.push(...directions.slice(0, 8 - out.length));
  return out.slice(0, 8);
}
