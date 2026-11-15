import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

async function state(page) {
  return page.evaluate(() => window.__terrainDebug.getState());
}

async function waitSettled(page, expectedLevel, timeout = 18_000) {
  await page.waitForFunction(
    (level) => {
      const current = window.__terrainDebug?.getState();
      return (
        current &&
        current.activeLevel === level &&
        current.targetLevel === level &&
        !current.pendingSwitch &&
        current.loading === 0 &&
        current.visible > 0
      );
    },
    expectedLevel,
    { timeout }
  );
  await page.waitForTimeout(500);
}

async function wheelToLevel(page, level, direction, maxSteps = 30) {
  await page.mouse.move(720, 480);
  for (let step = 0; step < maxSteps; step += 1) {
    await page.mouse.wheel(0, direction * 520);
    await page.waitForTimeout(75);
    const current = await state(page);
    if (current.targetLevel === level) return current;
  }
  throw new Error(`Unable to wheel to L${level}`);
}

test("renders on demand, exposes wireframe and exports one-level overview", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__terrainDebug?.getState().loading === 0,
    null,
    { timeout: 20_000 }
  );
  const initial = await state(page);
  expect(initial.activeLevel).toBe(1);
  expect(initial.visible).toBeGreaterThan(0);
  expect(initial.resident).toBe(initial.visible);
  expect(initial.resident).toBeLessThan(initial.residentTotal);
  expect(initial.memoryBytes).toBeGreaterThan(0);
  expect(initial.seam.maxHeightDelta).toBeLessThan(1e-6);
  expect(initial.seam.maxColorDelta).toBeLessThan(1e-6);

  await page.click("#wireToggle");
  await expect(page.locator("#wireToggle")).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect((await state(page)).wireframe).toBe(true);
  await page.screenshot({ path: "artifacts/final-wireframe.png" });

  await page.click("#wireToggle");
  await page.click("#exportButton");
  const downloadPromise = page.waitForEvent("download");
  await page.click('[data-export="1"]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /terrain-overview-L1-896px\.png/
  );
  const path = await download.path();
  const data = await readFile(path);
  expect(data.subarray(1, 4).toString()).toBe("PNG");
  expect(data.length).toBeGreaterThan(100_000);
  await download.saveAs("artifacts/terrain-overview-L1-896px.png");
});

test("two continuous wheel-zoom rounds keep seams stable and release far tiles", async ({
  page
}) => {
  await page.goto("/");
  await page.waitForFunction(
    () => window.__terrainDebug?.getState().loading === 0,
    null,
    { timeout: 20_000 }
  );
  const initial = await state(page);
  const checkSeam = (snapshot, label) => {
    expect(
      snapshot.seam.maxHeightDelta,
      `${label} height seam`
    ).toBeLessThan(1e-6);
    expect(
      snapshot.seam.maxColorDelta,
      `${label} color seam`
    ).toBeLessThan(1e-6);
  };

  for (let round = 1; round <= 2; round += 1) {
    await wheelToLevel(page, 2, -1);
    await waitSettled(page, 2);
    const fine = await state(page);
    expect(fine.visible).toBeGreaterThan(0);
    expect(fine.visible).toBeLessThan(fine.residentTotal);
    checkSeam(fine, `round ${round} L2`);

    await wheelToLevel(page, 0, 1);
    await waitSettled(page, 0);
    const coarse = await state(page);
    expect(coarse.visible).toBeGreaterThan(0);
    checkSeam(coarse, `round ${round} L0`);

    await wheelToLevel(page, 1, -1);
    await waitSettled(page, 1);
    const middle = await state(page);
    checkSeam(middle, `round ${round} L1`);
  }

  const beforeRelease = await state(page);
  await page.waitForTimeout(6500);
  const afterRelease = await state(page);
  const visited = afterRelease.levelHistory;
  expect(visited.at(-1)).toBe(1);
  expect(visited.filter((level) => level === 2).length).toBeGreaterThanOrEqual(2);
  expect(visited.filter((level) => level === 0).length).toBeGreaterThanOrEqual(2);
  expect(afterRelease.evictions).toBeGreaterThan(beforeRelease.evictions);
  expect(afterRelease.memoryBytes).toBeLessThan(
    beforeRelease.memoryBytes
  );
  expect(afterRelease.hits).toBeGreaterThan(initial.hits);
  expect(afterRelease.hitRate).toBeGreaterThan(0);
  const residentLevels = [
    ...new Set(afterRelease.cacheKeys.map((key) => Number(key.split(":")[0])))
  ];
  expect(residentLevels).toEqual([1]);
  checkSeam(afterRelease, "final release");

  await page.click("#wireToggle");
  await page.screenshot({ path: "artifacts/two-round-final.png" });
  await writeFile(
    "artifacts/verification.json",
    JSON.stringify(
      {
        rounds: 2,
        levelsVisited: afterRelease.levelHistory,
        initial: {
          activeLevel: initial.activeLevel,
          visibleTiles: initial.visible,
          memoryBytes: initial.memoryBytes
        },
        final: {
          activeLevel: afterRelease.activeLevel,
          visibleTiles: afterRelease.visible,
          residentTiles: afterRelease.resident,
          memoryBytes: afterRelease.memoryBytes,
          hits: afterRelease.hits,
          misses: afterRelease.misses,
          hitRate: afterRelease.hitRate,
          evictions: afterRelease.evictions
        },
        seam: {
          maxHeightDelta: afterRelease.seam.maxHeightDelta,
          maxColorDelta: afterRelease.seam.maxColorDelta,
          samples: afterRelease.seam.samples
        }
      },
      null,
      2
    )
  );
});
