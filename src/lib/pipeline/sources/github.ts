import { fetchJson } from "../http";

export interface RepoInfo {
  fullName: string;
  url: string;
  stars: number;
  pushedAt: string;
  archived: boolean;
  disabled: boolean;
  license?: string;
  description?: string;
  homepage?: string;
  topics: string[];
  retrievedAt: string;
}

function headers() {
  const token = process.env.GITHUB_TOKEN;
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

const PLACEHOLDER_LICENSES = new Set(["noassertion", "other", "unknown", "none", ""]);
export function realLicense(v?: string | null): string | undefined {
  if (!v) return undefined;
  return PLACEHOLDER_LICENSES.has(v.trim().toLowerCase()) ? undefined : v.trim();
}

export function parseRepo(url?: string): string | undefined {
  if (!url) return undefined;
  const m = /github\.com\/([^/]+)\/([^/#?]+)/i.exec(url);
  if (!m) return undefined;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/, "");
  return `${owner}/${repo}`;
}

/** Tier 1/2: official repository metadata. */
export async function fetchRepo(fullName: string): Promise<RepoInfo | undefined> {
  const d = await fetchJson<{
    full_name: string;
    html_url: string;
    stargazers_count: number;
    pushed_at: string;
    archived: boolean;
    disabled: boolean;
    license?: { spdx_id?: string; name?: string } | null;
    description?: string | null;
    homepage?: string | null;
    topics?: string[];
  }>(`https://api.github.com/repos/${fullName}`, { headers: headers() });
  if (!d) return undefined;
  return {
    fullName: d.full_name,
    url: d.html_url,
    stars: d.stargazers_count,
    pushedAt: d.pushed_at,
    archived: d.archived,
    disabled: d.disabled,
    // GitHub reports NOASSERTION / "Other" when it cannot classify a license: that is unknown, not a license.
    license: realLicense(d.license?.spdx_id) ?? realLicense(d.license?.name),
    description: d.description ?? undefined,
    homepage: d.homepage ?? undefined,
    topics: d.topics ?? [],
    retrievedAt: new Date().toISOString(),
  };
}

export interface RepoSearchHit {
  fullName: string;
  url: string;
  stars: number;
  description?: string;
  homepage?: string;
  topics: string[];
  createdAt: string;
  pushedAt: string;
  license?: string;
}

/** Tier 3 discovery: recently created, fast-growing repositories in developer-tool topics. */
export async function searchRepos(query: string, perPage = 30): Promise<RepoSearchHit[]> {
  const d = await fetchJson<{ items: Array<Record<string, unknown>> }>(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`, { headers: headers() });
  if (!d?.items) return [];
  return d.items.map((it) => ({
    fullName: String(it.full_name),
    url: String(it.html_url),
    stars: Number(it.stargazers_count),
    description: (it.description as string | null) ?? undefined,
    homepage: (it.homepage as string | null) ?? undefined,
    topics: (it.topics as string[]) ?? [],
    createdAt: String(it.created_at),
    pushedAt: String(it.pushed_at),
    license: realLicense((it.license as { spdx_id?: string } | null)?.spdx_id),
  }));
}

export const DISCOVERY_QUERIES = [
  "topic:developer-tools stars:>1500 created:>2025-06-01",
  "topic:llm stars:>2000 created:>2025-06-01",
  "topic:database stars:>1500 created:>2025-01-01",
  "topic:framework stars:>2000 created:>2025-01-01",
  "topic:agents stars:>1500 created:>2025-06-01",
  "topic:infrastructure stars:>1500 created:>2025-01-01",
  "topic:observability stars:>1000 created:>2025-01-01",
  "topic:vector-database stars:>500 created:>2025-01-01",
];
