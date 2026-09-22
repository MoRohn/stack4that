import { describe, expect, it } from "vitest";
import { safeUrl } from "@/lib/safe-url";
import { rateLimit } from "@/lib/rate-limit";

describe("security helpers", () => {
  it("drops non-http URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>")).toBeUndefined();
    expect(safeUrl("https://postgresql.org")).toBe("https://postgresql.org/");
    expect(safeUrl(undefined)).toBeUndefined();
  });
  it("rate limits per key", () => {
    const key = `t-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(rateLimit(key, 3).ok).toBe(true);
    const r = rateLimit(key, 3);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});
