/**
 * Browser end-to-end suite (real Chrome via puppeteer-core) with assertions,
 * timings and screenshots.  npm run e2e [-- http://stack4that:3333 [screenshotDir]]
 */
import puppeteer, { type Page } from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://stack4that:3333";
const outDir = process.argv[3] ?? "screenshots";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A stalled browser must fail the suite, not hang it.
setTimeout(() => {
  console.error(`✗ e2e watchdog: suite exceeded ${Number(process.env.E2E_TIMEOUT_MS ?? 600000) / 1000}s`);
  process.exit(2);
}, Number(process.env.E2E_TIMEOUT_MS ?? 600000)).unref();
const INPUT = "input[aria-label='What are you building?']";

type Scene = { getStackSlots(): string[]; getPileCount(): number; getBlockPosition(s: string): { x: number; y: number } | undefined; getPileCentroid(): { x: number; y: number }; applyWindowMotion(dx: number, dy: number): void; isCharging(): boolean };
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const metrics: Record<string, number | string> = {};
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const scene = <T>(page: Page, fn: (s: Scene) => T) => page.evaluate((f: string) => {
  const s = (window as unknown as { __s4t?: Scene }).__s4t;
  return s ? new Function("s", `return (${f})(s)`)(s) : null;
}, fn.toString()) as Promise<T | null>;

async function fps(page: Page, ms = 2000) {
  return page.evaluate((duration) => new Promise<number>((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - start < duration) requestAnimationFrame(tick);
      else resolve((frames * 1000) / (performance.now() - start));
    };
    requestAnimationFrame(tick);
  }), ms);
}

async function waitComplete(page: Page, timeout = 90000) {
  await page.waitForFunction(() => /decisions · .* technologies ·/.test(document.body.innerText) || document.body.innerText.includes("Try again"), { timeout });
}

async function build(page: Page, text: string) {
  await page.click(INPUT, { count: 3 });
  await page.type(INPUT, text, { delay: 2 });
  const t0 = Date.now();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => ((window as unknown as { __s4t?: Scene }).__s4t?.getStackSlots().length ?? 0) > 0, { timeout: 60000 });
  const firstBlock = Date.now() - t0;
  await waitComplete(page);
  return { firstBlock, total: Date.now() - t0 };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--enable-gpu-rasterization", "--ignore-gpu-blocklist", ...(process.env.CHROME_EXTRA_ARGS ? [process.env.CHROME_EXTRA_ARGS] : [])] });
  // tsx (esbuild keepNames) wraps functions with __name(); give pages a no-op shim so evaluate() callbacks run.
  browser.on("targetcreated", async (t) => {
    const pg = await t.page().catch(() => null);
    await pg?.evaluateOnNewDocument("window.__name = (f) => f;");
  });
  // Clipboard permissions exist only for secure origins (https, localhost). http://stack4that:3333 is not one,
  // so there the app uses its execCommand fallback and the suite verifies the confirmation toast instead.
  const secureOrigin = /^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(base);
  if (secureOrigin) await browser.defaultBrowserContext().overridePermissions(base, ["clipboard-read", "clipboard-write", "clipboard-sanitized-write"]);
  const page = await browser.newPage();
  await page.evaluateOnNewDocument("window.__name = (f) => f;");
  await page.setViewport({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("requestfailed", (r) => !r.url().includes("/api/architect") && errors.push(`requestfailed: ${r.url()}`));
  const shot = (n: string) => page.screenshot({ path: path.join(outDir, `${n}.png`) as `${string}.png` });

  // 1. Initial load
  const t0 = Date.now();
  await page.goto(base, { waitUntil: "load" });
  await page.waitForFunction(() => ((window as unknown as { __s4t?: Scene }).__s4t?.getPileCount() ?? 0) > 50, { timeout: 15000 });
  metrics.timeToUniverseMs = Date.now() - t0;
  await sleep(3500);
  const pile = await scene(page, (s) => s.getPileCount());
  check("universe renders a physics pile", (pile ?? 0) >= 150, `${pile} blocks, ${metrics.timeToUniverseMs}ms`);
  await sleep(3000);
  const idleTop = await page.evaluate(() => (window as unknown as { __s4t: { getVisiblePileTop(): number } }).__s4t.getVisiblePileTop());
  const inputBottom = await page.$eval(INPUT, (el) => el.getBoundingClientRect().bottom);
  check("settled pile stays well below the command input", idleTop > inputBottom + 60, `pile top ${Math.round(idleTop)}px, input bottom ${Math.round(inputBottom)}px`);
  metrics.idleFps = Math.round(await fps(page));
  check("idle animation is smooth", Number(metrics.idleFps) >= 45, `${metrics.idleFps} fps`);
  check("input is focused on load", await page.evaluate((sel) => document.activeElement === document.querySelector(sel), INPUT));
  await shot("01-idle");

  // 2. Build
  const run1 = await build(page, "Build the stack for a real-time AI news application");
  metrics.firstBlockMs = run1.firstBlock;
  metrics.buildTotalMs = run1.total;
  check("first block lands before the stack completes (progressive)", run1.firstBlock < run1.total - 500, `first ${run1.firstBlock}ms, total ${run1.total}ms`);
  check("first block within 4s", run1.firstBlock < 4000, `${run1.firstBlock}ms`);
  await sleep(2500);
  const slots = (await scene(page, (s) => s.getStackSlots())) ?? [];
  check("stack has a sensible number of blocks", slots.length >= 7 && slots.length <= 16, `${slots.length}`);
  metrics.buildFps = Math.round(await fps(page));
  check("assembled scene stays smooth", Number(metrics.buildFps) >= 40, `${metrics.buildFps} fps`);
  const positions = await page.evaluate((ss: string[]) => ss.map((sl) => (window as unknown as { __s4t: Scene }).__s4t.getBlockPosition(sl)), slots);
  const onScreen = positions.every((p) => p && p.x > 0 && p.x < 1440 && p.y > 140 && p.y < 900);
  check("every stack block is on screen, below the input", onScreen);
  const firstText = await page.evaluate(() => document.body.innerText);
  check("your request and the brief built from it are both shown", firstText.includes("“Build the stack for a real-time AI news application”") && /built from|interpreted/i.test(firstText) && /Design the technology stack/i.test(firstText));
  check("primary objectives are traced to blocks", /served by/i.test(firstText));
  // Landed blocks rest on their row line (nothing hangs between rows).
  const rows = await page.evaluate(() => {
    const s = (window as unknown as { __s4t: Scene }).__s4t;
    return s.getStackSlots().map((sl) => s.getBlockPosition(sl)!.y);
  });
  const distinctRows = [...new Set(rows.map((y) => Math.round(y / 6)))].length;
  check("blocks settle onto their rows", distinctRows <= 6, `${distinctRows} distinct resting heights`);
  const overlaps = positions.filter((a, i) => positions.some((b, j) => j !== i && a && b && Math.abs(a.x - b.x) < 52 && Math.abs(a.y - b.y) < 52)).length;
  check("stack blocks do not overlap", overlaps === 0, `${overlaps} overlapping`);
  await shot("02-complete");

  // 3. Detail panel via canvas click
  const target = slots.includes("api-backend") ? "api-backend" : slots[0];
  const pos = await page.evaluate((sl: string) => (window as unknown as { __s4t: Scene }).__s4t.getBlockPosition(sl), target);
  await page.mouse.click(pos!.x, pos!.y);
  await page.waitForSelector("[role=dialog]", { timeout: 3000 });
  const panel = await page.$eval("[role=dialog]", (el) => (el as HTMLElement).innerText);
  check("panel explains why the technology is here", /why it.s here/i.test(panel) && panel.length > 600);
  check("panel shows decision, tradeoff, confidence, sources", ["DECISION", "TRADEOFF", "CONFIDENCE", "SOURCES"].every((h) => panel.toUpperCase().includes(h)));
  check("panel focuses its close button", await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Close"));
  await shot("03-panel");
  await page.keyboard.press("Escape");
  await sleep(200);
  check("Escape closes the panel", !(await page.$("[role=dialog]")));

  // 4. Share + export
  const share = await page.$("button ::-p-text(Share link)");
  check("share and export actions are offered", Boolean(share) && Boolean(await page.$("button ::-p-text(Copy as Markdown)")));
  check("URL points at the saved stack", /\/s\/arch_/.test(page.url()), page.url());
  if (!secureOrigin) {
    // Capture what the execCommand fallback copies.
    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string };
      document.addEventListener("copy", () => {
        w.__copied = (document.activeElement as HTMLTextAreaElement | null)?.value ?? "";
      }, { once: true });
    });
  }
  await (await page.$("button ::-p-text(Copy as Markdown)"))?.click();
  await sleep(400);
  const md = secureOrigin
    ? await page.evaluate(() => navigator.clipboard.readText().catch(() => ""))
    : await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");
  const toastText = await page.evaluate(() => document.body.innerText);
  check(`markdown export contains the stack (${secureOrigin ? "clipboard API" : "insecure-origin fallback"})`, md.startsWith("# Stack:") && md.includes("Tradeoff") && toastText.includes("Markdown copied"), `${md.length} chars`);

  // 5. Keyboard access
  await page.focus(INPUT);
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => Boolean(document.activeElement?.closest("nav[aria-label='Recommended stack']")));
  }
  check("stack is reachable by keyboard", reached);
  if (reached) {
    await page.keyboard.press("Enter");
    await sleep(300);
    check("keyboard opens the detail panel", Boolean(await page.$("[role=dialog]")));
    await shot("04-keyboard");
    await page.keyboard.press("Escape");
  }

  // 6. Swap
  await page.mouse.click(pos!.x, pos!.y);
  await page.waitForSelector("[role=dialog]");
  const altBtn = await page.$("[role=dialog] button ::-p-text(Use instead)");
  if (altBtn) {
    const before = (await scene(page, (s) => s.getStackSlots())) ?? [];
    await altBtn.click();
    await waitComplete(page);
    await sleep(2000);
    const after = (await scene(page, (s) => s.getStackSlots())) ?? [];
    const panelAfter = await page.$eval("[role=dialog]", (el) => (el as HTMLElement).innerText).catch(() => "");
    check("swap replaces the component and explains it", panelAfter.includes("You chose it explicitly") && after.length >= before.length - 2, `${before.length} → ${after.length} blocks`);
    await shot("05-swapped");
    await page.keyboard.press("Escape");
  }

  // 7. Add context via a suggestion chip, then continue the same thread (shake off and rebuild).
  const chip = await page.$("button ::-p-text(+ Keep it cheap)") ?? (await page.$$("[aria-label='Add context'] button"))[0];
  if (chip) {
    await chip.click();
    await sleep(250);
    const typed = await page.$eval(INPUT, (el) => (el as HTMLInputElement).value);
    check("a suggestion chip adds its context to the input", typed.length > 5, typed);
    await page.click(INPUT, { count: 3 });
  } else check("a suggestion chip adds its context to the input", false, "no suggestion chips");
  await page.type(INPUT, "Make it entirely open source and self-hosted", { delay: 2 });
  await page.keyboard.press("Enter");
  await sleep(700);
  await shot("06a-shaking");
  await waitComplete(page);
  await sleep(2500);
  const refined = await page.evaluate(() => document.body.innerText);
  check("the follow-up continues the thread with its context", /turn 2/i.test(refined) && refined.includes("“Make it entirely open source and self-hosted”") && /Build the stack for a real-time AI news application/.test(refined));
  check("the new context becomes a hard constraint", /Open source required|open-source software only/i.test(refined));
  await shot("06-refined");

  // 8. Pile click on the idle screen opens a technology record
  await (await page.$("button ::-p-text(New thread)"))?.click();
  await sleep(2500);
  check("a new thread returns to the empty state", page.url().endsWith("/") && ((await scene(page, (s) => s.getStackSlots())) ?? []).length === 0);
  const pileTarget = await page.evaluate(() => {
    const s = (window as unknown as { __s4t: { getPilePosition(id: string): { x: number; y: number } | undefined } }).__s4t;
    for (const id of ["tech_postgresql", "tech_redis", "tech_nextjs", "tech_stripe", "tech_supabase", "tech_vercel"]) {
      const p = s.getPilePosition(id);
      if (p && p.y > 500) return p;
    }
    return null;
  });
  if (pileTarget) {
    await page.mouse.click(pileTarget.x, pileTarget.y);
    await page.waitForSelector("[role=dialog]", { timeout: 3000 }).catch(() => {});
    await sleep(800);
    const text = await page.$eval("[role=dialog]", (el) => (el as HTMLElement).innerText).catch(() => "");
    check("clicking a pile block shows its knowledge-base record", /EVIDENCE/i.test(text) && /FACTS/i.test(text));
    await shot("07-tech-record");
    await page.keyboard.press("Escape");
  } else check("clicking a pile block shows its knowledge-base record", false, "no known block found in pile");

  // 8b. The pile answers the space bar and the window being dragged.
  {
    const rest = (await scene(page, (s) => s.getPileCentroid())) ?? { x: 0, y: 0 };
    await page.keyboard.down("Space");
    await sleep(400);
    const charging = (await scene(page, (s) => s.isCharging())) ?? false;
    await sleep(1300);
    await page.keyboard.up("Space");
    await sleep(300);
    const launched = (await scene(page, (s) => s.getPileCentroid())) ?? rest;
    const rise = Math.round(rest.y - launched.y);
    check("holding space charges a blast", charging);
    check("releasing space throws the pile upward", rise > 60, `${rise}px`);
    const blastFps = await fps(page, 1200);
    check("the blast stays smooth", blastFps >= 50, `${blastFps} fps`);
    metrics.blastFps = blastFps;
    await sleep(4500);
    const settled = (await scene(page, (s) => s.getPileCentroid())) ?? launched;
    check("the pile falls back and settles", Math.abs(settled.y - rest.y) < 80, `${Math.round(settled.y - rest.y)}px from rest`);

    // Typing keeps the space bar as a space.
    await page.click(INPUT, { count: 3 });
    await page.type(INPUT, "ai news");
    await page.keyboard.press("Space");
    const typed = await page.$eval(INPUT, (el) => (el as HTMLInputElement).value);
    check("space inside a request stays a space", typed === "ai news ", JSON.stringify(typed));
    await page.click(INPUT, { count: 3 });
    await page.keyboard.press("Backspace");

    // Dragging the window sloshes the pile, and it comes back to rest.
    const preDrag = (await scene(page, (s) => s.getPileCentroid())) ?? { x: 0, y: 0 };
    let peak = 0;
    for (let i = 0; i < 8; i++) {
      await scene(page, (s) => s.applyWindowMotion(-45, 0));
      const now = (await scene(page, (s) => s.getPileCentroid())) ?? preDrag;
      peak = Math.max(peak, Math.abs(now.x - preDrag.x));
      await sleep(16);
    }
    await scene(page, (s) => s.applyWindowMotion(0, 0));
    for (let i = 0; i < 20; i++) {
      const now = (await scene(page, (s) => s.getPileCentroid())) ?? preDrag;
      peak = Math.max(peak, Math.abs(now.x - preDrag.x));
      await sleep(16);
    }
    check("dragging the window makes the pile slosh", peak > 30, `${Math.round(peak)}px`);
    await sleep(2500);
    const afterDrag = (await scene(page, (s) => s.getPileCentroid())) ?? preDrag;
    check("the pile settles again after the window stops", Math.abs(afterDrag.x - preDrag.x) < 220, `${Math.round(afterDrag.x - preDrag.x)}px`);
  }

  // 9. Short requests are accepted, interpreted and built; a browser refresh keeps the stack.
  await page.click(INPUT, { count: 3 });
  await page.type(INPUT, "todo app");
  await page.keyboard.press("Enter");
  await waitComplete(page);
  await sleep(2500);
  const shortText = await page.evaluate(() => document.body.innerText);
  const shortBlocks = ((await scene(page, (s) => s.getStackSlots())) ?? []).length;
  check("a two-word request is accepted, interpreted and built", /interpreted/i.test(shortText) && /task-management/i.test(shortText) && shortBlocks >= 4, `${shortBlocks} blocks`);
  await shot("08-short-request");
  const reloaded = await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => ((window as unknown as { __s4t?: Scene }).__s4t?.getStackSlots().length ?? 0) > 3, { timeout: 20000 }).catch(() => {});
  check("a browser refresh keeps the stack", reloaded?.status() === 200 && (((await scene(page, (s) => s.getStackSlots())) ?? []).length) > 3, `HTTP ${reloaded?.status()}`);

  // 10. Error + retry (simulated server failure)
  await (await page.$("button ::-p-text(New thread)"))?.click().catch(() => {});
  await page.goto(base, { waitUntil: "load" });
  await page.setRequestInterception(true);
  let fail = true;
  const handler = (req: import("puppeteer-core").HTTPRequest) => {
    if (fail && req.url().includes("/api/architect/stream")) req.respond({ status: 503, contentType: "text/plain", body: "Service temporarily unavailable" });
    else req.continue();
  };
  page.on("request", handler);
  await page.waitForSelector(INPUT);
  await page.type(INPUT, "Build a cheap stack for a two-person startup");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.body.innerText.includes("Try again"), { timeout: 10000 }).catch(() => {});
  check("a failed request shows an error with retry", (await page.evaluate(() => document.body.innerText)).includes("Try again"));
  await shot("09-error");
  fail = false;
  await (await page.$("button ::-p-text(Try again)"))?.click();
  await waitComplete(page).catch(() => {});
  check("retry recovers", /decisions ·/.test(await page.evaluate(() => document.body.innerText)));
  page.off("request", handler);
  await page.setRequestInterception(false);
  const sharedUrl = page.url();

  // 11. Shared link replay
  const p2 = await browser.newPage();
  await p2.evaluateOnNewDocument("window.__name = (f) => f;");
  await p2.setViewport({ width: 1440, height: 900 });
  await p2.goto(sharedUrl, { waitUntil: "load" });
  await p2.waitForFunction(() => ((window as unknown as { __s4t?: Scene }).__s4t?.getStackSlots().length ?? 0) > 3, { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  check("shared link replays the saved stack", (((await scene(p2, (s) => s.getStackSlots())) ?? []).length) > 3, sharedUrl);
  await p2.screenshot({ path: path.join(outDir, "10-shared.png") as `${string}.png` });
  await p2.close();

  // 12. Reduced motion
  const p3 = await browser.newPage();
  await p3.evaluateOnNewDocument("window.__name = (f) => f;");
  await p3.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await p3.setViewport({ width: 1280, height: 800 });
  await p3.goto(base, { waitUntil: "load" });
  await sleep(2500);
  await p3.type(INPUT, "Architecture for a 2-person SaaS startup");
  await p3.keyboard.press("Enter");
  await waitComplete(p3);
  await sleep(800);
  check("reduced motion still assembles the stack", (((await scene(p3, (s) => s.getStackSlots())) ?? []).length) >= 4);
  const rmTop = await p3.evaluate(() => (window as unknown as { __s4t: { getVisiblePileTop(): number } }).__s4t.getVisiblePileTop());
  check("reduced motion keeps the pile to a still strip at the bottom", rmTop > 800 * 0.7, `pile top ${Math.round(rmTop)}px of 800`);
  const rmSlots = ((await scene(p3, (s) => s.getStackSlots())) ?? []) as string[];
  const rmPos = await p3.evaluate((sl: string[]) => sl.map((x) => (window as unknown as { __s4t: Scene }).__s4t.getBlockPosition(x)), rmSlots);
  const rmHeader = await p3.evaluate(() => Math.max(...[...document.querySelectorAll("button, input")].filter((e) => (e as HTMLElement).offsetParent && !e.closest("nav[aria-label='Recommended stack']") && e.getBoundingClientRect().width > 4).map((e) => e.getBoundingClientRect()).filter((r) => r.top < 400).map((r) => r.bottom)));
  const rmOverlap = rmPos.filter((a, i) => rmPos.some((b, j) => j !== i && a && b && Math.abs(a.x - b.x) < 50 && Math.abs(a.y - b.y) < 50)).length;
  check("reduced motion: stack is laid out cleanly below the header", rmOverlap === 0 && rmPos.every((p) => p && p.y - 32 > rmHeader - 2 && p.y < rmTop), `${rmOverlap} overlapping, header ${Math.round(rmHeader)}`);
  await p3.screenshot({ path: path.join(outDir, "11-reduced-motion.png") as `${string}.png` });
  await p3.close();

  // 13. Tablet + mobile builds
  for (const [name, w, h] of [["12-tablet", 820, 1180], ["13-mobile", 390, 844]] as const) {
    const pm = await browser.newPage();
    await pm.evaluateOnNewDocument("window.__name = (f) => f;");
  await pm.evaluateOnNewDocument("window.__name = (f) => f;");
    await pm.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: w < 500, hasTouch: w < 500 });
    await pm.goto(base, { waitUntil: "load" });
    await sleep(2500);
    const count = await scene(pm, (s) => s.getPileCount());
    await pm.type(INPUT, "Build a cheap stack for a two-person startup");
    await pm.keyboard.press("Enter");
    await waitComplete(pm);
    await sleep(3000);
    const ss = (await scene(pm, (s) => s.getStackSlots())) ?? [];
    const ps = await pm.evaluate((sl: string[]) => sl.map((x) => (window as unknown as { __s4t: Scene }).__s4t.getBlockPosition(x)), ss);
    const inside = ps.every((p) => p && p.x > 0 && p.x < w && p.y > 0 && p.y < h);
    const blockSize = w < 700 ? 44 : 54;
    const ov = ps.filter((a, i) => ps.some((b, j) => j !== i && a && b && Math.abs(a.x - b.x) < blockSize * 0.8 && Math.abs(a.y - b.y) < blockSize * 0.8)).length;
    const headerBottom = await pm.evaluate(() => Math.max(...[...document.querySelectorAll("button, input")].filter((e) => (e as HTMLElement).offsetParent && !e.closest("nav[aria-label='Recommended stack']") && e.getBoundingClientRect().width > 4).map((e) => e.getBoundingClientRect()).filter((r) => r.top < 500).map((r) => r.bottom)));
    const belowHeader = ps.every((p) => p && p.y - blockSize / 2 > headerBottom - 2);
    check(`${name}: stack blocks do not overlap each other or the header`, ov === 0 && belowHeader, `${ov} overlapping, header bottom ${Math.round(headerBottom)}`);
    const hscroll = await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`${name}: reduced pile, stack fits the viewport, no horizontal scroll`, (count ?? 999) <= (w < 500 ? 80 : 200) && ss.length > 3 && inside && !hscroll, `pile ${count}, ${ss.length} blocks`);
    await pm.screenshot({ path: path.join(outDir, `${name}.png`) as `${string}.png` });
    await pm.close();
  }

  // 13b. Launch a pipeline run from the pipeline page and watch it finish.
  await page.goto(`${base}/pipeline`, { waitUntil: "load" });
  await page.waitForSelector("section[aria-label='Run the pipeline']");
  const limitSelect = await page.$("section[aria-label='Run the pipeline'] select");
  await limitSelect?.select("10");
  const runBtn = await page.$("button ::-p-text(Run refresh)");
  check("the pipeline page offers a run control", Boolean(runBtn));
  if (runBtn) {
    await runBtn.click();
    await page.waitForFunction(() => /running|completed/.test(document.querySelector("section[aria-label='Run the pipeline']")?.textContent ?? ""), { timeout: 15000 }).catch(() => {});
    await shot("15-pipeline-running");
    await page.waitForFunction(() => /completed|failed/.test(document.querySelector("section[aria-label='Run the pipeline']")?.textContent ?? ""), { timeout: 180000 }).catch(() => {});
    const panel = await page.$eval("section[aria-label='Run the pipeline']", (el) => (el as HTMLElement).innerText);
    check("the run completes and reports what it did", /completed/i.test(panel) && /refreshed:\s*\d+/i.test(panel), panel.split("\n").filter((l) => /refreshed|embedded|completed/i.test(l))[0] ?? "");
    await shot("16-pipeline-done");
  }

  // 14. Secondary pages
  for (const [p, sel] of [["/catalog", "input"], ["/pipeline", "main"]] as const) {
    await page.goto(`${base}${p}`, { waitUntil: "load" });
    await page.waitForSelector(sel);
    await sleep(700);
    check(`${p} renders`, (await page.evaluate(() => document.body.innerText.length)) > 300);
    await shot(`14-${p.slice(1)}`);
  }
  await page.goto(`${base}/catalog`, { waitUntil: "load" });
  await page.type("input", "vector");
  await sleep(700);
  const catText = await page.evaluate(() => document.body.innerText);
  check("catalog search finds vector databases", /pgvector|Pinecone|Qdrant/.test(catText));

  await browser.close();
  // Aborted RSC prefetches during navigation are expected browser behaviour.
  const noisy = errors.filter((e) => !/favicon|chrome-extension|_rsc=/.test(e));
  check("no console errors or failed requests", noisy.filter((e) => !e.includes("503")).length === 0, noisy.slice(0, 5).join(" | "));
  console.log("\nmetrics:", JSON.stringify(metrics));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
