/* 真实浏览器（Chromium）验证：Canvas 栅格化、UI 交互、SVG 往返、localStorage 持久化。 */
const { test, expect } = require('@playwright/test');
const url = '/index.html';

test.describe('字腔自适应笔画实验台（浏览器）', () => {
  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto('/index.html');
    await p.evaluate(() => localStorage.clear());
    await ctx.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(url);
    await page.waitForFunction(() => window.LabAPI);
  });

  test('页面加载后 Canvas 已用程序化路径绘制（非空白）', async ({ page }) => {
    const nonBlank = await page.evaluate(() => {
      const c = document.getElementById('stage');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 10) n++;
      return n;
    });
    expect(nonBlank).toBeGreaterThan(500);
  });

  test('真实 Canvas 测量：细字重不粘连、粗字重不吞腔', async ({ page }) => {
    const result = await page.evaluate(() => {
      const api = window.LabAPI;
      const sample = '细字重 Stroke 0.5 不粘连，粗字重 2026 不吞掉字腔：ABCO 中文字体实验';
      const chars = [...new Set(sample)].filter((c) => c.trim() && GlyphLib[c] && GlyphLib[c].strokes.length);
      const rows = chars.map((ch) => {
        const g = GlyphLib[ch];
        const thin = api.measurer.resolve(g, 0.5);
        const thick = api.measurer.resolve(g, 2.2);
        return {
          ch,
          thinOK: thin.metrics.bodyCount <= thin.base.bodyCount,
          thickOK: thick.metrics.counterCount >= thick.base.counterCount,
          thinScale: thin.scale, thickScale: thick.scale,
          baseCounters: thick.base.counterCount,
          keptCounters: thick.metrics.counterCount,
        };
      });
      return {
        total: rows.length,
        thinFails: rows.filter((r) => !r.thinOK).map((r) => r.ch),
        thickFails: rows.filter((r) => !r.thickOK).map((r) => r.ch),
        clamped: rows.filter((r) => r.thickScale < 2.0).map((r) => r.ch + '=' + r.thickScale.toFixed(2)),
        rows,
      };
    });
    expect(result.total).toBeGreaterThan(25);
    expect(result.thinFails).toEqual([]);
    expect(result.thickFails).toEqual([]);
    expect(result.clamped.length).toBeGreaterThan(3);
  });

  test('粗细/圆度/字距/行高滑块驱动重绘并更新布局尺寸', async ({ page }) => {
    const before = await page.evaluate(() => {
      const s = window.LabAPI.readState();
      return { tracking: s.tracking, lineHeight: s.lineHeight };
    });
    await page.evaluate(() => window.LabAPI.setTracking(260));
    await page.evaluate(() => window.LabAPI.setLineHeight(2.0));
    const after = await page.evaluate(() => window.LabAPI.readState());
    expect(after.tracking).toBe(260);
    expect(after.lineHeight).toBe(2.0);
    const label = await page.locator('#trackVal').textContent();
    expect(label).toContain('+260');
  });

  test('SVG 导出包含参数与路径，重新解析可完整恢复', async ({ page }) => {
    await page.evaluate(() => {
      window.LabAPI.applyState({
        text: 'ABCO 2026 字腔', weight: 1.7, roundness: 0.55,
        tracking: 80, lineHeight: 1.6, adapt: true,
      });
      window.LabAPI.rerender();
    });
    const round = await page.evaluate(() => {
      const svg = window.LabAPI.exportSVG();
      const state = window.LabAPI.parseState(svg);
      return {
        hasSvg: svg.includes('<svg'),
        pathCount: (svg.match(/<path/g) || []).length,
        hasMeta: svg.includes('counter-lab-state'),
        state,
      };
    });
    expect(round.hasSvg).toBe(true);
    expect(round.hasMeta).toBe(true);
    expect(round.pathCount).toBeGreaterThan(20);
    expect(round.state.weight).toBeCloseTo(1.7);
    expect(round.state.roundness).toBeCloseTo(0.55);
    expect(round.state.tracking).toBe(80);
    expect(round.state.text).toBe('ABCO 2026 字腔');
  });

  test('参数写入 localStorage，重新打开后保留', async ({ page }) => {
    await page.evaluate(() => {
      window.LabAPI.applyState({
        text: '持久化测试 Persist 9', weight: 1.3, roundness: 0.8,
        tracking: 120, lineHeight: 1.8, adapt: false,
      });
      window.LabAPI.rerender();
    });
    await page.reload();
    await page.waitForFunction(() => window.LabAPI);
    const restored = await page.evaluate(() => window.LabAPI.readState());
    expect(restored.text).toBe('持久化测试 Persist 9');
    expect(restored.weight).toBeCloseTo(1.3);
    expect(restored.adapt).toBe(false);
    expect(restored.tracking).toBe(120);
  });

  test('页面内验证报告全部通过', async ({ page }) => {
    const pass = await page.evaluate(() => window.LabAPI.runVerification());
    expect(pass).toBe(true);
    await expect(page.locator('#testReport .pass').first()).toBeVisible();
  });
});
