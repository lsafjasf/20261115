import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function waitForCity(page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const state = window.__CITY_LAB__?.getState();
    return state && state.buildingCount > 20 && state.rebuildCount >= 1;
  });
  await page.waitForTimeout(350);
}

test("两个 seed 生成不同且稳定的城市轮廓", async ({ page }) => {
  await waitForCity(page);
  const compare = await page.evaluate(() => window.__CITY_LAB__.getCompareState());
  expect(compare.a.seed).toBe("20261115");
  expect(compare.b.seed).toBe("117340");
  expect(compare.a.count).toBeGreaterThan(60);
  expect(compare.b.count).toBeGreaterThan(60);
  expect(compare.distance).toBeGreaterThan(0.08);
  expect(compare.a.maxFloors).not.toBe(compare.b.maxFloors);

  await page.screenshot({ path: "artifacts/verify-seed-a.png" });
  await page.locator("#seed-card-b").click();
  await page.waitForFunction(() => window.__CITY_LAB__.getState()?.seed === "117340");
  const activeSeed = await page.evaluate(() => window.__CITY_LAB__.getState().seed);
  expect(activeSeed).toBe("117340");
  await page.screenshot({ path: "artifacts/verify-seed-b.png" });
});

test("编辑一栋楼只替换该楼网格，不重建全城", async ({ page }) => {
  await waitForCity(page);
  const clickable = await page.evaluate(() => window.__CITY_LAB__.findClickableBuilding());
  expect(clickable).not.toBeNull();
  await page.mouse.click(clickable.clientX, clickable.clientY);
  await page.waitForFunction(
    (id) => {
      const state = window.__CITY_LAB__.getState();
      return state.selectedId === id && !document.querySelector("#selected-card").hidden;
    },
    clickable.id,
  );
  const before = await page.evaluate(() => {
    const lab = window.__CITY_LAB__;
    const state = lab.getState();
    return {
      state,
      fingerprints: lab.meshFingerprints(),
      target: state.buildingPositions.find((building) => building.id === state.selectedId),
    };
  });

  const selectedFloors = Number(await page.locator("#building-floors").textContent());
  await page.locator("#floor-plus").click();
  await page.waitForFunction(
    ({ id, floors }) => {
      const state = window.__CITY_LAB__.getState();
      const target = state.buildingPositions.find((building) => building.id === id);
      return target && target.floors > floors && state.editRevision === 1;
    },
    { id: before.target.id, floors: selectedFloors },
  );

  const after = await page.evaluate(() => ({
    state: window.__CITY_LAB__.getState(),
    fingerprints: window.__CITY_LAB__.meshFingerprints(),
  }));
  expect(after.state.rebuildCount).toBe(before.state.rebuildCount);
  expect(after.state.editRevision).toBe(1);
  expect(after.fingerprints[before.target.id]).not.toBe(before.fingerprints[before.target.id]);
  const otherIds = Object.keys(before.fingerprints).filter((id) => id !== before.target.id);
  for (const id of otherIds) {
    expect(after.fingerprints[id]).toBe(before.fingerprints[id]);
  }
  await page.screenshot({ path: "artifacts/verify-incremental-edit.png" });
});

test("逐层显影严格按建筑高度过滤，旋转后遮挡顺序正确", async ({ page }) => {
  await waitForCity(page);
  await page.evaluate(() => window.__CITY_LAB__.setLayerThreshold(12));
  const early = await page.evaluate(() => window.__CITY_LAB__.getState());
  const expectedAtTwelve = early.buildingPositions.filter((building) => building.floors <= 12).length;
  expect(early.layerMode).toBe(true);
  expect(early.visibleBuildings).toBe(expectedAtTwelve);
  expect(early.visibleBuildings).toBeLessThan(early.buildingCount);
  await page.screenshot({ path: "artifacts/verify-layers-12f.png" });

  await page.evaluate(() => window.__CITY_LAB__.setLayerThreshold(100));
  const full = await page.evaluate(() => window.__CITY_LAB__.getState());
  expect(full.visibleBuildings).toBe(full.buildingCount);

  await page.evaluate(() => window.__CITY_LAB__.setLayerMode("solid", { animate: false }));
  await page.evaluate(() => window.__CITY_LAB__.orbitTo(18, 24, 220));
  await page.waitForTimeout(250);
  const probe = await page.evaluate(() => window.__CITY_LAB__.findOcclusionProbe());
  expect(probe).not.toBeNull();
  expect(probe.frontId).not.toBe(probe.backId);
  expect(probe.depthOrderCorrect).toBe(true);
  expect(probe.frontDistance).toBeLessThan(probe.backDistance);

  const camera = await page.evaluate(() => window.__CITY_LAB__.getState().camera);
  expect(Math.abs(camera.azimuth - 18)).toBeLessThan(1);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: "artifacts/verify-occlusion-rotated.png" });
});

test("参数 JSON 与 PNG 截图均可下载", async ({ page }) => {
  await waitForCity(page);
  const parameterDownload = page.waitForEvent("download");
  await page.locator("#save-btn").click();
  const parameterFile = await parameterDownload;
  expect(parameterFile.suggestedFilename()).toMatch(/^seedscape-20261115\.json$/);
  const parameterPath = await parameterFile.path();
  const parameters = JSON.parse(await readFile(parameterPath, "utf8"));
  expect(parameters.format).toBe("seedscape-city-v1");
  expect(parameters.parameters.seed).toBe("20261115");
  expect(parameters.parameters.roofTypes.length).toBeGreaterThan(0);

  const screenshotDownload = page.waitForEvent("download");
  await page.locator("#shot-btn").click();
  const screenshotFile = await screenshotDownload;
  expect(screenshotFile.suggestedFilename()).toMatch(/^seedscape-20261115-\d+\.png$/);
  const screenshotPath = await screenshotFile.path();
  const png = await readFile(screenshotPath);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.length).toBeGreaterThan(10_000);
});
