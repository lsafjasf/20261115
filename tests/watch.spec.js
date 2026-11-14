import { expect, test } from "@playwright/test";

async function install(page, teeth, slot) {
  await page.locator(`.tray-gear[data-tooth-count="${teeth}"]`).click();
  await page.locator(`.slot-hotspot[data-slot="${slot}"]`).click();
}

async function wind(page) {
  for (let index = 0; index < 5; index += 1) {
    await page.locator("#crownButton").click();
  }
}

test("rejects wrong ratios, completes assembly, and confirms axle binding", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("h1")).toHaveText("擒纵调试台");

  await install(page, 42, "center");
  await install(page, 36, "third");
  await install(page, 24, "fourth");
  await expect(page.locator("#statusMessage")).toContainText("点击表冠五次");

  await wind(page);
  await expect.poll(() => page.evaluate(() => window.__watchGame.getSnapshot().mode)).toBe("running");
  const wrongRun = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(wrongRun.failure).toBe("fast");
  expect(wrongRun.speedFactor).toBeGreaterThan(1);
  expect(wrongRun.audio.contextState).toBe("running");
  await page.waitForTimeout(1_800);
  await page.screenshot({ path: "artifacts/wrong-tooth.png", fullPage: true });

  await expect.poll(
    () => page.evaluate(() => window.__watchGame.getSnapshot().mode),
    { timeout: 7_000 }
  ).toBe("failed");
  const rejected = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(rejected.attemptsLeft).toBe(2);
  expect(rejected.installed).toEqual({ center: 42, third: 36, fourth: 24 });
  await expect(page.locator("#statusMessage")).toContainText("走时过快");
  await page.screenshot({ path: "artifacts/wrong-tooth-failed.png", fullPage: true });

  await page.locator('.slot-hotspot[data-slot="center"]').click();
  await install(page, 48, "center");
  await wind(page);
  await expect.poll(() => page.evaluate(() => window.__watchGame.getSnapshot().mode)).toBe("running");
  const stableStart = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(stableStart.failure).toBeNull();
  expect(stableStart.speedFactor).toBe(1);

  await page.waitForTimeout(10_000);
  const stableMidpoint = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(stableMidpoint.mode).toBe("running");
  expect(stableMidpoint.secondsAngle).toBeGreaterThan(58);
  expect(stableMidpoint.secondsAngle).toBeLessThan(62);
  await page.screenshot({ path: "artifacts/stable-running.png", fullPage: true });

  await expect.poll(
    () => page.evaluate(() => window.__watchGame.getSnapshot().mode),
    { timeout: 23_000, intervals: [500, 1_000, 2_000] }
  ).toBe("success");

  const completed = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(completed.attemptsLeft).toBe(1);
  expect(completed.runTime).toBe(30);
  await expect(page.locator("#resultModal")).toHaveClass(/is-open/);
  await expect(page.locator("#resultTitle")).toHaveText("走时稳定");
  await page.locator("#resultAction").click();
  await expect(page.locator("#resultModal")).not.toHaveClass(/is-open/);
  await page.screenshot({ path: "artifacts/assembly-complete.png", fullPage: true });

  await page.locator("#resetButton").click();
  await install(page, 48, "center");
  await install(page, 42, "third");
  await install(page, 24, "fourth");
  await wind(page);
  await page.waitForTimeout(700);
  const jammedRun = await page.evaluate(() => window.__watchGame.getSnapshot());
  expect(jammedRun.failure).toBe("jam");
  expect(jammedRun.audio.frictionActive).toBe(true);
  await page.screenshot({ path: "artifacts/tight-axle.png", fullPage: true });
  await expect.poll(
    () => page.evaluate(() => window.__watchGame.getSnapshot().mode),
    { timeout: 3_000 }
  ).toBe("failed");
  await expect(page.locator("#statusMessage")).toContainText("轴位");
  expect(await page.evaluate(() => window.__watchGame.getSnapshot().attemptsLeft)).toBe(2);

  expect(pageErrors).toEqual([]);
});
