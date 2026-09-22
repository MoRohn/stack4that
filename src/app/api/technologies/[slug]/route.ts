import { getTechnology, listChanges } from "@/lib/db/repo";
import { iconPathForSlug } from "@/lib/catalog/logos";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const tech = await getTechnology(slug);
  if (!tech) return Response.json({ error: "not found" }, { status: 404 });
  const changes = await listChanges({ technologyId: tech.id, limit: 50 });
  const { semanticEmbedding, ...rest } = tech;
  void semanticEmbedding;
  return Response.json({ technology: { ...rest, iconPath: iconPathForSlug(tech.logoAssetId) }, changes });
}
