"use client";
import { useEffect, useRef } from "react";

/**
 * Settings note. The hosted site and any self-hosted deploy use the server
 * environment key (TYPESAFE_API_KEY). The browser never collects or stores one.
 *
 * Mounted only while open.
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const focus = setTimeout(() => closeRef.current?.focus(), 30);
    return () => clearTimeout(focus);
  }, []);

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
              TypeSafe
            </h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">
              Stack4That makes every decision with TypeSafe.
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-[18px] leading-none text-white/45 transition hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>

        <p className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-white/75">
          This site runs on a managed TypeSafe AI key, so you don&apos;t need to provide one.
        </p>
      </div>
    </div>
  );
}
