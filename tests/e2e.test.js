import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const PORT = 4319;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;
let browser;

before(async () => {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: import.meta.dirname + "/..",
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) break;
    } catch {
      // The static server is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill("SIGTERM");
});

async function openStudio() {
  const page = await browser.newPage({
    viewport: { width: 1460, height: 1080 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.click("#start-button");
  await page.waitForFunction(() => window.__studioReady === true);
  return { page, errors };
}

test("browser pause freezes actor, beat and audio cue counter", async () => {
  const { page, errors } = await openStudio();
  await page.waitForTimeout(750);
  await page.click("#pause-button");
  await page.waitForTimeout(150);

  const frozen = await page.evaluate(() => {
    const state = window.__studio.getState();
    return {
      clock: state.clock,
      beatsPlayed: window.__studio.audio.beatEventCount,
    };
  });
  await page.waitForTimeout(1400);
  const afterWait = await page.evaluate(() => {
    const state = window.__studio.getState();
    return {
      clock: state.clock,
      beatsPlayed: window.__studio.audio.beatEventCount,
    };
  });

  assert.deepEqual(afterWait.clock.actor, frozen.clock.actor);
  assert.equal(afterWait.clock.elapsedMs, frozen.clock.elapsedMs);
  assert.equal(afterWait.clock.beatIndex, frozen.clock.beatIndex);
  assert.equal(afterWait.clock.beatProgress, frozen.clock.beatProgress);
  assert.equal(afterWait.clock.beatPulses, frozen.clock.beatPulses);
  assert.equal(afterWait.beatsPlayed, frozen.beatsPlayed);
  await assert.doesNotReject(page.locator("#pause-scrim").waitFor({ state: "visible" }));
  await page.screenshot({ path: "artifacts/pause-sync.png" });

  await page.click("#pause-button");
  await page.waitForTimeout(900);
  const resumed = await page.evaluate(() => {
    const state = window.__studio.getState();
    return { clock: state.clock, beatsPlayed: window.__studio.audio.beatEventCount };
  });
  assert.equal(resumed.clock.paused, false);
  assert.ok(resumed.clock.beatIndex > frozen.clock.beatIndex);
  assert.ok(resumed.clock.beatPulses > frozen.clock.beatPulses);
  assert.ok(resumed.beatsPlayed > frozen.beatsPlayed);
  assert.notDeepEqual(resumed.clock.actor, frozen.clock.actor);
  assert.deepEqual(errors, []);
  await page.close();
});

const TAKES = [
  {
    camera: { x: 525, y: 211, focal: 51 },
    lights: [13.284866484902182, 270.48850144290964],
  },
  {
    camera: { x: 240, y: 85, focal: 30 },
    lights: [351.21615037438164, 152.0540227769858],
  },
  {
    camera: { x: 240, y: 154, focal: 55 },
    lights: [11.216150374381641, 276.0540227769858],
  },
];

async function setControl(page, id, value) {
  await page.evaluate(
    ({ id: controlId, value: nextValue }) => {
      const control = document.getElementById(controlId);
      control.value = String(Math.round(nextValue));
      control.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { id, value },
  );
}

async function applyTake(page, take) {
  await setControl(page, "camera-x", take.camera.x);
  await setControl(page, "camera-y", take.camera.y);
  await setControl(page, "focal-length", take.camera.focal);
  await setControl(page, "light-a", take.lights[0]);
  await setControl(page, "light-b", take.lights[1]);
}

test("browser completes all three shots through the live game UI", async () => {
  const { page, errors } = await openStudio();

  for (let index = 0; index < TAKES.length; index += 1) {
    await applyTake(page, TAKES[index]);
    await page.waitForFunction(
      () => window.__studio.getState().analysis.ready,
      undefined,
      { timeout: 12000, polling: 16 },
    );
    const before = await page.evaluate(() => window.__studio.getState());
    await page.evaluate(() => window.__studio.takePhoto());
    await page.waitForFunction(
      (completed) => window.__studio.getState().completedShots.length === completed,
      index + 1,
      { timeout: 1500 },
    );
    assert.equal(before.analysis.reason, "ready");
    const progress = await page.locator("#progress-label").textContent();
    assert.equal(progress.trim(), `${index + 1} / 3`);
  }

  await page.locator("#round-overlay").waitFor({ state: "visible", timeout: 2500 });
  const completed = await page.evaluate(() => window.__studio.getState());
  assert.equal(completed.completedShots.length, 3);
  assert.equal(completed.roundComplete, true);
  await page.evaluate(() => {
    window.__studio.engine.flash = 0;
    document.querySelector("#round-overlay").hidden = true;
  });
  await page.waitForTimeout(120);
  await page.screenshot({ path: "artifacts/three-shots-contact-sheet.png", fullPage: true });
  await page.evaluate(() => {
    document.querySelector("#round-overlay").hidden = false;
  });
  await page.screenshot({ path: "artifacts/three-shots-complete.png", fullPage: true });

  await page.click("#next-round-button");
  await page.waitForTimeout(120);
  const nextRound = await page.evaluate(() => window.__studio.getState());
  assert.equal(nextRound.round, 2);
  assert.equal(nextRound.completedShots.length, 0);
  assert.equal(nextRound.roundComplete, false);
  assert.equal(nextRound.paused, false);
  assert.deepEqual(errors, []);
  await page.close();
});
