/** Accessibility audit with axe-core over every page and state. npm run a11y -- [url] */
import "./env";
import puppeteer, { type Page } from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const base = process.argv[2] ?? "http://stack4that:3333";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const AXE = fs.readFileSync(axePath, "utf8");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const INPUT = "input[aria-label='What are you building?']";

interface Violation {
  id: string;
  impact: string;
  help: string;
  nodes: Array<{ html: string; target: string[] }>;
}

async function audit(page: Page, label: string) {
  await page.evaluate(AXE);
  const result = (await page.evaluate(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).axe.run(document, { resultTypes: ["violations"], rules: { "color-contrast": { enabled: true } } }),
  )) as { violations: Violation[] };
  const serious = result.violations.filter((v) => ["serious", "critical"].includes(v.impact));
  const minor = result.violations.filter((v) => !["serious", "critical"].includes(v.impact));
  console.log(`${serious.length ? "✗" : "✓"} ${label}: ${serious.length} serious/critical, ${minor.length} minor`);
  for (const v of [...serious, ...minor]) {
    console.log(`    [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length})`);
    for (const n of v.nodes.slice(0, 2)) console.log(`        ${n.target.join(" ")} — ${n.html.slice(0, 110)}`);
  }
  return serious.length;
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument("window.__name = (f) => f;");
  await page.setViewport({ width: 1440, height: 900 });
  let serious = 0;

  await page.goto(base, { waitUntil: "load" });
  await sleep(3000);
  serious += await audit(page, "home (idle)");

  await page.type(INPUT, "Build the stack for a real-time AI news application", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /decisions · .* technologies ·/.test(document.body.innerText), { timeout: 90000 });
  await sleep(2500);
  serious += await audit(page, "home (stack built)");

  const pos = await page.evaluate(() => {
    const s = (window as unknown as { __s4t: { getStackSlots(): string[]; getBlockPosition(x: string): { x: number; y: number } | undefined } }).__s4t;
    return s.getBlockPosition(s.getStackSlots()[1]);
  });
  if (pos) {
    await page.mouse.click(pos.x, pos.y);
    await page.waitForSelector("[role=dialog]");
    await sleep(600);
    serious += await audit(page, "detail panel");
    await page.keyboard.press("Escape");
  }

  for (const p of ["/catalog", "/pipeline"]) {
    await page.goto(`${base}${p}`, { waitUntil: "load" });
    await sleep(1200);
    serious += await audit(page, p);
  }

  // Mobile
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(base, { waitUntil: "load" });
  await sleep(2500);
  serious += await audit(page, "home (mobile)");

  await browser.close();
  console.log(`\n${serious === 0 ? "no serious or critical accessibility violations" : `${serious} serious/critical violations`}`);
  void path;
  process.exit(serious === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
