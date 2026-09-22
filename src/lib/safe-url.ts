/** Only http(s) URLs may be rendered as links; everything else (javascript:, data:, …) is dropped. */
export function safeUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
