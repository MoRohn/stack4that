import { AppHeader } from "@/components/AppHeader";
import { catalogStats } from "@/lib/db/repo";
import { CATEGORIES } from "@/lib/taxonomy";
import { CatalogBrowser } from "@/components/CatalogBrowser";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const stats = await catalogStats();
  return (
    <main className="min-h-screen">
      <AppHeader active="catalog" technologies={stats.active} updatedAt={stats.lastUpdated} />
      <div className="mx-auto max-w-5xl px-5 pb-10 pt-8">
      <h1 className="mb-1 text-[26px] font-semibold tracking-[-0.03em]">Technology knowledge base</h1>
      <p className="mb-6 text-[13.5px] text-white/70">Every technology Stack4That can recommend, with provenance for each fact.</p>
      <CatalogBrowser categories={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))} />
      </div>
    </main>
  );
}
