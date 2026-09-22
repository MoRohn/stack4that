import { getDb } from "./client";
import { createHash } from "node:crypto";
import { seedTechnologies } from "@/lib/catalog";
import type { Architecture, Technology, TechnologyChange } from "@/lib/types";

// In-process cache of the active catalog (the retrieval index reads from it).
let catalogCache: { version: number; items: Technology[] } | null = null;
let catalogVersion = 0;

export function invalidateCatalogCache() {
  catalogVersion += 1;
  catalogCache = null;
}

function rowToTech(row: Record<string, unknown>): Technology {
  const tech = JSON.parse(String(row.data)) as Technology;
  if (row.embedding) {
    tech.semanticEmbedding = JSON.parse(String(row.embedding)) as number[];
    tech.embeddingProvider = row.embedding_provider ? String(row.embedding_provider) : undefined;
  }
  return tech;
}

function techToRow(t: Technology) {
  const { semanticEmbedding, embeddingProvider, ...rest } = t;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    verification_status: t.verificationStatus,
    data: JSON.stringify(rest),
    embedding: semanticEmbedding ? JSON.stringify(semanticEmbedding) : null,
    embedding_provider: embeddingProvider ?? null,
    updated_at: t.lastUpdatedAt,
  };
}

/** Fields the pipeline owns: verified from live sources, never overwritten by the curated seed. */
/** Bump to force a re-merge of the curated seed (e.g. after repairing bad pipeline data). */
const SEED_SYNC_REVISION = 2;
const PIPELINE_FIELDS: Array<keyof Technology> = ["repositoryStars", "repositoryActivity", "lastVerifiedAt", "verificationStatus", "firstSeenAt", "status", "semanticEmbedding", "embeddingProvider"];

/**
 * Ensure the catalog is seeded and in sync with the curated seed. When the
 * seed changes (new technologies, corrected capabilities), curated fields are
 * merged into existing rows while pipeline-verified facts and all evidence
 * are preserved. Idempotent and cheap after the first call.
 */
let seeded: Promise<void> | null = null;

/** Force the next ensureSeeded() to re-check the seed version (after swapping databases, or in tests). */
export function resetSeedSync() {
  seeded = null;
  invalidateCatalogCache();
}

export function ensureSeeded(): Promise<void> {
  if (!seeded) {
    seeded = (async () => {
      const db = await getDb();
      const seed = seedTechnologies();
      const version = `${SEED_SYNC_REVISION}:` + createHash("sha1").update(JSON.stringify(seed.map((t) => ({ ...t, firstSeenAt: undefined, lastUpdatedAt: undefined })))).digest("hex").slice(0, 16);
      const current = await db.execute({ sql: "SELECT value FROM meta WHERE key = 'seed_version'", args: [] });
      if (current.rows[0]?.value === version) return;
      const existingRes = await db.execute("SELECT data FROM technologies");
      const existing = new Map(existingRes.rows.map((r) => {
        const t = JSON.parse(String(r.data)) as Technology;
        return [t.id, t] as const;
      }));
      const merged = seed.map((s) => {
        const prev = existing.get(s.id);
        if (!prev) return s;
        const next: Technology = { ...s };
        for (const f of PIPELINE_FIELDS) (next as unknown as Record<string, unknown>)[f] = prev[f] ?? s[f];
        // A newer license or description verified from an official source beats the curated value.
        const placeholder = (v?: string) => !v || /^(other|noassertion|unknown)$/i.test(v);
        if (!placeholder(prev.license) && prev.evidence.some((e) => e.claimType === "license" && e.sourceType === "official-repository" && e.extractedValue === prev.license)) next.license = prev.license;
        next.evidence = [...prev.evidence.filter((e) => e.sourceType !== "curated-seed" && !(e.claimType === "license" && placeholder(e.extractedValue))), ...s.evidence];
        next.sourceRecords = [...prev.sourceRecords.filter((r) => r.sourceType !== "curated-seed"), ...s.sourceRecords];
        next.tags = [...new Set([...s.tags, ...prev.tags.filter((t) => t === "unreachable" || t === "inactive-repository")])];
        next.lastUpdatedAt = new Date().toISOString();
        return next;
      });
      await upsertTechnologies(merged, { source: "curated-seed", recordChanges: existing.size > 0, confidence: 0.85 });
      await db.execute({ sql: "INSERT INTO meta (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [version] });
    })().catch((err) => {
      seeded = null;
      throw err;
    });
  }
  return seeded;
}

/** Detect catalog writes made by another process (e.g. `stack4that refresh` next to the running app). */
let lastExternalCheck = 0;
let lastExternalStamp = "";
async function checkExternalChanges() {
  if (Date.now() - lastExternalCheck < 5000) return;
  lastExternalCheck = Date.now();
  const db = await getDb();
  const res = await db.execute("SELECT COUNT(*) AS n, MAX(updated_at) AS m, (SELECT COUNT(*) FROM technology_changes) AS c FROM technologies");
  const stamp = `${res.rows[0].n}:${res.rows[0].m}:${res.rows[0].c}`;
  if (lastExternalStamp && stamp !== lastExternalStamp) invalidateCatalogCache();
  lastExternalStamp = stamp;
}

export async function listTechnologies(opts: { includeInactive?: boolean } = {}): Promise<Technology[]> {
  await ensureSeeded();
  await checkExternalChanges();
  if (catalogCache && catalogCache.version === catalogVersion && !opts.includeInactive) return catalogCache.items;
  const db = await getDb();
  const res = await db.execute("SELECT * FROM technologies ORDER BY name");
  const all = res.rows.map((r) => rowToTech(r as unknown as Record<string, unknown>));
  const active = all.filter((t) => t.status !== "sunset");
  if (!opts.includeInactive) catalogCache = { version: catalogVersion, items: active };
  return opts.includeInactive ? all : active;
}

export async function getTechnology(idOrSlug: string): Promise<Technology | undefined> {
  await ensureSeeded();
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM technologies WHERE id = ? OR slug = ? LIMIT 1", args: [idOrSlug, idOrSlug] });
  const row = res.rows[0];
  return row ? rowToTech(row as unknown as Record<string, unknown>) : undefined;
}

export async function getTechnologies(ids: string[]): Promise<Technology[]> {
  const all = await listTechnologies({ includeInactive: true });
  const set = new Set(ids);
  return all.filter((t) => set.has(t.id) || set.has(t.slug));
}

const TRACKED_FIELDS: Array<keyof Technology> = [
  "name",
  "status",
  "license",
  "openSource",
  "pricingModel",
  "pricingSummary",
  "freeTier",
  "websiteUrl",
  "repositoryUrl",
  "companyName",
  "categories",
  "capabilities",
  "integrations",
  "deploymentModels",
  "compliance",
  "maturity",
];

function changeKindFor(field: keyof Technology, prev: unknown, next: unknown): TechnologyChange["changeKind"] {
  switch (field) {
    case "name":
      return "renamed";
    case "companyName":
      return "acquisition";
    case "status":
      return next === "sunset" ? "shutdown" : next === "deprecated" ? "deprecated" : "field";
    case "pricingModel":
    case "pricingSummary":
    case "freeTier":
      return "pricing";
    case "license":
    case "openSource":
      return "license";
    case "capabilities":
    case "categories":
      return "capability";
    case "integrations":
      return "integration";
    case "deploymentModels":
      return "deployment-model";
    case "repositoryActivity":
      return "repository-inactivity";
    default:
      void prev;
      return "field";
  }
}

export interface UpsertOptions {
  source: string;
  recordChanges?: boolean;
  confidence?: number;
}

/**
 * Upsert technologies, diffing tracked fields against the stored version and
 * appending TechnologyChange rows. Never deletes.
 */
export async function upsertTechnologies(techs: Technology[], opts: UpsertOptions): Promise<{ inserted: number; updated: number; changes: TechnologyChange[] }> {
  const db = await getDb();
  const changes: TechnologyChange[] = [];
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();
  const existingRes = await db.execute("SELECT id, slug, data FROM technologies");
  const existing = new Map<string, Technology>();
  for (const r of existingRes.rows) existing.set(String(r.id), JSON.parse(String(r.data)) as Technology);

  const statements: Array<{ sql: string; args: (string | number | null)[] }> = [];
  for (const tech of techs) {
    const prev = existing.get(tech.id);
    if (prev) {
      updated += 1;
      if (opts.recordChanges !== false) {
        for (const field of TRACKED_FIELDS) {
          const a = JSON.stringify(prev[field] ?? null);
          const b = JSON.stringify(tech[field] ?? null);
          if (a !== b) {
            changes.push({
              id: `chg_${tech.id}_${field}_${Date.now()}_${changes.length}`,
              technologyId: tech.id,
              field,
              previousValue: prev[field] == null ? null : a,
              newValue: tech[field] == null ? null : b,
              detectedAt: now,
              source: opts.source,
              confidence: opts.confidence ?? 0.8,
              changeKind: changeKindFor(field, prev[field], tech[field]),
            });
          }
        }
      }
    } else {
      inserted += 1;
      if (opts.recordChanges !== false) {
        changes.push({
          id: `chg_${tech.id}_new_${Date.now()}`,
          technologyId: tech.id,
          field: "*",
          previousValue: null,
          newValue: tech.name,
          detectedAt: now,
          source: opts.source,
          confidence: opts.confidence ?? tech.confidence,
          changeKind: "new-technology",
        });
      }
    }
    const row = techToRow(tech);
    statements.push({
      sql: `INSERT INTO technologies (id, slug, name, status, verification_status, data, embedding, embedding_provider, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, status=excluded.status,
              verification_status=excluded.verification_status, data=excluded.data,
              embedding=COALESCE(excluded.embedding, technologies.embedding),
              embedding_provider=COALESCE(excluded.embedding_provider, technologies.embedding_provider),
              updated_at=excluded.updated_at`,
      args: [row.id, row.slug, row.name, row.status, row.verification_status, row.data, row.embedding, row.embedding_provider, row.updated_at],
    });
  }
  for (const c of changes) {
    statements.push({
      sql: `INSERT INTO technology_changes (id, technology_id, field, previous_value, new_value, detected_at, source, confidence, change_kind) VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [c.id, c.technologyId, c.field, c.previousValue, c.newValue, c.detectedAt, c.source, c.confidence, c.changeKind],
    });
  }
  // libsql batch in chunks to stay under statement limits
  for (let i = 0; i < statements.length; i += 200) {
    await db.batch(statements.slice(i, i + 200), "write");
  }
  invalidateCatalogCache();
  return { inserted, updated, changes };
}

/** Append an explicit change record (used by the pipeline for derived lifecycle signals). */
export async function recordChange(change: Omit<TechnologyChange, "id" | "detectedAt">) {
  const db = await getDb();
  const c: TechnologyChange = { ...change, id: `chg_${change.technologyId}_${change.field}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, detectedAt: new Date().toISOString() };
  await db.execute({
    sql: `INSERT INTO technology_changes (id, technology_id, field, previous_value, new_value, detected_at, source, confidence, change_kind) VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [c.id, c.technologyId, c.field, c.previousValue, c.newValue, c.detectedAt, c.source, c.confidence, c.changeKind],
  });
}

export async function saveEmbeddings(items: Array<{ id: string; embedding: number[]; provider: string }>) {
  const db = await getDb();
  const stmts = items.map((i) => ({
    sql: "UPDATE technologies SET embedding = ?, embedding_provider = ? WHERE id = ?",
    args: [JSON.stringify(i.embedding), i.provider, i.id],
  }));
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200), "write");
  invalidateCatalogCache();
}

export async function listChanges(opts: { technologyId?: string; limit?: number } = {}): Promise<TechnologyChange[]> {
  const db = await getDb();
  const res = opts.technologyId
    ? await db.execute({ sql: "SELECT * FROM technology_changes WHERE technology_id = ? ORDER BY detected_at DESC LIMIT ?", args: [opts.technologyId, opts.limit ?? 100] })
    : await db.execute({ sql: "SELECT * FROM technology_changes ORDER BY detected_at DESC LIMIT ?", args: [opts.limit ?? 100] });
  return res.rows.map((r) => ({
    id: String(r.id),
    technologyId: String(r.technology_id),
    field: String(r.field),
    previousValue: r.previous_value == null ? null : String(r.previous_value),
    newValue: r.new_value == null ? null : String(r.new_value),
    detectedAt: String(r.detected_at),
    source: String(r.source),
    confidence: Number(r.confidence),
    changeKind: String(r.change_kind) as TechnologyChange["changeKind"],
  }));
}

// ---------------------------------------------------------------------------
// Discovery candidates
// ---------------------------------------------------------------------------

export interface DiscoveryCandidateRow {
  id: string;
  name: string;
  website?: string;
  sourceType: string;
  sourceUrl: string;
  status: "pending" | "accepted" | "rejected" | "hold" | "duplicate";
  reason?: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export async function upsertCandidates(rows: DiscoveryCandidateRow[]) {
  const db = await getDb();
  const stmts = rows.map((c) => ({
    sql: `INSERT INTO discovery_candidates (id, name, website, source_type, source_url, status, reason, data, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status, reason=excluded.reason, data=excluded.data, updated_at=excluded.updated_at`,
    args: [c.id, c.name, c.website ?? null, c.sourceType, c.sourceUrl, c.status, c.reason ?? null, JSON.stringify(c.data), c.createdAt, c.updatedAt],
  }));
  for (let i = 0; i < stmts.length; i += 200) await db.batch(stmts.slice(i, i + 200), "write");
}

export async function listCandidates(status?: DiscoveryCandidateRow["status"], limit = 200): Promise<DiscoveryCandidateRow[]> {
  const db = await getDb();
  const res = status
    ? await db.execute({ sql: "SELECT * FROM discovery_candidates WHERE status = ? ORDER BY updated_at DESC LIMIT ?", args: [status, limit] })
    : await db.execute({ sql: "SELECT * FROM discovery_candidates ORDER BY updated_at DESC LIMIT ?", args: [limit] });
  return res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    website: r.website ? String(r.website) : undefined,
    sourceType: String(r.source_type),
    sourceUrl: String(r.source_url),
    status: String(r.status) as DiscoveryCandidateRow["status"],
    reason: r.reason ? String(r.reason) : undefined,
    data: JSON.parse(String(r.data)),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

// ---------------------------------------------------------------------------
// Pipeline runs
// ---------------------------------------------------------------------------

export interface PipelineRunRow {
  id: string;
  startedAt: string;
  finishedAt?: string;
  mode: string;
  status: "running" | "completed" | "failed";
  stats: Record<string, unknown>;
  log: string[];
}

export async function savePipelineRun(run: PipelineRunRow) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO pipeline_runs (id, started_at, finished_at, mode, status, stats, log) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET finished_at=excluded.finished_at, status=excluded.status, stats=excluded.stats, log=excluded.log`,
    args: [run.id, run.startedAt, run.finishedAt ?? null, run.mode, run.status, JSON.stringify(run.stats), JSON.stringify(run.log)],
  });
}

export async function listPipelineRuns(limit = 20): Promise<PipelineRunRow[]> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?", args: [limit] });
  return res.rows.map((r) => ({
    id: String(r.id),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : undefined,
    mode: String(r.mode),
    status: String(r.status) as PipelineRunRow["status"],
    stats: JSON.parse(String(r.stats)),
    log: JSON.parse(String(r.log)),
  }));
}

// ---------------------------------------------------------------------------
// Saved architectures
// ---------------------------------------------------------------------------

export async function saveArchitecture(arch: Architecture) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO architectures (id, request, created_at, data) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    args: [arch.id, arch.request, arch.createdAt, JSON.stringify(arch)],
  });
}

export async function getArchitecture(id: string): Promise<Architecture | undefined> {
  const db = await getDb();
  const res = await db.execute({ sql: "SELECT data FROM architectures WHERE id = ?", args: [id] });
  const row = res.rows[0];
  return row ? (JSON.parse(String(row.data)) as Architecture) : undefined;
}

export async function catalogStats() {
  const all = await listTechnologies({ includeInactive: true });
  const active = all.filter((t) => t.status !== "sunset");
  const withEmbeddings = all.filter((t) => t.semanticEmbedding).length;
  const verified = all.filter((t) => t.verificationStatus === "verified").length;
  const lastUpdated = all.reduce((m, t) => (t.lastUpdatedAt > m ? t.lastUpdatedAt : m), "");
  return { total: all.length, active: active.length, withEmbeddings, verified, lastUpdated };
}
