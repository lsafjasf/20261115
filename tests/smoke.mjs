import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const errors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(String(err)));

await page.goto(`${process.env.TEST_BASE}/app/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);

const summary = await page.evaluate(() => ({
  routeCount: document.querySelectorAll("#routeSelect option").length,
  anomalies: document.querySelectorAll(".anomaly-item").length,
  stations: document.querySelectorAll(".station-item").length,
  mapW: document.getElementById("mapCanvas").width,
  chartW: document.getElementById("speedCanvas").width,
  counts: {
    speed: document.getElementById("cntSpeed").textContent,
    reverse: document.getElementById("cntReverse").textContent,
    skip: document.getElementById("cntSkip").textContent,
  },
}));

console.log(JSON.stringify(summary, null, 2));
if (errors.length) {
  console.error("CONSOLE ERRORS:\n" + errors.join("\n"));
  process.exitCode = 1;
}
await page.screenshot({ path: "artifacts/smoke-initial.png", fullPage: true });
await browser.close();
