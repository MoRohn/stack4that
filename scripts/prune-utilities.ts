/**
 * Retire catalog entries that are low-level libraries, SDKs or middleware rather than
 * architectural choices, plus registry duplicates of an existing product.
 *
 * Nothing is deleted: each entry is moved to the "sunset" lifecycle status (so it leaves
 * the active catalog and candidate retrieval) and the transition is recorded in
 * technology_changes with its reason.
 *
 * Usage: npx tsx scripts/prune-utilities.ts [--dry-run]
 */
import "./env";
import { getDb } from "../src/lib/db/client";
import { invalidateCatalogCache, listTechnologies, recordChange } from "../src/lib/db/repo";

/** slug -> why it is not an architectural choice. */
const PRUNE: Record<string, string> = {
  aiobotocore: "async client library for botocore, a dependency rather than a stack choice",
  aiohttp: "low-level HTTP client/server library, not a backend framework choice",
  anyio: "low-level async compatibility library, a dependency rather than a stack choice",
  boto3: "vendor SDK for AWS, not a technology selected in an architecture",
  ghapi: "GitHub API client library, a dependency rather than a stack choice",
  "opentelemetry-api": "language binding of OpenTelemetry, already represented by opentelemetry",
  pyjwt: "JWT encoding library, a dependency rather than an authentication choice",
  "tokio-rustls": "TLS adapter crate for Tokio, a dependency rather than a stack choice",
  tower: "middleware component library, a dependency rather than a stack choice",
  "tower-http": "HTTP middleware component library, a dependency rather than a stack choice",
};

async function main() {
  const dry = process.argv.includes("--dry-run");
  const all = await listTechnologies({ includeInactive: true });
  const db = await getDb();
  let retired = 0;

  for (const [slug, reason] of Object.entries(PRUNE)) {
    const tech = all.find((t) => t.slug === slug);
    if (!tech) {
      console.log(`- ${slug}: not in the catalog`);
      continue;
    }
    if (tech.status === "sunset") {
      console.log(`- ${slug}: already retired`);
      continue;
    }
    console.log(`${dry ? "would retire" : "retiring"} ${tech.name} (${slug}) — ${reason}`);
    if (dry) continue;
    const now = new Date().toISOString();
    const data = JSON.stringify({ ...tech, status: "sunset", lastUpdatedAt: now });
    await db.execute({ sql: "UPDATE technologies SET status = ?, data = ?, updated_at = ? WHERE id = ?", args: ["sunset", data, now, tech.id] });
    await recordChange({
      technologyId: tech.id,
      field: "status",
      previousValue: tech.status,
      newValue: "sunset",
      source: "catalog-curation",
      confidence: 0.9,
      changeKind: "deprecated",
    });
    await recordChange({
      technologyId: tech.id,
      field: "curation_reason",
      previousValue: null,
      newValue: reason,
      source: "catalog-curation",
      confidence: 0.9,
      changeKind: "deprecated",
    });
    retired += 1;
  }

  if (!dry) invalidateCatalogCache();
  const active = (await listTechnologies()).length;
  console.log(`\nretired ${retired}; ${active} active technologies remain`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
