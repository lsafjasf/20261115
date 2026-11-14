import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = normalize(join(fileURLToPath(import.meta.url), "../.."));
const artifactDir = join(root, "artifacts");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

function startServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const file = normalize(join(root, relative));
      if (!file.startsWith(root)) throw new Error("Outside workspace");
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function findBrowser() {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/tmp/chrome-browser/opt/google/chrome/chrome",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function gameState(page) {
  return page.evaluate(() => window.__deepTether.getState());
}

async function waitForState(page, predicate, label, timeout = 18000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await gameState(page);
    if (predicate(state)) return state;
    await page.waitForTimeout(80);
  }
  throw new Error(`Timeout while waiting for ${label}: ${JSON.stringify(await gameState(page))}`);
}

async function waitForLineTarget(page, target) {
  const state = await gameState(page);
  if (state.winchTarget < target) {
    await page.keyboard.down("ArrowDown");
    await waitForState(page, (value) => value.winchTarget >= target, `winch target ${target}`);
    await page.keyboard.up("ArrowDown");
  }
}

async function boot(page, url) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(message.text());
    }
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.click("#startButton");
  await page.evaluate(() => window.__deepTether.setTimeScale(2));
  const first = await waitForState(page, (state) => state.started, "game start");
  assert.equal(first.phase, "running");
  assert.equal(first.audio.ready, true, "Web Audio should initialize after a user gesture");
  return errors;
}

async function verifySuccessRecovery(page, url) {
  const errors = await boot(page, url);
  const tones = [];
  const noteState = (state) => {
    tones.push(state.toneFrequency);
    return state;
  };

  let current = noteState(await gameState(page));
  await waitForLineTarget(page, 11);
  current = noteState(await gameState(page));
  assert.ok(current.winchTarget >= 11);

  for (let index = 0; index < 3; index += 1) {
    const targetDepth = [150, 300, 450][index];
    await waitForState(
      page,
      (state) => state.depth >= targetDepth - 16 || state.phase !== "running",
      `depth ${targetDepth - 16} m`,
      20000
    );
    current = noteState(await gameState(page));
    assert.equal(current.phase, "running", `mission should still be running near ${targetDepth} m`);

    await page.keyboard.down("Space");
    let sampled;
    try {
      sampled = await waitForState(
        page,
        (state) => state.samples[index] || state.phase !== "running",
        `sample ${index + 1}`,
        12000
      );
      noteState(sampled);
      const progressStart = Date.now();
      while (!sampled.samples[index] && Date.now() - progressStart < 12000) {
        await page.waitForTimeout(120);
        sampled = noteState(await gameState(page));
      }
    } finally {
      await page.keyboard.up("Space");
    }
    if (sampled.phase !== "running") {
      throw new Error(`Cable failed before sample ${index + 1}: ${JSON.stringify(sampled)}`);
    }
    assert.equal(sampled.samples[index], true, `sample ${index + 1} should be sealed`);
    assert.ok(sampled.tension < 100, "sampling brake should keep tension below the break limit");
    current = sampled;
    await page.waitForTimeout(250);
  }

  assert.equal(current.sampleCount, 3);
  await page.screenshot({ path: join(artifactDir, "three-samples-sealed.png") });
  await page.keyboard.press("R");
  current = await waitForState(page, (state) => state.resultOpen, "success result", 30000);
  assert.equal(current.phase, "success");
  assert.equal(current.cableSnapped, false);
  assert.equal(current.sampleCount, 3);
  assert.equal(await page.locator("#resultTitle").textContent(), "样品已回收");
  assert.equal(current.audio.ready, true);
  assert.equal(current.audio.contextState, "running");
  assert.ok(current.audio.volume > 0);

  const toneRange = Math.max(...tones) - Math.min(...tones);
  assert.ok(toneRange >= 20, `tension sonification should change pitch (range ${toneRange} Hz)`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(artifactDir, "success-recovery.png") });
  assert.deepEqual(errors, [], "browser console should be clean");

  return {
    phase: current.phase,
    sampleCount: current.sampleCount,
    cableSnapped: current.cableSnapped,
    peakTension: current.peakTension,
    elapsedSeconds: current.elapsed,
    toneRangeHz: Number(toneRange.toFixed(1)),
    screenshot: "artifacts/success-recovery.png",
  };
}

async function verifyLateBrake(page, url) {
  const errors = await boot(page, url);
  await waitForLineTarget(page, 22);
  const beforeBrake = await gameState(page);
  assert.ok(beforeBrake.winchTarget >= 22);

  await waitForState(
    page,
    (state) => state.depth >= 135 || state.phase !== "running",
    "late-brake depth",
    16000
  );
  const atBrake = await gameState(page);
  assert.equal(atBrake.phase, "running");
  assert.ok(atBrake.velocity > 19, "basket should still carry high descent momentum");

  await page.keyboard.down("Space");
  let failed;
  try {
    failed = await waitForState(page, (state) => state.phase !== "running", "cable snap", 8000);
  } finally {
    await page.keyboard.up("Space");
  }
  assert.equal(failed.phase, "failed");
  assert.equal(failed.failReason, "snap");
  assert.equal(failed.cableSnapped, true);
  assert.ok(failed.peakTension > 100, "late braking should exceed the 100 kN break threshold");

  await waitForState(page, (state) => state.resultOpen, "failure result", 5000);
  const after = await gameState(page);
  assert.equal(await page.locator("#resultTitle").textContent(), "缆绳断裂");
  assert.equal(after.audio.contextState, "running");
  assert.ok(
    after.audio.frequency > atBrake.audio.frequency + 80,
    "the tension sonification should rise sharply when the cable snaps"
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(artifactDir, "late-brake-failure.png") });
  assert.deepEqual(errors, [], "browser console should be clean");

  return {
    phase: after.phase,
    failReason: after.failReason,
    cableSnapped: after.cableSnapped,
    peakTension: after.peakTension,
    sampleCount: after.sampleCount,
    pitchBeforeBrakeHz: atBrake.audio.frequency,
    pitchAfterSnapHz: after.audio.frequency,
    screenshot: "artifacts/late-brake-failure.png",
  };
}

async function main() {
  const workspace = await startServer();
  const executablePath = findBrowser();
  const launchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"],
  };
  if (executablePath) launchOptions.executablePath = executablePath;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  let report;
  try {
    const success = await verifySuccessRecovery(page, workspace.url);
    const lateBrake = await verifyLateBrake(page, workspace.url);
    report = {
      success,
      lateBrake,
      failedAsExpected: lateBrake.phase === "failed" && lateBrake.failReason === "snap",
    };
    await writeFile(join(artifactDir, "verification-results.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    workspace.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
