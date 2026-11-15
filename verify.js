const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", e => { console.error("PAGE ERROR:", e.message); process.exitCode = 1; });
  await page.goto("file://" + path.resolve(__dirname, "index.html"));
  await page.waitForFunction(() => window.__pcloud && window.__pcloud.ready);
  await page.waitForTimeout(600);

  const shot = (name) => page.screenshot({ path: `artifacts/${name}.png` });
  const count = () => page.evaluate(() => window.__pcloud.count);

  // 1. 高度着色 + 完整范围
  await page.evaluate(() => { window.__pcloud.setColorMode(0); window.__pcloud.setClip(100, 100, 100); });
  await page.waitForTimeout(300);
  console.log("高度着色/完整范围  剩余点数:", await count());
  await shot("1_height_full");

  // 2. 密度着色 + 完整范围
  await page.evaluate(() => window.__pcloud.setColorMode(1));
  await page.waitForTimeout(300);
  await shot("2_density_full");

  // 3. 密度着色 + 半剖范围
  await page.evaluate(() => window.__pcloud.setClip(50, 100, 50));
  await page.waitForTimeout(300);
  console.log("密度着色/半剖      剩余点数:", await count());
  await shot("3_density_half");

  // 4. 高度着色 + 核心盒范围
  await page.evaluate(() => { window.__pcloud.setColorMode(0); window.__pcloud.setClip(28, 45, 28); });
  await page.waitForTimeout(300);
  console.log("高度着色/核心盒    剩余点数:", await count());
  await shot("4_height_core");

  // 5. 换一个视角，用页面内按钮导出截图（捕获下载）
  await page.evaluate(() => window.__pcloud.setView(2.2, 0.7, 6.5));
  await page.waitForTimeout(300);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#shotBtn")
  ]);
  await download.saveAs("artifacts/export_view.png");
  console.log("页面内导出截图 -> artifacts/export_view.png");

  // 交互流畅性：采样 FPS
  const fps = await page.evaluate(() => new Promise(res => {
    let f = 0; const t0 = performance.now();
    (function loop() {
      f++;
      if (performance.now() - t0 < 2000) requestAnimationFrame(loop);
      else res(Math.round(f / 2));
    })();
  }));
  console.log("FPS (软件渲染):", fps);

  await browser.close();
  console.log("验证完成");
})();
