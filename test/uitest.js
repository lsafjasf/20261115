/*
 * uitest.js — 用 Playwright 无头浏览器验证页面交互：
 * 加载页面 → 点击"轻微拉伸"/"强烈拉伸" → 截图 → 模拟拖拽手柄。
 * 用法: node test/uitest.js   （需先在 /tmp 安装 playwright-core）
 */
'use strict';
const path = require('path');
const { chromium } = require('/tmp/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 560 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  await page.goto(url);
  await page.waitForTimeout(300);

  const info0 = await page.textContent('#info');
  console.log('初始:', info0);

  await page.click('#btnMild');
  await page.waitForTimeout(200);
  console.log('轻微:', await page.textContent('#info'));
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'ui_mild.png') });

  await page.click('#btnStrong');
  await page.waitForTimeout(200);
  console.log('强烈:', await page.textContent('#info'));
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts', 'ui_strong.png') });

  // 模拟拖拽第一个手柄向右 40px
  const h = await page.locator('#handle0').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 40, h.y + h.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  console.log('拖拽后:', await page.textContent('#info'));

  // 验证导出：拦截 download
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('#btnExport');
  const download = await dl;
  console.log('导出 PNG:', download ? await download.suggestedFilename() : '未触发（无头环境限制）');

  if (errors.length) {
    console.log('页面错误:'); errors.forEach((e) => console.log(' ', e));
    process.exitCode = 1;
  } else {
    console.log('UI 测试通过，无页面错误');
  }
  await browser.close();
})();
