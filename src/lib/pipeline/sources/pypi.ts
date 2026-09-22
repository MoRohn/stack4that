import { fetchJson } from "../http";

export interface PypiInfo {
  name: string;
  version?: string;
  homepage?: string;
  repository?: string;
  summary?: string;
  license?: string;
  retrievedAt: string;
}

/** Tier 2: PyPI JSON API. */
export async function fetchPypi(name: string): Promise<PypiInfo | undefined> {
  const d = await fetchJson<{ info: { version?: string; home_page?: string; project_urls?: Record<string, string>; summary?: string; license?: string } }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!d?.info) return undefined;
  const urls = d.info.project_urls ?? {};
  const repo = Object.entries(urls).find(([k, v]) => /source|repository|github|code/i.test(k) || /github\.com/.test(v))?.[1];
  return { name, version: d.info.version, homepage: d.info.home_page || urls.Homepage || urls.Documentation, repository: repo, summary: d.info.summary, license: d.info.license || undefined, retrievedAt: new Date().toISOString() };
}
