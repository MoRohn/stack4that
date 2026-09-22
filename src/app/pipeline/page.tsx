import { AppHeader } from "@/components/AppHeader";
import { PipelineControls } from "@/components/PipelineControls";
import { catalogStats, listCandidates, listChanges, listPipelineRuns } from "@/lib/db/repo";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [runs, stats, changes, pending, accepted, rejected] = await Promise.all([
    listPipelineRuns(15),
    catalogStats(),
    listChanges({ limit: 40 }),
    listCandidates("pending", 40),
    listCandidates("accepted", 40),
    listCandidates("rejected", 40),
  ]);
  return (
    <main className="min-h-screen text-sm">
      <AppHeader active="pipeline" technologies={stats.active} updatedAt={stats.lastUpdated} />
      <div className="mx-auto max-w-5xl px-5 pb-10 pt-8">
      <h1 className="mb-1 text-[26px] font-semibold tracking-[-0.03em]">Technology intelligence pipeline</h1>
      <p className="mb-6 text-[13.5px] text-white/70">Refreshes known technologies from official sources and discovers new ones, validated by TypeSafe.</p>
      <PipelineControls />
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Technologies", stats.total],
          ["Active", stats.active],
          ["Verified", stats.verified],
          ["Embedded", stats.withEmbeddings],
          ["Pending candidates", pending.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[10px] uppercase tracking-[0.25em] text-white/60">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </section>
      <p className="mt-4 text-[12px] text-white/65">
        The pipeline runs daily (Vercel cron → <code>/api/pipeline/run</code>, or <code>npm run pipeline</code>). It refreshes existing technologies from official sources, discovers new candidates from Wikidata (including
        products owned by large conglomerates), the Apache Software Foundation, the CNCF landscape, Docker Hub official images, yc-oss, GitHub, npm, PyPI and
        crates.io, validates each one with TypeSafe, and records every change with provenance.
      </p>

      <h2 className="mb-3 mt-10 text-[10px] uppercase tracking-[0.25em] text-white/60">Runs</h2>
      {runs.length === 0 && <div className="text-white/65">No runs yet. Trigger one with <code>npm run pipeline</code> or GET <code>/api/pipeline/run</code>.</div>}
      <ul className="space-y-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${r.status === "completed" ? "bg-emerald-400/10 text-emerald-200" : r.status === "failed" ? "bg-red-400/10 text-red-200" : "bg-white/10 text-white/70"}`}>{r.status}</span>
              <span className="text-white/70">{r.mode}</span>
              <span className="text-white/60">{new Date(r.startedAt).toLocaleString()}</span>
              {r.finishedAt && <span className="text-white/60">{Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/70">
              {Object.entries(r.stats).map(([k, v]) => (
                <span key={k}>
                  {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </span>
              ))}
            </div>
            {r.log.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[11px] text-white/60">log ({r.log.length})</summary>
                <pre className="s4t-code mt-2 max-h-64">{r.log.join("\n")}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-10 grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-[10px] uppercase tracking-[0.25em] text-white/60">Recent changes</h2>
          <ul className="space-y-1 text-[12px]">
            {changes.length === 0 && <li className="text-white/65">None recorded yet.</li>}
            {changes.map((c) => (
              <li key={c.id} className="truncate">
                <span className="text-white/60">{new Date(c.detectedAt).toLocaleDateString()} · {c.changeKind} · </span>
                <span className="text-white/70">{c.technologyId.replace("tech_", "")}</span> <span className="text-white/65">{c.field}</span>
                {c.field !== "*" && (
                  <span className="text-white/65">
                    : {c.previousValue ?? "∅"} → {c.newValue ?? "∅"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 text-[10px] uppercase tracking-[0.25em] text-white/60">Discovery candidates</h2>
          {[
            ["Accepted", accepted],
            ["Pending", pending],
            ["Rejected", rejected],
          ].map(([label, list]) => (
            <div key={String(label)} className="mb-4">
              <div className="mb-1 text-[11px] text-white/70">
                {String(label)} ({(list as typeof pending).length})
              </div>
              <ul className="space-y-1 text-[12px]">
                {(list as typeof pending).slice(0, 15).map((c) => (
                  <li key={c.id} className="truncate">
                    <span className="text-white/75">{c.name}</span> <span className="text-white/60">· {c.sourceType}</span>
                    {c.reason && <span className="text-white/60"> · {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
      </div>
    </main>
  );
}
