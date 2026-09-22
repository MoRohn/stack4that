import { getArchitecture } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const arch = await getArchitecture(id);
  if (!arch) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ architecture: arch });
}
