const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const exe = path.join(
  process.env.HOME,
  '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'
);

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1540, height: 980 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.__app && window.__app.sim);

  await page.fill('#seedInput', 'manual-check');
  await page.click('#newSeedBtn');
  await page.waitForFunction(() => window.__app.sim.seedString === 'manual-check');

  await page.selectOption('#widthSel', '22');
  await page.check('#sowingChk');
  await page.check('#contourAssist');
  const throttle = page.locator('#throttle');
  await throttle.fill('60');
  await page.keyboard.down('d');
  await page.waitForTimeout(400);
  await page.keyboard.up('d');
  await page.waitForTimeout(600);
  await page.click('#resetBtn');

  const state = await page.evaluate(() => {
    const s = window.__app.sim;
    return {
      width: s.width,
      zones: s.zones.length,
      seedUsed: s.seedUsed,
      hasTerrain: typeof s.terrain.heightAt === 'function',
    };
  });
  console.log('manual smoke state:', JSON.stringify(state));
  if (errors.length) {
    console.error('JS errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
  if (state.width !== 22 || state.zones !== 3) process.exitCode = 1;
  await page.screenshot({ path: path.join(ROOT, 'artifacts', '04-manual-drive.png') });
  console.log(process.exitCode ? 'MANUAL SMOKE FAILED' : 'MANUAL SMOKE OK');
  await browser.close();
})();
