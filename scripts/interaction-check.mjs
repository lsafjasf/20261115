import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.click("#shutterBtn");
await page.waitForTimeout(280);
const timerWasVisible = await page.locator("#timerLayer").evaluate((element) => element.classList.contains("is-active"));
await page.waitForFunction(() => window.__nightLab.getState().shots.length === 1, null, { timeout: 5000 });
const firstShot = await page.evaluate(() => window.__nightLab.getState());

await page.click("#shutterBtn");
await page.waitForTimeout(180);
const duplicateToast = await page.locator("#toast").textContent();
const afterDuplicate = await page.evaluate(() => window.__nightLab.getState());

await page.evaluate(() => window.__nightLab.setSettings({ shutterIndex: 0, isoIndex: 0, apertureIndex: 7 }));
await page.click("#shutterBtn");
await page.waitForTimeout(180);
const invalidToast = await page.locator("#toast").textContent();
const afterInvalid = await page.evaluate(() => window.__nightLab.getState());

await page.click("#audioToggle");
const soundOff = await page.locator("#audioToggle").getAttribute("aria-pressed");
await page.click("#audioToggle");
const soundOn = await page.locator("#audioToggle").getAttribute("aria-pressed");

const result = {
  errors,
  timerWasVisible,
  firstShotCount: firstShot.shots.length,
  duplicateToast,
  duplicateShotCount: afterDuplicate.shots.length,
  invalidToast,
  invalidShotCount: afterInvalid.shots.length,
  soundOff,
  soundOn,
};
console.log(JSON.stringify(result, null, 2));
await writeFile(new URL("../artifacts/interaction-checks.json", import.meta.url), JSON.stringify(result, null, 2));
await browser.close();
