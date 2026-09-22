"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchitectEvent } from "@/lib/architect/events";
import { UniverseScene, type SceneTech } from "@/lib/client/scene";
import { useArchitect } from "@/lib/client/useArchitect";
import { architectureToMarkdown } from "@/lib/client/export";
import { copyText } from "@/lib/client/clipboard";
import type { Architecture, StackComponent } from "@/lib/types";
import { AppHeader } from "./AppHeader";
import { CommandBar } from "./CommandBar";
import { DetailPanel, type PanelTarget } from "./DetailPanel";
import { StatusLine } from "./StatusLine";
import { RequestPanel, SuggestionChips, ThreadRail } from "./ThreadUI";

function pileCount(width: number) {
  if (width < 700) return 60;
  if (width < 1100) return 160;
  return 380;
}

const sceneTech = (c: Pick<StackComponent, "technologyId" | "slug" | "name" | "color" | "iconPath" | "domain" | "monogram">): SceneTech => ({
  id: c.technologyId,
  slug: c.slug,
  name: c.name,
  color: c.color,
  iconPath: c.iconPath,
  domain: c.domain,
  monogram: c.monogram,
  categories: [],
});

export function Stack4That({ initialArchitecture }: { initialArchitecture?: Architecture }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<UniverseScene | null>(null);
  const [charging, setCharging] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const continuingRef = useRef(false);
  const replayed = useRef(false);
  const [panel, setPanel] = useState<PanelTarget>(null);
  const [universe, setUniverse] = useState<SceneTech[]>([]);
  const [catalogInfo, setCatalogInfo] = useState<{ count?: number; updatedAt?: string }>({});
  const [hover, setHover] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ text: string; n: number; append?: boolean } | undefined>(undefined);
  const [lastRequest, setLastRequest] = useState<{ text: string; continueThread: boolean } | null>(null);

  const onEvent = useCallback((e: ArchitectEvent) => {
    const scene = sceneRef.current;
    if (!scene) return;
    switch (e.type) {
      case "analysis.started":
        // A follow-up shakes the current stack loose and re-decides it; a new request starts clean.
        if (continuingRef.current && scene.getStackSlots().length) scene.shakeOff();
        else scene.beginBuild(false);
        break;
      case "candidate.found":
        scene.highlight(e.candidates.map((c) => c.id));
        break;
      case "technology.rejected":
        scene.flash(e.technologyId, "#ff8a8a");
        break;
      case "technology.selected":
        scene.select({ slotId: e.slotId, group: e.group, tech: { id: e.technologyId, slug: e.slug, name: e.name, color: e.color, iconPath: e.iconPath, domain: e.domain, monogram: e.monogram, categories: [] } });
        break;
      case "stack.component.removed":
        scene.remove(e.slotId);
        break;
      case "stack.completed":
        continuingRef.current = false;
        scene.finishBuild(e.architecture.edges);
        if (typeof window !== "undefined" && e.architecture.components.length > 0) window.history.replaceState(null, "", `/s/${e.architecture.id}`);
        break;
      default:
        break;
    }
  }, []);

  const { state, run, swap, load, reset } = useArchitect(onEvent);
  const busy = state.phase !== "idle" && state.phase !== "complete" && state.phase !== "error";
  const docked = state.phase !== "idle";
  const hasStack = state.order.length > 0;
  const turns = state.thread?.turns ?? [];
  const turnNumber = state.pendingTurn && busy ? (state.continuing ? turns.length + 1 : 1) : Math.max(1, turns.length);

  // Boot the scene
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new UniverseScene(
      canvas,
      {
        onHover: (info) => setHover(info ? info.tech.name : null),
        onClick: (info) => {
          if (info.kind === "stack") setPanel({ kind: "stack", component: { slotId: info.slotId } as never });
          else setPanel({ kind: "tech", slug: info.tech.slug, name: info.tech.name });
        },
      },
      { reducedMotion },
    );
    sceneRef.current = scene;
    (window as unknown as { __s4t?: UniverseScene }).__s4t = scene;
    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);
    fetch("/api/universe")
      .then((r) => r.json())
      .then((d: { items: SceneTech[]; count: number }) => {
        setUniverse(d.items);
        setCatalogInfo((c) => ({ ...c, count: d.count }));
        scene.setTechnologies(d.items, pileCount(window.innerWidth));
      })
      .catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { catalog?: { active: number; lastUpdated?: string } }) => d.catalog && setCatalogInfo({ count: d.catalog.active, updatedAt: d.catalog.lastUpdated }))
      .catch(() => {});
    return () => {
      window.removeEventListener("resize", onResize);
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  /** Show a saved architecture: blocks launch from the pile in order, then the relationships appear. */
  const replay = useCallback(
    (arch: Architecture) => {
      const scene = sceneRef.current;
      if (!scene) return;
      load(arch);
      scene.beginBuild(false);
      arch.components.forEach((c, i) => setTimeout(() => scene.select({ slotId: c.slotId, group: c.group, tech: sceneTech(c) }), 120 * i));
      setTimeout(() => scene.finishBuild(arch.edges), 120 * arch.components.length + 150);
    },
    [load],
  );

  // Replay a shared architecture once the universe is loaded.
  useEffect(() => {
    if (!initialArchitecture || replayed.current || !universe.length || !sceneRef.current) return;
    replayed.current = true;
    replay(initialArchitecture);
  }, [initialArchitecture, universe.length, replay]);

  // Keep the stack below the docked command area, whatever its height.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => sceneRef.current?.setTopInset(el.getBoundingClientRect().bottom + 12);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    const id = setInterval(update, 800); // the header also moves while it animates into its docked position
    return () => {
      ro.disconnect();
      clearInterval(id);
    };
  }, []);

  // A failed build that produced nothing returns the universe to its idle state.
  useEffect(() => {
    if (state.phase === "error" && state.order.length === 0) sceneRef.current?.finishBuild([]);
  }, [state.phase, state.order.length]);

  /**
   * Space launches the pile: a tap tosses it, holding charges a bigger blast. A space typed
   * into a request is still a space, and space on a focused control still activates it.
   */
  useEffect(() => {
    const passThrough = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n?.tagName) return false;
      if (n.tagName === "BUTTON" || n.tagName === "A" || n.tagName === "SELECT" || n.tagName === "SUMMARY") return true;
      if (n.isContentEditable) return true;
      if (n.tagName === "INPUT" || n.tagName === "TEXTAREA") return Boolean((n as HTMLInputElement).value?.trim());
      return false;
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || passThrough(e.target)) return;
      e.preventDefault();
      sceneRef.current?.startCharge();
      setCharging(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !sceneRef.current?.isCharging()) return;
      e.preventDefault();
      sceneRef.current.releaseCharge();
      setCharging(false);
    };
    const cancel = () => {
      sceneRef.current?.cancelCharge();
      setCharging(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", cancel);
    };
  }, []);

  // Escape closes the side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  const copy = async (text: string, message: string) => {
    setToast((await copyText(text)) ? message : "Could not copy. Select and copy manually.");
  };

  const submit = (text: string) => {
    setPanel(null);
    const continueThread = hasStack && Boolean(state.thread);
    continuingRef.current = continueThread;
    setLastRequest({ text, continueThread });
    run(text, { continueThread });
  };

  const newThread = () => {
    setPanel(null);
    continuingRef.current = false;
    sceneRef.current?.clearStack();
    reset();
    window.history.replaceState(null, "", "/");
  };

  const openTurn = async (architectureId: string) => {
    setPanel(null);
    try {
      const res = await fetch(`/api/stacks/${architectureId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const { architecture } = (await res.json()) as { architecture: Architecture };
      replay(architecture);
      window.history.replaceState(null, "", `/s/${architecture.id}`);
    } catch {
      setToast("That turn's stack is no longer available.");
    }
  };

  const resolvedPanel: PanelTarget = useMemo(() => {
    if (panel?.kind === "stack") {
      const id = panel.component.slotId;
      // After a merge the slot lives inside another block ("covered"): follow it there.
      const c = state.components[id] ?? Object.values(state.components).find((x) => x.coveredSlots.some((s) => s.slotId === id));
      return c ? { kind: "stack", component: c } : null;
    }
    return panel;
  }, [panel, state.components]);

  const onSwap = (slotId: string, technologyId: string) => {
    if (!state.architecture) return;
    setPanel({ kind: "stack", component: { slotId } as never });
    swap(state.architecture, slotId, technologyId);
  };

  const shownRequest = state.pendingTurn ?? state.intent?.interpretation?.original ?? state.request;
  const interpretation = state.pendingTurn && busy && !state.intent?.interpretation?.context?.includes(state.pendingTurn) ? undefined : state.intent?.interpretation;

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="Technology universe" role="img" />
      {/* Soft top fade so the header and request panel read cleanly over flying blocks */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-[var(--bg)] via-[var(--bg)]/70 to-transparent" />

      <AppHeader floating active="build" technologies={catalogInfo.count} updatedAt={catalogInfo.updatedAt} onHome={newThread} />

      {/* Physics hint: the pile answers the space bar, and drifts when the window is moved. */}
      <p aria-live="polite" className={`pointer-events-none absolute bottom-4 left-5 z-10 hidden rounded-full border border-white/10 bg-black/70 px-2.5 py-1 text-[11px] tracking-wide backdrop-blur-sm transition-colors md:block ${charging ? "text-white/85" : "text-white/60"}`}>
        {charging ? "Hold to charge · release to launch" : "Press space to launch the pile · hold to charge"}
      </p>

      {/* Command area: centered when idle, docked under the header while building */}
      <div ref={headerRef} className={`pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center transition-all duration-700 ease-out ${docked ? "top-[68px]" : "top-[24vh]"}`}>
        {!docked && (
          <div className="s4t-fade-in mb-7 flex flex-col items-center px-4 text-center">
            <h1 className="text-balance bg-gradient-to-b from-white to-white/60 bg-clip-text text-[28px] font-semibold tracking-[-0.03em] text-transparent sm:text-[34px]">What are you building?</h1>
            <p className="mt-2 text-[13.5px] text-white/60">Describe it in a few words. TypeSafe designs the stack, and you watch it assemble.</p>
          </div>
        )}
        <CommandBar docked={docked} busy={busy} hasStack={hasStack} onSubmit={submit} onReset={newThread} seed={seed} onChange={(t) => sceneRef.current?.setHighlightQuery(t)} />

        {docked && shownRequest && state.phase !== "error" && (
          <RequestPanel request={shownRequest} interpretation={interpretation} turnNumber={turnNumber} busy={busy} onOpenBlock={(slotId) => setPanel({ kind: "stack", component: { slotId } as never })} />
        )}

        {/* Compact thread on screens without the side rail */}
        {docked && turns.length > 1 && (
          <details className="pointer-events-auto mx-4 mt-2 w-[calc(100%-2rem)] max-w-2xl text-[11.5px] text-white/50 xl:hidden">
            <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50 hover:text-white/60">Thread · {turns.length} turns ▸</summary>
            <ol className="mt-1.5 space-y-1">
              {turns.map((t, i) => (
                <li key={`${i}-${t.request}`}>
                  <button type="button" disabled={!t.architectureId || t.architectureId === state.architecture?.id || busy} onClick={() => t.architectureId && openTurn(t.architectureId)} className="w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-white/5 disabled:hover:bg-transparent">
                    <span className="text-white/50">{i + 1}.</span> “{t.request}”
                  </button>
                </li>
              ))}
            </ol>
          </details>
        )}

        {state.phase === "complete" && hasStack && <SuggestionChips suggestions={state.suggestions} onPick={(s) => setSeed({ text: s.text, n: Date.now(), append: true })} />}

        <StatusLine state={state} />

        {state.phase === "error" && (
          <div role="alert" className="s4t-fade-in pointer-events-auto mx-4 mt-4 max-w-xl rounded-xl border border-red-300/25 bg-[rgba(30,10,12,0.88)] px-4 py-3 text-[13px] leading-relaxed text-red-50/90 backdrop-blur">
            <div className="mb-1 text-[10px] uppercase tracking-[0.25em] text-red-200/70">{/typesafe/i.test(state.error ?? "") ? "TypeSafe unavailable" : "Something went wrong"}</div>
            <div className="break-words">{state.error}</div>
            {lastRequest && (
              <button onClick={() => run(lastRequest.text, { continueThread: lastRequest.continueThread })} className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10">
                Try again
              </button>
            )}
          </div>
        )}

        {state.phase === "complete" && state.architecture && hasStack && (
          <div className="s4t-fade-in pointer-events-auto mt-2 flex items-center gap-2 text-[11px]">
            <button onClick={() => copy(window.location.href, "Link copied")} className="rounded-md border border-white/10 px-2.5 py-1 text-white/60 hover:bg-white/10 hover:text-white">
              Share link
            </button>
            <button onClick={() => copy(architectureToMarkdown(state.architecture!, window.location.href), "Markdown copied")} className="rounded-md border border-white/10 px-2.5 py-1 text-white/60 hover:bg-white/10 hover:text-white">
              Copy as Markdown
            </button>
          </div>
        )}
      </div>

      {/* Thread rail (wide screens) */}
      {docked && (turns.length > 0 || state.pendingTurn) && (
        <ThreadRail
          turns={state.continuing || !busy ? turns : []}
          pendingTurn={busy ? state.pendingTurn : undefined}
          currentArchitectureId={state.architecture?.id}
          constraints={state.constraints}
          assumptions={state.assumptions}
          issues={state.issues}
          onOpenTurn={openTurn}
          busy={busy}
        />
      )}

      {/* Keyboard and screen-reader access to the stack (the canvas itself is not focusable). */}
      {hasStack && (
        <nav aria-label="Recommended stack" className="sr-only focus-within:not-sr-only focus-within:absolute focus-within:bottom-4 focus-within:left-1/2 focus-within:z-30 focus-within:-translate-x-1/2 focus-within:rounded-xl focus-within:border focus-within:border-white/15 focus-within:bg-black/85 focus-within:p-2">
          <ul className="flex max-w-[90vw] flex-wrap justify-center gap-1">
            {state.order
              .map((id) => state.components[id])
              .filter(Boolean)
              .map((c) => (
                <li key={c.slotId}>
                  <button onClick={() => setPanel({ kind: "stack", component: c })} className="rounded-md px-2 py-1 text-xs text-white/80 hover:bg-white/10 focus:bg-white/15 focus:outline-none">
                    {c.name} <span className="text-white/55">· {c.slotLabel}</span>
                  </button>
                </li>
              ))}
          </ul>
        </nav>
      )}

      {toast && (
        <div role="status" className="s4t-fade-in pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-xs text-white/80">
          {toast}
        </div>
      )}

      {/* Hover name for touch devices without canvas tooltip */}
      {hover && <div className="pointer-events-none absolute bottom-4 right-4 z-20 text-[11px] text-white/55 md:hidden">{hover}</div>}

      <DetailPanel target={resolvedPanel} onClose={() => setPanel(null)} onSwap={state.architecture ? onSwap : undefined} busy={busy} />
    </main>
  );
}
