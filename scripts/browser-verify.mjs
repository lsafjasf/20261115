import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const port = Number(process.env.PORT || 4179);
const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const screenshotDir = "artifacts/screenshots";
let serverProcess = null;

if (!process.env.BASE_URL) {
  serverProcess = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.on("exit", () => serverProcess?.kill());
  await waitForServer(baseUrl);
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start at ${url}`);
}

await mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 1,
});
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") runtimeErrors.push(message.text());
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => Boolean(window.snowGame), null, {
  timeout: 10000,
});
await page.waitForTimeout(500);

const initial = await page.evaluate(() => window.snowGame.getSnapshot());
const fontReady = await page.evaluate(() =>
  document.fonts.check("14px 'Noto Sans SC Variable'"),
);
assert.equal(initial.phase, "preparing");
assert.equal(initial.certifiedCount, 0);
assert.equal(fontReady, true, "local Chinese font should load");
await page.screenshot({
  path: `${screenshotDir}/snowline-initial.png`,
  fullPage: true,
});

await page.click("#audioButton");
await page.waitForTimeout(250);
const audioState = await page.evaluate(() => window.snowGame.getAudioState());
assert.equal(audioState.enabled, true);
assert.equal(audioState.contextState, "running");
assert.ok(audioState.sampleRate >= 8000);

async function setRange(selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function sprayLane(index, water, air, angle, desiredExtra = 0.4) {
  await page.click(`.lane-tab[data-lane="${index}"]`);
  await setRange("#waterControl", water);
  await setRange("#airControl", air);
  await setRange("#angleControl", angle);
  await page.click("#sprayButton");
  const snapshot = await page.evaluate(
    ({ laneIndex, extra }) => {
      let current;
      for (let step = 0; step < 100; step += 1) {
        current = window.snowGame.advance(0.35);
        const lane = current.lanes[laneIndex];
        if (
          lane.certified &&
          lane.thickness >= lane.targetThickness + extra
        ) {
          break;
        }
      }
      window.snowGame.spray(false);
      return window.snowGame.getSnapshot();
    },
    { laneIndex: index, extra: desiredExtra },
  );
  assert.equal(
    snapshot.lanes[index].certified,
    true,
    `lane ${index + 1} should certify with the sprayed mixture`,
  );
  return snapshot;
}

await sprayLane(0, 42, 69, 34);
await sprayLane(1, 78, 57, 34);
const prepared = await sprayLane(2, 96, 36, 36, 0.8);
await page.waitForTimeout(650);

assert.equal(prepared.success, true);
assert.equal(prepared.certifiedCount, 3);
assert.equal(await page.locator("#resultDialog").evaluate((dialog) => dialog.open), true);
const resultTitle = await page.locator("#resultTitle").textContent();
assert.match(resultTitle || "", /验收/);

await page.screenshot({
  path: `${screenshotDir}/snowline-complete.png`,
  fullPage: true,
});
await page.click("#continueButton");
await page.waitForTimeout(200);
await page.screenshot({
  path: `${screenshotDir}/snowline-complete-slopes.png`,
  fullPage: true,
});

const beforeWarm = prepared;
await page.click("#warmButton");
await page.waitForTimeout(200);
const warmed = await page.evaluate(() => window.snowGame.advance(18));
await page.waitForTimeout(450);
assert.ok(
  warmed.environment.temperature - beforeWarm.environment.temperature >= 4,
  "warm front should raise temperature by at least 4 °C",
);
assert.ok(
  warmed.averageQuality <= beforeWarm.averageQuality - 0.2,
  "warm front should visibly reduce average snow quality",
);
assert.equal(warmed.success, false);
assert.ok(warmed.certifiedCount < 3);
assert.equal(warmed.phase, "testing");
assert.ok(warmed.lanes.some((lane) => lane.meltLoss > 0.2));
await page.screenshot({
  path: `${screenshotDir}/snowline-warm-front.png`,
  fullPage: true,
});

const warmRecipe = [
  [35, 98, 38],
  [57, 65, 38],
  [80, 48, 40],
];
let restored;
for (const [index, recipe] of warmRecipe.entries()) {
  restored = await sprayLane(index, recipe[0], recipe[1], recipe[2], 0.7);
}
await page.waitForTimeout(500);
assert.equal(restored.success, true);
assert.equal(restored.certifiedCount, 3);
assert.equal(restored.phase, "open");
assert.ok(restored.averageQuality > warmed.averageQuality + 0.08);
assert.ok(restored.lanes[0].hardness < restored.lanes[1].hardness);
assert.ok(restored.lanes[1].hardness < restored.lanes[2].hardness);
await page.screenshot({
  path: `${screenshotDir}/snowline-warm-adjusted.png`,
  fullPage: true,
});

const adjustedAudio = await page.evaluate(() => window.snowGame.getAudioState());
assert.ok(adjustedAudio.levels.pump > audioState.levels.pump);
assert.ok(adjustedAudio.levels.air !== audioState.levels.air);

await page.evaluate(() => window.snowGame.reset());
await page.click('.lane-tab[data-lane="0"]');
await setRange("#waterControl", 100);
await setRange("#airControl", 0);
await setRange("#angleControl", 12);
await page.click("#sprayButton");
const wetMix = await page.evaluate(() => window.snowGame.advance(7));
await page.evaluate(() => window.snowGame.spray(false));
assert.ok(
  wetMix.lanes[0].ice > 0.38,
  "over-wetting should render an ice area above the limit",
);
await page.waitForTimeout(250);
await page.screenshot({
  path: `${screenshotDir}/snowline-ice-zone.png`,
  fullPage: true,
});

const canvasStats = await page.evaluate(() => window.snowGame.getCanvasStats());
assert.ok(canvasStats.width > 800);
assert.ok(canvasStats.dataUrlLength > 150000, "Canvas should contain a detailed scene");

await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.snowGame.reset());
await page.waitForTimeout(450);
const mobileLayout = await page.evaluate(() => ({
  viewport: window.innerWidth,
  scrollWidth: document.documentElement.scrollWidth,
  canvasWidth: Math.round(
    document.querySelector("#snowCanvas").getBoundingClientRect().width,
  ),
  audioLabel: document.querySelector("#audioLabel").textContent,
}));
assert.ok(
  mobileLayout.scrollWidth <= mobileLayout.viewport + 1,
  "Mobile layout should not overflow horizontally",
);
assert.ok(mobileLayout.canvasWidth > 320);
await page.screenshot({
  path: `${screenshotDir}/snowline-mobile.png`,
  fullPage: true,
});

const report = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  preparation: {
    success: prepared.success,
    certifiedCount: prepared.certifiedCount,
    lanes: prepared.lanes.map((lane) => ({
      name: lane.name,
      thickness: Number(lane.thickness.toFixed(1)),
      hardness: Number(lane.hardness.toFixed(1)),
      quality: Number(lane.quality.toFixed(3)),
    })),
  },
  warmFront: {
    beforeTemperature: Number(beforeWarm.environment.temperature.toFixed(1)),
    afterTemperature: Number(warmed.environment.temperature.toFixed(1)),
    beforeQuality: Number(beforeWarm.averageQuality.toFixed(3)),
    afterQuality: Number(warmed.averageQuality.toFixed(3)),
    certifiedAfterWarming: warmed.certifiedCount,
    meltedLanes: warmed.lanes.filter((lane) => lane.meltLoss > 0.2).length,
    successAfterWarming: warmed.success,
  },
  adjustment: {
    success: restored.success,
    certifiedCount: restored.certifiedCount,
    averageQuality: Number(restored.averageQuality.toFixed(3)),
    controls: restored.controls,
  },
  audio: {
    initial: audioState,
    adjusted: adjustedAudio,
  },
  wetMix: {
    ice: Number(wetMix.lanes[0].ice.toFixed(2)),
    wetness: Number(wetMix.forecast.wetness.toFixed(2)),
  },
  canvas: canvasStats,
  mobileLayout,
  runtimeErrors,
  screenshots: [
    "snowline-initial.png",
    "snowline-complete.png",
    "snowline-complete-slopes.png",
    "snowline-warm-front.png",
    "snowline-warm-adjusted.png",
    "snowline-ice-zone.png",
    "snowline-mobile.png",
  ],
};

assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"));
await writeFile(
  "artifacts/browser-verification.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  "artifacts/result.json",
  `${JSON.stringify(
    {
      task: "完成一次造雪，并验证暖锋升温后的雪质下降与调参恢复",
      completed: true,
      preparationSuccess: prepared.success,
      warmFrontQualityDrop: Number(
        (beforeWarm.averageQuality - warmed.averageQuality).toFixed(3),
      ),
      adjustmentSuccess: restored.success,
      certifications: restored.certifiedCount,
      audioContext: adjustedAudio.contextState,
      runtimeErrors: runtimeErrors.length,
      screenshots: report.screenshots.map((name) => `${screenshotDir}/${name}`),
    },
    null,
    2,
  )}\n`,
);

console.log(JSON.stringify(report, null, 2));
await browser.close();
serverProcess?.kill();
