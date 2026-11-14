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
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.__app && window.__app.sim);

  const initial = await page.evaluate(() => {
    const s = window.__app.sim;
    return { zones: s.zones.length, seed: s.seedString, ratios: s.zones.map((z) => z.ratio) };
  });
  console.log('loaded seed', initial.seed, 'zones', initial.zones);

  await page.screenshot({ path: path.join(ROOT, 'artifacts', '01-initial-terrain.png') });

  await page.click('#autoCoverBtn');
  await page.waitForFunction(
    () => document.querySelector('#testOut').textContent.includes('结果'),
    { timeout: 60000 }
  );
  const coverText = await page.textContent('#testOut');
  console.log('\n--- full coverage run ---\n' + coverText);
  await page.screenshot({ path: path.join(ROOT, 'artifacts', '02-full-coverage.png') });

  await page.click('#autoMissBtn');
  await page.waitForFunction(
    () => {
      const t = document.querySelector('#testOut').textContent;
      return t.includes('风偏漏播') && t.includes('结果');
    },
    { timeout: 60000 }
  );
  const missText = await page.textContent('#testOut');
  console.log('\n--- wind drift miss run ---\n' + missText);
  await page.screenshot({ path: path.join(ROOT, 'artifacts', '03-wind-miss.png') });

  const coverWon = coverText.includes('成功');
  const missDetected = missText.includes('出现漏播');
  if (errors.length) {
    console.error('\nJS errors:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
  if (!coverWon || !missDetected) {
    console.error('\nE2E assertion failed: coverWon=' + coverWon + ' missDetected=' + missDetected);
    process.exitCode = 1;
  } else {
    console.log('\nE2E OK: coverage succeeded and wind-drift miss was demonstrated.');
  }
  await browser.close();
})();
