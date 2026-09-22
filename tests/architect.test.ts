import { describe, expect, it } from "vitest";
import "./setup";
import { analyzeIntent, buildRequirementGraph, deriveCriteria, runArchitect } from "@/lib/architect";
import { getDecisionEngine, TypeSafeNotConfiguredError } from "@/lib/typesafe";
import type { ArchitectEvent } from "@/lib/architect/events";

// These tests call TypeSafe for real. Stack4That has no other decision engine.

describe("TypeSafe is mandatory", () => {
  it("refuses to create an engine without an API key", () => {
    const key = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      expect(() => getDecisionEngine()).toThrow(TypeSafeNotConfiguredError);
    } finally {
      if (key !== undefined) process.env.TYPESAFE_API_KEY = key;
    }
  });

  it("has an API key configured for the rest of the suite", () => {
    expect(process.env.TYPESAFE_API_KEY, "set TYPESAFE_API_KEY in .env.local").toBeTruthy();
  });
});

describe("intent + requirements (TypeSafe)", () => {
  it("extracts constraints and a lean requirement graph for a cheap startup stack", async () => {
    const intent = await analyzeIntent("Build a cheap stack for a two-person startup", getDecisionEngine());
    expect(intent.engine).toBe("typesafe");
    expect(intent.constraints.find((c) => c.kind === "budget")?.value).toBe("minimal");
    const ids = buildRequirementGraph(intent).requirements.map((r) => r.id);
    for (const slot of ["api-backend", "relational-db", "hosting"]) expect(ids).toContain(slot);
    for (const slot of ["container-orchestration", "streaming", "data-warehouse"]) expect(ids).not.toContain(slot);
    expect(deriveCriteria(intent).slice(0, 2).map((c) => c.id)).toContain("cost");
  });

  it("turns local-first RAG on NVIDIA into local inference requirements", async () => {
    const intent = await analyzeIntent("I need a local-first RAG application running on NVIDIA hardware", getDecisionEngine());
    expect(intent.constraints.some((c) => c.kind === "ai" && c.value === "local" && c.severity === "hard")).toBe(true);
    const ids = buildRequirementGraph(intent).requirements.map((r) => r.id);
    expect(ids).toContain("local-inference");
    expect(ids).not.toContain("llm-inference");
    expect(ids).toContain("vector-db");
  });

  it("recognizes a replacement request and avoids the replaced technology", async () => {
    const intent = await analyzeIntent("Replace Firebase in my existing stack", getDecisionEngine());
    expect(intent.requestKind).toBe("replace-component");
    expect(intent.constraints.some((c) => c.kind === "existing-technology" && c.value === "avoid:firebase")).toBe(true);
  });

  it("accepts a two-word request and turns it into an explicit brief", async () => {
    const intent = await analyzeIntent("todo app", getDecisionEngine());
    expect(intent.interpretation.archetype).toBe("todo_productivity");
    expect(intent.interpretation.vague).toBe(true);
    expect(intent.interpretation.enhancedRequest).toMatch(/task-management/i);
    const ids = buildRequirementGraph(intent).requirements.map((r) => r.id);
    for (const slot of ["web-frontend", "api-backend", "authentication", "relational-db"]) expect(ids).toContain(slot);
  });

  it("accepts even a greeting and routes it to a general starter", async () => {
    const intent = await analyzeIntent("hello", getDecisionEngine());
    expect(intent.interpretation.vague).toBe(true);
    expect(intent.interpretation.enhancedRequest.length).toBeGreaterThan(40);
    expect(buildRequirementGraph(intent).requirements.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps a specific request as stated rather than padding it", async () => {
    const intent = await analyzeIntent("I need a local-first RAG application running on NVIDIA hardware", getDecisionEngine());
    expect(intent.interpretation.vague).toBe(false);
    expect(intent.interpretation.addedCapabilities).toEqual([]);
  });

  it("reads compliance flags from the request", async () => {
    const intent = await analyzeIntent("I need a HIPAA-oriented healthcare SaaS platform", getDecisionEngine());
    expect(intent.productKind).toBe("healthcare");
    expect(intent.constraints.some((c) => c.kind === "compliance" && c.value === "HIPAA")).toBe(true);
  });
});

describe("runArchitect (TypeSafe)", () => {
  it("streams the full event protocol and produces a coherent architecture", async () => {
    const events: ArchitectEvent[] = [];
    const arch = await runArchitect("Build the stack for a real-time AI news application", { emit: (e) => events.push(e), persist: false });
    const types = new Set(events.map((e) => e.type));
    for (const t of ["analysis.started", "requirements.extracted", "requirement.created", "retrieval.started", "candidate.found", "decision.started", "decision.completed", "technology.selected", "technology.rejected", "stack.validation.started", "stack.validation.completed", "stack.component.ready", "stack.completed"]) {
      expect(types.has(t as ArchitectEvent["type"]), t).toBe(true);
    }
    expect(arch.stats.engine).toBe("typesafe");
    expect(arch.stats.typesafeCalls).toBeGreaterThan(3);
    expect(arch.components.length).toBeGreaterThanOrEqual(6);
    expect(arch.components.length).toBeLessThanOrEqual(16);
    const techIds = arch.components.map((c) => c.technologyId);
    expect(new Set(techIds).size).toBe(techIds.length);
    for (const c of arch.components) {
      expect(c.decisionMetadata.engine).toBe("typesafe");
      expect(c.whyHere).toContain(c.name);
      expect(c.whyHere).toContain("TypeSafe chose it");
      expect(c.alternatives.length).toBeGreaterThanOrEqual(1);
      expect(c.sources.length).toBeGreaterThan(0);
    }
    const firstReady = events.findIndex((e) => e.type === "stack.component.ready");
    expect(firstReady).toBeGreaterThan(-1);
    expect(firstReady).toBeLessThan(events.findIndex((e) => e.type === "stack.completed"));
  });

  it("honors a hard open-source constraint across the whole stack", async () => {
    const arch = await runArchitect("Build an entirely open source, self-hosted stack for a small SaaS", { persist: false });
    const { listTechnologies } = await import("@/lib/db/repo");
    const techs = new Map((await listTechnologies()).map((t) => [t.id, t]));
    for (const c of arch.components) expect(techs.get(c.technologyId)!.openSource, `${c.name} should be open source`).not.toBe(false);
  });

  it("fails loudly when TypeSafe rejects the request instead of guessing", async () => {
    const key = process.env.TYPESAFE_API_KEY;
    process.env.TYPESAFE_API_KEY = "invalid-key";
    const { TypeSafeDecisionEngine, TypeSafeUnavailableError } = await import("@/lib/typesafe");
    const events: ArchitectEvent[] = [];
    try {
      // A fresh client picks up the invalid key.
      const { resetTypeSafeClient } = await import("@/lib/typesafe/client");
      resetTypeSafeClient();
      await expect(runArchitect("Build a cheap stack for a two-person startup", { engine: new TypeSafeDecisionEngine(), emit: (e) => events.push(e), persist: false })).rejects.toBeInstanceOf(TypeSafeUnavailableError);
      expect(events.some((e) => e.type === "stack.component.ready")).toBe(false);
    } finally {
      if (key !== undefined) process.env.TYPESAFE_API_KEY = key;
      else delete process.env.TYPESAFE_API_KEY;
      const { resetTypeSafeClient } = await import("@/lib/typesafe/client");
      resetTypeSafeClient();
    }
  });
});

describe("objective clauses", () => {
  it("keeps the user's phrasing, strips only request boilerplate, and keeps relative clauses whole", async () => {
    const { splitClauses } = await import("@/lib/architect/intent");
    expect(splitClauses("Build me a marketplace for vintage furniture")).toEqual(["marketplace for vintage furniture"]);
    expect(splitClauses("Make it entirely open source")).toEqual(["Make it entirely open source"]);
    expect(splitClauses("Add AI features that suggest due dates, and we are a solo developer")).toEqual(["Add AI features that suggest due dates", "we are a solo developer"]);
    expect(splitClauses("A nightly batch pipeline that scrapes competitor prices and writes a report to S3")).toEqual(["A nightly batch pipeline that scrapes competitor prices", "writes a report to S3"]);
    expect(splitClauses("todo app")).toEqual(["todo app"]);
  });
});
