import { fetchJson, mapLimit } from "../http";
import { fetchPypi } from "./pypi";

/** Docker Hub official images: databases, servers, runtimes and infrastructure used worldwide. */
export interface DockerImage {
  name: string;
  description: string;
  pulls: number;
  url: string;
}

export async function fetchDockerOfficialImages(): Promise<DockerImage[]> {
  const out: DockerImage[] = [];
  for (let page = 1; page <= 3; page++) {
    const d = await fetchJson<{ results: Array<{ name: string; description?: string; pull_count?: number }>; next?: string | null }>(`https://hub.docker.com/v2/repositories/library/?page_size=100&page=${page}`, {}, 20000);
    if (!d?.results) break;
    for (const r of d.results) out.push({ name: r.name, description: r.description ?? "", pulls: r.pull_count ?? 0, url: `https://hub.docker.com/_/${r.name}` });
    if (!d.next) break;
  }
  const skip = new Set(["scratch", "hello-world", "hello-seattle", "busybox", "alpine", "ubuntu", "debian", "centos", "fedora", "amazonlinux", "oraclelinux", "photon", "clearlinux", "archlinux", "almalinux", "rockylinux", "buildpack-deps", "bash"]);
  return out.filter((i) => !skip.has(i.name) && i.description).sort((a, b) => b.pulls - a.pulls);
}

/** Most-downloaded Python packages, narrowed to ones whose summary looks like a stack technology. */
export interface PypiCandidate {
  name: string;
  summary: string;
  homepage?: string;
  repository?: string;
  downloads: number;
}

const STACK_WORDS = /\b(framework|database|orm|server|queue|broker|client for|sdk|api|machine learning|deep learning|llm|vector|search|http|web|async|workflow|orchestrat|pipeline|cloud|storage|cache|stream|monitor|observab|auth|payments?|task)\b/i;

export async function fetchTopPypi(pool = 400, keep = 120, exclude: Set<string> = new Set()): Promise<PypiCandidate[]> {
  const d = await fetchJson<{ rows: Array<{ project: string; download_count: number }> }>("https://hugovk.dev/top-pypi-packages/top-pypi-packages.min.json", {}, 30000);
  if (!d?.rows) return [];
  const names = d.rows.slice(0, pool).filter((r) => !exclude.has(r.project.toLowerCase()));
  const infos = await mapLimit(names.slice(0, 200), 8, async (r) => ({ r, info: await fetchPypi(r.project) }));
  return infos
    .filter(({ info }) => info?.summary && STACK_WORDS.test(info.summary))
    .slice(0, keep)
    .map(({ r, info }) => ({ name: r.project, summary: info!.summary!, homepage: info!.homepage, repository: info!.repository, downloads: r.download_count }));
}

/** crates.io, by the categories that hold stack components (servers, databases). */
export interface CrateCandidate {
  name: string;
  description: string;
  homepage?: string;
  repository?: string;
  downloads: number;
}

export async function fetchCrates(categories = ["web-programming::http-server", "database", "database-implementations", "asynchronous"]): Promise<CrateCandidate[]> {
  const out: CrateCandidate[] = [];
  for (const cat of categories) {
    const d = await fetchJson<{ crates: Array<{ name: string; description?: string; homepage?: string; repository?: string; downloads: number }> }>(`https://crates.io/api/v1/crates?category=${encodeURIComponent(cat)}&sort=downloads&per_page=40`, {}, 20000);
    for (const c of d?.crates ?? []) out.push({ name: c.name, description: c.description ?? "", homepage: c.homepage, repository: c.repository, downloads: c.downloads });
  }
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.name) && seen.add(c.name) && c.description);
}
