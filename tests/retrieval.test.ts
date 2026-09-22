import { describe, expect, it } from "vitest";
import "./setup";
import { findMentions, retrieveCandidates, searchTechnologies } from "@/lib/retrieval";
import { HashEmbeddingProvider } from "@/lib/embeddings/hash";
import { cosine } from "@/lib/embeddings";
import { BM25Index } from "@/lib/retrieval/bm25";
import type { Constraint, ProjectContext, Requirement } from "@/lib/types";

const ctx: ProjectContext = { request: "Build a SaaS app", summary: "A SaaS product", productKind: "b2b_saas", hardConstraints: [], softPreferences: [], assumptions: [], objectives: [], selectedSoFar: [] };
const req = (id: string, capability: string, query: string, categories: string[]): Requirement => ({ id, group: "DATA", label: id, capability, description: query, required: true, probability: 0.9, dependsOn: [], queryText: query, categories });

describe("hash embeddings", () => {
  it("are deterministic, normalized and lexically sensitive", async () => {
    const p = new HashEmbeddingProvider();
    const [a, b, c] = await p.embed(["postgres relational database", "postgres relational database", "vector similarity search embeddings"]);
    expect(cosine(a, b)).toBeCloseTo(1, 5);
    expect(cosine(a, c)).toBeLessThan(0.5);
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 5);
  });
});

describe("bm25", () => {
  it("ranks keyword matches", () => {
    const idx = new BM25Index([
      { id: "a", text: "PostgreSQL relational database with JSONB" },
      { id: "b", text: "Redis in-memory cache" },
    ]);
    expect(idx.search("relational database")[0].id).toBe("a");
    expect(idx.search("cache")[0].id).toBe("b");
  });
});

describe("hybrid retrieval", () => {
  it("returns relational databases for the relational slot with PostgreSQL near the top", async () => {
    const out = await retrieveCandidates(req("relational-db", "relational-db", "relational SQL database transactional persistence", ["sql-databases"]), ctx, []);
    expect(out.length).toBeGreaterThanOrEqual(8);
    expect(out.length).toBeLessThanOrEqual(30);
    const names = out.map((c) => c.tech.slug);
    expect(names.slice(0, 5)).toContain("postgresql");
    for (const c of out) expect(c.tech.capabilities.includes("relational-db") || c.tech.categories.includes("sql-databases")).toBe(true);
  });

  it("enforces hard open-source constraints", async () => {
    const constraints: Constraint[] = [{ id: "c1", kind: "open-source", value: "required", label: "OSS", severity: "hard", confidence: 1, source: "explicit" }];
    const out = await retrieveCandidates(req("vector-db", "vector-db", "vector database similarity search", ["vector-databases"]), ctx, constraints);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(c.tech.openSource, c.tech.slug).toBe(true);
    expect(out.map((c) => c.tech.slug)).not.toContain("pinecone");
  });

  it("boosts cloud-native services for a cloud preference", async () => {
    const constraints: Constraint[] = [{ id: "c1", kind: "cloud", value: "aws", label: "AWS", severity: "hard", confidence: 1, source: "explicit" }];
    const out = await retrieveCandidates(req("object-storage", "object-storage", "object storage files", ["storage"]), ctx, constraints);
    expect(out[0].tech.slug).toBe("amazon-s3");
  });

  it("excludes avoided technologies", async () => {
    const constraints: Constraint[] = [{ id: "c1", kind: "existing-technology", value: "avoid:firebase", label: "Replace Firebase", severity: "hard", confidence: 1, source: "explicit" }];
    const out = await retrieveCandidates(req("nosql-db", "nosql-db", "document database", ["nosql-databases"]), ctx, constraints);
    expect(out.map((c) => c.tech.slug)).not.toContain("firebase");
  });

  it("finds catalog mentions in free text", async () => {
    const m = await findMentions("Replace Firebase in my existing stack, keep Next.js and Stripe");
    const slugs = m.map((t) => t.slug);
    expect(slugs).toContain("firebase");
    expect(slugs).toContain("nextjs");
    expect(slugs).toContain("stripe");
  });

  it("searches the catalog by name", async () => {
    const r = await searchTechnologies("postgres", 5);
    expect(r[0].slug).toBe("postgresql");
  });
});

describe("mention detection edge cases", () => {
  it("matches short forms and ignores common words", async () => {
    const slugs = (await findMentions("Go services with Kafka on Kubernetes, deploy on Render, render charts in S3")).map((t) => t.slug);
    expect(slugs).toContain("apache-kafka");
    expect(slugs).toContain("kubernetes");
    expect(slugs).toContain("render");
    expect(slugs).toContain("amazon-s3");
    const none = (await findMentions("render the page in a modal and segment users over a temporal window")).map((t) => t.slug);
    for (const s of ["render", "modal", "segment", "temporal"]) expect(none).not.toContain(s);
  });
});
