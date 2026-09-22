/**
 * Technology Intelligence Pipeline
 *
 *   DISCOVER → FETCH → NORMALIZE → DEDUPLICATE → CLASSIFY → VALIDATE → ENRICH → EMBED → UPSERT → AUDIT
 *
 * Runs daily. Refreshes existing technologies from Tier 1 sources and
 * discovers new candidates from Tier 2/3 sources. Candidates are never
 * inserted without validation; nothing is ever deleted.
 */
import { fallbackColor, resolveLogo } from "@/lib/catalog/logos";
import { slugify } from "@/lib/catalog/seed/helper";
import { getEmbeddingProvider, technologyEmbeddingText } from "@/lib/embeddings";
import { listTechnologies, recordChange, saveEmbeddings, savePipelineRun, upsertCandidates, upsertTechnologies, type DiscoveryCandidateRow } from "@/lib/db/repo";
import { invalidateRetrievalIndex } from "@/lib/retrieval";
import { CATEGORY_IDS } from "@/lib/taxonomy";
import { assertTypeSafeConfigured } from "@/lib/typesafe/client";
import type { Evidence, SourceRecord, SourceType, Technology } from "@/lib/types";
import { classifyCandidates, classifyCapabilities, judgeLifecycle, type CandidateInput } from "./classify";
import { canonicalUrl, domainOf, mapLimit } from "./http";
import { fetchCncfLandscape, mapCncfCategory } from "./sources/cncf";
import { DISCOVERY_QUERIES, fetchRepo, parseRepo, searchRepos } from "./sources/github";
import { NPM_DISCOVERY_QUERIES, searchNpm } from "./sources/npm";
import { checkWebsite } from "./sources/website";
import { developerRelevant, fetchYcCompanies, mapYcTags } from "./sources/yc";
import { fetchWikidataClassMembers, fetchWikidataCompanyProducts } from "./sources/wikidata";
import { fetchApacheProjects, mapApacheCategories } from "./sources/apache";
import { fetchCrates, fetchDockerOfficialImages, fetchTopPypi } from "./sources/registries";

export type PipelineMode = "refresh" | "discover" | "full";

export interface PipelineProgress {
  stage: "starting" | "refresh" | "discover" | "fetch" | "validate" | "embed" | "done";
  label: string;
  done: number;
  total: number;
}

export type PipelineSource = "wikidata" | "apache" | "cncf" | "dockerhub" | "yc" | "github" | "npm" | "pypi" | "crates";
export const ALL_SOURCES: PipelineSource[] = ["wikidata", "apache", "cncf", "dockerhub", "yc", "github", "npm", "pypi", "crates"];

export interface PipelineOptions {
  mode: PipelineMode;
  /** Max technologies to refresh and max candidates to validate per run. */
  limit?: number;
  /** Supplied by the launcher so the UI can follow the run. */
  id?: string;
  log?: (line: string) => void;
  onProgress?: (p: PipelineProgress) => void;
  sources?: Array<PipelineSource>;
}

export interface PipelineResult {
  id: string;
  mode: PipelineMode;
  status: "completed" | "failed";
  stats: Record<string, number | string>;
  log: string[];
  durationMs: number;
}

interface RawCandidate {
  key: string;
  name: string;
  website?: string;
  repo?: string;
  description: string;
  sourceType: SourceType;
  sourceUrl: string;
  hints: string[];
  categories: string[];
  payload: Record<string, unknown>;
  stars?: number;
  license?: string;
  /** Source-specific popularity (sitelinks, pulls, downloads, stars) used to rank within a source. */
  popularity?: number;
}

const MULTI_PRODUCT_HOSTS = new Set(["aws.amazon.com", "cloud.google.com", "azure.microsoft.com", "learn.microsoft.com", "developers.google.com", "firebase.google.com", "www.ibm.com", "ibm.com", "www.oracle.com", "oracle.com", "www.alibabacloud.com", "cloud.tencent.com", "developer.nvidia.com", "www.nvidia.com", "hub.docker.com", "github.com", "pypi.org", "crates.io", "www.npmjs.com", "developers.cloudflare.com", "www.cloudflare.com", "www.salesforce.com", "www.sap.com", "www.redhat.com"]);

/**
 * Name variants for dedupe: "MongoDB" ~ "mongo", "Node.js" ~ "node", "Apache Kafka" ~ "kafka",
 * "Amazon DynamoDB" ~ "dynamodb". Short generic stems are skipped to avoid false merges.
 */
const VENDOR_STEMS = new Set(["azure", "google", "amazon", "microsoft", "apache", "oracle", "alibaba", "tencent", "cloud", "open", "web", "data", "cloudflare", "vercel", "redis", "elastic"]);

export function nameVariants(name: string): string[] {
  // Separators are not normalized to spaces here on purpose: that would let the vendor
  // strip below turn "azure-openai" into "openai", merging a managed service into the
  // product it hosts. Late-named registry packages are caught by the accept-time check.
  const base = name.toLowerCase().replace(/\(.*?\)/g, " ").trim();
  const noVendor = base.replace(/^(apache|amazon|aws|google cloud|google|microsoft azure|azure|microsoft|ibm|oracle|the)\s+/, "");
  const out = new Set<string>();
  for (const v of [base, noVendor]) {
    const compact = v.replace(/[^a-z0-9]+/g, "");
    if (compact.length >= 3) out.add(compact);
    // "mongodb" ~ "mongo", "node.js" ~ "node" — but never stem down to a vendor name ("azure-sql" ≠ Azure).
    const stem = compact.replace(/(js|db|server|sql|io|lang|hq)$/, "");
    if (compact.length >= 6 && stem.length >= 4 && stem !== compact && !VENDOR_STEMS.has(stem)) out.add(stem);
  }
  return [...out];
}

/** Dedupe key: the host, plus the first path segment on hosts that carry many products. */
export function productKey(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const bare = host.replace(/^www\./, "");
    if (!MULTI_PRODUCT_HOSTS.has(host) && !MULTI_PRODUCT_HOSTS.has(bare)) return bare;
    const segs = u.pathname.split("/").filter(Boolean).filter((seg) => !/^[a-z]{2}(-[a-z]{2})?$/i.test(seg) && seg !== "products" && seg !== "services" && seg !== "_");
    // Code hosts and registries identify a project by owner/name (or type/name).
    const depth = ["github.com", "pypi.org", "crates.io", "npmjs.com", "hub.docker.com"].includes(bare) ? 2 : 1;
    return `${bare}/${segs.slice(0, depth).join("/").toLowerCase()}`;
  } catch {
    return undefined;
  }
}

const now = () => new Date().toISOString();

// Progress reporter for the run in flight (only one run executes at a time, see runner.ts).
let report: (p: PipelineProgress) => void = () => {};

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const started = Date.now();
  const id = opts.id ?? `run_${Date.now().toString(36)}`;
  report = opts.onProgress ?? (() => {});
  report({ stage: "starting", label: "Starting", done: 0, total: 1 });
  const lines: string[] = [];
  const log = (line: string) => {
    const l = `${new Date().toISOString().slice(11, 19)} ${line}`;
    lines.push(l);
    opts.log?.(l);
  };
  const stats: Record<string, number | string> = { refreshed: 0, refreshChanges: 0, discovered: 0, deduplicated: 0, validated: 0, accepted: 0, rejected: 0, held: 0, embedded: 0, errors: 0 };
  const limit = opts.limit ?? 40;
  await savePipelineRun({ id, startedAt: now(), mode: opts.mode, status: "running", stats, log: lines });
  try {
    // Every validation, classification and lifecycle judgment is made by TypeSafe; without it the run cannot proceed.
    assertTypeSafeConfigured();
    if (opts.mode === "refresh" || opts.mode === "full") await refreshExisting(limit, stats, log);
    if (opts.mode === "discover" || opts.mode === "full") await discoverNew(limit, stats, log, opts.sources);
    report({ stage: "embed", label: "Embedding for search", done: 0, total: 1 });
    await embedMissing(stats, log);
    invalidateRetrievalIndex();
    report({ stage: "done", label: "Done", done: 1, total: 1 });
    const result: PipelineResult = { id, mode: opts.mode, status: "completed", stats, log: lines, durationMs: Date.now() - started };
    await savePipelineRun({ id, startedAt: new Date(started).toISOString(), finishedAt: now(), mode: opts.mode, status: "completed", stats, log: lines });
    log(`done in ${(result.durationMs / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    stats.errors = Number(stats.errors) + 1;
    log(`FAILED: ${(err as Error).message}`);
    await savePipelineRun({ id, startedAt: new Date(started).toISOString(), finishedAt: now(), mode: opts.mode, status: "failed", stats, log: lines });
    return { id, mode: opts.mode, status: "failed", stats, log: lines, durationMs: Date.now() - started };
  }
}

// ---------------------------------------------------------------------------
// REFRESH
// ---------------------------------------------------------------------------

function evidence(tech: Technology, sourceType: SourceType, sourceUrl: string, claimType: Evidence["claimType"], value: string, confidence: number): Evidence {
  return { id: `ev_${tech.slug}_${claimType}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, technologyId: tech.id, sourceUrl, sourceType, retrievedAt: now(), claimType, extractedValue: value, confidence };
}

function addEvidence(tech: Technology, e: Evidence) {
  // Replace older evidence for the same claim + source to keep the record bounded.
  tech.evidence = tech.evidence.filter((x) => !(x.claimType === e.claimType && x.sourceType === e.sourceType && x.sourceUrl === e.sourceUrl));
  tech.evidence.push(e);
  if (tech.evidence.length > 60) tech.evidence = tech.evidence.slice(-60);
}

function addSource(tech: Technology, rec: Omit<SourceRecord, "id" | "technologyId">) {
  tech.sourceRecords = tech.sourceRecords.filter((r) => !(r.sourceType === rec.sourceType && r.sourceUrl === rec.sourceUrl));
  tech.sourceRecords.push({ id: `src_${tech.slug}_${rec.sourceType}_${Date.now().toString(36)}`, technologyId: tech.id, ...rec });
  if (tech.sourceRecords.length > 30) tech.sourceRecords = tech.sourceRecords.slice(-30);
}

/** A description worth storing: long enough to say something, and not just the name back. */
function describesIt(text: string | undefined, name: string): text is string {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 40) return false;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(t) !== norm(name);
}

async function refreshExisting(limit: number, stats: Record<string, number | string>, log: (l: string) => void) {
  const all = await listTechnologies({ includeInactive: true });
  // Records that never got a real description are re-checked first: an entry the catalogue
  // cannot describe is worth more attention than one that is merely a few days stale.
  const thin = (t: Technology) => ((t.description ?? "").trim().length < 60 ? 0 : 1);
  const due = all
    .filter((t) => t.status !== "sunset")
    .sort((a, b) => thin(a) - thin(b) || (a.lastVerifiedAt ?? "").localeCompare(b.lastVerifiedAt ?? ""))
    .slice(0, limit);
  log(`refresh: ${due.length} technologies due (of ${all.length})`);
  const updated: Technology[] = [];
  let refreshedCount = 0;
  report({ stage: "refresh", label: "Re-verifying known technologies", done: 0, total: due.length });
  await mapLimit(due, 4, async (orig) => {
    try {
      await refreshOne(orig, updated, stats, log);
    } finally {
      refreshedCount += 1;
      report({ stage: "refresh", label: `Re-verifying ${orig.name}`, done: refreshedCount, total: due.length });
    }
  });
  await finishRefresh(updated, stats, log);
}

async function refreshOne(orig: Technology, updated: Technology[], stats: Record<string, number | string>, log: (l: string) => void) {
  {
    const tech: Technology = structuredClone(orig);
    try {
      // Tier 1: website
      if (tech.websiteUrl) {
        const w = await checkWebsite(tech.websiteUrl);
        addSource(tech, { sourceType: "official-website", sourceUrl: tech.websiteUrl, retrievedAt: w.retrievedAt, payload: { status: w.status, finalUrl: w.finalUrl, title: w.title } });
        if (w.ok) {
          addEvidence(tech, evidence(tech, "official-website", tech.websiteUrl, "existence", w.title ?? "reachable", 0.95));
          if (w.description && w.description.length > 40) {
            addEvidence(tech, evidence(tech, "official-website", tech.websiteUrl, "description", w.description, 0.8));
            // Thin records (often from a registry or catalog) adopt the official description.
            if ((tech.description ?? "").length < 60 && w.description.length > (tech.description ?? "").length) {
              tech.description = w.description;
              tech.shortDescription = w.description.split(/(?<=\.)\s/)[0].slice(0, 160);
            }
          }
          const life = await judgeLifecycle(tech.name, w.title, w.description).catch((err) => {
            stats.errors = Number(stats.errors) + 1;
            log(`lifecycle judgment for ${tech.slug} failed: ${(err as Error).message}`);
            return undefined;
          });
          if (life) {
            if (life.shutdown > 0.75) {
              tech.status = "deprecated";
              addEvidence(tech, evidence(tech, "typesafe-classification", tech.websiteUrl, "status", `shutdown p=${life.shutdown.toFixed(2)}`, life.shutdown));
            }
            if (life.acquired > 0.8) addEvidence(tech, evidence(tech, "typesafe-classification", tech.websiteUrl, "company", `acquisition signal p=${life.acquired.toFixed(2)}`, life.acquired));
            if (life.renamed > 0.8) addEvidence(tech, evidence(tech, "typesafe-classification", tech.websiteUrl, "status", `rename signal p=${life.renamed.toFixed(2)}`, life.renamed));
          }
          const unreachable = tech.tags.indexOf("unreachable");
          if (unreachable >= 0) tech.tags.splice(unreachable, 1);
        } else if (w.status === 404 || w.status === 410) {
          if (!tech.tags.includes("unreachable")) tech.tags.push("unreachable");
          else tech.status = tech.status === "active" ? "unknown" : tech.status; // second consecutive miss
          addEvidence(tech, evidence(tech, "official-website", tech.websiteUrl, "status", `HTTP ${w.status}`, 0.6));
        }
      }
      // Tier 1: repository
      const full = parseRepo(tech.repositoryUrl);
      if (full) {
        const r = await fetchRepo(full);
        if (r) {
          addSource(tech, { sourceType: "official-repository", sourceUrl: r.url, externalId: r.fullName, retrievedAt: r.retrievedAt, payload: { stars: r.stars, pushedAt: r.pushedAt, archived: r.archived, license: r.license, topics: r.topics } });
          tech.repositoryStars = r.stars;
          tech.repositoryActivity = r.pushedAt;
          addEvidence(tech, evidence(tech, "official-repository", r.url, "repository-stars", String(r.stars), 0.98));
          addEvidence(tech, evidence(tech, "official-repository", r.url, "repository-activity", r.pushedAt, 0.98));
          if (r.license) {
            if (!tech.license || tech.license !== r.license) {
              addEvidence(tech, evidence(tech, "official-repository", r.url, "license", r.license, 0.95));
              tech.license = r.license;
            }
            if (tech.openSource === undefined) tech.openSource = true;
          }
          if (r.archived && tech.status === "active") {
            tech.status = "deprecated";
            addEvidence(tech, evidence(tech, "official-repository", r.url, "status", "repository archived", 0.95));
          }
          const monthsSincePush = (Date.now() - new Date(r.pushedAt).getTime()) / (30 * 86400e3);
          if (monthsSincePush > 18 && !tech.tags.includes("inactive-repository")) {
            tech.tags.push("inactive-repository");
            await recordChange({ technologyId: tech.id, field: "repositoryActivity", previousValue: orig.repositoryActivity ?? null, newValue: r.pushedAt, source: "pipeline:refresh", confidence: 0.95, changeKind: "repository-inactivity" });
          }
          if (monthsSincePush <= 18 && tech.tags.includes("inactive-repository")) tech.tags = tech.tags.filter((t) => t !== "inactive-repository");
          // Registry and foundation catalogues often carry a stub ("A Java ORM"). The
          // repository's own description is better and is a first-party source, so a thin
          // record adopts it rather than staying thin.
          if (describesIt(r.description, tech.name) && (tech.description ?? "").length < 60 && r.description.length > (tech.description ?? "").length) {
            tech.description = r.description;
            if ((tech.shortDescription ?? "").length < 60) tech.shortDescription = r.description.split(/(?<=\.)\s/)[0].slice(0, 160);
            addEvidence(tech, evidence(tech, "official-repository", r.url, "description", r.description, 0.9));
          }
        }
      }
      // Wikidata and foundation catalogues sometimes give a class label ("database engine")
      // and no repository. Find the project's own repository and take its description, so the
      // text comes from the project rather than from us.
      if (!tech.repositoryUrl && (tech.description ?? "").trim().length < 60) {
        const wanted = new Set(nameVariants(tech.name));
        const hits = await searchRepos(`${tech.name} in:name`, 5).catch(() => []);
        const hit = hits.find((h) => {
          const repoName = h.fullName.split("/")[1] ?? "";
          const owner = h.fullName.split("/")[0] ?? "";
          const sameSite = Boolean(h.homepage && tech.websiteUrl && domainOf(h.homepage) === domainOf(tech.websiteUrl));
          const matches = sameSite || nameVariants(repoName).some((v) => wanted.has(v)) || nameVariants(`${owner} ${repoName}`).some((v) => wanted.has(v));
          return matches && h.stars >= 200 && describesIt(h.description, tech.name);
        });
        if (hit) {
          tech.repositoryUrl = hit.url;
          tech.repositoryStars = hit.stars;
          tech.description = hit.description!;
          tech.shortDescription = hit.description!.split(/(?<=\.)\s/)[0].slice(0, 160);
          if (!tech.license && hit.license) tech.license = hit.license;
          addSource(tech, { sourceType: "github", sourceUrl: hit.url, retrievedAt: now(), payload: { stars: hit.stars, resolved: "thin-description" } });
          addEvidence(tech, evidence(tech, "official-repository", hit.url, "description", hit.description!, 0.85));
          await recordChange({ technologyId: tech.id, field: "description", previousValue: orig.description ?? null, newValue: tech.description, source: "pipeline:refresh", confidence: 0.85, changeKind: "capability" });
        }
      }
      if (!tech.logoAssetId) {
        const logo = resolveLogo([tech.slug, tech.name]);
        if (logo) {
          tech.logoAssetId = logo.iconSlug;
          tech.logoUrl = `https://cdn.simpleicons.org/${logo.iconSlug}`;
          tech.brandColor = logo.color;
          addEvidence(tech, evidence(tech, "simple-icons", `https://simpleicons.org/?q=${logo.iconSlug}`, "logo", logo.iconSlug, 0.9));
        }
      }
      tech.lastVerifiedAt = now();
      tech.lastUpdatedAt = now();
      if (tech.verificationStatus === "seeded" || tech.verificationStatus === "candidate") tech.verificationStatus = "verified";
      tech.confidence = Math.min(0.98, tech.confidence + 0.05);
      updated.push(tech);
    } catch (err) {
      stats.errors = Number(stats.errors) + 1;
      log(`refresh ${tech.slug} failed: ${(err as Error).message}`);
    }
  }
}

async function finishRefresh(updated: Technology[], stats: Record<string, number | string>, log: (l: string) => void) {
  const res = await upsertTechnologies(updated, { source: "pipeline:refresh", recordChanges: true, confidence: 0.9 });
  stats.refreshed = updated.length;
  stats.refreshChanges = res.changes.length;
  log(`refresh: ${updated.length} updated, ${res.changes.length} field changes recorded`);
}

// ---------------------------------------------------------------------------
// DISCOVER
// ---------------------------------------------------------------------------

/** Run one discovery source; a failure is logged and counted, and the run continues with the others. */
async function safeSource(name: string, log: (l: string) => void, stats: Record<string, number | string>, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    stats.errors = Number(stats.errors) + 1;
    log(`discover/${name} skipped: ${(err as Error).message}`);
  }
}

async function discoverNew(limit: number, stats: Record<string, number | string>, log: (l: string) => void, sources: PipelineOptions["sources"] = ALL_SOURCES) {
  const raw: RawCandidate[] = [];
  const push = (c: RawCandidate) => raw.push(c);

  await safeSource("yc", log, stats, async () => {
  if (sources.includes("yc")) {
    const companies = await fetchYcCompanies();
    const relevant = developerRelevant(companies);
    log(`discover/yc: ${companies.length} companies, ${relevant.length} developer-relevant`);
    for (const c of relevant) {
      push({
        key: `yc:${c.slug}`,
        name: c.name,
        website: canonicalUrl(c.website),
        description: [c.one_liner, c.long_description].filter(Boolean).join(" ").slice(0, 1200),
        sourceType: "yc-oss",
        sourceUrl: c.url ?? `https://www.ycombinator.com/companies/${c.slug}`,
        hints: c.tags ?? [],
        categories: mapYcTags(c.tags),
        payload: { batch: c.batch, tags: c.tags, industries: c.industries, teamSize: c.team_size, logo: c.small_logo_thumb_url },
      });
    }
  }
  });
  await safeSource("cncf", log, stats, async () => {
  if (sources.includes("cncf")) {
    const items = await fetchCncfLandscape();
    log(`discover/cncf: ${items.length} landscape items`);
    for (const it of items) {
      if (it.project === "archived") continue;
      const cats = mapCncfCategory(it.category, it.subcategory);
      if (!cats.length) continue;
      push({ key: `cncf:${slugify(it.name)}`, name: it.name, website: canonicalUrl(it.homepage), repo: it.repo, description: it.description ?? `${it.subcategory} (${it.category})`, sourceType: "cncf", sourceUrl: "https://landscape.cncf.io", hints: [it.category, it.subcategory, it.project ?? ""].filter(Boolean), categories: cats, payload: { category: it.category, subcategory: it.subcategory, project: it.project } });
    }
  }
  });
  await safeSource("github", log, stats, async () => {
  if (sources.includes("github")) {
    let n = 0;
    for (const q of DISCOVERY_QUERIES) {
      const hits = await searchRepos(q, 20);
      n += hits.length;
      for (const h of hits) {
        push({ key: `github:${h.fullName.toLowerCase()}`, name: h.fullName.split("/")[1], website: canonicalUrl(h.homepage) ?? h.url, repo: h.url, description: h.description ?? "", sourceType: "github", sourceUrl: h.url, hints: h.topics, categories: [], payload: { stars: h.stars, createdAt: h.createdAt, topics: h.topics }, stars: h.stars, license: h.license });
      }
    }
    log(`discover/github: ${n} repositories from ${DISCOVERY_QUERIES.length} queries`);
  }
  });
  await safeSource("npm", log, stats, async () => {
  if (sources.includes("npm")) {
    let n = 0;
    for (const q of NPM_DISCOVERY_QUERIES) {
      const hits = await searchNpm(q, 15);
      n += hits.length;
      for (const h of hits) {
        if (h.score < 0.3) continue;
        push({ key: `npm:${h.name}`, name: h.name.replace(/^@[^/]+\//, ""), website: canonicalUrl(h.homepage) ?? (h.repository ? canonicalUrl(h.repository) : undefined), repo: h.repository, description: h.description ?? "", sourceType: "npm", sourceUrl: `https://www.npmjs.com/package/${h.name}`, hints: [q.replace("keywords:", "")], categories: [], payload: { version: h.version, date: h.date, score: h.score } });
      }
    }
    log(`discover/npm: ${n} packages`);
  }
  });
  const known = new Set((await listTechnologies({ includeInactive: true })).flatMap((t) => [t.slug, t.name.toLowerCase()]));
  await safeSource("wikidata", log, stats, async () => {
  if (sources.includes("wikidata")) {
    report({ stage: "discover", label: "Querying Wikidata: products of major technology companies", done: 0, total: 2 });
    const owned = await fetchWikidataCompanyProducts();
    report({ stage: "discover", label: "Querying Wikidata: databases, frameworks, brokers, ML frameworks…", done: 1, total: 2 });
    const byClass = await fetchWikidataClassMembers();
    log(`discover/wikidata: ${owned.length} company-owned products, ${byClass.length} class members`);
    for (const w of [...owned, ...byClass]) {
      push({
        key: `wikidata:${w.qid}`,
        name: w.name,
        website: canonicalUrl(w.website),
        description: w.description ?? "",
        sourceType: "wikidata",
        sourceUrl: `https://www.wikidata.org/wiki/${w.qid}`,
        hints: [w.via.replace("wikidata:", ""), ...(w.company ? [w.company] : [])],
        categories: w.categories,
        payload: { qid: w.qid, sitelinks: w.sitelinks, company: w.company, parentCompany: w.parentCompany, via: w.via },
        popularity: w.score * 1000,
      });
    }
  }
  });
  await safeSource("apache", log, stats, async () => {
  if (sources.includes("apache")) {
    report({ stage: "discover", label: "Reading the Apache Software Foundation catalog", done: 0, total: 1 });
    const projects = await fetchApacheProjects();
    log(`discover/apache: ${projects.length} active projects`);
    for (const a of projects) {
      push({ key: `apache:${slugify(a.name)}`, name: a.name, website: canonicalUrl(a.homepage), repo: a.repository, description: a.description, sourceType: "apache", sourceUrl: "https://projects.apache.org", hints: [...a.categories, ...a.languages], categories: mapApacheCategories(a.categories), payload: { company: "Apache Software Foundation", categories: a.categories, languages: a.languages }, popularity: 5000 });
    }
  }
  });
  await safeSource("dockerhub", log, stats, async () => {
  if (sources.includes("dockerhub")) {
    report({ stage: "discover", label: "Reading Docker Hub official images", done: 0, total: 1 });
    const images = await fetchDockerOfficialImages();
    log(`discover/dockerhub: ${images.length} official images`);
    for (const i of images) {
      push({ key: `dockerhub:${i.name}`, name: i.name, website: i.url, description: i.description, sourceType: "dockerhub", sourceUrl: i.url, hints: ["docker official image"], categories: [], payload: { pulls: i.pulls }, popularity: i.pulls / 1000 });
    }
  }
  });
  await safeSource("pypi", log, stats, async () => {
  if (sources.includes("pypi")) {
    report({ stage: "discover", label: "Reading the most-downloaded Python packages", done: 0, total: 1 });
    const pkgs = await fetchTopPypi(400, 120, known);
    log(`discover/pypi: ${pkgs.length} stack-relevant top packages`);
    for (const p of pkgs) {
      push({ key: `pypi:${p.name}`, name: p.name, website: canonicalUrl(p.homepage) ?? (p.repository ? canonicalUrl(p.repository) : `https://pypi.org/project/${p.name}/`), repo: p.repository, description: p.summary, sourceType: "pypi", sourceUrl: `https://pypi.org/project/${p.name}/`, hints: ["python"], categories: [], payload: { downloads: p.downloads }, popularity: p.downloads / 10000 });
    }
  }
  });
  await safeSource("crates", log, stats, async () => {
  if (sources.includes("crates")) {
    report({ stage: "discover", label: "Reading crates.io servers and databases", done: 0, total: 1 });
    const crates = await fetchCrates();
    log(`discover/crates: ${crates.length} crates`);
    for (const c of crates) {
      push({ key: `crates:${c.name}`, name: c.name, website: canonicalUrl(c.homepage) ?? (c.repository ? canonicalUrl(c.repository) : `https://crates.io/crates/${c.name}`), repo: c.repository, description: c.description, sourceType: "crates", sourceUrl: `https://crates.io/crates/${c.name}`, hints: ["rust"], categories: [], payload: { downloads: c.downloads }, popularity: c.downloads / 1000 });
    }
  }
  });
  stats.discovered = raw.length;

  // NORMALIZE + DEDUPLICATE against the catalog and previously processed candidates
  const existing = await listTechnologies({ includeInactive: true });
  const bySlug = new Set(existing.map((t) => t.slug));
  // Shared cloud domains host many products (aws.amazon.com/dynamodb, cloud.google.com/bigtable): key them by path too.
  const byDomain = new Set(existing.map((t) => productKey(t.websiteUrl)).filter(Boolean) as string[]);
  const byRepo = new Set(existing.map((t) => t.repositoryUrl && canonicalUrl(t.repositoryUrl)?.toLowerCase()).filter(Boolean) as string[]);
  const byName = new Set(existing.flatMap((t) => [t.name, t.slug, ...t.aliases]).flatMap(nameVariants));
  const { listCandidates } = await import("@/lib/db/repo");
  const seenBefore = new Set((await listCandidates(undefined, 5000)).filter((c) => c.status !== "pending").map((c) => c.id));
  const { fresh, dupes } = dedupeCandidates(raw, { bySlug, byDomain, byRepo, byName, seenBefore });
  stats.deduplicated = dupes;
  log(`normalize/dedupe: ${fresh.length} new candidates after removing ${dupes} duplicates`);

  // Prioritize: repos by stars, yc by relevance; keep a bounded batch per run.
  // Diverse batches: rank within each source by its own popularity signal, then interleave sources.
  const bySource = new Map<string, RawCandidate[]>();
  for (const c of fresh) bySource.set(c.sourceType, [...(bySource.get(c.sourceType) ?? []), c]);
  for (const list of bySource.values()) list.sort((a, b) => (b.popularity ?? b.stars ?? 0) - (a.popularity ?? a.stars ?? 0));
  const batch: RawCandidate[] = [];
  for (let round = 0; batch.length < limit && [...bySource.values()].some((l) => l.length > round); round++) {
    for (const list of bySource.values()) if (list[round] && batch.length < limit) batch.push(list[round]);
  }
  const rows: DiscoveryCandidateRow[] = batch.map((c) => ({ id: `cand_${slugify(c.name)}`, name: c.name, website: c.website, sourceType: c.sourceType, sourceUrl: c.sourceUrl, status: "pending", data: { ...c.payload, description: c.description, hints: c.hints, repo: c.repo }, createdAt: now(), updatedAt: now() }));
  await upsertCandidates(rows);

  // FETCH (Tier 1 website + repository) for validation evidence
  let fetched = 0;
  report({ stage: "fetch", label: "Checking official websites and repositories", done: 0, total: batch.length });
  const checks = await mapLimit(batch, 4, async (c) => {
    const site = c.website ? await checkWebsite(c.website) : undefined;
    const full = parseRepo(c.repo);
    const repo = full ? await fetchRepo(full) : undefined;
    fetched += 1;
    report({ stage: "fetch", label: `Checking ${c.name}`, done: fetched, total: batch.length });
    return { c, site, repo };
  });

  // CLASSIFY + VALIDATE with TypeSafe (batches of 12 candidates per request)
  const accepted: Technology[] = [];
  const resultRows: DiscoveryCandidateRow[] = [];
  {
    for (let i = 0; i < checks.length; i += 12) {
      const chunk = checks.slice(i, i + 12);
      report({ stage: "validate", label: `TypeSafe validating ${chunk.map((x) => x.c.name).slice(0, 3).join(", ")}${chunk.length > 3 ? "…" : ""}`, done: i, total: checks.length });
      const inputs: CandidateInput[] = chunk.map(({ c, site, repo }) => ({ id: `cand_${slugify(c.name)}`, name: c.name, description: [c.description, repo?.description].filter(Boolean).join(" "), website: c.website, source: c.sourceType, websiteTitle: site?.title, websiteDescription: site?.description, hints: c.hints }));
      let verdicts;
      try {
        verdicts = await classifyCandidates(inputs);
      } catch (err) {
        stats.errors = Number(stats.errors) + 1;
        log(`classify batch failed: ${(err as Error).message}`);
        continue;
      }
      stats.validated = Number(stats.validated) + verdicts.length;
      for (let j = 0; j < chunk.length; j++) {
        const { c, site, repo } = chunk[j];
        const v = verdicts[j];
        const candId = `cand_${slugify(c.name)}`;
        const websiteOk = site ? site.ok : Boolean(repo);
        const reasons: string[] = [];
        if (v.isTechnology < 0.6) reasons.push(`not a stack technology (p=${v.isTechnology.toFixed(2)})`);
        if (v.developerFacing < 0.5) reasons.push(`not developer-facing (p=${v.developerFacing.toFixed(2)})`);
        if (v.utility > 0.65) reasons.push(`low-level utility dependency, not a stack component (p=${v.utility.toFixed(2)})`);
        if (v.subComponent > 0.6) reasons.push(`part of a larger project, not adopted on its own (p=${v.subComponent.toFixed(2)})`);
        if (v.notability < 0.4) reasons.push(`no evidence of production use (adoption ${v.notability.toFixed(2)})`);
        // A catalogue entry has to say what the technology is. Too little text is not a verdict
        // against the technology, so the candidate waits for a run that finds a description.
        const blurb = (site?.description && site.description.length > (c.description?.length ?? 0) ? site.description : c.description) || repo?.description || "";
        const thinText = blurb.trim().length < 40;
        if (!websiteOk) reasons.push(`website unreachable (${site?.status ?? "no website"})`);
        if (site && v.websiteMatches < 0.5) reasons.push(`website does not match (p=${v.websiteMatches.toFixed(2)})`);
        if (v.isActive < 0.5) reasons.push(`appears inactive (p=${v.isActive.toFixed(2)})`);
        if (v.primaryCategory === "none" || !CATEGORY_IDS.has(v.primaryCategory)) reasons.push("no technology category");
        const hold = reasons.length === 0 && (thinText || v.isTechnology < 0.85 || v.developerFacing < 0.7 || v.categoryConfidence < 0.5 || v.notability < 0.6 || v.subComponent > 0.4);
        if (reasons.length) {
          stats.rejected = Number(stats.rejected) + 1;
          resultRows.push({ id: candId, name: c.name, website: c.website, sourceType: c.sourceType, sourceUrl: c.sourceUrl, status: "rejected", reason: reasons.join("; "), data: { ...c.payload, verdict: v }, createdAt: now(), updatedAt: now() });
          continue;
        }
        if (hold) {
          stats.held = Number(stats.held) + 1;
          resultRows.push({ id: candId, name: c.name, website: c.website, sourceType: c.sourceType, sourceUrl: c.sourceUrl, status: "hold", reason: thinText ? `no usable description yet (${blurb.trim().length} chars)` : `low confidence (tech ${v.isTechnology.toFixed(2)}, category ${v.categoryConfidence.toFixed(2)}, adoption ${v.notability.toFixed(2)})`, data: { ...c.payload, verdict: v }, createdAt: now(), updatedAt: now() });
          continue;
        }
        // ENRICH: capabilities (second TypeSafe request), logo, license, repo signals
        const categories = [...new Set([v.primaryCategory, ...c.categories.filter((x) => CATEGORY_IDS.has(x))])];
        const secondary = Object.entries(v.categoryProbabilities)
          .filter(([k, p]) => k !== v.primaryCategory && k !== "none" && p > 0.2 && CATEGORY_IDS.has(k))
          .map(([k]) => k);
        for (const s of secondary) if (!categories.includes(s)) categories.push(s);
        let capProbs: Record<string, number>;
        try {
          capProbs = await classifyCapabilities(inputs[j], categories);
        } catch (err) {
          // No capability judgment means no acceptance: the candidate stays pending for the next run.
          stats.errors = Number(stats.errors) + 1;
          log(`capabilities for ${c.name} failed: ${(err as Error).message}`);
          continue;
        }
        const capabilities = Object.entries(capProbs)
          .filter(([, p]) => p > 0.55)
          .map(([k]) => k);
        const displayName = productName(c.name, site?.title, c.sourceType);
        // A registry slug only becomes a product name at this point ("drizzle-kit" → "Drizzle ORM"),
        // so the catalog is checked once more under the name the technology will actually carry.
        const finalVariants = nameVariants(displayName);
        if (finalVariants.some((nv) => byName.has(nv))) {
          stats.deduplicated = Number(stats.deduplicated) + 1;
          resultRows.push({ id: candId, name: c.name, website: c.website, sourceType: c.sourceType, sourceUrl: c.sourceUrl, status: "rejected", reason: `duplicate: already in the catalog as "${displayName}"`, data: { ...c.payload, verdict: v }, createdAt: now(), updatedAt: now() });
          continue;
        }
        for (const nv of finalVariants) byName.add(nv);
        const slug = slugify(c.name);
        const techId = `tech_${slug}`;
        const logo = resolveLogo([slug, c.name]);
        const tech: Technology = {
          id: techId,
          slug,
          name: displayName,
          aliases: displayName !== c.name ? [c.name] : [],
          companyName: (c.payload.company as string | undefined) ?? (c.sourceType === "yc-oss" ? c.name : undefined),
          parentCompanyName: c.payload.parentCompany as string | undefined,
          companyId: c.sourceType === "yc-oss" ? `co_${slug}` : undefined,
          type: v.type,
          categories,
          subcategories: [],
          capabilities,
          useCases: [],
          tags: [...new Set(c.hints.map((h) => h.toLowerCase()).filter((h) => h.length < 32))].slice(0, 12),
          description: (site?.description && site.description.length > (c.description?.length ?? 0) ? site.description : c.description) || repo?.description || c.name,
          shortDescription: (c.description || site?.description || repo?.description || c.name).split(/(?<=\.)\s/)[0].slice(0, 160),
          websiteUrl: c.website,
          documentationUrl: undefined,
          repositoryUrl: repo?.url ?? c.repo,
          pricingUrl: undefined,
          logoUrl: logo ? `https://cdn.simpleicons.org/${logo.iconSlug}` : (c.payload.logo as string | undefined),
          logoAssetId: logo?.iconSlug,
          brandColor: logo?.color ?? fallbackColor(slug),
          openSource: repo?.license ? true : v.openSource > 0.8 ? true : v.openSource < 0.2 ? false : undefined,
          license: repo?.license ?? c.license,
          repositoryStars: repo?.stars ?? c.stars,
          repositoryActivity: repo?.pushedAt,
          deploymentModels: [],
          supportedClouds: [],
          supportedLanguages: [],
          supportedFrameworks: [],
          integrations: [],
          pricingModel: repo?.license ? "open-source" : "unknown",
          freeTier: undefined,
          pricingSummary: undefined,
          maturity: repo ? (repo.stars > 20000 ? "established" : repo.stars > 5000 ? "growing" : "emerging") : c.sourceType === "cncf" && c.payload.project === "graduated" ? "established" : "emerging",
          status: repo?.archived ? "deprecated" : "active",
          regions: [],
          compliance: [],
          sourceRecords: [{ id: `src_${slug}_${c.sourceType}`, technologyId: techId, sourceType: c.sourceType, sourceUrl: c.sourceUrl, externalId: c.key, retrievedAt: now(), payload: c.payload }],
          evidence: [],
          firstSeenAt: now(),
          lastVerifiedAt: now(),
          lastUpdatedAt: now(),
          confidence: Number((0.5 * v.isTechnology + 0.3 * v.categoryConfidence + 0.2 * (websiteOk ? 1 : 0)).toFixed(2)),
          verificationStatus: "verified",
        };
        addEvidence(tech, evidence(tech, c.sourceType, c.sourceUrl, "existence", c.name, 0.7));
        if (site?.ok && c.website) {
          addEvidence(tech, evidence(tech, "official-website", c.website, "website", site.finalUrl ?? c.website, 0.95));
          if (site.description) addEvidence(tech, evidence(tech, "official-website", c.website, "description", site.description, 0.8));
        }
        if (repo) {
          addEvidence(tech, evidence(tech, "official-repository", repo.url, "repository", repo.url, 0.98));
          addEvidence(tech, evidence(tech, "official-repository", repo.url, "repository-stars", String(repo.stars), 0.98));
          if (repo.license) addEvidence(tech, evidence(tech, "official-repository", repo.url, "license", repo.license, 0.95));
        }
        addEvidence(tech, evidence(tech, "typesafe-classification", c.sourceUrl, "category", v.primaryCategory, v.categoryConfidence));
        for (const cap of capabilities) addEvidence(tech, evidence(tech, "typesafe-classification", c.sourceUrl, "capability", cap, capProbs[cap]));
        if (c.sourceType === "yc-oss") addEvidence(tech, evidence(tech, "yc-oss", c.sourceUrl, "company", `YC ${c.payload.batch ?? ""}`.trim(), 0.9));
        if (c.payload.company) addEvidence(tech, evidence(tech, c.sourceType, c.sourceUrl, "company", [c.payload.company, c.payload.parentCompany].filter(Boolean).join(" → "), 0.9));
        if (logo) addEvidence(tech, evidence(tech, "simple-icons", `https://simpleicons.org/?q=${logo.iconSlug}`, "logo", logo.iconSlug, 0.9));
        accepted.push(tech);
        stats.accepted = Number(stats.accepted) + 1;
        resultRows.push({ id: candId, name: c.name, website: c.website, sourceType: c.sourceType, sourceUrl: c.sourceUrl, status: "accepted", reason: `${v.primaryCategory} · ${capabilities.join(", ") || "no slot capabilities"}`, data: { ...c.payload, verdict: v, technologyId: techId }, createdAt: now(), updatedAt: now() });
      }
    }
  }
  await upsertCandidates(resultRows);
  if (accepted.length) {
    const res = await upsertTechnologies(accepted, { source: "pipeline:discover", recordChanges: true, confidence: 0.75 });
    log(`upsert: ${res.inserted} new technologies added (${accepted.map((t) => t.name).slice(0, 12).join(", ")}${accepted.length > 12 ? "…" : ""})`);
  }
  log(`validate: ${stats.validated} classified, ${stats.accepted} accepted, ${stats.rejected} rejected, ${stats.held} held`);
}

/**
 * Keep only candidates that are neither already in the catalog nor duplicated within the
 * batch. Dedupe keys: the repository, then the product URL, and always the slug, because
 * the slug becomes the technology id and two sources often describe one product under
 * different names, repositories or domains.
 */
export function dedupeCandidates(
  raw: RawCandidate[],
  known: { bySlug: Set<string>; byDomain: Set<string>; byRepo: Set<string>; byName: Set<string>; seenBefore: Set<string> },
): { fresh: RawCandidate[]; dupes: number } {
  const fresh: RawCandidate[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  let dupes = 0;
  for (const c of raw) {
    const slug = slugify(c.name);
    if (!slug || slug.length < 2) continue;
    const dom = productKey(c.website);
    const repo = c.repo ? canonicalUrl(c.repo)?.toLowerCase() : undefined;
    const dupKey = repo ?? dom ?? slug;
    const slugKey = `slug:${slug}`;
    // A vendor domain hosts many sibling products (vercel.com/blob, supabase.com/auth), so a URL match
    // alone is not a duplicate: the name has to match as well. Repositories and slugs are decisive.
    const urlDuplicate = Boolean(dom && known.byDomain.has(dom) && nameVariants(c.name).some((v) => known.byName.has(v)));
    const variants = nameVariants(c.name);
    // The same product often arrives from two sources under different names in one batch
    // ("Apache CouchDB" from Apache, "couchdb" from Docker Hub), so names are matched
    // against what this batch already kept, not only against the catalog.
    if (known.bySlug.has(slug) || variants.some((v) => known.byName.has(v) || seenNames.has(v)) || urlDuplicate || (repo && known.byRepo.has(repo)) || seenKeys.has(dupKey) || seenKeys.has(slugKey)) {
      dupes++;
      continue;
    }
    seenKeys.add(dupKey);
    seenKeys.add(slugKey);
    for (const v of variants) seenNames.add(v);
    if (known.seenBefore.has(`cand_${slug}`)) continue;
    fresh.push(c);
  }
  return { fresh, dupes };
}

/** Prefer the product name from the website title over a repository/package slug. */
export function productName(raw: string, siteTitle: string | undefined, sourceType: SourceType): string {
  if (!["github", "npm", "pypi", "crates", "dockerhub"].includes(sourceType)) return raw;
  if (sourceType === "dockerhub" || sourceType === "pypi" || sourceType === "crates") siteTitle = undefined; // registry pages are titled by the registry
  const humanized = raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  if (!siteTitle) return humanized;
  const head = siteTitle.split(/\s+[-|–—:·]\s+/)[0].trim();
  // Code-host titles describe a file view ("owner/repo at master"), not a product.
  if (/\//.test(head) || /\sat\s\S+$/.test(head) || /^GitHub\b/i.test(head)) return humanized;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  // A title that is just the package id ("agents-cli") is the registry echoing the slug back.
  const slugLike = /^[a-z0-9]+([-_][a-z0-9]+)+$/.test(head);
  if (!slugLike && head.length >= 2 && head.length <= 40 && (norm(head).includes(norm(raw)) || norm(raw).includes(norm(head)) || norm(head).startsWith(norm(raw).slice(0, 4)))) return head;
  return humanized;
}

// ---------------------------------------------------------------------------
// EMBED
// ---------------------------------------------------------------------------

async function embedMissing(stats: Record<string, number | string>, log: (l: string) => void) {
  const provider = getEmbeddingProvider();
  const all = await listTechnologies({ includeInactive: true });
  const missing = all.filter((t) => !t.semanticEmbedding || t.embeddingProvider !== provider.id || t.semanticEmbedding.length !== provider.dimensions);
  if (!missing.length) {
    log(`embed: all ${all.length} technologies embedded with ${provider.id}`);
    return;
  }
  const vecs = await provider.embed(missing.map(technologyEmbeddingText));
  await saveEmbeddings(missing.map((t, i) => ({ id: t.id, embedding: vecs[i], provider: provider.id })));
  stats.embedded = missing.length;
  log(`embed: ${missing.length} technologies embedded with ${provider.id}`);
}
