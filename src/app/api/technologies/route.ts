import { catalogStats, listTechnologies } from "@/lib/db/repo";
import { searchTechnologies } from "@/lib/retrieval";
import { compressedJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const category = url.searchParams.get("category") ?? "";
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 60));
  let items = q ? await searchTechnologies(q, limit * 2) : await listTechnologies();
  if (category) items = items.filter((t) => t.categories.includes(category));
  const stats = await catalogStats();
  return compressedJson(request, JSON.stringify({
    stats,
    items: items.slice(0, limit).map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      companyName: t.companyName,
      parentCompanyName: t.parentCompanyName,
      sources: [...new Set(t.sourceRecords.map((r) => r.sourceType))],
      type: t.type,
      categories: t.categories,
      capabilities: t.capabilities,
      shortDescription: t.shortDescription,
      websiteUrl: t.websiteUrl,
      openSource: t.openSource,
      license: t.license,
      pricingModel: t.pricingModel,
      maturity: t.maturity,
      status: t.status,
      brandColor: t.brandColor,
      logoAssetId: t.logoAssetId,
      verificationStatus: t.verificationStatus,
      lastVerifiedAt: t.lastVerifiedAt,
      repositoryStars: t.repositoryStars,
    })),
  }));
}
