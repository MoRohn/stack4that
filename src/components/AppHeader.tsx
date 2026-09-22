"use client";
import Link from "next/link";
import { useState } from "react";
import { GearIcon } from "./GearIcon";
import { LogoMark, Wordmark } from "./Logo";
import { SettingsModal } from "./SettingsModal";

type Section = "build" | "catalog" | "pipeline";

function relative(iso?: string): string | undefined {
  if (!iso) return undefined;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return undefined;
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/**
 * Product header shared by every page: mark + wordmark, a live knowledge-base pill and section nav.
 * It floats over the canvas on the home page, so it stays light and translucent.
 */
export function AppHeader({ active, technologies, updatedAt, onHome, floating = false }: { active: Section; technologies?: number; updatedAt?: string; onHome?: () => void; floating?: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fresh = relative(updatedAt);
  const nav: Array<[Section, string, string]> = [
    ["build", "Build", "/"],
    ["catalog", "Catalog", "/catalog"],
    ["pipeline", "Pipeline", "/pipeline"],
  ];
  return (
    <header className={`${floating ? "pointer-events-none absolute inset-x-0 top-0 z-30" : "relative"} flex items-center justify-between gap-3 px-4 pt-3.5 sm:px-5`}>
      <Link
        href="/"
        onClick={(e) => {
          if (onHome) {
            e.preventDefault();
            onHome();
          }
        }}
        className="pointer-events-auto group flex items-center gap-2.5 rounded-xl py-1 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        aria-label="Stack4That home"
      >
        <LogoMark size={26} className="transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105" />
        <span className="flex flex-col leading-none">
          <Wordmark className="text-[17px]" />
          <span className="mt-1 hidden text-[10px] font-medium uppercase tracking-[0.22em] text-white/60 sm:block">AI stack architect</span>
        </span>
      </Link>

      <div className="pointer-events-auto flex items-center gap-2">
        {technologies !== undefined && (
          <Link
            href="/catalog"
            title={fresh ? `Knowledge base refreshed ${fresh}` : "Live technology knowledge base"}
            className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11.5px] text-white/65 backdrop-blur-md transition hover:border-white/20 hover:text-white md:flex"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-medium tabular-nums text-white/85">{technologies.toLocaleString()}</span>
            <span>technologies</span>
            {fresh && (
              <span className="text-white/60" suppressHydrationWarning>
                · {fresh}
              </span>
            )}
          </Link>
        )}
        <nav aria-label="Sections" className="flex items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5 backdrop-blur-md">
          {nav.map(([id, label, href]) => (
            <Link
              key={id}
              href={href}
              onClick={(e) => {
                if (id === "build" && onHome) {
                  e.preventDefault();
                  onHome();
                }
              }}
              aria-current={active === id ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${active === id ? "bg-white/[0.12] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" : "text-white/70 hover:text-white"}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
          aria-haspopup="dialog"
          title="TypeSafe API key"
          className="group/gear flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 backdrop-blur-md transition hover:border-white/20 hover:text-white focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:outline-none"
        >
          <GearIcon size={15} className="transition-transform duration-500 group-hover/gear:rotate-45" />
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
