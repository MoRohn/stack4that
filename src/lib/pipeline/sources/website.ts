import { fetchWithTimeout } from "../http";

export interface WebsiteCheck {
  url: string;
  ok: boolean;
  status: number;
  finalUrl?: string;
  title?: string;
  description?: string;
  retrievedAt: string;
  error?: string;
}

/** Tier 1: the official website. Verifies existence and extracts title/description. */
export async function checkWebsite(url: string): Promise<WebsiteCheck> {
  const retrievedAt = new Date().toISOString();
  try {
    const res = await fetchWithTimeout(url, { method: "GET", headers: { accept: "text/html,*/*" } }, 12000);
    const status = res.status;
    let title: string | undefined;
    let description: string | undefined;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("text/html")) {
      const html = (await res.text()).slice(0, 200_000);
      title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim();
      description =
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i.exec(html)?.[1]?.trim() ??
        /<meta[^>]+content=["']([^"']{1,400})["'][^>]+name=["']description["']/i.exec(html)?.[1]?.trim() ??
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,400})["']/i.exec(html)?.[1]?.trim();
    }
    return { url, ok: status >= 200 && status < 400, status, finalUrl: res.url, title: decode(title), description: decode(description), retrievedAt };
  } catch (err) {
    return { url, ok: false, status: 0, retrievedAt, error: (err as Error).message };
  }
}

function decode(s?: string) {
  return s?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
