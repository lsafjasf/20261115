import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const url = process.env.GAME_URL || 'http://127.0.0.1:18080/';
const executablePath = process.env.CHROME_PATH || '/tmp/chrome-linux64/chrome';
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox']
});

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('Canvas was not rendered');
  const toScreen = (x, y) => ({
    x: box.x + (x / 1280) * box.width,
    y: box.y + (y / 720) * box.height
  });
  const dragAnchor = async (from, to) => {
    const start = toScreen(from.x, from.y);
    const end = toScreen(to.x, to.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 14 });
    await page.mouse.up();
  };

  await dragAnchor({ x: 516, y: 176 }, { x: 516, y: 112 });
  await dragAnchor({ x: 858, y: 214 }, { x: 858, y: 142 });
  await dragAnchor({ x: 932, y: 508 }, { x: 932, y: 410 });
  await dragAnchor({ x: 636, y: 430 }, { x: 636, y: 340 });

  await page.locator('#tension').evaluate((slider) => {
    slider.value = '48';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-mode="abnormal"]').click();

  const staged = await page.evaluate(() => window.__quarryGame.getSnapshot());
  await page.screenshot({ path: 'artifacts/abnormal-layout.png', fullPage: true });

  await page.locator('#blastButton').click();
  await page.waitForTimeout(6000);
  const running = await page.evaluate(() => window.__quarryGame.getSnapshot());
  await page.screenshot({ path: 'artifacts/abnormal-running.png', fullPage: true });

  await page.waitForFunction(
    () => window.__quarryGame.getSnapshot().state === 'complete',
    { timeout: 20000 }
  );
  const final = await page.evaluate(() => window.__quarryGame.getSnapshot());
  await page.screenshot({ path: 'artifacts/abnormal-verified.png', fullPage: true });

  const report = {
    verifiedAt: new Date().toISOString(),
    url,
    interaction: {
      anchorsDragged: true,
      tensionSetTo: 48,
      mode: 'abnormal',
      confirmationClicked: true
    },
    staged,
    running,
    final,
    consoleErrors
  };
  await writeFile(
    'artifacts/abnormal-rockfall-validation.json',
    `${JSON.stringify(report, null, 2)}\n`
  );

  if (final.state !== 'complete' || !final.result?.success) {
    throw new Error(`Abnormal rockfall validation failed: ${JSON.stringify(final.result)}`);
  }
  console.log(JSON.stringify({
    success: final.result.success,
    mode: final.result.mode,
    rockCount: final.result.rockCount,
    breachCount: final.result.breachCount,
    caught: final.result.caught,
    buffered: final.result.buffered,
    peakAnchorLoad: final.result.peakAnchorLoad,
    pocketLoad: final.result.pocketLoad,
    consoleErrors
  }, null, 2));
} finally {
  await browser.close();
}
