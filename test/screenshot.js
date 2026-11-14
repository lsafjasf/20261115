const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.goto('file://' + path.resolve(__dirname, '../index.html'));
  await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded');

  // 手动构建“三台泵全开 + 四支路供水 + 一条破裂”的代表性画面
  await page.click('#btn-start');
  for (let i = 0; i < 3; i++) await page.click(`#pump-btn-${i}`);
  await page.evaluate(() => {
    [0.8, 0.7, 0.65, 0.6].forEach((v, i) => {
      const r = document.getElementById(`hose-range-${i}`);
      r.value = v * 100;
      r.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await page.waitForTimeout(3500);
  await page.click('#btn-rupture');
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: path.resolve(__dirname, '../artifacts/rupture-event.png'),
    fullPage: true,
  });

  // 自动驾驶跑完整局，保存灭火成功结局画面
  await page.click('#btn-reset');
  await page.click('#btn-auto');
  await page.waitForFunction(
    () => document.getElementById('mission-state').textContent.includes('成功'),
    { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.resolve(__dirname, '../artifacts/mission-won.png'),
    fullPage: true,
  });
  await browser.close();
  console.log('已保存 artifacts/rupture-event.png 与 artifacts/mission-won.png');
})().catch(e => { console.error(e); process.exit(1); });
