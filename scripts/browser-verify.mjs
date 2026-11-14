import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.VERIFY_PORT || 4318);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok && (await response.text()).includes("潮闸三分钟")) {
        return;
      }
    } catch {
      // The server needs a few event-loop turns before accepting requests.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not start");
}

await mkdir("artifacts", { recursive: true });
await waitForServer();

function cachedChromium() {
  const cache = `/home/${userInfo().username}/.cache/ms-playwright`;
  if (!existsSync(cache)) {
    return null;
  }
  const versionDir = readdirSync(cache)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .at(-1);
  if (!versionDir) {
    return null;
  }
  const executable = join(cache, versionDir, "chrome-linux64", "chrome");
  return existsSync(executable) ? executable : null;
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  const executable = cachedChromium();
  if (!executable) {
    throw error;
  }
  browser = await chromium.launch({ headless: true, executablePath: executable });
}
const page = await browser.newPage({ viewport: { width: 1500, height: 1120 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#gameCanvas").waitFor();
  await page.screenshot({ path: "artifacts/harbor-start.png", fullPage: true });

  const canvasPixels = await page.evaluate(() => {
    const canvas = document.querySelector("#gameCanvas");
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let colored = 0;
    for (let index = 0; index < data.length; index += 400) {
      if (data[index + 3] > 0) opaque += 1;
      if (data[index] + data[index + 1] + data[index + 2] > 20) colored += 1;
    }
    return { opaque, colored };
  });
  assert.ok(canvasPixels.opaque > 1000, "Canvas should render a complete scene");
  assert.ok(canvasPixels.colored > 500, "Canvas should contain visible colored detail");

  await page.locator("#startButton").click();
  await page.waitForFunction(
    () => window.__harborDebug.getState().status === "running",
  );
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    const debug = window.__harborDebug;
    debug.advance(24, { render: false, update: false });
    debug.setPump(true);
    debug.advance(4, { render: false, update: true });
    debug.render();
  });
  await page.screenshot({ path: "artifacts/harbor-live.png", fullPage: true });
  await page.evaluate(() => window.__harborDebug.reset());
  await page.locator("#startButton").click();
  await page.waitForFunction(
    () => window.__harborDebug.getState().status === "running",
  );

  const trapped = await page.evaluate(() => {
    const debug = window.__harborDebug;
    debug.advance(4.2, { render: false, update: false });
    debug.closeGate(0);
    debug.advance(0.2, { render: false, update: false });
    debug.render();
    return {
      status: debug.getState().status,
      fail: debug.getState().fail,
      gate: debug.getState().gates[0],
      vehicle: debug.getState().vehicles[0],
    };
  });

  assert.equal(trapped.status, "lost");
  assert.equal(trapped.fail.code, "vehicle-trapped");
  assert.equal(trapped.fail.gateId, "A");
  assert.equal(trapped.vehicle.status, "trapped");
  assert.equal(trapped.gate.state, "closing");

  await page.waitForTimeout(300);
  assert.equal(await page.locator("#resultTitle").textContent(), "撤离通道阻断");
  assert.match(await page.locator("#resultReason").textContent(), /港运-01.*A 闸/);
  await page.screenshot({ path: "artifacts/vehicle-trapped.png", fullPage: true });

  await page.evaluate(() => window.__harborDebug.reset());
  await page.locator("#startButton").click();
  await page.waitForFunction(
    () => window.__harborDebug.getState().status === "running",
  );

  const win = await page.evaluate(() => {
    const debug = window.__harborDebug;
    for (let step = 0; step < 1800 && debug.getState().status === "running"; step += 1) {
      debug.advance(0.1, { render: false, update: false });
      const game = debug.getState();
      const gateIndex = game.gates.findIndex((gate) => gate.state !== "closed");
      const closing = game.gates.some((gate) => gate.state === "closing");
      if (
        gateIndex >= 0
        && game.gates[gateIndex].state === "open"
        && !closing
        && game.spawnCursor >= game.vehicles.length
      ) {
        const gate = game.gates[gateIndex];
        const clear = game.vehicles.every(
          (vehicle) => vehicle.status !== "active" || vehicle.x > gate.x + 40,
        );
        if (clear) {
          debug.closeGate(gateIndex);
        }
      }
    }
    debug.advance(0, { render: true, update: true });
    return {
      status: debug.getState().status,
      time: debug.getState().time,
      water: debug.getState().water,
      safe: debug.getState().safeCount,
      gates: debug.getState().gates.map((gate) => gate.state),
    };
  });

  assert.equal(win.status, "won");
  assert.ok(win.time < 180);
  assert.ok(win.water < 0.68);
  assert.equal(win.safe, 10);
  assert.deepEqual(win.gates, ["closed", "closed", "closed", "closed"]);
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#resultTitle").textContent(), "港区守住");
  await page.screenshot({ path: "artifacts/harbor-won.png", fullPage: true });

  assert.deepEqual(pageErrors, [], `Page errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({
    trapped: {
      status: trapped.status,
      message: trapped.fail.message,
      vehicle: trapped.vehicle.id,
      gate: trapped.gate.id,
    },
    win: {
      status: win.status,
      time: Number(win.time.toFixed(1)),
      water: Number(win.water.toFixed(3)),
      safe: win.safe,
    },
  }, null, 2));
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
