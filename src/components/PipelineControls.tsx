"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "refresh" | "discover" | "full";
interface Progress {
  stage: string;
  label: string;
  done: number;
  total: number;
}
interface LiveRun {
  id: string;
  mode: Mode;
  limit: number;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  progress: Progress;
  lines: string[];
  stats?: Record<string, number | string>;
  error?: string;
}

const MODES: Array<{ id: Mode; label: string; hint: string }> = [
  { id: "refresh", label: "Refresh", hint: "Re-verify known technologies against their official websites and repositories." },
  { id: "discover", label: "Discover", hint: "Find new technologies in the selected sources and validate each with TypeSafe." },
  { id: "full", label: "Full run", hint: "Refresh, then discover. This is what the daily schedule runs." },
];

const SOURCE_OPTIONS: Array<{ id: string; label: string; hint: string }> = [
  { id: "wikidata", label: "Wikidata", hint: "Global software knowledge graph, including products owned by large companies" },
  { id: "apache", label: "Apache", hint: "Apache Software Foundation projects" },
  { id: "cncf", label: "CNCF", hint: "Cloud Native Computing Foundation landscape" },
  { id: "dockerhub", label: "Docker Hub", hint: "Official images: databases, servers, runtimes" },
  { id: "yc", label: "Y Combinator", hint: "yc-oss company dataset, developer-facing companies" },
  { id: "github", label: "GitHub", hint: "Fast-growing repositories in developer topics" },
  { id: "npm", label: "npm", hint: "Popular JavaScript packages" },
  { id: "pypi", label: "PyPI", hint: "Most-downloaded Python packages" },
  { id: "crates", label: "crates.io", hint: "Most-downloaded Rust crates" },
];

const STAGES = ["refresh", "discover", "fetch", "validate", "embed"];

function elapsed(from: string, to?: string) {
  const s = Math.max(0, Math.round(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function PipelineControls() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("refresh");
  const [limit, setLimit] = useState(40);
  const [sources, setSources] = useState<string[]>(["wikidata", "apache", "cncf", "dockerhub", "yc", "github"]);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [token, setToken] = useState("");
  const [tokenRequired, setTokenRequired] = useState(false);
  const [, setTick] = useState(0);
  const logRef = useRef<HTMLPreElement>(null);
  const refreshedFor = useRef<string | null>(null);

  const poll = useCallback(async (id?: string) => {
    const res = await fetch(`/api/pipeline/launch${id ? `?id=${id}` : ""}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { run?: LiveRun | null; tokenRequired?: boolean };
    if (data.tokenRequired !== undefined) setTokenRequired(data.tokenRequired);
    if (data.run) setRun(data.run);
    return data.run ?? null;
  }, []);

  // Re-attach to a run already in progress (page reload, or launched elsewhere in the app).
  useEffect(() => {
    const t = setTimeout(() => void poll(), 0);
    return () => clearTimeout(t);
  }, [poll]);

  // Follow a running run: poll its state and tick the elapsed timer.
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const id = setInterval(() => {
      void poll(run.id);
      setTick((t) => t + 1);
    }, 900);
    return () => clearInterval(id);
  }, [run, poll]);

  // When a run finishes, refresh the server-rendered stats, runs, changes and candidates.
  useEffect(() => {
    if (run && run.status !== "running" && refreshedFor.current !== run.id) {
      refreshedFor.current = run.id;
      router.refresh();
    }
  }, [run, router]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [run?.lines.length]);

  const launch = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/pipeline/launch", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { "x-pipeline-token": token } : {}) },
        body: JSON.stringify({ mode, limit, sources: mode === "refresh" ? undefined : sources }),
      });
      const data = (await res.json().catch(() => ({}))) as { run?: LiveRun; error?: string; tokenRequired?: boolean };
      if (data.tokenRequired) setTokenRequired(true);
      if (!res.ok || !data.run) throw new Error(data.error ?? `Launch failed (${res.status})`);
      refreshedFor.current = null;
      setRun(data.run);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const running = run?.status === "running";
  const pct = run ? (run.progress.total ? Math.round((run.progress.done / run.progress.total) * 100) : 0) : 0;
  const stageIndex = run ? STAGES.indexOf(run.progress.stage) : -1;

  return (
    <section aria-label="Run the pipeline" className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.02] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Run the pipeline now</h2>
          <p className="mt-1 max-w-xl text-[12.5px] text-white/70">{MODES.find((m) => m.id === mode)?.hint}</p>
        </div>
        <div className="flex items-center rounded-full border border-white/10 bg-black/30 p-0.5" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              disabled={running}
              onClick={() => setMode(m.id)}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${mode === m.id ? "bg-white/[0.14] text-white" : "text-white/70 hover:text-white"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[12px] text-white/60">
        <label className="flex items-center gap-2">
          <span>{mode === "refresh" ? "Technologies to re-verify" : "Batch size"}</span>
          <select value={limit} disabled={running} onChange={(e) => setLimit(Number(e.target.value))} className="s4t-input rounded-lg px-2 py-1 text-[12px]">
            {[10, 25, 40, 100, 400].map((n) => (
              <option key={n} value={n}>
                {n === 400 ? "All (up to 400)" : n}
              </option>
            ))}
          </select>
        </label>
        {tokenRequired && (
          <label className="flex items-center gap-2">
            <span>Admin token</span>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="s4t-input w-44 rounded-lg px-2 py-1 text-[12px]" autoComplete="off" />
          </label>
        )}
      </div>

      {mode !== "refresh" && (
        <fieldset className="mt-4" disabled={running}>
          <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">Discovery sources</legend>
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_OPTIONS.map((s) => {
              const on = sources.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  title={s.hint}
                  aria-pressed={on}
                  onClick={() => setSources((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition ${on ? "border-[#9ef0c6]/35 bg-[#9ef0c6]/[0.08] text-[#d6fbe8]" : "border-white/10 text-white/65 hover:text-white/75"}`}
                >
                  {on ? "✓ " : ""}
                  {s.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={launch}
          disabled={running || starting || (mode !== "refresh" && sources.length === 0)}
          className="rounded-xl border border-white/25 bg-white/[0.14] px-4 py-2 text-[13px] font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.2] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : starting ? "Starting…" : `Run ${MODES.find((m) => m.id === mode)?.label.toLowerCase()}`}
        </button>
        <span className="text-[11.5px] text-white/60">Every validation is made by TypeSafe. Nothing is ever deleted; changes are recorded with provenance.</span>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-xl border border-red-300/25 bg-red-400/[0.07] px-3 py-2 text-[12.5px] text-red-50/90">
          {error}
        </div>
      )}

      {run && (
        <div className="mt-5 rounded-xl border border-white/10 bg-black/30 p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${run.status === "completed" ? "bg-emerald-400/15 text-emerald-200" : run.status === "failed" ? "bg-red-400/15 text-red-200" : "bg-[#8ab4ff]/15 text-[#cfe0ff]"}`}>{run.status}</span>
            <span className="text-white/70">{run.mode}</span>
            <span className="tabular-nums text-white/65">{elapsed(run.startedAt, run.finishedAt)}</span>
            {running && <span className="truncate text-white/60">{run.progress.label}</span>}
          </div>
          {running && (
            <>
              <div className="mt-3 flex gap-1" aria-hidden>
                {STAGES.map((st, i) => (
                  <div key={st} className="flex-1">
                    <div className={`h-1 rounded-full ${i < stageIndex ? "bg-[#9ef0c6]/70" : i === stageIndex ? "bg-white/15" : "bg-white/[0.06]"}`}>
                      {i === stageIndex && <div className="h-1 rounded-full bg-white/80 transition-all duration-500" style={{ width: `${Math.max(4, pct)}%` }} />}
                    </div>
                    <div className={`mt-1 text-[9.5px] uppercase tracking-[0.16em] ${i === stageIndex ? "text-white/70" : "text-white/70"}`}>{st}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] tabular-nums text-white/60">
                {run.progress.done} / {run.progress.total}
              </div>
            </>
          )}
          {run.stats && (
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
              {Object.entries(run.stats)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => (
                  <span key={k} className="rounded-full border border-white/10 px-2 py-0.5 text-white/70">
                    {k}: <span className="tabular-nums text-white">{String(v)}</span>
                  </span>
                ))}
            </div>
          )}
          {run.error && <div className="mt-2 text-[12px] text-red-200/80">{run.error}</div>}
          {run.lines.length > 0 && (
            <pre ref={logRef} className="s4t-code mt-3 max-h-48 overflow-auto text-[11px] text-white/60">
              {run.lines.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
