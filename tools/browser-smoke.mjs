// 无头浏览器冒烟测试：页面加载、音频引擎、拖墙、材质拖放、预设持久化
import { chromium } from "/tmp/node_modules/playwright/index.mjs";
import { createServer } from "http";
import { readFileSync } from "fs";
import { extname, join } from "path";

const root = join(import.meta.dirname, "..");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const data = readFileSync(join(root, path));
    res.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(7823, r));

const browser = await chromium.launch({
  args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:7823/", { waitUntil: "networkidle" });
await page.waitForSelector("#roomCanvas");
await page.waitForFunction(() => document.querySelectorAll("#pathsTable tbody tr").length === 12);

const metricsBefore = await page.locator("#metrics").innerText();
if (!metricsBefore.includes("RT60")) throw new Error("指标未渲染");

// 启动鼓循环 → 真实构建 AudioContext / FDN
await page.click("#playBtn");
await page.waitForTimeout(800);
const playLabel = await page.locator("#playBtn").innerText();
if (!playLabel.includes("停止")) throw new Error("鼓循环未启动");

// 拖后墙手柄（改变深度）——直接读取页面内 wallRect 得到精确画布坐标
const dims0 = await page.locator("#dimsLabel").innerText();
const backCenter = await page.evaluate(() => {
  const cv = document.getElementById("roomCanvas");
  const r = cv.getBoundingClientRect();
  const rect = window.__roomView.wallRect("back");
  const sx = r.width / cv.width, sy = r.height / cv.height;
  return { x: r.left + (rect.x + rect.w / 2) * sx,
           y: r.top + (rect.y + rect.h / 2) * sy };
});
await page.mouse.move(backCenter.x, backCenter.y);
await page.mouse.down();
await page.mouse.move(backCenter.x, backCenter.y - 120, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
const dims1 = await page.locator("#dimsLabel").innerText();
if (dims0 === dims1) {
  await page.screenshot({ path: "/tmp/smoke-room.png" });
  throw new Error("拖墙未改变尺寸");
}

// 材质拖放到左墙
const chip = page.locator(".mat-chip").first();
const roomBox = await page.locator("#roomCanvas").boundingBox();
const leftTarget = await page.evaluate(() => {
  const cv = document.getElementById("roomCanvas");
  const r = cv.getBoundingClientRect();
  const rect = window.__roomView.wallRect("left");
  const sx = r.width / cv.width, sy = r.height / cv.height;
  return { x: (rect.x + rect.w / 2) * sx, y: (rect.y + rect.h / 2) * sy };
});
await chip.dragTo(page.locator("#roomCanvas"), {
  targetPosition: leftTarget,
});
await page.waitForTimeout(200);
const wallMat = await page.evaluate(() => window.__roomView.state.walls.left);
if (wallMat !== "concrete") throw new Error("材质拖放未生效，左墙=" + wallMat);

// 保存预设并模拟重开
await page.fill("#presetName", "冒烟预设");
await page.click("#savePresetBtn");
const stored = await page.evaluate(() => localStorage.getItem("virtual-studio-presets-v1"));
if (!stored?.includes("冒烟预设")) throw new Error("预设未写入 localStorage");
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#presetList");
const listText = await page.locator("#presetList").innerText();
if (!listText.includes("冒烟预设")) throw new Error("重开后预设丢失");

// 场景对比按钮
await page.click("#loadHall");
await page.waitForTimeout(200);
const hallDims = await page.locator("#dimsLabel").innerText();
if (!hallDims.includes("22.00")) throw new Error("长走廊场景未载入: " + hallDims);
await page.click("#loadSmall");

// 离线 RT60 测量
await page.click("#measureBtn");
await page.waitForFunction(
  () => document.getElementById("measureResult").innerText.includes("实测 RT60"),
  { timeout: 10000 }
);
const measure = await page.locator("#measureResult").innerText();

await page.click("#playBtn"); // 停止
if (errors.length) throw new Error("控制台错误: " + errors.join(" | "));

console.log("PASS 页面加载与 12 条路径渲染");
console.log("PASS 鼓循环启动，AudioContext/FDN 构建成功");
console.log("PASS 拖墙改尺寸:", dims0, "→", dims1);
console.log("PASS 材质拖放、预设保存与重开恢复");
console.log("PASS 场景切换与离线 RT60 测量:", measure);
console.log("PASS 无控制台错误");
await browser.close();
server.close();
