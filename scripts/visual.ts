/* Visual QA with the locally installed Chrome: npm run visual [-- http://stack4that:3333 [outDir]] */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://stack4that:3333";
const outDir = process.argv[3] ?? "screenshots";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--window-size=1440,900"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const shot = (name: string) => page.screenshot({ path: path.join(outDir, `${name}.png`) as `${string}.png` });

  await page.goto(base, { waitUntil: "load" });
  await sleep(4000);
  const pile = await page.evaluate(() => (window as unknown as { __s4t?: { getPileCount(): number } }).__s4t?.getPileCount() ?? -1);
  console.log(`idle: ${pile} pile blocks`);
  await shot("01-idle");

  await page.type("input[aria-label='What are you building?']", "Build the stack for a real-time AI news application", { delay: 5 });
  await sleep(600);
  await shot("02-typing-highlight");
  await page.keyboard.press("Enter");
  await sleep(2200);
  await shot("03-building");
  await page.waitForFunction(() => document.body.innerText.includes("decisions ·") && document.body.innerText.includes("technologies ·"), { timeout: 90000 });
  await sleep(2500);
  await shot("04-complete");
  const slots = await page.evaluate(() => (window as unknown as { __s4t?: { getStackSlots(): string[] } }).__s4t?.getStackSlots() ?? []);
  console.log(`complete: ${slots.length} stack blocks (${slots.join(", ")})`);
  const pos = await page.evaluate((slot) => (window as unknown as { __s4t?: { getBlockPosition(s: string): { x: number; y: number } | undefined } }).__s4t?.getBlockPosition(slot), slots.includes("relational-db") ? "relational-db" : slots[1]);
  if (pos) {
    await page.mouse.move(pos.x, pos.y);
    await sleep(300);
    await page.mouse.click(pos.x, pos.y);
    await sleep(800);
    await shot("05-detail-panel");
    const panelText = await page.evaluate(() => (document.querySelector("[role=dialog]") as HTMLElement | null)?.innerText ?? "");
    console.log(`panel: ${panelText.includes("WHY IT'S HERE") || panelText.toLowerCase().includes("why it's here") ? "has explanation" : "MISSING explanation"}; ${panelText.length} chars`);
    const useInstead = await page.$("aside button ::-p-text(Use instead)");
    if (useInstead) {
      await useInstead.click();
      await sleep(1500);
      await shot("06-swapping");
      await page.waitForFunction(() => !document.body.innerText.includes("Re-evaluating"), { timeout: 90000 });
      await sleep(2500);
      await shot("07-swapped");
      console.log("swap: completed");
    }
    await page.keyboard.press("Escape");
    const close = await page.$("aside button[aria-label='Close']");
    if (close) await close.click();
  }
  await page.type("input[aria-label='What are you building?']", "Make it entirely open source and self-hosted", { delay: 5 });
  await page.keyboard.press("Enter");
  await sleep(2500);
  await shot("08-refining");
  await page.waitForFunction(() => document.body.innerText.includes("decisions ·") && document.body.innerText.includes("technologies ·"), { timeout: 90000 });
  await sleep(3000);
  await shot("09-refined");
  const slots2 = await page.evaluate(() => (window as unknown as { __s4t?: { getStackSlots(): string[] } }).__s4t?.getStackSlots() ?? []);
  console.log(`refined: ${slots2.length} stack blocks`);

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "load" });
  await sleep(3000);
  await shot("10-mobile-idle");
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${base}/catalog`, { waitUntil: "load" });
  await sleep(800);
  await shot("11-catalog");
  await page.goto(`${base}/pipeline`, { waitUntil: "load" });
  await shot("12-pipeline");
  await browser.close();
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
