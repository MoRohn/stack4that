"use client";
import { useEffect, useState } from "react";
import { safeUrl } from "@/lib/safe-url";

interface Item {
  id: string;
  slug: string;
  name: string;
  companyName?: string;
  parentCompanyName?: string;
  sources?: string[];
  type: string;
  categories: string[];
  shortDescription: string;
  websiteUrl?: string;
  openSource?: boolean;
  license?: string;
  pricingModel: string;
  maturity: string;
  status: string;
  brandColor?: string;
  verificationStatus: string;
  lastVerifiedAt?: string;
  repositoryStars?: number;
}

export function CatalogBrowser({ categories }: { categories: Array<{ id: string; label: string }> }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [stats, setStats] = useState<{ total: number; active: number; verified: number; withEmbeddings: number; lastUpdated: string } | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/technologies?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}&limit=120`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setItems(d.items);
          setStats(d.stats);
        })
        .catch(() => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, category]);
  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search technologies…" className="s4t-input w-full rounded-xl px-4 py-3 text-sm" />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="s4t-input rounded-xl px-3 py-3 text-sm text-white/80">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      {stats && (
        <div className="mt-3 text-[11px] text-white/60">
          {stats.active.toLocaleString()} active technologies · {stats.verified} verified by the pipeline · last update {stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleString() : "–"}
        </div>
      )}
      <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {items.map((t) => (
          <li key={t.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" style={{ background: t.brandColor ?? "#444" }} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-[11px] text-white/60">
                    {t.companyName ? `${t.companyName}${t.parentCompanyName && t.parentCompanyName !== t.companyName ? ` (${t.parentCompanyName})` : ""} · ` : ""}
                    {t.type} · {t.maturity}
                    {t.status !== "active" ? ` · ${t.status}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-white/65">{t.shortDescription}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.categories.map((c) => (
                    <button key={c} onClick={() => setCategory(c)} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/70 hover:bg-white/5">
                      {c}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-white/60">
                  <span>{t.openSource ? `open source${t.license ? ` · ${t.license}` : ""}` : t.openSource === false ? "proprietary" : "license unknown"}</span>
                  <span>{t.pricingModel}</span>
                  {t.repositoryStars !== undefined && <span>★ {t.repositoryStars.toLocaleString()}</span>}
                  <span>{t.verificationStatus}</span>
                  {t.sources?.filter((x) => x !== "curated-seed" && !x.startsWith("official") && x !== "simple-icons" && x !== "typesafe-classification").map((x) => (
                    <span key={x} className="rounded bg-white/[0.06] px-1.5 text-white/70">
                      via {x}
                    </span>
                  ))}
                  {safeUrl(t.websiteUrl) && (
                    <a href={safeUrl(t.websiteUrl)} target="_blank" rel="noopener noreferrer" className="hover:text-white/70">
                      website ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
