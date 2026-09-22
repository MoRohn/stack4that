import { YC_DISCOVERY_TAGS, YC_TAG_MAP } from "@/lib/taxonomy";
import { fetchJson } from "../http";

export interface YcCompany {
  id: number;
  name: string;
  slug: string;
  website?: string;
  one_liner?: string;
  long_description?: string;
  tags?: string[];
  industries?: string[];
  batch?: string;
  status?: string;
  small_logo_thumb_url?: string;
  url?: string;
  subindustry?: string;
  team_size?: number;
}

export const YC_DATASET_URL = "https://yc-oss.github.io/api/companies/all.json";

/** Tier 2: yc-oss public company dataset. One discovery source among several; never authoritative on its own. */
export async function fetchYcCompanies(): Promise<YcCompany[]> {
  const d = await fetchJson<YcCompany[]>(YC_DATASET_URL, {}, 30000);
  return d ?? [];
}

/** Companies whose tags suggest a developer-facing technology. */
export function developerRelevant(companies: YcCompany[]): YcCompany[] {
  return companies.filter((c) => {
    if (c.status && c.status !== "Active" && c.status !== "Public") return false;
    if (!c.website) return false;
    const tags = c.tags ?? [];
    const hits = tags.filter((t) => YC_DISCOVERY_TAGS.has(t)).length;
    const infra = (c.subindustry ?? "").includes("Infrastructure") || (c.industries ?? []).includes("Infrastructure");
    return hits >= 2 || (hits >= 1 && infra) || (tags.includes("Developer Tools") && (tags.includes("AI") || tags.includes("Artificial Intelligence") || tags.includes("Open Source")));
  });
}

export function mapYcTags(tags: string[] = []): string[] {
  const out = new Set<string>();
  for (const t of tags) for (const c of YC_TAG_MAP[t] ?? []) out.add(c);
  return [...out];
}
