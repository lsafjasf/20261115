import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function serve() {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = normalize(pathname === "/" ? "index.html" : pathname.slice(1));
    const file = join(root, relative);
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
    response.end(readFileSync(file));
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

function cachedChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(homedir(), ".cache", "ms-playwright"),
    resolve(root, "..", "..", ".cache", "ms-playwright"),
  ].filter(Boolean);
  for (const cache of caches) {
    if (!existsSync(cache)) continue;
    for (const entry of readdirSync(cache)) {
      if (!entry.startsWith("chromium-")) continue;
      const executable = join(cache, entry, "chrome-linux64", "chrome");
      if (existsSync(executable)) return executable;
    }
  }
  return undefined;
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({
  headless: true,
  executablePath: cachedChromium(),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") pageErrors.push(message.text());
});

try {
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("#start-screen").isVisible(), true, "start screen should be visible");
  await page.click("#start-button");
  await page.waitForTimeout(350);

  const audio = await page.evaluate(() => window.__SNOWLINE__.getState().audio);
  assert.equal(audio.ready, true, "Web Audio graph should be initialized");
  assert.equal(audio.state, "running", "AudioContext should be running after the start gesture");

  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  const keyboardState = await page.evaluate(() => window.__SNOWLINE__.getState());
  assert.ok(keyboardState.vehicle.speedKmh > 4, "holding W should accelerate the sled");

  await page.evaluate(() => {
    const api = window.__SNOWLINE__;
    api.freeze();
    api.resetDebug();
    const station = api.getStations()[0];
    api.setVehicleState({ x: station.x, y: station.y, heading: station.angle || 0, speed: 0 });
    api.step({ brake: true });
  });
  assert.equal(await page.locator("#prompt").isVisible(), true, "delivery prompt should appear near a station");
  await page.keyboard.press("e");
  const delivered = await page.evaluate(() => window.__SNOWLINE__.getState());
  assert.equal(delivered.cargoCount, 2, "pressing E at a station should unload one crate");

  const brake = await page.evaluate(() => {
    const api = window.__SNOWLINE__;
    api.freeze();
    api.resetDebug();
    for (let index = 0; index < 300; index += 1) {
      api.step({ throttle: true, steer: 0 });
    }
    const before = api.getState();
    let peakShift = 0;
    let peakRisk = 0;
    for (let index = 0; index < 90; index += 1) {
      const state = api.step({ brake: true, steer: 0 });
      peakShift = Math.max(peakShift, state.vehicle.cargoShiftCm);
      peakRisk = Math.max(peakRisk, state.vehicle.risk);
    }
    return { before, after: api.getState(), peakShift, peakRisk };
  });
  assert.ok(brake.before.vehicle.speedKmh > 40, "test vehicle should reach speed before braking");
  assert.ok(brake.peakShift > 25, `hard brake should shift cargo; got ${brake.peakShift.toFixed(1)} cm`);
  assert.ok(
    brake.peakRisk > brake.before.vehicle.maxRisk + 0.08,
    "hard brake should increase rollover risk",
  );

  const delivery = await page.evaluate(() => {
    const api = window.__SNOWLINE__;
    api.resetDebug();
    let steps = 0;
    while (steps < 50000 && !api.getState().completed && !api.getState().failed) {
      api.autopilotStep();
      steps += 1;
    }
    return { steps, state: api.getState(), stations: api.getStations() };
  });
  assert.equal(delivery.state.failed, false, "route should be traversable without rollover");
  assert.equal(delivery.state.completed, true, "all three observation points should be delivered");
  assert.equal(delivery.state.cargoCount, 0, "all medical crates should be unloaded");
  assert.equal(delivery.stations.length, 3, "there should be exactly three observation points");
  assert.ok(delivery.stations.every((station) => station.delivered), "each station should be reached");

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join(" | ")}`);
  console.log(`PASS audio=${audio.state} brakeShift=${brake.peakShift.toFixed(1)}cm risk=${(brake.peakRisk * 100).toFixed(0)}% delivery=${delivery.state.elapsed.toFixed(1)}s steps=${delivery.steps}`);
} finally {
  await browser.close();
  server.close();
}
