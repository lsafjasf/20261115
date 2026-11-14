const { test, expect } = require('@playwright/test');
const path = require('path');

const pageUrl = 'file://' + path.resolve(__dirname, '../../index.html');

// 在页面内通过合法步长把某面镜转到设计解，过热前主动散热
async function solveMirror(page, index) {
  await page.evaluate(async (idx) => {
    const { game } = window.__canyon;
    const L = window.CanyonEngine.LAYOUT;
    const T = window.CanyonEngine.TARGET_ANGLES;
    let steps = Math.round(T[idx] / L.stepDeg);
    steps = ((steps % 120) + 120) % 120;
    const m = game.mirrors[idx];
    for (let k = 0; k < steps; k++) {
      if (m.heat + L.heatPerStep >= L.overheatAt) {
        for (let c = 0; c < 22; c++) game.update(100);
      }
      game.rotate(idx, 1);
    }
  }, index);
}

// 等待 HUD 上三片镜片温度都低于胜利上限
async function coolDown(page) {
  await pollUntil(page, () => {
    const g = window.__canyon.game;
    const L = window.CanyonEngine.LAYOUT;
    g.update(100);
    return g.mirrors.every((m) => m.heat < L.winHeatCeiling) && g.won;
  }, 15000);
}

async function tick(page) {
  await page.evaluate(() => window.__canyon.game.update(16));
}

async function expectSignals(page, expected) {
  await page.evaluate((want) => {
    const g = window.__canyon.game;
    g.update(16);
    if (g.signals.join(',') !== want) {
      throw new Error('信号未就绪: ' + g.signals.join(',') + ' 期望 ' + want);
    }
  }, expected);
}

async function pollUntil(page, fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn)) return;
    await page.waitForTimeout(50);
  }
  throw new Error('pollUntil 超时: ' + fn.toString());
}

test.describe('峡谷镜面通信（真实浏览器）', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(pageUrl);
    await page.waitForFunction(() => window.__canyon && window.__canyon.game);
    await page.evaluate(() => {
      window.__canyon.setPaused(true);
      window.__canyon.game.weatherEnabled = false;
    });
  });

  test('Canvas 实际绘制了场景（非空白画布）', async ({ page }) => {
    const stats = await page.evaluate(() => {
      const c = window.__canyon.canvas;
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const colors = new Set();
      for (let i = 0; i < data.length; i += 4 * 500) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return { sampled: colors.size };
    });
    expect(stats.sampled).toBeGreaterThan(20);
  });

  test('实际完成一次三段反射并达成胜利', async ({ page }) => {
    for (let i = 0; i < 3; i++) await solveMirror(page, i);
    await tick(page);
    await expectSignals(page, 'true,true,true');
    const dots = await page.$$eval('[id^="sig-"]', els =>
      els.slice(0, 3).map(e => e.classList.contains('on')));
    expect(dots).toEqual([true, true, true]);

    expect(await page.evaluate(() => window.__canyon.game.won)).toBe(false);
    await coolDown(page);
    await pollUntil(page, () => window.__canyon.game.won === true);
    await expect(page.locator('#win-banner')).toBeVisible();
    expect(await page.evaluate(() => window.__canyon.game.won)).toBe(true);
  });

  test('错位一个步长后信号丢失，转回后恢复', async ({ page }) => {
    for (let i = 0; i < 3; i++) await solveMirror(page, i);
    await tick(page);
    await expectSignals(page, 'true,true,true');

    // M2 错位一步：后两段信号应丢失
    await page.evaluate(() => window.__canyon.game.rotate(1, 1));
    await tick(page);
    await expectSignals(page, 'true,false,false');

    // 转回原位，信号恢复
    await page.evaluate(() => window.__canyon.game.rotate(1, -1));
    await tick(page);
    await expectSignals(page, 'true,true,true');
  });

  test('连续快速转动触发过热锁定，锁定期间拒绝调角，随后自动解除', async ({ page }) => {
    const locked = await page.evaluate(async () => {
      const { game } = window.__canyon;
      const L = window.CanyonEngine.LAYOUT;
      for (let k = 0; k < 12; k++) game.rotate(0, 1);
      const duringLock = game.mirrors[0].locked && game.rotate(0, -1) === false;
      const t0 = game.time;
      while (game.mirrors[0].locked) game.update(100);
      return {
        duringLock,
        durationMs: game.time - t0,
        lockMs: L.overheatLockMs,
        canRotateAfter: game.rotate(0, -1)
      };
    });
    expect(locked.duringLock).toBe(true);
    expect(Math.abs(locked.durationMs - locked.lockMs)).toBeLessThanOrEqual(200);
    expect(locked.canRotateAfter).toBe(true);
  });

 test('UI 按钮与键盘可驱动调角，HUD 角度同步更新', async ({ page }) => {
    await page.click('[data-mirror="2"]');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => window.__canyon.syncHud());
    expect(await page.evaluate(() => window.__canyon.game.mirrors[2].angle)).toBe(3);
    await page.click('#btn-left');
    expect(await page.evaluate(() => window.__canyon.game.mirrors[2].angle)).toBe(0);
    await page.evaluate(() => window.__canyon.syncHud());
    const angText = await page.textContent('#ang-2');
    expect(angText.trim()).toBe('0°');
  });

  test('云层遮挡使信号丢失，云散后恢复', async ({ page }) => {
    for (let i = 0; i < 3; i++) await solveMirror(page, i);
    await tick(page);
    await expectSignals(page, 'true,true,true');

    await page.evaluate(() => {
      const g = window.__canyon.game;
      const L = window.CanyonEngine.LAYOUT;
      g.weatherEnabled = true;
      g.clouds.length = 0;
      g.clouds.push({
        x: (L.mirrors[1].x + L.mirrors[2].x) / 2,
        y: (L.mirrors[1].y + L.mirrors[2].y) / 2,
        w: 1200, depth: 1, speed: 0
      });
      g.update(16);
    });
    expect(await page.evaluate(() => window.__canyon.game.signals[1])).toBe(false);

    await page.evaluate(() => { window.__canyon.game.weatherEnabled = false; });
    await tick(page);
    await expectSignals(page, 'true,true,true');
  });
});
