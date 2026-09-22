/** Catalog data-quality audit: every finding a reviewer would raise about the knowledge base. */
import "./env";
import { listTechnologies, listChanges, catalogStats } from "@/lib/db/repo";
import { ALL_CAPABILITY_IDS, CAPABILITY_BY_ID, CATEGORY_IDS } from "@/lib/taxonomy";
import { nameVariants, productKey } from "@/lib/pipeline";

(async () => {
  const all = await listTechnologies({ includeInactive: true });
  const active = all.filter((t) => t.status !== "sunset");
  const problems: Array<{ level: "error" | "warn"; what: string; items: string[] }> = [];
  const add = (level: "error" | "warn", what: string, items: string[]) => items.length && problems.push({ level, what, items });

  add("error", "unknown category", active.filter((t) => t.categories.some((c) => !CATEGORY_IDS.has(c))).map((t) => `${t.slug}:${t.categories.filter((c) => !CATEGORY_IDS.has(c))}`));
  add("error", "unknown capability", active.filter((t) => t.capabilities.some((c) => !ALL_CAPABILITY_IDS.has(c))).map((t) => `${t.slug}:${t.capabilities.filter((c) => !ALL_CAPABILITY_IDS.has(c))}`));
  add("error", "no categories", active.filter((t) => t.categories.length === 0).map((t) => t.slug));
  add("error", "no website and no repository", active.filter((t) => !t.websiteUrl && !t.repositoryUrl).map((t) => t.slug));
  add("error", "no evidence", active.filter((t) => t.evidence.length === 0).map((t) => t.slug));
  add("warn", "very short description", active.filter((t) => (t.description ?? "").length < 40).map((t) => `${t.slug} (${t.description?.length ?? 0})`));
  add("warn", "lowercase display name", active.filter((t) => /^[a-z]/.test(t.name) && !["npm", "pnpm", "uv", "htmx", "vllm", "n8n", "dbt", "pgvector", "llama.cpp", "turbopuffer", "fal.ai", "bunny.net", "tRPC"].includes(t.name)).map((t) => t.name));
  add("warn", "placeholder license", active.filter((t) => t.license && /^(other|noassertion|unknown)$/i.test(t.license)).map((t) => t.slug));
  add("warn", "missing brand colour", active.filter((t) => !/^#[0-9a-f]{6}$/i.test(t.brandColor ?? "")).map((t) => t.slug));
  add("warn", "unreachable website", active.filter((t) => t.tags.includes("unreachable")).map((t) => t.slug));
  add("warn", "inactive repository", active.filter((t) => t.tags.includes("inactive-repository")).map((t) => t.slug));

  // Duplicates by name variant and by product key
  const byVariant = new Map<string, string[]>();
  for (const t of active) for (const v of new Set([t.name, t.slug, ...t.aliases].flatMap(nameVariants))) byVariant.set(v, [...(byVariant.get(v) ?? []), t.slug]);
  add("error", "duplicate technologies (name)", [...byVariant.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(", ")}`));
  const byKey = new Map<string, string[]>();
  for (const t of active) {
    const k = productKey(t.websiteUrl);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), t.slug]);
  }
  // Vendor domains legitimately host sibling products (supabase.com/auth, vercel.com/blob): a warning, not an error.
  add("warn", "sibling products on one vendor URL", [...byKey.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(", ")}`));

  // Slot coverage: every architecture slot needs candidates, ideally several open-source ones too
  const thin: string[] = [];
  for (const cap of CAPABILITY_BY_ID.values()) {
    const providers = active.filter((t) => t.capabilities.includes(cap.id) && t.type !== "protocol");
    const oss = providers.filter((t) => t.openSource);
    if (providers.length < 3) thin.push(`${cap.id}: ${providers.length} providers`);
    // Compliance automation is inherently a certified-vendor market; no open-source equivalent is expected.
    else if (oss.length === 0 && cap.id !== "compliance-automation") thin.push(`${cap.id}: no open-source provider`);
  }
  add("error", "thin slot coverage", thin);

  const changes = await listChanges({ limit: 2000 });
  const stats = await catalogStats();
  console.log(`catalog: ${stats.total} total, ${stats.active} active, ${stats.verified} verified, ${stats.withEmbeddings} embedded, ${changes.length} change records`);
  console.log(`sources: ${[...new Set(all.flatMap((t) => t.sourceRecords.map((r) => r.sourceType)))].join(", ")}`);
  const withCompany = active.filter((t) => t.companyName).length;
  console.log(`company known: ${withCompany}/${active.length}; parent company known: ${active.filter((t) => t.parentCompanyName).length}`);
  for (const p of problems) console.log(`\n${p.level === "error" ? "✗" : "!"} ${p.what} (${p.items.length})\n   ${p.items.slice(0, 12).join("\n   ")}${p.items.length > 12 ? `\n   …and ${p.items.length - 12} more` : ""}`);
  const errors = problems.filter((p) => p.level === "error");
  console.log(`\n${errors.length ? `${errors.length} blocking issue types` : "no blocking data issues"}`);
  process.exit(errors.length ? 1 : 0);
})();
