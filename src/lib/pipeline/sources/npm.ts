import { fetchJson } from "../http";

export interface NpmInfo {
  name: string;
  version?: string;
  modified?: string;
  homepage?: string;
  repository?: string;
  description?: string;
  license?: string;
  retrievedAt: string;
}

/** Tier 2: npm registry metadata for a package. */
export async function fetchNpm(name: string): Promise<NpmInfo | undefined> {
  const d = await fetchJson<{ "dist-tags"?: { latest?: string }; time?: { modified?: string }; homepage?: string; repository?: { url?: string } | string; description?: string; license?: string }>(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!d) return undefined;
  const repo = typeof d.repository === "string" ? d.repository : d.repository?.url;
  return {
    name,
    version: d["dist-tags"]?.latest,
    modified: d.time?.modified,
    homepage: d.homepage,
    repository: repo?.replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^ssh:\/\/git@/, "https://"),
    description: d.description,
    license: d.license,
    retrievedAt: new Date().toISOString(),
  };
}

export interface NpmSearchHit {
  name: string;
  description?: string;
  homepage?: string;
  repository?: string;
  version?: string;
  date?: string;
  score: number;
}

/** Tier 2/3 discovery: popular packages by keyword. */
export async function searchNpm(text: string, size = 25): Promise<NpmSearchHit[]> {
  const d = await fetchJson<{ objects: Array<{ package: { name: string; description?: string; version?: string; date?: string; links?: { homepage?: string; repository?: string } }; score: { final: number } }> }>(
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=${size}&popularity=1.0&quality=0.5`,
  );
  if (!d?.objects) return [];
  return d.objects.map((o) => ({ name: o.package.name, description: o.package.description, homepage: o.package.links?.homepage, repository: o.package.links?.repository, version: o.package.version, date: o.package.date, score: o.score.final }));
}

export const NPM_DISCOVERY_QUERIES = ["keywords:framework", "keywords:orm", "keywords:llm", "keywords:agents", "keywords:auth", "keywords:queue", "keywords:vector"];
