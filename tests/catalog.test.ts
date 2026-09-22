import { describe, expect, it } from "vitest";
import { seedTechnologies } from "@/lib/catalog";
import { ALL_CAPABILITY_IDS, CAPABILITIES, CATEGORY_IDS } from "@/lib/taxonomy";

describe("seed catalog", () => {
  const techs = seedTechnologies();

  it("has a substantial, unique catalog", () => {
    expect(techs.length).toBeGreaterThan(300);
    const slugs = new Set(techs.map((t) => t.slug));
    expect(slugs.size).toBe(techs.length);
    const ids = new Set(techs.map((t) => t.id));
    expect(ids.size).toBe(techs.length);
  });

  it("only uses canonical categories and capabilities", () => {
    for (const t of techs) {
      for (const c of t.categories) expect(CATEGORY_IDS.has(c), `${t.slug} category ${c}`).toBe(true);
      for (const c of t.capabilities) expect(ALL_CAPABILITY_IDS.has(c), `${t.slug} capability ${c}`).toBe(true);
      expect(t.categories.length).toBeGreaterThan(0);
    }
  });

  it("covers every architecture slot with at least three candidates", () => {
    for (const cap of CAPABILITIES) {
      const n = techs.filter((t) => t.capabilities.includes(cap.id) || t.categories.some((c) => cap.categories.includes(c))).length;
      expect(n, `slot ${cap.id}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("records provenance for every technology", () => {
    for (const t of techs) {
      expect(t.evidence.length, t.slug).toBeGreaterThan(0);
      expect(t.sourceRecords.length).toBeGreaterThan(0);
      expect(t.verificationStatus).toBe("seeded");
    }
  });

  it("resolves brand logos for the majority of technologies", () => {
    const withLogo = techs.filter((t) => t.logoAssetId).length;
    expect(withLogo / techs.length).toBeGreaterThan(0.5);
    expect(techs.find((t) => t.slug === "postgresql")?.logoAssetId).toBe("postgresql");
    expect(techs.every((t) => /^#[0-9a-f]{6}$/i.test(t.brandColor ?? ""))).toBe(true);
  });
});
