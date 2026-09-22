import { catalogStats } from "@/lib/db/repo";
import { isTypeSafeConfigured } from "@/lib/typesafe";
import { getEmbeddingProvider } from "@/lib/embeddings";
import { readSessionKey } from "@/lib/typesafe/session-key";
import { runWithTypeSafeKey } from "@/lib/typesafe/key-context";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionKey = await readSessionKey();
  return runWithTypeSafeKey(sessionKey, async () => {
    const stats = await catalogStats();
    const typesafe = isTypeSafeConfigured();
    return Response.json(
      {
        ok: typesafe,
        typesafe: typesafe ? "configured" : "missing: add a key in settings or set TYPESAFE_API_KEY",
        keySource: sessionKey ? "session" : process.env.TYPESAFE_API_KEY ? "env" : "none",
        embeddings: getEmbeddingProvider().id,
        catalog: stats,
      },
      { status: typesafe ? 200 : 503 },
    );
  });
}
