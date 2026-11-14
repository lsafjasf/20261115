import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const candidates = [
    join(homedir(), ".cache", "ms-playwright"),
    "/home/hj/.cache/ms-playwright",
    "/root/.cache/ms-playwright",
  ];
  const browserCache = candidates.find((path) => existsSync(path));
  if (browserCache) process.env.PLAYWRIGHT_BROWSERS_PATH = browserCache;
}

const { chromium } = await import("playwright");

const port = Number(process.env.PORT) || 5487;
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const artifactDir = "artifacts";
const screenshotDir = `${artifactDir}/screenshots`;
let server = null;
let browser = null;
const runtimeErrors = [];

async function waitForServer(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function flatten(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value);
}

function createKeyboard(page) {
  const held = new Set();
  return {
    async set(key, wanted) {
      if (wanted && !held.has(key)) {
        await page.keyboard.down(key);
        held.add(key);
      } else if (!wanted && held.has(key)) {
        await page.keyboard.up(key);
        held.delete(key);
      }
    },
    async releaseAll() {
      for (const key of held) await page.keyboard.up(key);
      held.clear();
    },
  };
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

async function snapshot(page) {
  return page.evaluate(() => window.__iceGame.getSnapshot());
}

async function driveToFirstSite(page) {
  const routes = await page.evaluate(() => window.__iceGame.getRoutes());
  const points = routes.campToSites[0].points;
  const keyboard = createKeyboard(page);
  let waypoint = 1;
  const started = Date.now();
  try {
    while (Date.now() - started < 26000) {
      const state = await snapshot(page);
      if (state.canDrill) break;
      const target = points[Math.min(waypoint, points.length - 1)];
      const vehicle = state.vehicle;
      const distance = Math.hypot(target.x - vehicle.x, target.y - vehicle.y);
      if (distance < 70 && waypoint < points.length - 1) {
        waypoint += 1;
        continue;
      }
      const desired = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
      const difference = normalizeAngle(desired - vehicle.angle);
      const finalWaypoint = waypoint === points.length - 1;
      const braking = finalWaypoint && distance < 95;
      await keyboard.set("a", difference < -0.09);
      await keyboard.set("d", difference > 0.09);
      await keyboard.set("w", !braking && state.speed < 66);
      await keyboard.set("s", braking);
      await page.waitForTimeout(80);
    }
  } finally {
    await keyboard.releaseAll();
  }
  await page.waitForTimeout(500);
  const state = await snapshot(page);
  assert.equal(state.canDrill, true, "vehicle should reach the S-01 drill ring");
  assert.equal(state.crackCrossings, 0, "safe route should not cross an open lead");
  assert.ok(state.safeBridgeCrossings >= 1, "safe route should cross W-1 bridge");
  return state;
}

async function enterDrill(page) {
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().canDrill === true,
    null,
    { timeout: 5000 },
  );
  await page.keyboard.press("e");
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().mode === "drilling",
    null,
    { timeout: 3000 },
  );
}

async function drillUntilCore(page, siteIndex, screenshotPath = null) {
  const keyboard = createKeyboard(page);
  const started = Date.now();
  let progressScreenshot = false;
  try {
    while (Date.now() - started < 30000) {
      const state = await snapshot(page);
      if (state.activeSiteIndex > siteIndex) break;
      if (state.mode !== "drilling") {
        await page.waitForTimeout(100);
        continue;
      }
      if (
        screenshotPath &&
        !progressScreenshot &&
        state.sites[siteIndex].progress > 32
      ) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        progressScreenshot = true;
      }
      if (state.drilling.jam || state.drilling.overheated) {
        await keyboard.set("r", false);
        await keyboard.set("f", false);
      } else {
        const safeTorque = state.drilling.torque < 86;
        await keyboard.set("r", safeTorque && state.drilling.rpm < 62);
        await keyboard.set("f", safeTorque && state.drilling.pressure < 45);
      }
      await page.waitForTimeout(85);
    }
  } finally {
    await keyboard.releaseAll();
  }

  await page.waitForFunction(
    (index) => window.__iceGame.getSnapshot().activeSiteIndex > index,
    siteIndex,
    { timeout: 5000 },
  );
  return snapshot(page);
}

async function main() {
  await mkdir(screenshotDir, { recursive: true });
  if (!process.env.BASE_URL) {
    server = spawn(process.execPath, ["server.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      if (!text.includes("EADDRINUSE")) process.stderr.write(text);
    });
  }
  await waitForServer(baseUrl);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => runtimeErrors.push(flatten(error)));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__iceGame), null, {
    timeout: 10000,
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);
  await page.screenshot({
    path: `${screenshotDir}/01-title.png`,
    fullPage: true,
  });

  const routes = await page.evaluate(() => window.__iceGame.getRoutes());
  assert.equal(routes.campToSites.length, 3);
  for (const route of routes.campToSites) {
    assert.equal(route.found, true, `${route.site} should have a safe path`);
    assert.equal(
      route.violations,
      0,
      `${route.site} safe path must not cross an unbridged lead`,
    );
    assert.ok(route.bridges.length > 0, `${route.site} should use a snow bridge`);
  }

  await page.click("#startButton");
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().mode === "driving",
    null,
    { timeout: 3000 },
  );
  await page.waitForTimeout(450);
  await page.screenshot({
    path: `${screenshotDir}/02-camp-departure.png`,
    fullPage: true,
  });

  const driveStarted = Date.now();
  const arrived = await driveToFirstSite(page);
  const driveSeconds = (Date.now() - driveStarted) / 1000;
  await page.screenshot({
    path: `${screenshotDir}/03-s01-arrival.png`,
    fullPage: true,
  });

  await enterDrill(page);
  const sampleOne = await drillUntilCore(
    page,
    0,
    `${screenshotDir}/04-balanced-drilling.png`,
  );
  assert.equal(sampleOne.load, 1);
  assert.equal(sampleOne.cores.length, 1);
  assert.equal(sampleOne.cores[0].siteId, "S-01");
  assert.equal(sampleOne.sites[0].done, true);
  assert.equal(sampleOne.sites[0].progress, 100);
  assert.equal(sampleOne.jamCount, 0);
  await page.waitForTimeout(650);
  await page.screenshot({
    path: `${screenshotDir}/05-s01-core-loaded.png`,
    fullPage: true,
  });

  await page.evaluate(() => window.__iceGame.teleportToSite(1));
  await page.waitForTimeout(300);
  await enterDrill(page);
  const sampleTwo = await drillUntilCore(page, 1);
  assert.equal(sampleTwo.load, 2);
  assert.equal(sampleTwo.cores.length, 2);
  assert.equal(sampleTwo.sites[1].done, true);

  await page.evaluate(() => window.__iceGame.teleportToSite(2));
  await page.waitForTimeout(300);
  await enterDrill(page);
  const sampleThree = await drillUntilCore(
    page,
    2,
    `${screenshotDir}/06-third-core-drilling.png`,
  );
  assert.equal(sampleThree.load, 3);
  assert.equal(sampleThree.cores.length, 3);
  assert.equal(sampleThree.sites[2].done, true);

  await page.evaluate(() => window.__iceGame.teleportToCamp());
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().mode === "complete",
    null,
    { timeout: 5000 },
  );
  await page.waitForFunction(
    () => !document.querySelector("#resultScreen").classList.contains("hidden"),
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(450);
  const mission = await snapshot(page);
  const resultTitle = await page.locator("#resultTitle").textContent();
  assert.equal(mission.result.success, true);
  assert.equal(mission.result.cores, 3);
  assert.match(resultTitle || "", /三根冰芯/);
  await page.screenshot({
    path: `${screenshotDir}/07-mission-complete.png`,
    fullPage: true,
  });

  await page.click("#restartButton");
  await page.waitForFunction(
    () =>
      window.__iceGame.getSnapshot().mode === "driving" &&
      window.__iceGame.getSnapshot().load === 0,
    null,
    { timeout: 4000 },
  );
  await page.evaluate(() => window.__iceGame.teleportToSite(0));
  await page.waitForTimeout(300);
  await enterDrill(page);
  await page.keyboard.down("r");
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().drilling.jam === true,
    null,
    { timeout: 8000 },
  );
  const jammed = await snapshot(page);
  await page.screenshot({
    path: `${screenshotDir}/08-drill-jammed.png`,
    fullPage: true,
  });
  assert.equal(jammed.jamCount, 1);
  assert.equal(jammed.drilling.jam, true);
  assert.ok(jammed.drilling.rpm > 90);
  assert.ok(jammed.drilling.torque > 98);
  assert.ok(jammed.drilling.pressure <= 12);

  await page.keyboard.up("r");
  await page.waitForFunction(
    () => window.__iceGame.getSnapshot().drilling.jam === false,
    null,
    { timeout: 5000 },
  );
  const jamCleared = await snapshot(page);
  await page.screenshot({
    path: `${screenshotDir}/09-jam-cleared.png`,
    fullPage: true,
  });
  assert.equal(jamCleared.drilling.jam, false);
  assert.equal(jamCleared.jamCount, 1);
  assert.ok(jamCleared.drilling.torque < 40);
  assert.ok(jamCleared.drilling.rpm < 20);

  await page.evaluate(() => window.__iceGame.restart());
  await page.waitForTimeout(2900);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(450);
  const mobileLayout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvasWidth: Math.round(
      document.querySelector("#gameCanvas").getBoundingClientRect().width,
    ),
    interfaceWidth: Math.round(
      document.querySelector("#interface").getBoundingClientRect().width,
    ),
  }));
  assert.ok(
    mobileLayout.scrollWidth <= mobileLayout.viewport + 1,
    "mobile layout must not overflow horizontally",
  );
  assert.equal(mobileLayout.canvasWidth, 390);
  await page.screenshot({
    path: `${screenshotDir}/10-mobile.png`,
    fullPage: true,
  });

  const canvasDataLength = await page.evaluate(() => {
    const canvas = document.querySelector("#gameCanvas");
    return canvas.toDataURL("image/png").length;
  });
  assert.ok(canvasDataLength > 50000, "Canvas should contain a detailed scene");
  const audioState = await page.evaluate(() => window.__iceGame.getAudioState());
  assert.equal(audioState.enabled, true);
  assert.equal(audioState.state, "running");
  assert.equal(audioState.muted, false);

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    runtimeErrors,
    routes: routes.campToSites.map((route) => ({
      site: route.site,
      found: route.found,
      length: route.length,
      bridges: route.bridges,
      violations: route.violations,
      waypoints: route.points.length,
    })),
    actualDrive: {
      durationSeconds: Number(driveSeconds.toFixed(1)),
      reachedCanDrill: arrived.canDrill,
      safeBridgeCrossings: arrived.safeBridgeCrossings,
      openLeadCrossings: arrived.crackCrossings,
      canvasPngChars: canvasDataLength,
    },
    firstSample: {
      site: sampleOne.cores[0],
      progress: sampleOne.sites[0].progress,
      load: sampleOne.load,
      jamCount: sampleOne.jamCount,
    },
    allSamples: {
      cores: sampleThree.cores,
      load: sampleThree.load,
      missionSuccess: mission.result.success,
      missionSeconds: Number(mission.result.elapsed.toFixed(1)),
    },
    jamTest: {
      triggered: jammed.drilling.jam,
      rpm: Number(jammed.drilling.rpm.toFixed(1)),
      pressure: Number(jammed.drilling.pressure.toFixed(1)),
      torque: Number(jammed.drilling.torque.toFixed(1)),
      count: jammed.jamCount,
      clearedAfterRelease: jamCleared.drilling.jam === false,
    },
    audio: audioState,
    mobileLayout,
    screenshots: [
      "01-title.png",
      "02-camp-departure.png",
      "03-s01-arrival.png",
      "04-balanced-drilling.png",
      "05-s01-core-loaded.png",
      "06-third-core-drilling.png",
      "07-mission-complete.png",
      "08-drill-jammed.png",
      "09-jam-cleared.png",
      "10-mobile.png",
    ],
  };
  await writeFile(
    `${artifactDir}/verification-report.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  console.error("Browser verification failed:", error);
  if (runtimeErrors.length) console.error(runtimeErrors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill();
}
