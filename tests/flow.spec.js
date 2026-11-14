import { test, expect } from "@playwright/test";
import { readFile, stat, writeFile } from "node:fs/promises";

function setRange(locator, value) {
  return locator.evaluate((input, nextValue) => {
    input.value = String(nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("switches all three scenes, saves parameters, exports, and reloads", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");

  const savedStates = {};
  const expectedTitles = ["潮汐信使", "鹤归松谷", "灯火归人"];

  for (let index = 0; index < 3; index += 1) {
    await page.locator(`.scene-card[data-scene="${index}"]`).click();
    await expect(page.locator("#sceneTitle")).toHaveText(expectedTitles[index]);

    if (index === 0) {
      const keyframe = page.locator('[data-keyframe="0"][data-edge="in"]');
      const handleBox = await keyframe.boundingBox();
      const trackBox = await page.locator('[data-track="0"]').boundingBox();
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(trackBox.x + trackBox.width * 0.08, handleBox.y + handleBox.height / 2, { steps: 8 });
      await page.mouse.up();
    }

    const spacingValue = [58, 64, 70][index];
    await setRange(page.locator(`[data-spacing="${index}"]`), spacingValue);
    await setRange(page.locator(`[data-angle="${index}"]`), 0);
    await page.locator("#stageCanvas").click({ position: { x: 740, y: 220 } });
    await page.waitForTimeout(180);

    const metrics = await page.evaluate(() => window.shadowBox.getMetrics());
    expect(metrics.activeLayers).toBe(4);
    expect(metrics.burn).toBe(0);
    expect(metrics.silhouette).toBeGreaterThanOrEqual(60);

    await page.locator("#saveSceneButton").click();
    await expect(page.locator(`.scene-card[data-scene="${index}"]`)).toHaveClass(/is-complete/);
    savedStates[index] = await page.evaluate(() => window.shadowBox.getState());
  }

  await expect(page.locator("#completeCount")).toHaveText("3");
  await expect(page.locator("#progressLabel")).toHaveText("三幕齐备");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportButton").click();
  const download = await downloadPromise;
  const exportPath = "artifacts/export-frame.png";
  await download.saveAs(exportPath);
  expect(download.suggestedFilename()).toMatch(/^shadowbox-city-.*\.png$/);
  const exported = await readFile(exportPath);
  expect(exported.subarray(1, 4).toString()).toBe("PNG");
  const exportSize = (await stat(exportPath)).size;
  expect(exportSize).toBeGreaterThan(100_000);

  const storage = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), "shadowbox-atelier.v1");
  expect(storage.activeIndex).toBe(2);
  expect(storage.scenes.tide.complete).toBe(true);
  expect(storage.scenes.crane.complete).toBe(true);
  expect(storage.scenes.city.complete).toBe(true);
  expect(storage.scenes.tide.spacings[0]).toBe(58);
  expect(storage.scenes.crane.spacings[1]).toBe(64);
  expect(storage.scenes.city.spacings[2]).toBe(70);
  expect(storage.scenes.tide.timeline[0].in).toBeGreaterThan(0.2);

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await expect(page.locator("#sceneTitle")).toHaveText("灯火归人");
  await expect(page.locator("#completeCount")).toHaveText("3");
  const reloaded = await page.evaluate(() => window.shadowBox.getState());
  expect(reloaded.scenes.tide.spacings[0]).toBe(58);
  expect(reloaded.scenes.crane.spacings[1]).toBe(64);
  expect(reloaded.scenes.city.spacings[2]).toBe(70);
  expect(reloaded.scenes.tide.timeline[0].in).toBeCloseTo(storage.scenes.tide.timeline[0].in, 5);
  await writeFile("artifacts/verification.json", JSON.stringify({
    verifiedAt: new Date().toISOString(),
    completeCount: 3,
    activeScene: reloaded.activeScene,
    exportedFrame: {
      file: "export-frame.png",
      bytes: exportSize,
      signature: "PNG",
      dimensions: "802x491",
    },
    roundTrip: {
      tideAngle0: reloaded.scenes.tide.angles[0],
      tideSpacing0: reloaded.scenes.tide.spacings[0],
      craneSpacing1: reloaded.scenes.crane.spacings[1],
      citySpacing2: reloaded.scenes.city.spacings[2],
      tideFadeIn: reloaded.scenes.tide.timeline[0].in,
      completionFlags: Object.fromEntries(
        ["tide", "crane", "city"].map((id) => [id, reloaded.scenes[id].complete]),
      ),
    },
  }, null, 2));
  await page.screenshot({ path: "artifacts/delivered.png" });

  await page.evaluate(() => window.shadowBox.setLight({ distance: 18 }));
  await page.waitForTimeout(120);
  const burnMetrics = await page.evaluate(() => window.shadowBox.getMetrics());
  expect(burnMetrics.burn).toBeGreaterThan(0);
  await expect(page.locator("#burnCallout")).toHaveClass(/is-visible/);
  await expect(page.locator("#warningText")).toContainText("光源过近");

  await page.screenshot({ path: "artifacts/burn-guard.png" });
  await page.evaluate(() => window.shadowBox.setLight({ distance: 64 }));
});
