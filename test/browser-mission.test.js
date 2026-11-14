/* End-to-end verification in a real browser: load the actual page,
   engage autopilot, and assert a full three-point mission is completed. */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const url = 'file://' + path.join(__dirname, '..', 'index.html');
const outDir = path.join(__dirname, '..', 'artifacts');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(url);
  await page.waitForFunction(() => window.__ice && window.__ice.sim);

  await page.screenshot({ path: path.join(outDir, 'shot-01-start.png') });

  await page.click('#autoBtn');

  /* Let the autopilot run the whole tour; mission takes ~40s of sim time.
     Poll manually so timing is independent of waitForFunction defaults. */
  let status = 'playing';
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    status = await page.evaluate(() => window.__ice.sim.status);
    const snap = await page.evaluate(() => ({
      measured: window.__ice.world.points.filter((p) => p.measured).length,
      active: window.__ice.sim.activePoint
    }));
    if (snap.measured === 1 && snap.active >= 0) {
      await page.screenshot({ path: path.join(outDir, 'shot-measuring.png') });
    }
    if (status !== 'playing') break;
  }
  if (status === 'playing') {
    await page.screenshot({ path: path.join(outDir, 'shot-timeout.png') });
    throw new Error('mission did not finish within 90s');
  }

  const result = await page.evaluate(() => {
    const { sim, world, autoMode } = window.__ice;
    return {
      status: sim.status,
      failReason: sim.failReason,
      time: sim.time,
      thrusts: sim.thrusts,
      autoMode,
      measurements: sim.measurements.map((m) => ({
        point: m.point, t: +m.t.toFixed(2)
      })),
      points: world.points.map((p) => ({ id: p.id, measured: p.measured })),
      finalPos: { x: +sim.x.toFixed(1), y: +sim.y.toFixed(1) },
      camp: world.camp
    };
  });

  await page.screenshot({ path: path.join(outDir, 'shot-02-finish.png') });
  await browser.close();

  console.log(JSON.stringify(result, null, 2));
  console.log('page errors:', errors.length ? errors : 'none');
  fs.writeFileSync(
    path.join(outDir, 'browser-mission-result.json'),
    JSON.stringify({ ...result, errors }, null, 2)
  );

  const ok =
    errors.length === 0 &&
    result.status === 'won' &&
    result.autoMode === true &&
    result.measurements.length === 3 &&
    result.points.every((p) => p.measured);
  if (!ok) process.exit(1);
  console.log('BROWSER MISSION PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
