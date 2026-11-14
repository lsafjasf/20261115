/* 交互与声音：真实 1 秒定时器、暂停/重置、WebAudio 随曝气强度变化 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const FILE_URL = "file://" + path.join(__dirname, "..", "index.html");

test.describe("交互与音频", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForFunction(() => window.__game && window.__game.snapshot());
  });

  test("点击开始后按真实秒数推进，暂停后冻结", async ({ page }) => {
    await page.click("#btn-start");
    const t0 = await page.evaluate(() => window.__game.snapshot().timeLeft);
    await page.waitForTimeout(2500);
    const t1 = await page.evaluate(() => window.__game.snapshot().timeLeft);
    expect(t0 - t1).toBeGreaterThanOrEqual(2);
    expect(t0 - t1).toBeLessThanOrEqual(3);

    await page.click("#btn-pause");
    const paused = await page.evaluate(() => window.__game.snapshot());
    expect(paused.status).toBe("paused");
    await page.waitForTimeout(1500);
    const t2 = await page.evaluate(() => window.__game.snapshot().timeLeft);
    expect(t2).toBe(t1);

    await page.click("#btn-reset");
    const reset = await page.evaluate(() => window.__game.snapshot());
    expect(reset.timeLeft).toBe(240);
    expect(reset.status).toBe("ready");
  });

  test("WebAudio 上下文可创建，且曝气强度映射到滤波频率与增益", async ({ page }) => {
    // 用户手势创建并保持 AudioContext 开启
    await page.click("#btn-sound"); // 关
    await page.click("#btn-sound"); // 开（此时 AudioContext 已创建）
    const audioState = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 300));
      const game = window.__game;
      game.audio.update(10);
      await new Promise((r) => setTimeout(r, 200));
      const low = game.audio.targets(10);
      const high = game.audio.targets(95);
      return {
        low, high,
        ctxState: game.audio.ctx ? game.audio.ctx.state : null,
        hasAudioContext: typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined",
        nodeCount: document.querySelectorAll("canvas").length
      };
    });
    expect(audioState.hasAudioContext).toBe(true);
    expect(audioState.nodeCount).toBe(1);
    expect(audioState.ctxState).toMatch(/running|suspended/);
    expect(audioState.high.filterFreq).toBeGreaterThan(audioState.low.filterFreq);
    expect(audioState.high.noiseGain).toBeGreaterThan(audioState.low.noiseGain);
    console.log("音频参数: 弱曝气", JSON.stringify(audioState.low),
      "→ 强曝气", JSON.stringify(audioState.high));

    // 声音开关按钮文案切换
    await page.click("#btn-sound");
    expect(await page.textContent("#btn-sound")).toContain("关");
    await page.click("#btn-sound");
    expect(await page.textContent("#btn-sound")).toContain("开");
  });
});
