/**
 * TypeSafe-backed validation and classification of discovery candidates.
 * Every accepted claim becomes Evidence with source "typesafe-classification".
 */
import { choice, noul, type Questions } from "@typesafe-ai/sdk";
import { CAPABILITIES, CATEGORIES } from "@/lib/taxonomy";
import { askTypeSafe } from "@/lib/typesafe/client";
import type { TechnologyType } from "@/lib/types";

export interface CandidateInput {
  id: string;
  name: string;
  description: string;
  website?: string;
  source: string;
  websiteTitle?: string;
  websiteDescription?: string;
  hints?: string[];
}

export interface CandidateVerdict {
  id: string;
  isTechnology: number;
  isActive: number;
  websiteMatches: number;
  type: TechnologyType;
  typeConfidence: number;
  primaryCategory: string;
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  openSource: number;
  developerFacing: number;
  /** Probability it is a low-level utility dependency rather than a component a team chooses. */
  utility: number;
  model?: string;
}

const TYPE_CRITERIA: Record<TechnologyType, string> = {
  platform: "A hosted platform bundling several capabilities (cloud, BaaS, PaaS)",
  service: "A hosted SaaS/API service providing one capability",
  framework: "A software framework developers build applications with",
  library: "A library or SDK imported into code",
  database: "A database or data store",
  language: "A programming language",
  runtime: "A language runtime",
  tool: "A developer tool, CLI or editor",
  model: "An AI model or model family",
  api: "A public API product",
  infrastructure: "Infrastructure software (orchestration, networking, servers)",
  protocol: "A protocol or specification",
};

export async function classifyCandidates(cands: CandidateInput[]): Promise<CandidateVerdict[]> {
  if (!cands.length) return [];
  const state = {
    candidates: cands.map((c) => ({ name: c.name, description: c.description.slice(0, 600), website: c.website ?? "unknown", website_title: c.websiteTitle ?? "unknown", website_description: c.websiteDescription?.slice(0, 300) ?? "unknown", source: c.source, hints: c.hints ?? [] })),
  };
  const categoryCriteria: Record<string, string> = {};
  for (const c of CATEGORIES) categoryCriteria[c.id] = `${c.label}: ${c.description}`;
  categoryCriteria.none = "Not a technology category (consumer product, non-software company, or unrelated)";
  const questions: Questions = {};
  cands.forEach((c, i) => {
    const ref = `\`candidates[${i}]\` (${c.name})`;
    questions[`tech_${i}`] = noul(`Is ${ref} a software technology, developer product, infrastructure platform, API, framework, database, AI system, cloud service or library that a software team could include in a technology stack?`, {
      true: "It is something engineers would build with or run as part of a system (tools, APIs, platforms, libraries, models, databases, services for developers)",
      false: "It is a consumer app, a non-software business, a service for end users rather than builders, a marketplace of goods, or otherwise not a component of a software stack",
    });
    questions[`active_${i}`] = noul(`Based on the available text, does ${ref} appear to be currently available and maintained rather than shut down, deprecated or acquired-and-discontinued?`, {
      true: "Nothing indicates it is discontinued; the website and description describe a live product",
      false: "Text indicates shutdown, sunset, deprecation, acquisition with discontinuation, or the website is unrelated",
    });
    questions[`match_${i}`] = noul(`Do the website title and description of ${ref} describe the same product as its name and description?`, {
      true: "The website content is consistent with the candidate",
      false: "The website appears to be for a different company or product, a parked domain, or unrelated content",
    });
    questions[`dev_${i}`] = noul(`Is ${ref} primarily aimed at software developers, data teams or technical builders (as opposed to end consumers or non-technical business users)?`, { true: "Developers or technical teams integrate or operate it", false: "It is used by non-technical people or consumers" });
    questions[`util_${i}`] = noul(`Is ${ref} a low-level utility or transitive dependency (HTTP helpers, compatibility shims, parsers, packaging tools) rather than a component a team deliberately chooses when designing a technology stack?`, {
      true: "It is plumbing that arrives as a dependency of other libraries; nobody lists it as part of their architecture",
      false: "Teams deliberately choose it as a framework, database, service, platform, SDK, runtime or tool in their stack",
    });
    questions[`oss_${i}`] = noul(`Is ${ref} open source (its core is available under an open-source license)?`, { true: "Explicitly open source or has a public source repository under an OSS license", false: "Proprietary, or no indication of open source" });
    questions[`type_${i}`] = choice(`What kind of technology is ${ref}?`, TYPE_CRITERIA);
    questions[`cat_${i}`] = choice(`Which single category best describes ${ref}?`, categoryCriteria);
  });
  const res = await askTypeSafe(state, questions);
  const a = res.answers as Record<string, { noul?: number; choice?: string; confidence?: number; probabilities?: Record<string, number> }>;
  return cands.map((c, i) => ({
    id: c.id,
    isTechnology: a[`tech_${i}`]?.noul ?? 0,
    isActive: a[`active_${i}`]?.noul ?? 0,
    websiteMatches: a[`match_${i}`]?.noul ?? 0,
    developerFacing: a[`dev_${i}`]?.noul ?? 0,
    openSource: a[`oss_${i}`]?.noul ?? 0,
    utility: a[`util_${i}`]?.noul ?? 0,
    type: (a[`type_${i}`]?.choice as TechnologyType) ?? "service",
    typeConfidence: a[`type_${i}`]?.confidence ?? 0,
    primaryCategory: a[`cat_${i}`]?.choice ?? "none",
    categoryConfidence: a[`cat_${i}`]?.confidence ?? 0,
    categoryProbabilities: a[`cat_${i}`]?.probabilities ?? {},
    model: res.model,
  }));
}

/** Second request: which capabilities does an accepted candidate provide? Options are limited to plausible ones for its category. */
export async function classifyCapabilities(cand: CandidateInput, categories: string[]): Promise<Record<string, number>> {
  const plausible = CAPABILITIES.filter((cap) => cap.categories.some((c) => categories.includes(c)));
  if (!plausible.length) return {};
  const questions: Questions = {};
  for (const cap of plausible) {
    questions[cap.id] = noul(`Does \`candidate\` provide this capability to the applications that use it: ${cap.label} (${cap.description})?`, {
      true: `Using it in a stack gives the application ${cap.label.toLowerCase()}`,
      false: "It does not provide that capability, or only tangentially",
    });
  }
  const res = await askTypeSafe({ candidate: { name: cand.name, description: cand.description.slice(0, 800), website: cand.website ?? "unknown", categories } }, questions);
  const out: Record<string, number> = {};
  for (const cap of plausible) out[cap.id] = (res.answers as Record<string, { noul?: number }>)[cap.id]?.noul ?? 0;
  return out;
}

/** Refresh-time judgments about an existing technology's website text. */
export async function judgeLifecycle(name: string, websiteTitle?: string, websiteDescription?: string): Promise<{ shutdown: number; renamed: number; acquired: number }> {
  const res = await askTypeSafe(
    { technology: name, website_title: websiteTitle ?? "unknown", website_description: websiteDescription ?? "unknown" },
    {
      shutdown: noul("Does the website text indicate that `technology` has been shut down, sunset, discontinued or deprecated?", { true: "Explicit shutdown/sunset/deprecation language", false: "No such indication" }),
      renamed: noul("Does the website text indicate that `technology` now goes by a different name?", { true: "Text says it was renamed or 'is now X'", false: "No rename indicated" }),
      acquired: noul("Does the website text indicate that `technology` was acquired by or joined another company?", { true: "Acquisition or 'joined' language", false: "No acquisition indicated" }),
    },
  );
  return { shutdown: res.answers.shutdown.noul, renamed: res.answers.renamed.noul, acquired: res.answers.acquired.noul };
}
