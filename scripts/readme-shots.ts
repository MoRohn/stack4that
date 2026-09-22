/*
 * Regenerate the images the README uses: the masthead and the four screenshots.
 *
 *   npm run shots [-- http://localhost:3333]
 *
 * The masthead is rendered from docs/assets/masthead.html in a real browser so it
 * picks up Geist exactly as the product does, rather than hoping a hand-written
 * SVG's text renders the same everywhere. The screenshots drive the live app,
 * which means the "decision" shot spends real TypeSafe calls building a stack.
 */
import "./env";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
/** `npm run shots -- --masthead` redraws just the banner, without spending TypeSafe calls. */
const mastheadOnly = args.includes("--masthead");
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3333";
const OUT = path.join(process.cwd(), "docs/images");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const REQUEST = "Build the stack for a real-time AI news application";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Refuse to shoot an unstyled page. A server running against a `.next` that was
 * rebuilt underneath it serves HTML whose CSS chunk 404s, and the screenshots
 * come out as bare markup — which is easy to miss and embarrassing in a README.
 */
async function assertStyled(page: Page) {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgb = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
  if (rgb[0] + rgb[1] + rgb[2] > 120) throw new Error(`stylesheet did not load (body background ${bg}) — is the server serving a current build?`);
}
/** Drop focus first: whatever we clicked to set the shot up would otherwise wear a focus ring. */
async function jpg(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`) as `${string}.jpg`, type: "jpeg", quality: 84 });
}

async function masthead(browser: Browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 300, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(process.cwd(), "docs/assets/masthead.html")).href, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, "masthead.png") as `${string}.png`, type: "png" });
  await page.close();
  console.log("masthead.png");
}

/** Wait for the architect to finish: the status line reports both counts when it settles. */
const waitForStack = (page: Page) =>
  page.waitForFunction(() => document.body.innerText.includes("decisions ·") && document.body.innerText.includes("technologies ·"), { timeout: 240_000 });

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  await masthead(browser);
  if (mastheadOnly) {
    await browser.close();
    return;
  }

  const page = await browser.newPage();
  // 1.5x is sharp on a retina display without making the README carry megabytes.
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // universe: the idle pile, settled.
  await page.goto(base, { waitUntil: "load" });
  await assertStyled(page);
  await sleep(4500);
  await jpg(page, "universe");
  console.log("universe.jpg");

  // blast: hold space to charge, and catch the pile at the top of its arc.
  await page.keyboard.down(" ");
  await sleep(1600);
  await page.keyboard.up(" ");
  await sleep(420);
  await jpg(page, "blast");
  console.log("blast.jpg");

  // decision: build a stack, then open a block's panel. Reload first so the pile
  // is settled again after the blast rather than still raining down.
  await page.goto(base, { waitUntil: "load" });
  await sleep(4000);
  await page.click("input[aria-label='What are you building?']");
  await page.type("input[aria-label='What are you building?']", REQUEST, { delay: 4 });
  await page.keyboard.press("Enter");
  await waitForStack(page);
  await sleep(3000);
  const slots = await page.evaluate(() => (window as unknown as { __s4t?: { getStackSlots(): string[] } }).__s4t?.getStackSlots() ?? []);
  const slot = slots.find((s) => s === "relational-db") ?? slots[1] ?? slots[0];
  const pos = slot ? await page.evaluate((s) => (window as unknown as { __s4t?: { getBlockPosition(s: string): { x: number; y: number } | undefined } }).__s4t?.getBlockPosition(s), slot) : undefined;
  if (!pos) throw new Error(`no block to open (slots: ${slots.join(", ") || "none"})`);
  await page.mouse.click(pos.x, pos.y);
  await sleep(1400);
  await jpg(page, "decision");
  console.log(`decision.jpg (${slot})`);

  // pipeline: the run page.
  await page.goto(`${base}/pipeline`, { waitUntil: "load" });
  await assertStyled(page);
  await sleep(1200);
  await jpg(page, "pipeline");
  console.log("pipeline.jpg");

  await browser.close();
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
