import { SEED } from "./seed";
import { seedToTechnology } from "./seed/helper";
import { fallbackColor, monogram, resolveLogo, iconPathForSlug } from "./logos";
import type { Technology, UniverseTech } from "@/lib/types";

let cache: Technology[] | null = null;

function domainOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The curated seed catalog materialized as Technology entities (with logos). */
export function seedTechnologies(): Technology[] {
  if (cache) return cache;
  cache = SEED.map((seed) => {
    const logo = seed.icon === null ? undefined : resolveLogo([seed.icon, seed.slug, seed.name, seed.name.split(" ")[0]]);
    const tech = seedToTechnology(seed, logo ? { iconSlug: logo.iconSlug, color: logo.color } : {});
    if (!tech.brandColor) tech.brandColor = fallbackColor(tech.slug);
    return tech;
  });
  return cache;
}

export function toUniverseTech(t: Technology): UniverseTech {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    color: t.brandColor ?? fallbackColor(t.slug),
    iconPath: iconPathForSlug(t.logoAssetId),
    domain: domainOf(t.websiteUrl),
    categories: t.categories,
    monogram: monogram(t.name),
  };
}
