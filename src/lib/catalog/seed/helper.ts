import type { DeploymentModel, Maturity, PricingModel, Technology, TechnologyType, LifecycleStatus } from "@/lib/types";

export interface SeedInput {
  company?: string;
  type: TechnologyType;
  cats: string[];
  caps: string[];
  desc: string;
  short?: string;
  site?: string;
  docs?: string;
  repo?: string;
  pricingUrl?: string;
  oss?: boolean;
  license?: string;
  deploy?: DeploymentModel[];
  clouds?: string[];
  langs?: string[];
  frameworks?: string[];
  integrations?: string[];
  pricing?: PricingModel;
  free?: boolean;
  pricingSummary?: string;
  maturity?: Maturity;
  status?: LifecycleStatus;
  compliance?: string[];
  regions?: string[];
  tags?: string[];
  useCases?: string[];
  aliases?: string[];
  /** simple-icons slug override when it differs from the technology slug. */
  icon?: string | null;
  color?: string;
}

export interface SeedTechnology extends SeedInput {
  slug: string;
  name: string;
}

export const t = (slug: string, name: string, input: SeedInput): SeedTechnology => ({ slug, name, ...input });

export const SEED_TIMESTAMP = "2026-09-01T00:00:00.000Z";

export function seedToTechnology(seed: SeedTechnology, logo: { iconSlug?: string; color?: string } = {}): Technology {
  const now = SEED_TIMESTAMP;
  const id = `tech_${seed.slug}`;
  const evidence: Technology["evidence"] = [];
  const push = (claimType: Technology["evidence"][number]["claimType"], value: string, url: string | undefined, conf = 0.85) => {
    if (!url) return;
    evidence.push({
      id: `ev_${seed.slug}_${claimType}_${evidence.length}`,
      technologyId: id,
      sourceUrl: url,
      sourceType: "curated-seed",
      retrievedAt: now,
      claimType,
      extractedValue: value,
      confidence: conf,
    });
  };
  push("existence", seed.name, seed.site);
  push("website", seed.site ?? "", seed.site);
  if (seed.repo) push("repository", seed.repo, seed.repo);
  if (seed.docs) push("description", seed.desc, seed.docs, 0.8);
  if (seed.license) push("license", seed.license, seed.repo ?? seed.site, 0.8);
  if (seed.pricingUrl) push("pricing", seed.pricingSummary ?? seed.pricing ?? "unknown", seed.pricingUrl, 0.7);
  if (logo.iconSlug) {
    evidence.push({
      id: `ev_${seed.slug}_logo`,
      technologyId: id,
      sourceUrl: `https://simpleicons.org/?q=${encodeURIComponent(logo.iconSlug)}`,
      sourceType: "simple-icons",
      retrievedAt: now,
      claimType: "logo",
      extractedValue: logo.iconSlug,
      confidence: 0.9,
    });
  }
  const openSource = seed.oss ?? (seed.license ? true : undefined);
  const pricingModel: PricingModel = seed.pricing ?? (openSource && !seed.pricingSummary ? "open-source" : "unknown");
  return {
    id,
    slug: seed.slug,
    name: seed.name,
    aliases: seed.aliases ?? [],
    companyId: seed.company ? `co_${slugify(seed.company)}` : undefined,
    companyName: seed.company,
    type: seed.type,
    categories: seed.cats,
    subcategories: [],
    capabilities: seed.caps,
    useCases: seed.useCases ?? [],
    tags: seed.tags ?? [],
    description: seed.desc,
    shortDescription: seed.short ?? firstSentence(seed.desc),
    websiteUrl: seed.site,
    documentationUrl: seed.docs,
    repositoryUrl: seed.repo,
    pricingUrl: seed.pricingUrl,
    logoUrl: logo.iconSlug ? `https://cdn.simpleicons.org/${logo.iconSlug}` : undefined,
    logoAssetId: logo.iconSlug,
    brandColor: seed.color ?? logo.color,
    openSource,
    license: seed.license,
    repositoryStars: undefined,
    repositoryActivity: undefined,
    deploymentModels: seed.deploy ?? [],
    supportedClouds: seed.clouds ?? [],
    supportedLanguages: seed.langs ?? [],
    supportedFrameworks: seed.frameworks ?? [],
    integrations: seed.integrations ?? [],
    pricingModel,
    freeTier: seed.free,
    pricingSummary: seed.pricingSummary,
    maturity: seed.maturity ?? "established",
    status: seed.status ?? "active",
    regions: seed.regions ?? [],
    compliance: seed.compliance ?? [],
    sourceRecords: [
      {
        id: `src_${seed.slug}_seed`,
        technologyId: id,
        sourceType: "curated-seed",
        sourceUrl: seed.site ?? "",
        retrievedAt: now,
        payload: { seed: true },
      },
    ],
    evidence,
    firstSeenAt: now,
    lastVerifiedAt: undefined,
    lastUpdatedAt: now,
    confidence: 0.8,
    verificationStatus: "seeded",
  };
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstSentence(s: string): string {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return (m ? m[1] : s).slice(0, 160);
}
