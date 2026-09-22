/**
 * Logo resolution via simple-icons. Server-side only (the package is large).
 * Provenance for every logo is recorded as evidence of type "simple-icons".
 */
import * as simpleIcons from "simple-icons";

interface IconLike {
  title: string;
  slug: string;
  path: string;
  hex: string;
}

let bySlug: Map<string, IconLike> | null = null;
let byTitle: Map<string, IconLike> | null = null;

function ensureIndex() {
  if (bySlug) return;
  bySlug = new Map();
  byTitle = new Map();
  for (const value of Object.values(simpleIcons) as unknown[]) {
    const icon = value as Partial<IconLike>;
    if (icon && typeof icon === "object" && typeof icon.slug === "string" && typeof icon.path === "string") {
      bySlug.set(icon.slug, icon as IconLike);
      byTitle!.set(icon.title!.toLowerCase(), icon as IconLike);
    }
  }
}

export interface ResolvedLogo {
  iconSlug: string;
  path: string;
  color: string;
}

export function resolveLogo(candidates: Array<string | null | undefined>): ResolvedLogo | undefined {
  ensureIndex();
  for (const c of candidates) {
    if (!c) continue;
    const key = c.toLowerCase();
    const hit = bySlug!.get(key.replace(/[^a-z0-9]/g, "")) ?? bySlug!.get(key) ?? byTitle!.get(key);
    if (hit) return { iconSlug: hit.slug, path: hit.path, color: `#${hit.hex}` };
  }
  return undefined;
}

export function iconPathForSlug(iconSlug?: string): string | undefined {
  if (!iconSlug) return undefined;
  ensureIndex();
  return bySlug!.get(iconSlug)?.path;
}

/** Deterministic pleasant color for technologies with no brand logo. */
export function fallbackColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return hslToHex(hue, 55, 52);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

export function monogram(name: string): string {
  const words = name.replace(/[()]/g, "").split(/[\s/.-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
