"use strict";
/* 自动化验证：画三条线（含抖动轨迹）、一次橡皮擦、一次盖章（随后撤销）、
 * 校验图层隔离与撤销/重做，最后导出 PNG 到 artifacts/result.png */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "result.png");

// 沿直线生成带垂直抖动的轨迹点（模拟手抖）
function jitterLine(x1, y1, x2, y2, steps, jitter) {
  const pts = [];
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const j = (Math.sin(i * 2.7) + Math.cos(i * 1.3)) * 0.5 * jitter;
    pts.push([x1 + dx * t + nx * j, y1 + dy * t + ny * j]);
  }
  return pts;
}

async function stroke(page, pts) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y);
  await page.mouse.up();
}

// 读取某图层画布某点 RGBA
async function pixel(page, layerIndex, x, y) {
  return page.evaluate(
    ([i, px, py]) => {
      const dpr = window.devicePixelRatio || 1;
      const ctx = window.__app.layers[i].canvas.getContext("2d");
      return Array.from(ctx.getImageData(px * dpr, py * dpr, 1, 1).data);
    },
    [layerIndex, x, y]
  );
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto("file://" + path.join(ROOT, "index.html"));

  // 画布在页面中的偏移
  const box = await page.locator("#board").boundingBox();
  const ox = box.x, oy = box.y;
  const at = (pts) => pts.map(([x, y]) => [x + ox, y + oy]);

  const assert = (cond, msg) => {
    if (!cond) throw new Error("断言失败: " + msg);
    console.log("✓ " + msg);
  };

  // ---- 初始状态 ----
  assert(await page.locator(".layer-btn.active").innerText() === "图层 1", "初始激活图层 1");
  assert((await page.locator("#board").getAttribute("class")).includes("tool-line"), "初始指针样式为画线");

  // ---- 线 1：图层 1，水平线（带抖动）----
  await stroke(page, at(jitterLine(80, 150, 880, 150, 120, 2.5)));
  assert((await pixel(page, 0, 480, 150))[3] > 200, "线 1 已画在图层 1（蓝色）");

  // ---- 线 2：图层 1，斜线（带抖动）----
  await stroke(page, at(jitterLine(80, 420, 500, 200, 100, 2.5)));
  assert((await pixel(page, 0, 290, 310))[3] > 200, "线 2 已画在图层 1");

  // ---- 切到图层 2：指针样式与工具状态同步 ----
  await page.locator(".layer-btn[data-layer='1']").click();
  assert((await page.locator("#toolBadge").innerText()) === "画线", "切换图层后工具徽标同步");

  // ---- 线 3：图层 2，折线（两段方向，检验平滑转折）----
  const seg1 = jitterLine(120, 520, 500, 520, 60, 2);
  const seg2 = jitterLine(500, 520, 880, 320, 60, 2);
  await stroke(page, at(seg1.concat(seg2.slice(1))));
  assert((await pixel(page, 1, 300, 520))[3] > 200, "线 3 已画在图层 2（红色）");
  assert((await pixel(page, 0, 300, 520))[3] === 0, "线 3 未污染图层 1");

  // ---- 图层 2 上做一次盖章，验证识别后撤销（保持最终画面为三线一擦）----
  await page.mouse.click(ox + 700, oy + 120);
  assert((await pixel(page, 1, 700, 120))[3] > 200, "轻点识别为盖章（星形中心实心）");
  assert((await page.locator("#toolBadge").innerText()) === "盖章", "盖章后工具状态同步为盖章");
  await page.locator("#undoBtn").click();
  assert((await pixel(page, 1, 700, 120))[3] === 0, "撤销后印章消失");

  // ---- 橡皮擦：回图层 1，在线 1 上来回折返涂抹 ----
  await page.locator(".layer-btn[data-layer='0']").click();
  // 图层 2 的红色线 3 与擦除区域取一个参照点，验证图层隔离
  const redBefore = await pixel(page, 1, 690, 420);
  const zig = [];
  for (let i = 0; i <= 4; i++) zig.push([i % 2 === 0 ? 380 : 520, 150 + (i % 2) * 10]);
  const zigPts = [];
  for (let i = 0; i < zig.length - 1; i++)
    zigPts.push(...jitterLine(...zig[i], ...zig[i + 1], 20, 0.8).slice(i === 0 ? 0 : 1));
  await stroke(page, at(zigPts));
  assert((await pixel(page, 0, 450, 150))[3] === 0, "橡皮擦已擦除图层 1 的线 1 中段");
  assert((await pixel(page, 0, 300, 150))[3] > 200, "线 1 未被擦到的部分保留");
  const redAfter = await pixel(page, 1, 690, 420);
  assert(JSON.stringify(redBefore) === JSON.stringify(redAfter), "橡皮擦未影响图层 2（图层隔离）");
  assert((await page.locator("#toolBadge").innerText()) === "擦除", "擦除后工具状态同步为擦除");

  // ---- 撤销 / 重做 ----
  await page.locator("#undoBtn").click();
  assert((await pixel(page, 0, 450, 150))[3] > 200, "撤销后线 1 恢复");
  await page.locator("#redoBtn").click();
  assert((await pixel(page, 0, 450, 150))[3] === 0, "重做后擦除重现");

  // ---- 导出 PNG ----
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportBtn").click(),
  ]);
  await download.saveAs(OUT);
  assert(fs.existsSync(OUT) && fs.statSync(OUT).size > 5000, "PNG 已导出: " + OUT);

  await page.screenshot({ path: path.join(ROOT, "artifacts", "app-screenshot.png") });
  await browser.close();
  console.log("\n全部验证通过 ✅  导出文件: " + OUT);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
