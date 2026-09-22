import { catalogStats } from "@/lib/db/repo";
import { isTypeSafeConfigured } from "@/lib/typesafe";
import { getEmbeddingProvider } from "@/lib/embeddings";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats = await catalogStats();
  const typesafe = isTypeSafeConfigured();
  return Response.json(
    { ok: typesafe, typesafe: typesafe ? "configured" : "missing: set TYPESAFE_API_KEY", embeddings: getEmbeddingProvider().id, catalog: stats },
    { status: typesafe ? 200 : 503 },
  );
}
