import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

function assert(condition, message) {
  if (!condition) throw new Error(`验证失败：${message}`);
  console.log(`✓ ${message}`);
}

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const filePath = path.resolve(root, relative);
      if (!filePath.startsWith(root)) throw new Error("forbidden");
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mime[path.extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/home/hj/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

await mkdir(artifacts, { recursive: true });
const { server, port } = await startServer();
const browser = await chromium.launch({
  headless: true,
  executablePath: findChrome(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.tideApp));

  const initial = await page.evaluate(() => window.tideApp.getDiagnostics());
  assert(initial.cleaning.sourceRows === 114, "内置 CSV 共读取 114 条数据行");
  assert(initial.cleaning.duplicateGroups === 3, "3 组重复站点时间戳被识别并合并");
  assert(initial.alertCount > 0, "默认警戒线以下存在越限告警供验证");
  assert(initial.chart.gapBandCount === 3, "默认 24 小时视图绘制了 3 个缺测段");

  await page.locator("#thresholdInput").fill("3.00");
  await page.locator("#thresholdInput").blur();
  await page.waitForTimeout(120);
  const thresholdChanged = await page.evaluate(() => window.tideApp.getDiagnostics());
  assert(thresholdChanged.state.threshold === 3, "阈值输入已更新为 3.00 m");
  assert(thresholdChanged.alertCount === 0, "提高阈值后告警清单同步清空");
  assert(thresholdChanged.ui.alertCount === 0 && thresholdChanged.ui.alertPill === 0, "摘要与告警徽标同步为 0");
  const emptyAlertText = await page.locator("#alertList").innerText();
  assert(emptyAlertText.includes("没有水位超过 3.00 m"), "告警侧栏显示新的阈值文案");
  await page.screenshot({ path: path.join(artifacts, "verification-threshold.png"), fullPage: true });

  await page.locator("#resetButton").click();
  await page.locator("#windowSelect").selectOption("6");
  await page.waitForTimeout(80);
  const sixHourView = await page.evaluate(() => window.tideApp.getDiagnostics());
  assert(
    sixHourView.visiblePoints === 21 && sixHourView.alertCount < initial.alertCount,
    "切换至 6 小时窗口后图表与告警同步缩小",
  );
  assert(sixHourView.ui.alertPill === sixHourView.alertCount, "时间窗口变化后告警徽标保持同步");
  await page.locator("#windowSelect").selectOption("24");
  await page.locator("#stationSelect").selectOption("东港");
  await page.waitForTimeout(120);
  const gapView = await page.evaluate(() => window.tideApp.getDiagnostics());
  assert(gapView.missingPoints === 2, "东港 24 小时窗口内有 2 个连续缺测点");
  assert(gapView.continuousGaps.length === 1 && gapView.continuousGaps[0].count === 2, "缺测被识别为一个连续段");
  assert(gapView.chart.gapBandCount === 1 && gapView.chart.canvasGapSegments === 1, "Canvas 实际绘制了缺测段阴影");
  assert(gapView.ui.gapMeta.includes("曲线已断开"), "界面明确提示曲线已断开");

  const band = gapView.chart.gapBands[0];
  const canvasBox = await page.locator("#tideChart").boundingBox();
  await page.mouse.move(
    canvasBox.x + (band.left + band.right) / 2,
    canvasBox.y + (gapView.chart.plotTop + gapView.chart.plotBottom) / 2,
  );
  await page.waitForTimeout(100);
  const tooltipText = await page.locator("#chartTooltip").innerText();
  assert(tooltipText.includes("缺测"), "悬停缺测时段时提示“缺测”，未显示虚构水位");
  await page.screenshot({ path: path.join(artifacts, "verification-gap.png"), fullPage: true });

  const pngDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportPngButton").click();
  const pngDownload = await pngDownloadPromise;
  const pngPath = await pngDownload.path();
  const pngInfo = await stat(pngPath);
  assert(pngDownload.suggestedFilename().endsWith(".png") && pngInfo.size > 20_000, "PNG 图已成功导出");
  await pngDownload.saveAs(path.join(artifacts, "verification-export.png"));

  const logDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportLogButton").click();
  const logDownload = await logDownloadPromise;
  const logPath = await logDownload.path();
  const logText = await readFile(logPath, "utf8");
  assert(logText.includes("重复合并") && logText.includes("连续缺测"), "清洗日志导出包含重复与缺测记录");
  await logDownload.saveAs(path.join(artifacts, "verification-cleaning-log.csv"));

  assert(pageErrors.length === 0, `页面无运行错误${pageErrors.length ? `：${pageErrors.join(" | ")}` : ""}`);
  console.log("\n验证完成：阈值修改与缺失段显示均已通过真实 Chromium 页面验证。");
  console.log(`截图：${path.relative(root, path.join(artifacts, "verification-threshold.png"))}`);
  console.log(`截图：${path.relative(root, path.join(artifacts, "verification-gap.png"))}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
