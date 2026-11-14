"use strict";
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const ART = path.join(ROOT, "artifacts");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === "/" ? "index.html" : req.url.split("?")[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    });
    srv.listen(0, () => resolve(srv));
  });
}

function decodePng(buf) {
  return PNG.sync.read(buf);
}

function comparePngs(a, b, margin = 0) {
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, reason: `尺寸不一致 ${a.width}x${a.height} vs ${b.width}x${b.height}` };
  }
  let maxDiff = 0, sum = 0, n = 0;
  for (let y = margin; y < a.height - margin; y++) {
    for (let x = margin; x < a.width - margin; x++) {
      const i = (y * a.width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const d = Math.abs(a.data[i + c] - b.data[i + c]);
        if (d > maxDiff) maxDiff = d;
        sum += d; n++;
      }
    }
  }
  return { ok: true, maxDiff, meanDiff: sum / n };
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => typeof render === "function");

  const results = [];
  const blends = ["screen", "multiply", "difference"];

  async function shootCanvas() {
    const box = await page.locator("#stage").boundingBox();
    return page.screenshot({
      clip: { x: box.x + 1, y: box.y + 1, width: 960, height: 600 },
    });
  }

  for (const blend of blends) {
    // 通过真实 UI 下拉框切换前层混合模式
    await page.selectOption(".layer-card:first-of-type select:nth-of-type(2)", blend);
    await page.waitForTimeout(120);

    // 屏幕截图（仅画布元素）
    const shotBuf = await shootCanvas();
    fs.writeFileSync(path.join(ART, `blend-${blend}.png`), shotBuf);

    // 页面内画布原始像素
    const dataUrl = await page.evaluate(() => document.getElementById("stage").toDataURL("image/png"));
    const canvasBuf = Buffer.from(dataUrl.split(",")[1], "base64");

    const shot = decodePng(shotBuf);
    const canv = decodePng(canvasBuf);
    const cmp = comparePngs(canv, shot, 10); // 内缩 10px，避开圆角抗锯齿边缘
    results.push({ blend, ...cmp });
    console.log(`[${blend}]`, JSON.stringify(cmp));
  }

  // 验证三个预设
  for (let i = 0; i < 3; i++) {
    await page.click(`.preset-btn[data-preset="${i}"]`);
    await page.waitForTimeout(80);
  }
  const status = await page.textContent("#presetStatus");
  console.log("预设状态:", status.trim());
  fs.writeFileSync(path.join(ART, "preset-all-done.png"), await shootCanvas());

  // 验证导出当前帧
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportBtn"),
  ]);
  const dlPath = path.join(ART, "exported-frame.png");
  await download.saveAs(dlPath);
  const dlPng = decodePng(fs.readFileSync(dlPath));
  const nowCanvas = decodePng(Buffer.from(
    (await page.evaluate(() => document.getElementById("stage").toDataURL("image/png"))).split(",")[1], "base64"));
  console.log("导出帧比对:", JSON.stringify(comparePngs(nowCanvas, dlPng)));

  // 验证投影机偏斜 -> 梯形变形 & 光斑移动
  await page.evaluate(() => {
    state.projX = 0.8; state.projY = -0.5; syncProjectorUI(); render();
  });
  await page.waitForTimeout(80);
  fs.writeFileSync(path.join(ART, "keystone-skewed.png"), await shootCanvas());

  await browser.close();
  srv.close();

  const pass = results.every((r) => r.ok && r.maxDiff <= 2);
  console.log(pass ? "✅ 全部验证通过：截图与屏幕画布一致" : "❌ 存在不一致");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
