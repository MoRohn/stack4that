/**
 * Repair provenance for technologies that were written without their change records.
 *
 * A pipeline run used to write technologies and their change records in separate batches,
 * so a failure between the two could leave discovered technologies with no entry in the
 * change log. Upserts are transactional now; this backfills the rows that were lost.
 *
 * Only technologies discovered by the pipeline are touched. Curated seed entries have no
 * discovery event and are left alone. Usage: npx tsx scripts/backfill-provenance.ts [--dry-run]
 */
import "../env";
import { getDb } from "../../src/lib/db/client";
import type { Technology } from "../../src/lib/types";

const DISCOVERY_SOURCES = new Set(["yc-oss", "cncf", "github", "npm", "wikidata", "apache", "dockerhub", "pypi", "crates"]);

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getDb();
  const withChanges = new Set((await db.execute("SELECT DISTINCT technology_id t FROM technology_changes")).rows.map((r) => String(r.t)));
  const rows = (await db.execute("SELECT id, data FROM technologies")).rows;

  const missing = rows
    .map((r) => JSON.parse(String(r.data)) as Technology)
    .filter((t) => !withChanges.has(t.id) && t.sourceRecords.some((s) => DISCOVERY_SOURCES.has(s.sourceType)));

  console.log(`${missing.length} discovered technologies have no change record`);
  if (!missing.length || dry) {
    for (const t of missing.slice(0, 10)) console.log(` - ${t.name} (${t.sourceRecords[0]?.sourceType}, first seen ${t.firstSeenAt})`);
    return;
  }

  const stmts = missing.map((t) => ({
    sql: "INSERT INTO technology_changes (id, technology_id, field, previous_value, new_value, detected_at, source, confidence, change_kind) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    args: [`chg_${t.id}_new_backfill`, t.id, "*", null, t.name, t.firstSeenAt, `pipeline:discover (backfilled from ${t.sourceRecords[0]?.sourceType ?? "source record"})`, t.confidence ?? 0.75, "new-technology"],
  }));

  const tx = await db.transaction("write");
  try {
    for (let i = 0; i < stmts.length; i += 200) await tx.batch(stmts.slice(i, i + 200));
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
  console.log(`backfilled ${missing.length} change records`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
