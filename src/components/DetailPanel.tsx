"use client";
import { useEffect, useRef, useState } from "react";
import { GROUP_COLOR } from "@/lib/client/scene";
import { safeUrl } from "@/lib/safe-url";
import { copyText } from "@/lib/client/clipboard";
import type { StackComponent, Technology, TechnologyChange } from "@/lib/types";

const CRITERION_LABEL: Record<string, string> = {
  "functional-fit": "Functional fit",
  "constraint-satisfaction": "Constraints",
  "integration-fit": "Integration",
  "developer-experience": "Developer experience",
  maturity: "Maturity",
  "operational-complexity": "Operational simplicity",
  scalability: "Scalability",
  performance: "Performance",
  cost: "Cost",
  ecosystem: "Ecosystem",
  documentation: "Docs",
  security: "Security",
  "deployment-flexibility": "Deployment",
  "vendor-lock-in": "Portability",
  "open-source": "Open source",
  maintenance: "Maintenance",
  "time-to-market": "Time to market",
};

export type PanelTarget = { kind: "stack"; component: StackComponent } | { kind: "tech"; slug: string; name: string } | null;

export function DetailPanel({ target, onClose, onSwap, busy }: { target: PanelTarget; onClose: () => void; onSwap?: (slotId: string, technologyId: string) => void; busy?: boolean }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const key = target ? (target.kind === "stack" ? target.component.slotId : target.slug) : null;
  useEffect(() => {
    if (key) closeRef.current?.focus({ preventScroll: true });
  }, [key]);
  if (!target) return null;
  return (
    <div className="s4t-panel s4t-scroll s4t-fade-in fixed right-0 top-0 z-30 flex h-full w-full max-w-[420px] flex-col overflow-y-auto" role="dialog" aria-modal="false" aria-label="Details">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/8 bg-[rgba(14,14,17,0.9)] px-5 py-3 backdrop-blur">
        <span className="text-[10px] uppercase tracking-[0.25em] text-white/55">{target.kind === "stack" ? "Selected technology" : "Technology"}</span>
        <button ref={closeRef} onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-white/50 hover:bg-white/5 hover:text-white">
          ✕
        </button>
      </div>
      {target.kind === "stack" ? <ComponentDetail c={target.component} onSwap={onSwap} busy={busy} /> : <TechDetail slug={target.slug} name={target.name} />}
    </div>
  );
}

function Favicon({ domain, fallback }: { domain?: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/favicon?domain=${encodeURIComponent(domain)}`} alt="" width={26} height={26} className="rounded" onError={() => setFailed(true)} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="mb-2 text-[10px] uppercase tracking-[0.25em] text-white/55">{title}</h3>
      <div className="text-[13.5px] leading-relaxed text-white/85">{children}</div>
    </section>
  );
}

function ComponentDetail({ c, onSwap, busy }: { c: StackComponent; onSwap?: (slotId: string, technologyId: string) => void; busy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const engine = `TypeSafe${c.decisionMetadata.model ? ` · ${c.decisionMetadata.model}` : ""}`;
  return (
    <div className="divide-y divide-white/8">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold" style={{ background: c.color, color: "#fff" }}>
            {c.iconPath ? (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                <path d={c.iconPath} fill="currentColor" />
              </svg>
            ) : (
              <Favicon domain={c.domain} fallback={c.monogram} />
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{c.name}</h2>
            <div className="text-xs" style={{ color: GROUP_COLOR[c.group] }}>
              <span className="mr-2 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-widest" style={{ borderColor: GROUP_COLOR[c.group] + "55" }}>
                {c.group}
              </span>
              {c.role}
            </div>
          </div>
        </div>
      </div>
      <Section title="Why it's here">{c.whyHere}</Section>
      <Section title="Role">{c.role}</Section>
      {c.alternatives.length > 0 && (
        <Section title="Decision">
          <div className="mb-1 text-white/60">Selected over:</div>
          <ul className="space-y-2">
            {c.alternatives.map((a) => (
              <li key={a.technologyId} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.name}</span>
                  {onSwap && (
                    <button disabled={busy} onClick={() => onSwap(c.slotId, a.technologyId)} className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:bg-white/10 disabled:opacity-40">
                      Use instead
                    </button>
                  )}
                </div>
                <div className="mt-1 text-xs text-white/55">{a.whyNot}</div>
                <div className="mt-1 text-xs text-white/60">Prefer it {a.whenPreferable.charAt(0).toLowerCase() + a.whenPreferable.slice(1)}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Tradeoff">{c.tradeoff}</Section>
      <Section title="Confidence">
        <div className="flex items-center gap-3">
          <div className="s4t-bar flex-1">
            <span style={{ width: `${Math.round(c.confidence * 100)}%` }} />
          </div>
          <span className="tabular-nums text-xs text-white/60">{Math.round(c.confidence * 100)}%</span>
        </div>
        <div className="mt-1 text-[11px] text-white/55">
          {engine} · {c.decisionMetadata.questionCount} questions · {c.decisionMetadata.latencyMs}ms
        </div>
        {c.criteriaResults.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {c.criteriaResults.map((r) => (
              <li key={r.criterionId} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 text-white/55">{CRITERION_LABEL[r.criterionId] ?? r.criterionId}</span>
                <div className="s4t-bar flex-1">
                  <span style={{ width: `${Math.round(r.score * 100)}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-white/60">{Math.round(r.score * 100)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {c.snippet && (
        <Section title="Implementation">
          <div className="mb-1 flex items-center justify-between text-[11px] text-white/60">
            <span>{c.snippet.title}</span>
            <button
              onClick={async () => {
                if (await copyText(c.snippet!.code)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }
              }}
              className="hover:text-white/80"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="s4t-code">{c.snippet.code}</pre>
        </Section>
      )}
      <Section title="Sources">
        <ul className="space-y-1 text-xs">
          {c.sources.filter((s) => safeUrl(s.url)).map((s, i) => (
            <li key={i} className="truncate">
              <span className="text-white/55">{s.claim} · {s.type} · </span>
              <a href={safeUrl(s.url)} target="_blank" rel="noopener noreferrer" className="text-white/70 underline-offset-2 hover:underline">
                {s.url.replace(/^https?:\/\//, "")}
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function TechDetail({ slug, name }: { slug: string; name: string }) {
  const [data, setData] = useState<{ technology: Technology & { iconPath?: string }; changes: TechnologyChange[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/technologies/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e.message)));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (error) return <div className="p-5 text-sm text-red-300">Could not load {name}: {error}</div>;
  if (!data || data.technology.slug !== slug) return <div className="s4t-pulse p-5 text-sm text-white/50">Loading {name}…</div>;
  const t = data.technology;
  return (
    <div className="divide-y divide-white/8">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: t.brandColor ?? "#444" }}>
            {t.iconPath ? (
              <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                <path d={t.iconPath} fill="currentColor" />
              </svg>
            ) : (
              name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{t.name}</h2>
            <div className="text-xs text-white/50">
              {t.companyName ? `${t.companyName}${t.parentCompanyName && t.parentCompanyName !== t.companyName ? ` (${t.parentCompanyName})` : ""} · ` : ""}
              {t.type} · {t.maturity} · {t.status}
            </div>
          </div>
        </div>
      </div>
      <Section title="About">{t.description}</Section>
      <Section title="Categories">
        <div className="flex flex-wrap gap-1.5">
          {t.categories.map((c) => (
            <span key={c} className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/70">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.capabilities.map((c) => (
            <span key={c} className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/55">
              {c}
            </span>
          ))}
        </div>
      </Section>
      <Section title="Facts">
        <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-xs">
          <dt className="text-white/60">Open source</dt>
          <dd>{t.openSource === undefined ? "unknown" : t.openSource ? `yes${t.license ? ` (${t.license})` : ""}` : "no"}</dd>
          <dt className="text-white/60">Pricing</dt>
          <dd>{t.pricingSummary ?? t.pricingModel}</dd>
          <dt className="text-white/60">Deployment</dt>
          <dd>{t.deploymentModels.join(", ") || "unknown"}</dd>
          <dt className="text-white/60">Compliance</dt>
          <dd>{t.compliance.join(", ") || "not documented"}</dd>
          {t.repositoryStars !== undefined && (
            <>
              <dt className="text-white/60">Stars</dt>
              <dd>{t.repositoryStars.toLocaleString()}</dd>
            </>
          )}
          <dt className="text-white/60">Verified</dt>
          <dd>
            {t.verificationStatus}
            {t.lastVerifiedAt ? ` · ${new Date(t.lastVerifiedAt).toLocaleDateString()}` : ""}
          </dd>
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {safeUrl(t.websiteUrl) && (
            <a className="text-white/70 hover:underline" href={safeUrl(t.websiteUrl)} target="_blank" rel="noopener noreferrer">
              Website ↗
            </a>
          )}
          {safeUrl(t.documentationUrl) && (
            <a className="text-white/70 hover:underline" href={safeUrl(t.documentationUrl)} target="_blank" rel="noopener noreferrer">
              Docs ↗
            </a>
          )}
          {safeUrl(t.repositoryUrl) && (
            <a className="text-white/70 hover:underline" href={safeUrl(t.repositoryUrl)} target="_blank" rel="noopener noreferrer">
              Repository ↗
            </a>
          )}
          {safeUrl(t.pricingUrl) && (
            <a className="text-white/70 hover:underline" href={safeUrl(t.pricingUrl)} target="_blank" rel="noopener noreferrer">
              Pricing ↗
            </a>
          )}
        </div>
      </Section>
      <Section title="Evidence">
        <ul className="space-y-1 text-[11px]">
          {t.evidence.slice(0, 10).map((e) => (
            <li key={e.id} className="truncate">
              <span className="text-white/55">{e.claimType} · {e.sourceType} · {Math.round(e.confidence * 100)}% · </span>
              <a className="text-white/65 hover:underline" href={safeUrl(e.sourceUrl)} target="_blank" rel="noopener noreferrer">
                {e.sourceUrl.replace(/^https?:\/\//, "").slice(0, 48)}
              </a>
            </li>
          ))}
        </ul>
      </Section>
      {data.changes.length > 0 && (
        <Section title="Change history">
          <ul className="space-y-1 text-[11px]">
            {data.changes.slice(0, 10).map((c) => (
              <li key={c.id}>
                <span className="text-white/55">{new Date(c.detectedAt).toLocaleDateString()} · {c.changeKind} · </span>
                {c.field}: {c.previousValue ?? "∅"} → {c.newValue ?? "∅"}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
