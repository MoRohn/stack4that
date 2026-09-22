import YAML from "yaml";
import { fetchWithTimeout } from "../http";

export interface CncfItem {
  name: string;
  homepage?: string;
  repo?: string;
  description?: string;
  category: string;
  subcategory: string;
  project?: string; // graduated | incubating | sandbox | archived
}

export const CNCF_LANDSCAPE_URL = "https://raw.githubusercontent.com/cncf/landscape/master/landscape.yml";

const CATEGORY_MAP: Record<string, string[]> = {
  Database: ["databases"],
  Streaming: ["streaming", "queues"],
  "Streaming & Messaging": ["streaming", "queues"],
  "Application Definition & Image Build": ["containers", "ci-cd"],
  "Continuous Integration & Delivery": ["ci-cd"],
  "Scheduling & Orchestration": ["kubernetes"],
  "Coordination & Service Discovery": ["networking"],
  "Remote Procedure Call": ["apis"],
  "Service Proxy": ["networking", "api-gateways"],
  "API Gateway": ["api-gateways"],
  "Service Mesh": ["networking"],
  "Cloud Native Storage": ["storage"],
  "Container Runtime": ["containers"],
  "Cloud Native Network": ["networking"],
  Automation: ["infrastructure-as-code"],
  "Automation & Configuration": ["infrastructure-as-code"],
  "Container Registry": ["containers"],
  "Security & Compliance": ["security"],
  "Key Management": ["secrets"],
  Observability: ["observability"],
  "Observability and Analysis": ["observability"],
  Monitoring: ["monitoring"],
  Logging: ["logging"],
  Tracing: ["tracing"],
  "Chaos Engineering": ["testing"],
  "Feature Flagging": ["feature-flags"],
  Serverless: ["serverless"],
  "Wasm": ["runtimes"],
};

export function mapCncfCategory(category: string, subcategory: string): string[] {
  return CATEGORY_MAP[subcategory] ?? CATEGORY_MAP[category] ?? [];
}

/** Tier 2: CNCF landscape (open-source cloud native ecosystem). */
export async function fetchCncfLandscape(): Promise<CncfItem[]> {
  try {
    const res = await fetchWithTimeout(CNCF_LANDSCAPE_URL, {}, 30000);
    if (!res.ok) return [];
    const doc = YAML.parse(await res.text()) as { landscape?: Array<{ name: string; subcategories?: Array<{ name: string; items?: Array<Record<string, unknown>> }> }> };
    const out: CncfItem[] = [];
    for (const cat of doc.landscape ?? []) {
      for (const sub of cat.subcategories ?? []) {
        for (const it of sub.items ?? []) {
          out.push({
            name: String(it.name),
            homepage: it.homepage_url ? String(it.homepage_url) : undefined,
            repo: it.repo_url ? String(it.repo_url) : undefined,
            description: it.description ? String(it.description) : undefined,
            category: cat.name,
            subcategory: sub.name,
            project: it.project ? String(it.project) : undefined,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
