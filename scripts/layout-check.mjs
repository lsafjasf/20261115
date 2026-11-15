import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.APP_URL || "http://127.0.0.1:4173";
const artifactDir = new URL("../artifacts/", import.meta.url);
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const checks = [];
for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 720 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(650);
  const layout = await page.evaluate(() => {
    const canvas = document.querySelector("#viewfinder").getBoundingClientRect();
    const controls = document.querySelector(".controls");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      bodyScrollWidth: document.documentElement.scrollWidth,
      canvas: { width: Math.round(canvas.width), height: Math.round(canvas.height) },
      controls: {
        clientHeight: controls.clientHeight,
        scrollHeight: controls.scrollHeight,
      },
      compareHidden: document.querySelector("#compareModal").hidden,
    };
  });
  const file = new URL(`../artifacts/layout-${viewport.name}.png`, import.meta.url);
  await page.screenshot({ path: file.pathname, fullPage: viewport.name === "mobile" });
  checks.push({ viewport: viewport.name, errors, layout });
  await page.close();
}

await writeFile(new URL("../artifacts/layout-checks.json", import.meta.url), JSON.stringify(checks, null, 2));
console.log(JSON.stringify(checks, null, 2));
await browser.close();
