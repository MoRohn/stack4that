import { fetchJson } from "../http";

/** Apache Software Foundation project catalog (~380 projects). */
export interface ApacheProject {
  name: string;
  homepage?: string;
  description: string;
  categories: string[];
  languages: string[];
  repository?: string;
}

const CATEGORY_MAP: Record<string, string[]> = {
  database: ["databases"],
  "big-data": ["data-engineering"],
  "web-framework": ["backend-frameworks"],
  "network-server": ["networking"],
  "http": ["networking"],
  cloud: ["cloud-platforms"],
  messaging: ["queues"],
  "content": ["cms"],
  "search": ["search"],
  "build-management": ["ci-cd"],
  testing: ["testing"],
  "machine-learning": ["ml-platforms"],
  library: ["developer-tools"],
  "graphics": [],
  "retired": [],
};

export function mapApacheCategories(cats: string[]): string[] {
  return [...new Set(cats.flatMap((c) => CATEGORY_MAP[c.trim()] ?? []))];
}

export async function fetchApacheProjects(): Promise<ApacheProject[]> {
  const d = await fetchJson<Record<string, { name?: string; homepage?: string; shortdesc?: string; description?: string; category?: string | string[]; "programming-language"?: string | string[]; repository?: unknown; retired?: boolean }>>("https://projects.apache.org/json/foundation/projects.json", {}, 30000);
  if (!d) return [];
  // The catalog is loosely typed: fields may be strings, arrays or missing.
  const list = (v?: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((x) => String(x).trim()).filter(Boolean);
  return Object.values(d)
    .filter((p) => p.name && p.homepage && !list(p.category).includes("retired"))
    .map((p) => ({ name: p.name!, homepage: p.homepage, description: [p.shortdesc, p.description].filter((x): x is string => typeof x === "string").sort((a, b) => b.length - a.length)[0]?.trim() ?? "", categories: list(p.category), languages: list(p["programming-language"]), repository: list(p.repository).find((r) => r.includes("github.com")) }));
}
