import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));

await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const boxes = await page.evaluate(() => {
  const selectors = [".stage", ".canvas-shell", "#posterCanvas"];
  return Object.fromEntries(
    selectors.map((selector) => {
      const element = document.querySelector(selector);
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [selector, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        cssWidth: style.width,
        cssHeight: style.height,
        aspectRatio: style.aspectRatio,
      }];
    }),
  );
});
await page.screenshot({ path: "artifacts/editor-initial.png", fullPage: true });
console.log(JSON.stringify({ errors, boxes, title: await page.title() }, null, 2));
await browser.close();
