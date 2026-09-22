/**
 * Database access. libSQL (SQLite-compatible) so the app runs locally with a
 * file, in CI with :memory:, and on Turso/libSQL in production.
 *
 *   DATABASE_URL=file:./data/stack4that.db   (default)
 *   DATABASE_URL=libsql://...  + DATABASE_AUTH_TOKEN
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

let client: Client | null = null;
let ready: Promise<void> | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS technologies (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  data TEXT NOT NULL,
  embedding TEXT,
  embedding_provider TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tech_status ON technologies(status);
CREATE TABLE IF NOT EXISTS technology_changes (
  id TEXT PRIMARY KEY,
  technology_id TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  change_kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_tech ON technology_changes(technology_id);
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cand_status ON discovery_candidates(status);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  stats TEXT NOT NULL,
  log TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS architectures (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL
);
`;

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "file:./data/stack4that.db";
}

export async function getDb(): Promise<Client> {
  if (client && ready) {
    await ready;
    return client;
  }
  const url = databaseUrl();
  if (url.startsWith("file:")) {
    const filePath = url.slice("file:".length);
    if (filePath !== ":memory:") {
      try {
        fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
      } catch {
        /* read-only filesystem: fall through, open will fail and we fall back */
      }
    }
  }
  try {
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });
    const c = client;
    ready = (async () => {
      if (url.startsWith("file:") && !url.includes(":memory:")) {
        // The app and the pipeline (stack4that refresh) may write at the same time.
        await c.execute("PRAGMA journal_mode = WAL");
        await c.execute("PRAGMA busy_timeout = 10000");
      }
      await c.executeMultiple(SCHEMA);
    })();
    await ready;
  } catch (err) {
    console.warn(`[db] could not open ${url} (${(err as Error).message}); falling back to in-memory database`);
    client = createClient({ url: ":memory:" });
    ready = client.executeMultiple(SCHEMA);
    await ready;
  }
  return client;
}

export async function closeDb() {
  client?.close();
  client = null;
  ready = null;
}

/** Test helper: force a fresh in-memory database. */
export async function useInMemoryDb() {
  await closeDb();
  const repo = await import("./repo");
  repo.resetSeedSync();
  process.env.DATABASE_URL = "file::memory:";
  client = createClient({ url: ":memory:" });
  ready = client.executeMultiple(SCHEMA);
  await ready;
  return client;
}
