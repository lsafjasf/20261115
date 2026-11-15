import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { join } from "node:path";

const port = 4488;
const server = spawn(process.execPath, [join(process.cwd(), "bench", "server.mjs")], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
});
await new Promise((resolve, reject) => {
  const t = setInterval(() => fetch(`http://localhost:${port}/`).then(() => {
    clearInterval(t); resolve();
  }).catch(() => {}), 100);
  setTimeout(() => reject(new Error("timeout")), 5000);
});

const browser = await chromium.launch({ args: ["--disable-gpu", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });

// Toggles update live stats without errors.
await page.uncheck("#opt-culling");
await page.waitForTimeout(200);
const noCullVisible = await page.textContent("#m-visible");
await page.check("#opt-culling");
await page.uncheck("#opt-spatial");
await page.waitForTimeout(200);

// Parity check across all four optimization combinations.
await page.click("#btn-parity");
await page.waitForFunction(() => document.querySelector("#parity-out").textContent.includes("像素"));
const parityText = await page.textContent("#parity-out");

// Run the in-app benchmark button and confirm output renders.
await page.click("#btn-bench");
await page.waitForFunction(
  () => document.querySelector("#bench-out").textContent.includes("all_off"),
  { timeout: 60000 }
);
const benchText = await page.textContent("#bench-out");

// Start the 10 s replay, then let it run a few frames.
await page.click("#btn-replay");
await page.waitForTimeout(500);
const replayFrame = await page.textContent("#m-replay-frame");

console.log(JSON.stringify({
  noCullVisible,
  parityOk: parityText.includes("四种组合像素完全一致"),
  benchmarkRendered: benchText.includes("p95"),
  replayStarted: replayFrame.includes("/ 600"),
  errors,
}, null, 2));

await page.screenshot({ path: join(process.cwd(), "artifacts", "bench", "app.png") });
await browser.close();
server.kill();
process.exit(errors.length ? 1 : 0);
