import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const buf = await readFile(join(root, path));
  res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
  res.end(buf);
});
await new Promise(r => server.listen(0, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector(".node");

/* Real user flow: click the six material cards in order (fills first empty slot). */
const order = await page.evaluate(() => window.__ECHO__.correctOrder);
for (const mat of order) {
  await page.locator(`.mat-card[data-mat="${mat}"]`).click();
}
let filled = await page.locator(".seq-slot.filled").count();

/* Clear one slot via its × button, then refill by clicking the card again. */
await page.locator(".seq-slot").nth(2).locator(".s-clear").click();
const afterClear = await page.locator(".seq-slot.filled").count();
await page.locator(`.mat-card[data-mat="${order[2]}"]`).click();
const refilled = await page.locator(".seq-slot.filled").count();

/* Submit the correct arrangement purely through UI. */
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.ok");
const firstVerdict = await page.evaluate(() => window.__lastVerdict.verdict);

/* Reset and drive a wrong arrangement through the UI, then submit. */
await page.click("#resetBtn");
const resetSlots = await page.locator(".seq-slot.filled").count();
const wrong = [...order];
[wrong[0], wrong[1]] = [wrong[1], wrong[0]];
for (const mat of wrong) await page.locator(`.mat-card[data-mat="${mat}"]`).click();
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.bad");
const secondVerdict = await page.evaluate(() => window.__lastVerdict.verdict);

/* Recover via reset + correct UI clicks, verify path closes again. */
await page.click("#resetBtn");
for (const mat of order) await page.locator(`.mat-card[data-mat="${mat}"]`).click();
await page.click("#submitBtn");
await page.waitForSelector(".grid-badge.ok");
const recovered = await page.evaluate(() => window.__lastVerdict.verdict);

const result = {
  filled, afterClear, refilled, resetSlots,
  firstVerdict, secondVerdict, recovered, errors
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
server.close();
const ok = filled === 6 && afterClear === 5 && refilled === 6 && resetSlots === 0
  && firstVerdict === "ok" && secondVerdict === "bad" && recovered === "ok" && errors.length === 0;
process.exit(ok ? 0 : 1);
