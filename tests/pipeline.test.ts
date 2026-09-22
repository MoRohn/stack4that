import { describe, expect, it } from "vitest";
import "./setup";
import { ensureSeeded, listChanges, listTechnologies, upsertTechnologies } from "@/lib/db/repo";
import { canonicalUrl, domainOf } from "@/lib/pipeline/http";
import { parseRepo } from "@/lib/pipeline/sources/github";
import { developerRelevant, mapYcTags } from "@/lib/pipeline/sources/yc";
import { mapCncfCategory } from "@/lib/pipeline/sources/cncf";
import { productName } from "@/lib/pipeline";
import { encodeSSE } from "@/lib/architect/events";

describe("pipeline helpers", () => {
  it("normalizes urls and repos", () => {
    expect(canonicalUrl("supabase.com/")).toBe("https://supabase.com");
    expect(canonicalUrl("https://www.example.com/path/?q=1#x")).toBe("https://www.example.com/path");
    expect(domainOf("https://www.Supabase.com/docs")).toBe("supabase.com");
    expect(parseRepo("https://github.com/vercel/next.js/issues")).toBe("vercel/next.js");
    expect(parseRepo("https://gitlab.com/x/y")).toBeUndefined();
  });

  it("derives product names from website titles", () => {
    expect(productName("hermes-agent", "Hermes Agent - The agent that grows with you", "github")).toBe("Hermes Agent");
    expect(productName("mempalace", "MemPalace | Long-term memory for agents", "github")).toBe("MemPalace");
    expect(productName("rtk", "Some unrelated marketing headline for a landing page", "github")).toBe("Rtk");
    expect(productName("Supabase", "Supabase | The Postgres Development Platform", "yc-oss")).toBe("Supabase");
  });

  it("maps yc and cncf taxonomies into canonical categories without overwriting", () => {
    expect(mapYcTags(["Developer Tools", "Databases", "SaaS"])).toEqual(["developer-tools", "databases"]);
    expect(mapCncfCategory("Observability and Analysis", "Monitoring")).toEqual(["monitoring"]);
    expect(mapCncfCategory("Unknown", "Unknown")).toEqual([]);
    const rel = developerRelevant([
      { id: 1, name: "DevCo", slug: "devco", website: "https://devco.com", tags: ["Developer Tools", "Open Source"], status: "Active" },
      { id: 2, name: "FoodCo", slug: "foodco", website: "https://foodco.com", tags: ["Food", "Consumer"], status: "Active" },
      { id: 3, name: "DeadCo", slug: "deadco", website: "https://deadco.com", tags: ["Developer Tools", "Databases"], status: "Inactive" },
    ]);
    expect(rel.map((c) => c.slug)).toEqual(["devco"]);
  });
});

describe("change detection", () => {
  it("records field changes without deleting history", async () => {
    await ensureSeeded();
    const [pg] = (await listTechnologies()).filter((t) => t.slug === "postgresql");
    const updated = { ...pg, license: "PostgreSQL-2", repositoryStars: 99999, lastUpdatedAt: new Date().toISOString() };
    const res = await upsertTechnologies([updated], { source: "test", recordChanges: true });
    expect(res.updated).toBe(1);
    expect(res.changes.map((c) => c.field).sort()).toEqual(["license"]);
    expect(res.changes.find((c) => c.field === "license")?.changeKind).toBe("license");
    const stored = await listChanges({ technologyId: pg.id });
    expect(stored.length).toBeGreaterThanOrEqual(1);
    const sunset = { ...updated, status: "sunset" as const };
    const res2 = await upsertTechnologies([sunset], { source: "test", recordChanges: true });
    expect(res2.changes[0].changeKind).toBe("shutdown");
    const all = await listTechnologies({ includeInactive: true });
    expect(all.some((t) => t.slug === "postgresql")).toBe(true);
    expect((await listTechnologies()).some((t) => t.slug === "postgresql")).toBe(false);
    await upsertTechnologies([{ ...sunset, status: "active" }], { source: "test", recordChanges: false });
  });
});

describe("sse encoding", () => {
  it("encodes events as named SSE frames", () => {
    const frame = encodeSSE({ type: "progress", phase: "searching", message: "Searching…" });
    expect(frame.startsWith("event: progress\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.split("data: ")[1]).message).toBe("Searching…");
  });
});

describe("seed sync", () => {
  it("merges curated changes without losing pipeline-verified facts", async () => {
    const { useInMemoryDb, getDb } = await import("@/lib/db/client");
    const repo = await import("@/lib/db/repo");
    await useInMemoryDb();
    await repo.ensureSeeded();
    const redis = (await repo.listTechnologies()).find((t) => t.slug === "redis")!;
    // A pipeline refresh verified stars, and a (simulated) older seed dropped a capability.
    await repo.upsertTechnologies([{ ...redis, repositoryStars: 70000, verificationStatus: "verified", capabilities: ["cache"] }], { source: "pipeline:refresh" });
    await (await getDb()).execute("UPDATE meta SET value = 'stale' WHERE key = 'seed_version'");
    repo.resetSeedSync();
    await repo.ensureSeeded();
    const after = (await repo.listTechnologies()).find((t) => t.slug === "redis")!;
    expect(after.repositoryStars).toBe(70000);
    expect(after.verificationStatus).toBe("verified");
    expect(after.capabilities).toContain("queue");
  });
});

describe("license normalization", () => {
  it("treats GitHub placeholder licenses as unknown", async () => {
    const { realLicense } = await import("@/lib/pipeline/sources/github");
    expect(realLicense("NOASSERTION")).toBeUndefined();
    expect(realLicense("Other")).toBeUndefined();
    expect(realLicense("MIT")).toBe("MIT");
  });
});

describe("product-aware dedupe keys", () => {
  it("separates products on shared cloud domains and projects on code hosts", async () => {
    const { productKey } = await import("@/lib/pipeline");
    expect(productKey("https://aws.amazon.com/dynamodb/")).toBe("aws.amazon.com/dynamodb");
    expect(productKey("https://aws.amazon.com/")).toBe("aws.amazon.com/");
    expect(productKey("https://cloud.google.com/bigtable/")).toBe("cloud.google.com/bigtable");
    expect(productKey("https://azure.microsoft.com/en-us/products/cosmos-db")).toBe("azure.microsoft.com/cosmos-db");
    expect(productKey("https://github.com/vercel/next.js")).toBe("github.com/vercel/next.js");
    expect(productKey("https://www.postgresql.org/docs")).toBe("postgresql.org");
  });
});

describe("alias-aware name dedupe", () => {
  it("matches registry names to canonical products without merging unrelated ones", async () => {
    const { nameVariants } = await import("@/lib/pipeline");
    const overlap = (a: string, b: string) => nameVariants(a).some((v) => nameVariants(b).includes(v));
    expect(overlap("mongo", "MongoDB")).toBe(true);
    expect(overlap("node", "Node.js")).toBe(true);
    expect(overlap("kafka", "Apache Kafka")).toBe(true);
    expect(overlap("Amazon DynamoDB", "dynamodb")).toBe(true);
    expect(overlap("Postgres", "PostgreSQL")).toBe(false); // aliases handle this one explicitly
    expect(overlap("Redis", "Redpanda")).toBe(false);
    expect(overlap("Go", "Gin")).toBe(false);
  });
});

describe("name variants do not over-merge", () => {
  it("never stems a product down to its vendor name", async () => {
    const { nameVariants } = await import("@/lib/pipeline");
    const overlap = (a: string, b: string) => nameVariants(a).some((v) => nameVariants(b).includes(v));
    expect(overlap("azure-sql", "Microsoft Azure")).toBe(false);
    expect(overlap("Google Cloud SQL", "Google Cloud Platform")).toBe(false);
    expect(overlap("mongo", "MongoDB")).toBe(true);
  });
});
