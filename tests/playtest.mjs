import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

let baseURL = process.env.BASE_URL || "http://127.0.0.1:4273";
const artifacts = new URL("../artifacts/", import.meta.url);
await mkdir(artifacts, { recursive: true });
let localServer = null;

async function ensureServer() {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(800) });
    if (response.ok) return;
  } catch {
    // Start a local server when the test is run without npm start.
  }
  const port = 4274;
  baseURL = `http://127.0.0.1:${port}`;
  localServer = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(400) });
      if (response.ok) return;
    } catch {
      // Wait for the server to finish starting.
    }
  }
  throw new Error(`Could not start test server at ${baseURL}`);
}

await ensureServer();

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const cacheRoot = `/home/${process.env.USER || "user"}/.cache/ms-playwright`;
  if (!existsSync(cacheRoot)) return bundled;
  const version = readdirSync(cacheRoot).find((entry) => entry.startsWith("chromium-"));
  return version ? join(cacheRoot, version, "chrome-linux64", "chrome") : bundled;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: findChromium(),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(message.text());
});

const snapshot = () => page.evaluate(() => window.__tideGame.snapshot());
const delay = (ms) => page.waitForTimeout(ms);

async function waitForPlaying() {
  await page.waitForFunction(() => window.__tideGame?.snapshot().mode === "playing");
}

async function driveUntilX(targetX, tolerance = 58) {
  await page.keyboard.down("ArrowRight");
  const deadline = Date.now() + 18000;
  let state;
  do {
    await delay(40);
    state = await snapshot();
    if (state.mode !== "playing") break;
  } while (state.boat.x < targetX - tolerance && Date.now() < deadline);
  await page.keyboard.up("ArrowRight");
  if (Date.now() >= deadline) throw new Error(`Timed out driving to x=${targetX}`);
  return snapshot();
}

async function collectAtDock(index) {
  const expected = (await snapshot()).docks[index];
  const state = await driveUntilX(expected.x);
  assert.ok(Math.abs(state.boat.x - expected.x) < 82, `Boat reached dock ${expected.id}`);
  await page.keyboard.press("e");
  await delay(80);
  return snapshot();
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "潮汐清运" }).waitFor();
  await page.screenshot({ path: new URL("01-start.png", artifacts).pathname });

  await page.getByRole("button", { name: "启航" }).click();
  await waitForPlaying();
  assert.equal((await snapshot()).boat.volume, 0);
  const audio = await page.evaluate(() => window.__tideGame.audioStatus());
  assert.equal(audio.ready, true);
  assert.equal(audio.contextState, "running");
  await page.screenshot({ path: new URL("02-gameplay.png", artifacts).pathname });

  let state = await collectAtDock(0);
  assert.equal(state.docks[0].collected, true, "Dock A collected");
  assert.equal(state.boat.volume, 38);

  state = await collectAtDock(1);
  assert.equal(state.docks[1].collected, true, "Dock B collected");
  assert.equal(state.boat.volume, 76);

  state = await collectAtDock(2);
  assert.equal(state.docks[2].collected, false, "Third collection rejected while load would overflow");
  assert.equal(state.boat.volume, 76, "Rejected collection leaves hold unchanged");
  assert.equal(state.stats.fullRejects, 1);
  assert.match(await page.locator("#toastText").textContent(), /满载/);
  await page.screenshot({ path: new URL("03-full-reject.png", artifacts).pathname });

  await page.keyboard.down("Space");
  await delay(140);
  const compactAudio = await page.evaluate(() => window.__tideGame.audioStatus());
  assert.ok(compactAudio.compactorLevel > 0.02, "Compactor Web Audio bus is active");
  await page.waitForFunction(() => window.__tideGame.snapshot().boat.volume <= 60);
  await page.keyboard.up("Space");
  state = await snapshot();
  assert.ok(state.boat.volume <= 60, "Compactor reduced volume");
  assert.ok(state.boat.battery < 100, "Compactor consumed battery");
  assert.equal(state.boat.hasCompacted, true);

  await page.keyboard.press("e");
  await delay(80);
  state = await snapshot();
  assert.equal(state.docks[2].collected, true, "Dock C collected after compaction");
  assert.ok(state.boat.volume > 97.5 && state.boat.volume <= 98.1, "Load is within hold capacity");

  state = await driveUntilX(state.processor.x, 75);
  assert.ok(Math.abs(state.boat.x - state.processor.x) < 96, "Boat reached processor");
  await page.keyboard.press("e");
  await page.waitForFunction(() => window.__tideGame.snapshot().mode === "won");
  await page.locator("#endOverlay:not(.hidden)").waitFor();
  state = await snapshot();
  assert.equal(state.processor.delivered, true);
  assert.equal(state.stats.collections, 3);
  assert.ok(state.boat.battery > 0, "Battery remains above zero");
  assert.match(await page.locator("#endKicker").textContent(), /任务完成/);
  await page.screenshot({ path: new URL("04-victory.png", artifacts).pathname });

  console.log("PASS round: 3 docks collected, compacted, delivered, battery > 0");
  console.log(
    `Result: time ${state.time.toFixed(1)}s, battery ${state.boat.battery.toFixed(1)}%, peak leak ${state.stats.peakLeak.toFixed(1)}%`,
  );

  const fullPage = await context.newPage();
  fullPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await fullPage.goto(baseURL, { waitUntil: "networkidle" });
  await fullPage.getByRole("button", { name: "启航" }).click();
  await fullPage.waitForFunction(() => window.__tideGame?.snapshot().mode === "playing");
  await fullPage.evaluate(() => {
    window.__tideGame.debugSet({ x: 620, volume: 100, mass: 63, battery: 90, leak: 8 });
    window.__tideGame.action();
  });
  await delay(100);
  const fullState = await fullPage.evaluate(() => window.__tideGame.snapshot());
  assert.equal(fullState.boat.volume, 100, "Full hold remains at capacity");
  assert.equal(fullState.docks[0].collected, false, "Full hold cannot collect another dock");
  assert.equal(fullState.stats.fullRejects, 1, "Full rejection was recorded");
  assert.equal(fullState.stats.lastFullReject.heldVolume, 100);
  assert.equal(fullState.stats.lastFullReject.incomingVolume, 38);
  assert.match(await fullPage.locator("#toastText").textContent(), /满载/);
  await fullPage.screenshot({ path: new URL("05-capacity-invariant.png", artifacts).pathname });
  console.log("PASS invariant: a 100/100 hold rejects a 38 m³ dock load");
  await fullPage.close();

  assert.deepEqual(runtimeErrors, [], `Browser runtime errors: ${runtimeErrors.join(" | ")}`);
} finally {
  await browser.close();
  localServer?.kill();
}
