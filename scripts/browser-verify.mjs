import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { cleanRawRecords, generateRawSample } from "../src/core.js";

const port = 4290;
const baseUrl = `http://127.0.0.1:${port}`;
const root = process.cwd();
const artifacts = join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });

function findChromium() {
  const cacheRoots = [
    join(homedir(), ".cache", "ms-playwright"),
    join(userInfo().homedir, ".cache", "ms-playwright"),
  ];
  const candidates = cacheRoots
    .filter((cacheRoot) => existsSync(cacheRoot))
    .flatMap((cacheRoot) => readdirSync(cacheRoot)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse()
      .flatMap((name) => [
        join(cacheRoot, name, "chrome-linux64", "chrome"),
        join(cacheRoot, name, "chrome-linux", "chrome"),
      ]));
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the local server");
}

async function canvasFingerprint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#mapCanvas");
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    let brightPixels = 0;
    for (let index = 0; index < pixels.length; index += 97) {
      hash ^= pixels[index] + pixels[index + 1] * 3 + pixels[index + 2] * 7;
      hash = Math.imul(hash, 16777619);
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 180) brightPixels += 1;
    }
    return { hash: hash >>> 0, brightPixels, width: canvas.width, height: canvas.height };
  });
}

async function setSlice(page, index) {
  await page.locator("#timeSlider").evaluate((slider, value) => {
    slider.value = String(value);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, index);
  await page.waitForTimeout(120);
}

async function readState(page) {
  return page.evaluate(() => ({
    state: window.__transitApp.getState(),
    metrics: window.__transitApp.getMetrics(),
  }));
}

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let browser;
try {
  await waitForServer(baseUrl);
  const executablePath = findChromium();
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  assert.deepEqual(runtimeErrors, [], "The page should load without runtime errors");

  const cleaned = cleanRawRecords(generateRawSample()).report;
  const duplicateText = await page.locator("#duplicateCount").innerText();
  const filledText = await page.locator("#filledCount").innerText();
  assert.match(duplicateText, new RegExp(String(cleaned.removedDuplicates)));
  assert.match(filledText, new RegExp(String(cleaned.filledRecords)));

  const initialFingerprint = await canvasFingerprint(page);
  assert.ok(initialFingerprint.brightPixels > 100, "Canvas should contain rendered map content");

  await page.locator('[data-route-id="r52"]').click();
  await page.waitForTimeout(120);
  const routeState = await readState(page);
  assert.deepEqual(routeState.state.routeIds, ["r52"]);
  assert.equal(routeState.state.selectedStationId, null);
  assert.match(await page.locator("#mapFilterText").innerText(), /52路/);
  assert.equal(routeState.metrics.recordCount, 26);
  assert.ok(Math.abs(routeState.metrics.averageDelay - 7.97) < 0.05);
  const filteredFingerprint = await canvasFingerprint(page);
  assert.notEqual(filteredFingerprint.hash, initialFingerprint.hash, "Route filtering should redraw the canvas");
  await page.screenshot({ path: join(artifacts, "verify-route-52.png") });

  await page.locator("#allRoutes").click();
  const stationPoint = await page.evaluate(() => window.__transitApp.getStationClientPoint("univ-town"));
  await page.mouse.click(stationPoint.x, stationPoint.y);
  await page.waitForTimeout(120);
  const stationState = await readState(page);
  assert.equal(stationState.state.selectedStationId, "univ-town");
  assert.deepEqual(stationState.state.routeIds.sort(), ["r18", "r36"]);
  assert.equal(await page.locator("#stationName").innerText(), "大学城");
  await page.screenshot({ path: join(artifacts, "verify-station-filter.png") });

  await page.locator("#allRoutes").click();
  await setSlice(page, 5);
  const morningState = await readState(page);
  assert.equal(morningState.state.sliceStart, 510);
  assert.equal(morningState.state.sliceLabel, "08:30—09:00");
  const morningFingerprint = await canvasFingerprint(page);
  await page.screenshot({ path: join(artifacts, "verify-slice-0830.png") });

  await setSlice(page, 24);
  const eveningState = await readState(page);
  assert.equal(eveningState.state.sliceStart, 1080);
  assert.equal(eveningState.state.sliceLabel, "18:00—18:30");
  const eveningFingerprint = await canvasFingerprint(page);
  assert.notEqual(eveningFingerprint.hash, morningFingerprint.hash, "Time slices should render different heatmaps");
  assert.ok(
    eveningState.metrics.averageDelay - morningState.metrics.averageDelay > 4,
    "Evening peak delay should differ materially from the morning slice",
  );
  await page.screenshot({ path: join(artifacts, "verify-slice-1800.png") });
  assert.deepEqual(runtimeErrors, [], "Interactions should not introduce runtime errors");

  const result = {
    passed: true,
    checkedAt: new Date().toISOString(),
    viewport: "1440x900",
    cleaningReport: cleaned,
    routeFilter: {
      route: "52路",
      selectedRouteIds: routeState.state.routeIds,
      recordCount: routeState.metrics.recordCount,
      averageDelay: Number(routeState.metrics.averageDelay.toFixed(2)),
      canvasChanged: filteredFingerprint.hash !== initialFingerprint.hash,
    },
    stationFilter: {
      station: "大学城",
      selectedRouteIds: stationState.state.routeIds,
      canvasPointClick: true,
    },
    timeSlices: [morningState, eveningState].map((entry) => ({
      label: entry.state.sliceLabel,
      sliceStart: entry.state.sliceStart,
      averageDelay: Number(entry.metrics.averageDelay.toFixed(2)),
      averageHeadway: entry.metrics.averageHeadway,
      highDelayStations: entry.metrics.highDelayStations,
      recordCount: entry.metrics.recordCount,
    })),
    sliceCanvasChanged: morningFingerprint.hash !== eveningFingerprint.hash,
    runtimeErrors,
  };
  writeFileSync(join(artifacts, "verification.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
