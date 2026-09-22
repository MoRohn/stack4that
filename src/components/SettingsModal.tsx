"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Where the key Stack4That is currently using came from. */
type KeySource = "session" | "env" | "none";
interface KeyStatus {
  source: KeySource;
  hint?: string;
}

const CONSOLE_URL = "https://console.typesafe.ai/settings/keys";

/**
 * Settings: the visitor's own TypeSafe API key.
 *
 * The key is posted once, verified against TypeSafe, then kept in an httpOnly
 * cookie — so this component can show that a key exists and its last four
 * characters, but never holds the secret itself after the save.
 *
 * Mounted only while open, so each visit starts from a clean form.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/typesafe-key", { cache: "no-store" });
      setStatus((await res.json()) as KeyStatus);
    } catch {
      setStatus(null);
    }
  }, []);

  // Mounted fresh on each open by the caller, so there is no stale state to reset.
  // The status fetch is deferred off the effect body, as the pipeline controls do.
  useEffect(() => {
    const status = setTimeout(() => void load(), 0);
    const focus = setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      clearTimeout(status);
      clearTimeout(focus);
    };
  }, [load]);

  // Escape closes, and Tab is kept inside the dialog while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function save() {
    const key = value.trim();
    if (!key) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/typesafe-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = (await res.json()) as KeyStatus & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save that key.");
        return;
      }
      setStatus(data);
      setValue("");
      setReveal(false);
      setSaved(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/typesafe-key", { method: "DELETE" });
      setStatus((await res.json()) as KeyStatus);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button aria-label="Close settings" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s4t-settings-title"
        className="s4t-fade-in relative w-full max-w-[460px] rounded-2xl border border-white/10 bg-[rgba(14,14,18,0.96)] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.6)] backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="s4t-settings-title" className="text-[15px] font-semibold tracking-[-0.01em] text-white">
              TypeSafe API key
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">
              Stack4That makes every decision with TypeSafe. Use your own key and all of its calls — architecture, swaps and pipeline runs — bill to your account.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-[18px] leading-none text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[12px]">
          <CurrentKey status={status} />
        </div>

        <label htmlFor="s4t-key" className="mt-4 block text-[11px] font-medium uppercase tracking-[0.18em] text-white/45">
          {status?.source === "session" ? "Replace key" : "Add key"}
        </label>
        <div className="mt-1.5 flex gap-2">
          <div className="relative flex-1">
            <input
              id="s4t-key"
              ref={inputRef}
              type={reveal ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) void save();
              }}
              placeholder="Paste your key"
              autoComplete="off"
              spellCheck={false}
              className="s4t-input w-full rounded-xl px-3 py-2 pr-14 text-[13px] font-mono"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-[10.5px] font-medium uppercase tracking-wider text-white/45 transition hover:bg-white/10 hover:text-white/80"
            >
              {reveal ? "Hide" : "Show"}
            </button>
          </div>
          <button
            onClick={() => void save()}
            disabled={busy || !value.trim()}
            className="rounded-xl border border-white/25 bg-white/[0.14] px-4 py-2 text-[13px] font-semibold text-white transition hover:border-white/40 hover:bg-white/[0.2] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? "Checking…" : "Save"}
          </button>
        </div>

        <p aria-live="polite" className="mt-2 min-h-[16px] text-[11.5px] leading-relaxed">
          {error ? <span className="text-red-200/90">{error}</span> : saved ? <span className="text-emerald-200/90">Key verified and saved.</span> : <span className="text-white/40">Verified with a single live call before it is saved.</span>}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/8 pt-3">
          <a href={CONSOLE_URL} target="_blank" rel="noreferrer" className="text-[12px] text-white/55 underline decoration-white/20 underline-offset-4 transition hover:text-white">
            Get a key from the TypeSafe console
          </a>
          {status?.source === "session" && (
            <button onClick={() => void remove()} disabled={busy} className="rounded-lg px-2.5 py-1.5 text-[12px] text-white/55 transition hover:bg-white/10 hover:text-white disabled:opacity-40">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CurrentKey({ status }: { status: KeyStatus | null }) {
  if (!status) return <span className="text-white/45">Checking…</span>;
  if (status.source === "session") {
    return (
      <span className="flex items-center gap-2 text-white/75">
        <Dot className="bg-emerald-400" />
        Using your key <span className="font-mono text-white/55">{status.hint}</span>
      </span>
    );
  }
  if (status.source === "env") {
    return (
      <span className="flex items-center gap-2 text-white/75">
        <Dot className="bg-emerald-400" />
        Using the server key from <span className="font-mono text-white/55">.env.local</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-white/75">
      <Dot className="bg-amber-300" />
      No key set — Stack4That cannot make decisions yet.
    </span>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}
