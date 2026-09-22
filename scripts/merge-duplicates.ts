/**
 * Merge technologies that describe the same product under two names.
 *
 * The loser keeps existing (nothing is deleted) but moves to the "sunset" status so it
 * leaves the active catalog, and its name, aliases and source records are folded into the
 * winner so no provenance is lost. Every merge is recorded in the change log.
 *
 * Usage: npx tsx scripts/merge-duplicates.ts [--dry-run]
 */
import "./env";
import { getDb } from "../src/lib/db/client";
import { invalidateCatalogCache, listTechnologies, recordChange } from "../src/lib/db/repo";
import type { Technology } from "../src/lib/types";

/** keep -> retire */
const MERGES: Array<[string, string]> = [
  ["couchdb", "apache-couchdb"],
  ["bigquery", "google-cloud-bigquery"],
  ["drizzle", "drizzle-kit"],
  ["amazon-rds", "amazon-relational-database-service"],
];

async function main() {
  const dry = process.argv.includes("--dry-run");
  const all = await listTechnologies({ includeInactive: true });
  const db = await getDb();
  let merged = 0;

  for (const [keepSlug, dropSlug] of MERGES) {
    const keep = all.find((t) => t.slug === keepSlug);
    const drop = all.find((t) => t.slug === dropSlug);
    if (!keep || !drop) {
      console.log(`- ${keepSlug} + ${dropSlug}: pair not found`);
      continue;
    }
    if (drop.status === "sunset") {
      console.log(`- ${dropSlug}: already retired`);
      continue;
    }
    console.log(`${dry ? "would merge" : "merging"} "${drop.name}" (${dropSlug}) into "${keep.name}" (${keepSlug})`);
    if (dry) continue;

    const now = new Date().toISOString();
    const winner: Technology = {
      ...keep,
      aliases: [...new Set([...keep.aliases, drop.name, ...drop.aliases].filter((n) => n && n !== keep.name))],
      sourceRecords: [...new Map([...keep.sourceRecords, ...drop.sourceRecords.map((r) => ({ ...r, technologyId: keep.id }))].map((r) => [r.id, r])).values()],
      lastUpdatedAt: now,
    };
    const loser: Technology = { ...drop, status: "sunset", lastUpdatedAt: now };

    const tx = await db.transaction("write");
    try {
      await tx.execute({ sql: "UPDATE technologies SET data = ?, updated_at = ? WHERE id = ?", args: [JSON.stringify(winner), now, winner.id] });
      await tx.execute({ sql: "UPDATE technologies SET status = ?, data = ?, updated_at = ? WHERE id = ?", args: ["sunset", JSON.stringify(loser), now, loser.id] });
      await tx.commit();
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }

    await recordChange({ technologyId: loser.id, field: "status", previousValue: drop.status, newValue: "sunset", source: "catalog-curation", confidence: 0.9, changeKind: "deprecated" });
    await recordChange({ technologyId: loser.id, field: "merged_into", previousValue: null, newValue: keep.id, source: "catalog-curation", confidence: 0.9, changeKind: "renamed" });
    await recordChange({ technologyId: winner.id, field: "aliases", previousValue: JSON.stringify(keep.aliases), newValue: JSON.stringify(winner.aliases), source: "catalog-curation", confidence: 0.9, changeKind: "renamed" });
    merged += 1;
  }

  if (!dry) invalidateCatalogCache();
  console.log(`\nmerged ${merged}; ${(await listTechnologies()).length} active technologies remain`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
