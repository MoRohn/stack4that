/**
 * Curation pass over the catalogue: find thin entries and let TypeSafe judge them.
 *
 * Discovery admits some things that read as technologies but are not stack choices: a
 * project's own sub-modules, demos, course material, tiny repositories. This selects the
 * entries that look thin, asks TypeSafe whether a team would actually choose each one, and
 * retires those it rules out. Nothing is deleted; entries move to the "sunset" status with
 * the judgment and its probability recorded as the reason.
 *
 * Usage: npx tsx scripts/prune-thin.ts [--dry-run] [--limit N]
 */
import "../env";
import { getDb } from "../../src/lib/db/client";
import { invalidateCatalogCache, listTechnologies, recordChange } from "../../src/lib/db/repo";
import { reviewCatalogEntries, type CatalogReviewInput } from "../../src/lib/pipeline/classify";
import type { Technology } from "../../src/lib/types";

const CURATED = "curated-seed";
/**
 * Retirement policy. Adoption and "would a team pick this" are separate judgments, and one
 * weak signal is not enough: a niche authorization service scores low on adoption but is a
 * real choice, and a famous legacy framework scores high on adoption but nobody picks it
 * today. An entry goes only when both axes agree, or when it is plainly part of something
 * else. Adoption is 0 (barely used) to 1 (mainstream).
 */
const MAX_SUB_COMPONENT = 0.6;
const UNUSED = 0.4;
const NOT_A_CHOICE = 0.6;
const WEAK_CHOICE = 0.5;
const WELL_KNOWN = 0.67;

function shouldRetire(v: { subComponent: number; notability: number; stackChoice: number }): string | null {
  if (v.subComponent > MAX_SUB_COMPONENT) return `part of a larger project (p=${v.subComponent.toFixed(2)})`;
  if (v.notability < UNUSED && v.stackChoice < NOT_A_CHOICE) return `no evidence of production use (adoption ${v.notability.toFixed(2)}, would be picked p=${v.stackChoice.toFixed(2)})`;
  if (v.stackChoice < WEAK_CHOICE && v.notability < WELL_KNOWN) return `not chosen at the architecture level (p=${v.stackChoice.toFixed(2)}, adoption ${v.notability.toFixed(2)})`;
  return null;
}

function thin(t: Technology): string | null {
  if (t.sourceRecords.some((s) => s.sourceType === CURATED)) return null;
  const text = (t.shortDescription || t.description || "").trim();
  if (text.length < 40) return `description is ${text.length} characters`;
  if (/^[a-z0-9]+([-_][a-z0-9]+)+$/.test(t.name) || /^[a-z]/.test(t.name)) return "name is a registry slug";
  if (typeof t.repositoryStars === "number" && t.repositoryStars < 400) return `${t.repositoryStars} repository stars`;
  return null;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 400;

  const all = await listTechnologies();
  const suspects = all.map((t) => ({ t, why: thin(t) })).filter((x): x is { t: Technology; why: string } => Boolean(x.why)).slice(0, limit);
  console.log(`${suspects.length} of ${all.length} active technologies look thin; asking TypeSafe about each`);
  if (!suspects.length) return;

  const verdicts = new Map<string, { subComponent: number; notability: number; stackChoice: number }>();
  for (let i = 0; i < suspects.length; i += 10) {
    const chunk = suspects.slice(i, i + 10);
    const inputs: CatalogReviewInput[] = chunk.map(({ t }) => ({
      id: t.id,
      name: t.name,
      description: (t.description || t.shortDescription || "").slice(0, 600),
      categories: t.categories,
      source: t.sourceRecords[0]?.sourceType ?? "unknown",
      stars: t.repositoryStars,
      website: t.websiteUrl,
      type: t.type,
      maturity: t.maturity,
    }));
    try {
      for (const v of await reviewCatalogEntries(inputs)) verdicts.set(v.id, v);
    } catch (err) {
      console.log(`  review failed for a batch, keeping those entries: ${(err as Error).message}`);
    }
    process.stdout.write(`  reviewed ${Math.min(i + 10, suspects.length)}/${suspects.length}\r`);
  }
  console.log("");

  const dumpArg = process.argv.indexOf("--dump");
  if (dumpArg > -1) {
    const rows = suspects.map(({ t, why }) => ({ name: t.name, id: t.id, why, ...(verdicts.get(t.id) ?? {}) }));
    await (await import("node:fs/promises")).writeFile(process.argv[dumpArg + 1], JSON.stringify(rows, null, 1));
    console.log(`wrote ${rows.length} verdicts to ${process.argv[dumpArg + 1]}`);
  }

  const retire = suspects.filter(({ t }) => {
    const v = verdicts.get(t.id);
    return v ? Boolean(shouldRetire(v)) : false;
  });

  for (const { t, why } of retire) {
    const v = verdicts.get(t.id)!;
    const reason = shouldRetire(v)!;
    console.log(`${dry ? "would retire" : "retiring"} ${t.name} — ${reason}; adoption ${v.notability.toFixed(2)}, sub-project ${v.subComponent.toFixed(2)}, stack choice ${v.stackChoice.toFixed(2)}; flagged because ${why}`);
    if (dry) continue;
    const now = new Date().toISOString();
    const db = await getDb();
    await db.execute({ sql: "UPDATE technologies SET status = ?, data = ?, updated_at = ? WHERE id = ?", args: ["sunset", JSON.stringify({ ...t, status: "sunset", lastUpdatedAt: now }), now, t.id] });
    await recordChange({ technologyId: t.id, field: "status", previousValue: t.status, newValue: "sunset", source: "typesafe-curation", confidence: 0.85, changeKind: "deprecated" });
    await recordChange({ technologyId: t.id, field: "curation_reason", previousValue: null, newValue: reason, source: "typesafe-curation", confidence: 0.85, changeKind: "deprecated" });
  }

  const keptNames = suspects.filter((x) => !retire.includes(x)).map((x) => x.t.name);
  if (keptNames.length) console.log(`\nkept: ${keptNames.join(", ")}`);
  if (!dry && retire.length) invalidateCatalogCache();
  const kept = suspects.length - retire.length;
  console.log(`\n${dry ? "would retire" : "retired"} ${retire.length}; TypeSafe kept ${kept} of the flagged entries`);
  if (!dry) console.log(`${(await listTechnologies()).length} active technologies remain`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
