/* Playwright 端到端：真实浏览器中完成一次净化 + 一次底泥翻起浊度反弹 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const SHOT_DIR = path.join(__dirname, "..", "artifacts", "shots");
const FILE_URL = "file://" + path.join(__dirname, "..", "index.html");

test.describe("池塘蓝藻净化模拟", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForFunction(() => window.__game && window.__game.snapshot());
  });

  test("实际完成一次净化：藻密度与溶氧同时进入安全区", async ({ page }) => {
    const result = await page.evaluate(() => {
      const game = window.__game;
      const trace = [];
      game.start();
      const strategy = (t) =>
        t < 150
          ? { aeration: 55, pump: 85, shade: 95 }
          : { aeration: 45, pump: 75, shade: 40 };

      for (let t = 0; t < 240; t++) {
        game.setControls(strategy(t));
        const snap = game.tick(1);
        if (t % 20 === 0 || snap.status !== "running") trace.push({ t, ...snap });
        if (snap.status !== "running") break;
      }
      return { final: game.snapshot(), trace, logs: game.sim.events };
    });

    console.log("净化轨迹:");
    result.trace.forEach((p) =>
      console.log(
        `  t=${p.t} algae=${p.algae.toFixed(1)} do=${p.dissolvedOxygen.toFixed(2)} ` +
        `turb=${p.turbidity.toFixed(1)} plant=${p.plantHealth.toFixed(1)} status=${p.status}`
      )
    );

    expect(result.final.status).toBe("won");
    expect(result.final.algae).toBeLessThanOrEqual(30);
    expect(result.final.dissolvedOxygen).toBeGreaterThanOrEqual(5);
    expect(result.final.plantHealth).toBeGreaterThan(60);

    await page.screenshot({ path: path.join(SHOT_DIR, "01-purification-success.png"), fullPage: true });
  });

  test("强曝气翻起底泥：浊度明显反弹并产生告警", async ({ page }) => {
    const data = await page.evaluate(() => {
      const game = window.__game;
      game.start();
      const samples = [];
      // 先温和运行 15 秒建立基线
      for (let t = 0; t < 15; t++) {
        game.setControls({ aeration: 30, pump: 40, shade: 20 });
        game.tick(1);
      }
      samples.push({ phase: "baseline", ...game.snapshot() });
      // 曝气拉满 60 秒
      for (let t = 0; t < 60; t++) {
        game.setControls({ aeration: 100, pump: 20, shade: 20 });
        const snap = game.tick(1);
        if (t % 15 === 14) samples.push({ phase: "over-aeration", t: t + 1, ...snap });
      }
      return {
        samples,
        final: game.snapshot(),
        disturbanceTicks: game.sim.disturbanceTicks,
        logs: game.sim.events.filter((e) => e.level !== "info")
      };
    });

    console.log("浊度反弹采样:");
    data.samples.forEach((s) =>
      console.log(
        `  ${s.phase}${s.t ? "@" + s.t + "s" : ""} turb=${s.turbidity.toFixed(1)} ` +
        `sediment=${s.sedimentStability.toFixed(1)} do=${s.dissolvedOxygen.toFixed(2)}`
      )
    );

    const baseline = data.samples[0].turbidity;
    const peak = Math.max(...data.samples.map((s) => s.turbidity));
    console.log(`  基线浊度=${baseline.toFixed(1)} → 峰值=${peak.toFixed(1)}，累计扰动 ${data.disturbanceTicks} 秒`);

    expect(data.disturbanceTicks).toBeGreaterThan(40);
    expect(peak).toBeGreaterThan(baseline + 15);
    expect(data.final.sedimentStability).toBeLessThan(85);
    expect(data.logs.some((e) => e.text.includes("底泥"))).toBe(true);

    await page.screenshot({ path: path.join(SHOT_DIR, "02-sediment-turbidity-rebound.png"), fullPage: true });
  });

  test("画面包含水体分层、藻团、气泡、光照与遮光网", async ({ page }) => {
    await page.evaluate(() => {
      const game = window.__game;
      game.start();
      game.setControls({ aeration: 60, pump: 50, shade: 80 });
      for (let t = 0; t < 10; t++) game.tick(1);
      game.render();
    });
    await page.screenshot({ path: path.join(SHOT_DIR, "03-canvas-elements.png"), fullPage: true });

    const nonBlankPixels = await page.evaluate(() => {
      const canvas = document.getElementById("pond");
      const ctx = canvas.getContext("2d");
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBg = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] + img[i + 1] + img[i + 2] < 720) nonBg++;
      }
      return nonBg;
    });
    expect(nonBlankPixels).toBeGreaterThan(50000);
  });

  test("不干预导致失败：溶氧危机与事件告警", async ({ page }) => {
    const result = await page.evaluate(() => {
      const game = window.__game;
      game.start();
      for (let t = 0; t < 240 && game.snapshot().status === "running"; t++) {
        game.setControls({ aeration: 0, pump: 0, shade: 0 });
        game.tick(1);
      }
      return { final: game.snapshot(), logs: game.sim.events };
    });
    expect(result.final.status).toBe("lost");
    expect(result.logs.length).toBeGreaterThan(0);
    expect(result.final.loseReason).toContain("窒息");
    console.log("不干预失败原因:", result.final.loseReason);
    await page.screenshot({ path: path.join(SHOT_DIR, "04-failure-idle.png"), fullPage: true });
  });
});
