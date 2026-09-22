"use client";
import { useEffect, useRef, useState } from "react";

const EXAMPLES = [
  "Build me an AI-native fintech stack",
  "Architecture for a 2-person SaaS startup",
  "Replace Firebase in my existing stack",
  "Design a local RAG stack on NVIDIA hardware",
  "Best stack for an iOS social network expecting 500,000 users",
  "An autonomous video generation pipeline",
  "A HIPAA-oriented healthcare SaaS platform",
];

export function CommandBar({
  docked,
  busy,
  onSubmit,
  onChange,
  hasStack,
  onReset,
  seed,
}: {
  /** External text for the box. `append` adds to what is typed (suggestion chips); otherwise it replaces. */
  seed?: { text: string; n: number; append?: boolean };
  docked: boolean;
  busy: boolean;
  hasStack: boolean;
  onSubmit: (text: string) => void;
  onChange?: (text: string) => void;
  onReset?: () => void;
}) {
  const [value, setValue] = useState("");
  const [example, setExample] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // External text (suggestion chips): adopt it when a new seed arrives, then focus the box.
  const [seedN, setSeedN] = useState<number | undefined>(undefined);
  if (seed && seed.n !== seedN) {
    setSeedN(seed.n);
    setValue((v) => (seed.append && v.trim() && !v.includes(seed.text) ? `${v.trim().replace(/[.]?$/, ".")} ${seed.text}` : seed.append && v.includes(seed.text) ? v : seed.text));
  }
  useEffect(() => {
    if (!seed) return;
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollLeft = el.scrollWidth;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  useEffect(() => {
    if (docked) return;
    const id = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3800);
    return () => clearInterval(id);
  }, [docked]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
    onChange?.("");
  };

  return (
    <div className={`pointer-events-auto w-full ${docked ? "max-w-2xl" : "max-w-3xl"} px-4 transition-all duration-500`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="relative"
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            onChange?.(e.target.value);
          }}
          disabled={busy}
          aria-label="What are you building?"
          placeholder={docked ? (hasStack ? "Add context to reshape this stack… “we need SOC 2”, “1M users”, “use AWS”" : "What are you building?") : "What are you building?"}
          className={`s4t-input w-full rounded-2xl ${docked ? "px-4 py-3 text-[15px]" : "px-6 py-5 text-lg md:text-xl"} ${hasStack ? "pr-28" : "pr-14"} disabled:opacity-60`}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          aria-label={hasStack ? "Reshape the stack" : "Build"}
          className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-30 ${hasStack && value.trim() ? "border-white/25 bg-white/[0.14] text-white hover:border-white/40 hover:bg-white/[0.2]" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}
        >
          {busy ? <span className="s4t-pulse">…</span> : hasStack ? "Reshape ↵" : "↵"}
        </button>
      </form>
      {!docked && (
        <div className="mt-4 h-5 text-center text-sm text-[var(--muted)]" aria-live="polite">
          <button
            type="button"
            className="transition hover:text-white/80"
            onClick={() => {
              setValue(EXAMPLES[example]);
              onChange?.(EXAMPLES[example]);
              inputRef.current?.focus();
            }}
          >
            {EXAMPLES[example]}
          </button>
        </div>
      )}
      {docked && hasStack && !busy && (
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[11px] text-white/50">
          <span className="truncate">Context you add builds on this thread. Click any block for why it is here.</span>
          <button type="button" onClick={onReset} className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-white/55 hover:bg-white/10 hover:text-white">
            + New thread
          </button>
        </div>
      )}
    </div>
  );
}
