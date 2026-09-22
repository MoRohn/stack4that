/**
 * Launch and follow pipeline runs from the app. One run at a time: a run in this process,
 * or a recent run still marked "running" by another process (e.g. `stack4that refresh`),
 * blocks a new launch. Runs continue in the background if the page is closed.
 */
import { listPipelineRuns } from "@/lib/db/repo";
import { runPipeline, type PipelineMode, type PipelineOptions, type PipelineProgress } from "./index";

export interface LiveRun {
  id: string;
  mode: PipelineMode;
  limit: number;
  sources?: PipelineOptions["sources"];
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  progress: PipelineProgress;
  lines: string[];
  stats?: Record<string, number | string>;
  error?: string;
}

const runs = new Map<string, LiveRun>();
let activeId: string | null = null;

export class PipelineBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineBusyError";
  }
}

export function getRun(id: string): LiveRun | undefined {
  return runs.get(id);
}

export function getActiveRun(): LiveRun | undefined {
  const run = activeId ? runs.get(activeId) : undefined;
  return run?.status === "running" ? run : undefined;
}

export async function startRun(opts: { mode: PipelineMode; limit: number; sources?: PipelineOptions["sources"] }): Promise<{ run: LiveRun; alreadyRunning: boolean }> {
  const active = getActiveRun();
  if (active) return { run: active, alreadyRunning: true };
  // Another process (the CLI) may be running one right now.
  const recent = (await listPipelineRuns(5)).find((r) => r.status === "running" && Date.now() - new Date(r.startedAt).getTime() < 30 * 60_000);
  if (recent) throw new PipelineBusyError(`A pipeline run started ${new Date(recent.startedAt).toLocaleTimeString()} is still in progress (probably from \`stack4that refresh\`). Try again when it finishes.`);

  const id = `run_${Date.now().toString(36)}`;
  const run: LiveRun = { id, mode: opts.mode, limit: opts.limit, sources: opts.sources, status: "running", startedAt: new Date().toISOString(), progress: { stage: "starting", label: "Starting", done: 0, total: 1 }, lines: [] };
  runs.set(id, run);
  activeId = id;
  // Keep a bounded history in memory.
  if (runs.size > 20) for (const key of [...runs.keys()].slice(0, runs.size - 20)) if (key !== id) runs.delete(key);

  void runPipeline({
    id,
    mode: opts.mode,
    limit: opts.limit,
    sources: opts.sources,
    log: (line) => {
      run.lines.push(line);
      if (run.lines.length > 500) run.lines.splice(0, run.lines.length - 500);
    },
    onProgress: (p) => {
      run.progress = p;
    },
  })
    .then((res) => {
      run.status = res.status;
      run.stats = res.stats;
      run.finishedAt = new Date().toISOString();
      if (res.status === "failed") run.error = res.log.filter((l) => l.includes("FAILED")).pop();
    })
    .catch((err) => {
      run.status = "failed";
      run.error = (err as Error).message;
      run.finishedAt = new Date().toISOString();
    })
    .finally(() => {
      if (activeId === id) activeId = null;
    });
  return { run, alreadyRunning: false };
}
