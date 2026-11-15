import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { compareScenes } from "../src/scene.js";

const root = resolve(import.meta.dirname, "..");
const artifacts = join(root, "artifacts");
const port = Number(process.env.E2E_PORT || 4297);
const baseURL = `http://127.0.0.1:${port}`;

mkdirSync(artifacts, { recursive: true });

function findChromium() {
  const configured = process.env.CHROMIUM_PATH || process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (configured && existsSync(configured)) return configured;

  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    join(userInfo().homedir, ".cache", "ms-playwright"),
    "/home/hj/.cache/ms-playwright"
  ].filter(Boolean);
  for (const cacheRoot of cacheRoots) {
    if (existsSync(cacheRoot)) {
      const builds = readdirSync(cacheRoot)
        .filter((name) => name.startsWith("chromium-"))
        .sort()
        .reverse();
      for (const build of builds) {
        for (const relative of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
          const candidate = join(cacheRoot, build, relative);
          if (existsSync(candidate)) return candidate;
        }
      }
    }
  }
  throw new Error("No Chromium executable found. Set CHROMIUM_PATH.");
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
    } catch {
      // Server startup is still in progress.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Server did not start at ${baseURL}`);
}

async function captureCanvas(page, filePath) {
  await page.evaluate(
    () =>
      new Promise((resolvePromise) =>
        requestAnimationFrame(() => requestAnimationFrame(resolvePromise))
      )
  );
  const dataURL = await page.locator("#canvas").evaluate((element) => element.toDataURL("image/png"));
  const screenshot = await page.locator("#canvas").screenshot({ path: filePath });
  return {
    dataURL,
    hash: createHash("sha256").update(dataURL).digest("hex"),
    screenshotHash: createHash("sha256").update(screenshot).digest("hex")
  };
}

async function waitForObjectCount(page, count) {
  await page.waitForFunction(
    (expected) => window.vectorStudio?.getStats().objects === expected,
    count,
    { timeout: 10000 }
  );
}

async function runRound(page, round) {
  const before = await captureCanvas(page, join(artifacts, `roundtrip-${round}-before.png`));
  const originalScene = JSON.parse(await page.evaluate(() => window.vectorStudio.exportJSON()));
  assert.equal(originalScene.objects.length, 20, "random scene should contain 20 objects");
  let svgReport = null;

  if (round === 1) {
    const svgDownloadPromise = page.waitForEvent("download");
    await page.locator("#export-svg").click();
    const svgDownload = await svgDownloadPromise;
    const svgPath = join(artifacts, "roundtrip-1.svg");
    await svgDownload.saveAs(svgPath);
    const svgText = readFileSync(svgPath, "utf8");
    svgReport = {
      file: "artifacts/roundtrip-1.svg",
      textNodes: (svgText.match(/<text\b/g) || []).length,
      expectedTextObjects: originalScene.objects.filter((object) => object.type === "text").length,
      rasterImages: (svgText.match(/<image\b/g) || []).length
    };
    assert.equal(svgReport.textNodes, svgReport.expectedTextObjects);
    assert.equal(svgReport.rasterImages, 0);
  }

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#save-json").click();
  const download = await downloadPromise;
  const savedPath = join(artifacts, `roundtrip-${round}.json`);
  await download.saveAs(savedPath);
  const savedText = readFileSync(savedPath, "utf8");
  JSON.parse(savedText);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.vectorStudio));
  await page.locator("#file-input").setInputFiles(savedPath);
  await waitForObjectCount(page, originalScene.objects.length);
  await page.evaluate(() => window.vectorStudio.clearSelection());

  const after = await captureCanvas(page, join(artifacts, `roundtrip-${round}-after.png`));
  const restoredScene = JSON.parse(await page.evaluate(() => window.vectorStudio.exportJSON()));
  const report = compareScenes(originalScene, restoredScene);
  const pixelsStable = before.hash === after.hash;
  const screenshotsStable = before.screenshotHash === after.screenshotHash;

  return {
    round,
    savedFile: savedPath.replace(`${root}/`, ""),
    beforeScreenshot: `artifacts/roundtrip-${round}-before.png`,
    afterScreenshot: `artifacts/roundtrip-${round}-after.png`,
    objectCountBefore: originalScene.objects.length,
    objectCountAfter: restoredScene.objects.length,
    sceneComparison: report,
    beforeCanvasHash: before.hash,
    afterCanvasHash: after.hash,
    canvasPixelsStable: pixelsStable,
    beforeScreenshotHash: before.screenshotHash,
    afterScreenshotHash: after.screenshotHash,
    screenshotsStable,
    svgExport: svgReport
  };
}

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore"
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: findChromium()
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1
  });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.vectorStudio));
  await page.evaluate(() => window.vectorStudio.generate("roundtrip-random-batch", 20));
  await page.evaluate(() => window.vectorStudio.clearSelection());
  await waitForObjectCount(page, 20);

  const rounds = [];
  for (let round = 1; round <= 2; round += 1) {
    rounds.push(await runRound(page, round));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    seed: "roundtrip-random-batch",
    rounds,
    runtimeErrors,
    thresholds: rounds[0].sceneComparison
      ? {
          coordinates: rounds[0].sceneComparison.coordinateThreshold,
          colors: rounds[0].sceneComparison.colorThreshold
        }
      : null,
    passed:
      rounds.every(
        (item) =>
          item.objectCountBefore === 20 &&
          item.objectCountAfter === 20 &&
          item.sceneComparison.passed &&
          item.canvasPixelsStable &&
          item.screenshotsStable
      ) &&
      rounds[0].svgExport?.textNodes > 0 &&
      rounds[0].svgExport?.rasterImages === 0 &&
      runtimeErrors.length === 0
  };
  writeFileSync(join(artifacts, "roundtrip-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));

  assert.equal(report.passed, true, "two save-load round trips must be stable");
  assert.equal(runtimeErrors.length, 0, "browser runtime should have no errors");
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
