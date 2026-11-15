import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });

function resolvePlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PKG,
    "playwright",
    "../uid117/node_modules/playwright",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next local installation.
    }
  }
  throw new Error("Playwright not found. Set PLAYWRIGHT_PKG to a playwright installation.");
}

const playwright = resolvePlaywright();
let chromiumPath = process.env.CHROMIUM_PATH;
if (!chromiumPath) {
  const defaultPath = playwright.chromium.executablePath();
  if (fs.existsSync(defaultPath)) chromiumPath = defaultPath;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestPath = decodeURIComponent(request.url.split("?")[0]);
      const filePath = path.join(root, requestPath === "/" ? "index.html" : requestPath);
      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      fs.stat(filePath, (error, stats) => {
        if (error || !stats.isFile()) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(response);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function sha(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

async function readStats(page) {
  return page.evaluate(() => {
    const result = window.__dispatchApp.getResult();
    return {
      rows: document.querySelectorAll("#trainRows tr").length,
      stats: Object.assign({}, result.stats),
      sectionEvents: result.occupancies.filter((item) => item.kind === "section").length,
      occupancyCount: result.occupancies.length,
      conflicts: result.conflicts.map((item) => ({
        code: item.code,
        severity: item.severity,
        title: item.title,
        displayTime: item.displayTime,
      })),
      exportDisabled: document.querySelector("#exportPngBtn").disabled,
      csvDisabled: document.querySelector("#exportCsvBtn").disabled,
    };
  });
}

const server = await startServer();
const baseUrl = "http://127.0.0.1:" + server.address().port + "/";
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: chromiumPath,
  args: ["--no-sandbox"],
});

const report = { baseUrl, checks: [], downloads: {} };

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      consoleErrors.push(message.text());
    }
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);

  const initial = await readStats(page);
  assert.equal(initial.rows, 6, "initial train rows");
  assert.equal(initial.stats.ready, true, "initial schedule export ready");
  assert.equal(initial.stats.severeCount, 0, "initial severe conflicts");
  assert.equal(initial.stats.warningCount, 0, "initial warnings");
  assert.equal(initial.stats.sectionMinutes, 48, "initial section minutes");
  assert.equal(initial.stats.trackMinutes, 96, "initial track minutes");
  assert.equal(initial.occupancyCount, 30, "initial occupancy records");
  assert.equal(initial.exportDisabled, false, "initial export enabled");
  await page.screenshot({ path: path.join(artifacts, "ui-overview.png"), fullPage: true });
  const initialCanvas = await page.locator("#ganttCanvas").screenshot();
  report.checks.push({ name: "initial-six-train-conflict-free", passed: true, stats: initial.stats });

  await page.locator("#trainRows tr").first().locator('[data-action="delete"]').click();
  await page.waitForTimeout(220);
  const afterDelete = await readStats(page);
  assert.equal(afterDelete.rows, 5, "row count after delete");
  assert.equal(afterDelete.stats.plannedTrains, 5, "planned trains after delete");
  assert.equal(afterDelete.stats.sectionMinutes, 40, "section occupancy after delete");
  assert.equal(afterDelete.stats.trackMinutes, 80, "track occupancy after delete");
  assert.equal(afterDelete.sectionEvents, 10, "section bars after delete");
  assert.ok(Math.abs(afterDelete.stats.sectionUtil - 36.3636) < 0.01, "section utilization after delete");
  assert.equal(await page.locator("#metricTrains").innerText(), "5", "metric train count changed");
  assert.equal(await page.locator("#metricSection").innerText(), "36.4", "metric section utilization changed");
  assert.equal(await page.locator("#capacitySection").innerText(), "36.4%", "capacity panel changed");
  assert.equal(await page.locator("#capacityHeadroom").innerText(), "70 min", "capacity headroom changed");
  const afterCanvas = await page.locator("#ganttCanvas").screenshot();
  assert.notEqual(sha(initialCanvas), sha(afterCanvas), "occupancy chart pixels changed after delete");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(artifacts, "ui-after-delete.png"), fullPage: true });
  report.checks.push({
    name: "delete-recalculates-chart-and-capacity",
    passed: true,
    before: {
      trains: initial.stats.plannedTrains,
      sectionMinutes: initial.stats.sectionMinutes,
      trackMinutes: initial.stats.trackMinutes,
      sectionUtil: initial.stats.sectionUtil,
    },
    after: {
      trains: afterDelete.stats.plannedTrains,
      sectionMinutes: afterDelete.stats.sectionMinutes,
      trackMinutes: afterDelete.stats.trackMinutes,
      sectionUtil: afterDelete.stats.sectionUtil,
    },
    chartHash: { before: sha(initialCanvas), after: sha(afterCanvas) },
  });

  await page.locator("#resetBtn").click();
  await page.waitForTimeout(180);
  const reset = await readStats(page);
  assert.equal(reset.rows, 6, "reset rows");
  assert.equal(reset.stats.ready, true, "reset export ready");

  await page.locator('#trainRows tr[data-train-id="t2"] input[data-field="arrival"]').fill("08:01");
  await page.waitForTimeout(180);
  const blocked = await readStats(page);
  assert.ok(blocked.stats.severeCount > 0, "severe conflict detected");
  assert.equal(blocked.stats.ready, false, "severe conflict blocks readiness");
  assert.equal(blocked.exportDisabled, true, "PNG export disabled");
  assert.equal(blocked.csvDisabled, true, "CSV export disabled");
  const conflictText = await page.locator("#conflictList").innerText();
  assert.match(conflictText, /重叠|追踪间隔/, "conflict list explains the issue");
  assert.match(await page.locator("#globalStateLabel").innerText(), /锁定/, "global status shows locked");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(80);
  await page.screenshot({ path: path.join(artifacts, "ui-conflict-blocked.png"), fullPage: true });
  report.checks.push({
    name: "severe-conflict-blocks-export",
    passed: true,
    severeCount: blocked.stats.severeCount,
    conflicts: blocked.conflicts.slice(0, 4),
  });

  await page.locator("#resetBtn").click();
  await page.waitForTimeout(180);
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportCsvBtn").click(),
  ]);
  const csvPath = path.join(artifacts, "exported-timetable.csv");
  await csvDownload.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, "utf8");
  assert.match(csvText, /G101/, "exported CSV contains trains");
  assert.match(csvText, /图定列车,6 列/, "exported CSV contains capacity");
  report.downloads.csv = {
    file: "artifacts/exported-timetable.csv",
    bytes: fs.statSync(csvPath).size,
    suggestedName: csvDownload.suggestedFilename(),
  };

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#exportPngBtn").click(),
  ]);
  const pngPath = path.join(artifacts, "exported-occupancy-gantt.png");
  await pngDownload.saveAs(pngPath);
  const pngBuffer = fs.readFileSync(pngPath);
  assert.deepEqual(Array.from(pngBuffer.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], "PNG signature");
  assert.ok(pngBuffer.length > 100000, "PNG export has substantial content");
  report.downloads.png = {
    file: "artifacts/exported-occupancy-gantt.png",
    bytes: pngBuffer.length,
    suggestedName: pngDownload.suggestedFilename(),
  };
  report.checks.push({ name: "csv-and-png-export", passed: true, downloads: report.downloads });

  assert.deepEqual(consoleErrors, [], "no browser runtime errors");
  await page.screenshot({ path: path.join(artifacts, "ui-final.png"), fullPage: true });

  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobilePage.evaluate(() => document.fonts.ready);
  await mobilePage.waitForTimeout(220);
  assert.equal(await mobilePage.locator("#trainRows tr").count(), 6, "mobile rows");
  const mobileOverflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(mobileOverflow <= 1, "mobile page has no horizontal overflow");
  await mobilePage.screenshot({ path: path.join(artifacts, "ui-mobile.png"), fullPage: true });
  report.checks.push({ name: "mobile-layout", passed: true, horizontalOverflow: mobileOverflow });

  fs.writeFileSync(
    path.join(artifacts, "verification.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  console.log("E2E passed");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  server.close();
}
