import { expect, test } from "@playwright/test";

async function openCell(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/?e2e=1");
  await page.waitForFunction(
    () => Boolean(window.__SYNCWELD__),
    null,
    { timeout: 5_000 }
  );
  await page.evaluate(() => document.fonts.ready);
  return pageErrors;
}

async function waitForAlign(page) {
  await page.waitForFunction(
    () => window.__SYNCWELD__.getState().phase === "align",
    null,
    { timeout: 8_000 }
  );
}

async function centerBothSides(page) {
  await page.keyboard.down("d");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(280);
  await page.keyboard.up("d");
  await page.keyboard.up("ArrowLeft");
  await page.waitForFunction(
    () => {
      const state = window.__SYNCWELD__.getState();
      return Math.abs(state.fixtureError) <= 0.025 &&
        Math.abs(state.torchError) <= 0.025;
    },
    null,
    { timeout: 1_500 }
  );
}

test("two simultaneous operators complete one assembly group", async ({ page }) => {
  const pageErrors = await openCell(page);
  await waitForAlign(page);
  await centerBothSides(page);

  await expect.poll(
    () => page.evaluate(() => ({
      context: window.__SYNCWELD__.audio.context?.state,
      sync: window.__SYNCWELD__.audio.sync
    })),
    { timeout: 1_000 }
  ).toEqual({ context: "running", sync: expect.any(Number) });
  const audioSync = await page.evaluate(() => window.__SYNCWELD__.audio.sync);
  expect(audioSync).toBeGreaterThan(0.8);

  await Promise.all([
    page.keyboard.down("f"),
    page.keyboard.down("j")
  ]);

  await expect.poll(
    () => page.evaluate(() => window.__SYNCWELD__.getState().phase),
    { timeout: 1_000 }
  ).toBe("welding");

  await page.waitForTimeout(520);
  const midWeld = await page.evaluate(() => window.__SYNCWELD__.getState());
  expect(midWeld.weldProgress).toBeGreaterThan(0.25);
  expect(midWeld.held).toEqual({ fixture: true, torch: true });

  await expect.poll(
    () => page.evaluate(() => window.__SYNCWELD__.getState().completed),
    { timeout: 2_000 }
  ).toBe(1);

  await page.waitForTimeout(160);
  const completed = await page.evaluate(() => window.__SYNCWELD__.getState());
  expect(completed.phase).toBe("complete");
  expect(completed.spares).toBe(2);
  expect(completed.completed).toBe(1);
  await expect(page.locator("#groupLights")).toHaveAttribute(
    "aria-label",
    "装配进度 1/3"
  );
  await page.screenshot({
    path: "artifacts/verify-final.png",
    fullPage: true
  });

  await page.keyboard.up("f");
  await page.keyboard.up("j");
  expect(pageErrors).toEqual([]);
});

test("one operator alone cannot advance the assembly count", async ({ page }) => {
  const pageErrors = await openCell(page);
  await waitForAlign(page);

  await page.keyboard.down("f");
  await page.waitForTimeout(420);
  await page.keyboard.up("f");

  const state = await page.evaluate(() => window.__SYNCWELD__.getState());
  expect(state.completed).toBe(0);
  expect(state.phase).toBe("failed");
  expect(state.failure.code).toBe("SINGLE_OPERATOR");
  await expect(page.locator("#groupLights")).toHaveAttribute(
    "aria-label",
    "装配进度 0/3"
  );
  await expect(page.locator("#resultPanel")).toBeVisible();
  await page.screenshot({
    path: "artifacts/verify-single-operator.png",
    fullPage: true
  });
  expect(pageErrors).toEqual([]);
});
