import { expect, test } from "@playwright/test";

async function openAtelier(page) {
  await page.goto("/");
  await expect(page.locator("#overlayAction")).toBeVisible();
  await page.locator("#overlayAction").click();
  await expect(page.locator("#overlay")).toHaveClass(/hidden/);
}

test("forms a real bottle and records the finished silhouette", async ({ page }) => {
  await openAtelier(page);
  const result = await page.evaluate(() => {
    const game = window.__glassGame;
    game.begin();
    let heater = 0.18;
    game.advance(
      14.5,
      (state) => ({
        blow: state.fill < 0.992 && state.pressure < 0.52,
        spin: state.rpm < 38,
        brake: state.rpm > 45,
      }),
      (state) => {
        if (state.temperature < 760) heater = 0.54;
        else if (state.temperature > 970) heater = 0.18;
        return heater;
      },
    );
    return {
      phase: game.sim.phase,
      fill: game.sim.fill,
      contour: game.sim.contourScore,
      wallDelta: game.sim.wallDelta,
      bubbles: game.sim.bubbles.length,
      checks: game.sim.getChecks(),
    };
  });

  expect(result.phase).toBe("playing");
  expect(result.fill).toBeGreaterThan(0.98);
  expect(result.contour).toBeGreaterThanOrEqual(0.9);
  expect(result.wallDelta).toBeLessThanOrEqual(0.55);
  expect(result.bubbles).toBe(0);
  expect(result.checks.contour).toBe(true);
  expect(result.checks.wall).toBe(true);

  await page.locator("#overlay").evaluate((element) => element.classList.add("hidden"));
  await page.waitForTimeout(120);
  await page.screenshot({ path: "artifacts/bottle-formed.png", fullPage: true });

  await page.evaluate(() => window.__glassGame.finish());
  await expect(page.locator("#overlayTitle")).toContainText("瓶体完成");
  await expect(page.locator("#overlay")).not.toHaveClass(/hidden/);
  await page.screenshot({ path: "artifacts/bottle-success.png", fullPage: true });
});

test("overcooling ends the shift and shows the kiln alert", async ({ page }) => {
  await openAtelier(page);
  const result = await page.evaluate(() => {
    const game = window.__glassGame;
    game.begin();
    game.advance(
      26,
      (state) => ({
        blow: false,
        spin: state.rpm < 38,
        brake: state.rpm > 45,
      }),
      0.18,
    );
    return {
      phase: game.sim.phase,
      temperature: game.sim.temperature,
      coldTime: game.sim.coldTime,
    };
  });

  expect(result.phase).toBe("failed");
  expect(result.temperature).toBeLessThan(500);
  expect(result.coldTime).toBeGreaterThanOrEqual(1.25);
  await expect(page.locator("#overlayTitle")).toContainText("冷却过度");
  await expect(page.locator("#overlayBody")).toContainText("失去可塑性");
  await page.screenshot({ path: "artifacts/overcooled.png", fullPage: true });
});

test("keyboard controls drive airflow, rotation, and furnace position", async ({ page }) => {
  await openAtelier(page);
  const initial = await page.evaluate(() => ({
    pressure: window.__glassGame.sim.pressure,
    rpm: window.__glassGame.sim.rpm,
    heater: window.__glassGame.sim.heaterPosition,
  }));

  await page.keyboard.down("Space");
  await page.waitForTimeout(450);
  await page.keyboard.up("Space");
  const afterBlow = await page.evaluate(() => ({
    pressure: window.__glassGame.sim.pressure,
    fill: window.__glassGame.sim.fill,
  }));
  await page.keyboard.down("d");
  await page.waitForTimeout(500);
  await page.keyboard.up("d");
  await page.keyboard.down("e");
  await page.waitForTimeout(500);
  await page.keyboard.up("e");

  const driven = await page.evaluate(() => ({
    rpm: window.__glassGame.sim.rpm,
    heater: window.__glassGame.sim.heaterPosition,
  }));

  expect(afterBlow.pressure).toBeGreaterThan(initial.pressure);
  expect(afterBlow.fill).toBeGreaterThan(0.18);
  expect(driven.rpm).toBeGreaterThan(initial.rpm);
  expect(driven.heater).toBeGreaterThan(initial.heater);
});
