// 无头浏览器冒烟：真实加载页面，自动驾驶完成任务，检查渲染、HUD 与 Web Audio。
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const data = await readFile(join(process.cwd(), path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(8123, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1040, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto("http://127.0.0.1:8123/");
await page.waitForSelector("canvas");

// 模拟用户手势以启用 AudioContext，再开启自动驾驶
await page.click("#btn-auto");
await page.waitForTimeout(500);

const audioState = await page.evaluate(() => {
  // GameAudio 在首次手势时创建
  return window.AudioContext ? "audio-api-ok" : "no-audio-api";
});

// 等待胜利浮层（自动驾驶约 2 分钟模拟时间，按固定步长跑，给足超时）
await page.waitForSelector("#overlay:not(.hidden)", { timeout: 180000 });
const result = await page.evaluate(() => ({
  title: document.getElementById("overlay-title").textContent,
  text: document.getElementById("overlay-text").textContent,
  done: document.getElementById("hud-done").textContent,
  fuel: document.getElementById("hud-fuel-text").textContent,
}));

await page.screenshot({ path: "artifacts/mission-end.png", fullPage: true });

// 飞行中途截图：重开后跑 20 秒
await page.click("#overlay-btn");
await page.click("#btn-auto");
await page.waitForTimeout(20000);
await page.screenshot({ path: "artifacts/mission-flight.png", fullPage: true });

const midHud = await page.evaluate(() => ({
  alt: document.getElementById("hud-alt").textContent,
  vx: document.getElementById("hud-vx").textContent,
  vy: document.getElementById("hud-vy").textContent,
}));

console.log("Audio API:", audioState);
console.log("结算:", result.title);
console.log(result.text);
console.log("飞行中 HUD:", JSON.stringify(midHud));
console.log("页面错误:", errors.length ? errors : "无");

await browser.close();
server.close();

const ok =
  errors.length === 0 &&
  result.title.includes("完成") &&
  result.done.startsWith("4") &&
  !result.fuel.startsWith("0");
process.exit(ok ? 0 : 1);
