import { catalogStats, listCandidates, listChanges, listPipelineRuns } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const [runs, stats, changes, pending, accepted, rejected] = await Promise.all([
    listPipelineRuns(20),
    catalogStats(),
    listChanges({ limit: 50 }),
    listCandidates("pending", 50),
    listCandidates("accepted", 50),
    listCandidates("rejected", 50),
  ]);
  return Response.json({ runs, stats, changes, candidates: { pending, accepted, rejected } });
}
