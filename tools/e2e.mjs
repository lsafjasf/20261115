// Real-browser verification with Playwright. Exercises zoom anchoring,
// threshold hiding, JSON save/reload, and captures screenshots into artifacts/.
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baseURL = process.env.BASE_URL || 'http://localhost:4321/';
const results = [];

function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.removeItem('star-canvas-project-v1'));
page.on('pageerror', (error) => check('no page errors', false, error.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') check('no console errors', false, msg.text());
});

await page.goto(baseURL);
await page.waitForFunction(() => window.__starApp?.state?.stars?.length > 0);

// Full-view screenshot first, with both demo constellations in frame and a
// threshold inside both visible bands.
await page.locator('#magnitude').fill('5');
await page.locator('#resetView').click();
await page.waitForTimeout(50);
await page.screenshot({ path: join(root, 'artifacts', '00-overview.png') });

const initial = await page.evaluate(() => {
  const { state } = window.__starApp;
  return {
    starCount: state.stars.length,
    constellationCount: state.constellations.length,
    names: state.constellations.map((c) => c.name),
    edges: state.constellations.map((c) => c.edges.length),
    camera: { ...state.camera },
  };
});
check('two constellations created on load', initial.constellationCount === 2,
  initial.names.join(', '));
check('both constellations have connected lines',
  initial.edges[0] >= 6 && initial.edges[1] === 3, initial.edges.join('/'));

// Zoom with the wheel over the canvas centre; the world point under the
// cursor must stay fixed so lines never jump to wrong stars.
const canvas = page.locator('#sky');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.locator('#resetView').click();

const beforeWorld = await page.evaluate(({ x, y }) =>
  window.__starApp.state.camera.screenToWorld(x, y), { x: box.width / 2, y: box.height / 2 });
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(100);
const afterWorld = await page.evaluate(({ x, y }) =>
  window.__starApp.state.camera.screenToWorld(x, y), { x: box.width / 2, y: box.height / 2 });
const scaleAfterZoom = await page.evaluate(() => window.__starApp.state.camera.scale);
check('wheel zoom increases scale', scaleAfterZoom > 1, `scale=${scaleAfterZoom.toFixed(3)}`);
check('zoom keeps world point under cursor fixed',
  Math.abs(afterWorld.x - beforeWorld.x) < 1e-9 &&
  Math.abs(afterWorld.y - beforeWorld.y) < 1e-9,
  `dx=${(afterWorld.x - beforeWorld.x).toExponential(2)}`);

// Pan by dragging and confirm the centre now maps to a different world point.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 120, cy - 80, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(100);
const pannedWorld = await page.evaluate(({ x, y }) =>
  window.__starApp.state.camera.screenToWorld(x, y), { x: box.width / 2, y: box.height / 2 });
check('drag pans the camera',
  Math.hypot(pannedWorld.x - afterWorld.x, pannedWorld.y - afterWorld.y) > 1);

await page.screenshot({ path: join(root, 'artifacts', '01-zoomed-panned.png') });

// Threshold change hides faint stars but preserves every annotation.
const annotationSnapshot = await page.evaluate(() =>
  JSON.stringify(window.__starApp.state.constellations.map((c) =>
    ({ id: c.id, starIds: c.starIds, edges: c.edges, name: c.name }))));
const visibleAt6 = await page.evaluate(() =>
  window.__starApp.state.stars.filter((s) => s.magnitude <= 6).length);
await page.locator('#magnitude').fill('2');
await page.waitForTimeout(50);
const visibleAt2 = await page.evaluate(() =>
  window.__starApp.state.stars.filter((s) => s.magnitude <= 2).length);
const annotationAfter = await page.evaluate(() =>
  JSON.stringify(window.__starApp.state.constellations.map((c) =>
    ({ id: c.id, starIds: c.starIds, edges: c.edges, name: c.name }))));
check('lower threshold hides faint stars', visibleAt2 < visibleAt6,
  `${visibleAt6} -> ${visibleAt2} stars`);
check('annotations survive threshold change intact', annotationSnapshot === annotationAfter);
await page.screenshot({ path: join(root, 'artifacts', '02-threshold-2.png') });

// Rename and range edit through the panel.
await page.locator('#magnitude').fill('5');
await page.locator('#constellationList li').first().click();
await page.locator('#editName').fill('北斗（已编辑）');
await page.locator('#editMagMin').fill('1');
await page.locator('#editMagMax').fill('6');
await page.waitForTimeout(50);

// Save to JSON through the app's own serializer.
const savedJSON = await page.evaluate(() => window.__starApp.serialize());
const saved = JSON.parse(savedJSON);
check('saved JSON has format version and two constellations',
  saved.formatVersion === 1 && saved.constellations.length === 2);
check('saved JSON carries edited name and range',
  saved.constellations[0].name === '北斗（已编辑）' &&
  saved.constellations[0].magRange[0] === 1 &&
  saved.constellations[0].magRange[1] === 6);
await writeFile(join(root, 'artifacts', 'saved-project.json'), savedJSON);

// Reload into a fresh page context: stars regenerate from seed only, then the
// project restores names, lines, range and camera.
const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page2.addInitScript(() => localStorage.removeItem('star-canvas-project-v1'));
const pageErrors = [];
page2.on('pageerror', (error) => pageErrors.push(error.message));
await page2.goto(baseURL);
await page2.waitForFunction(() => window.__starApp?.state?.stars?.length > 0);
await page2.evaluate((json) => window.__starApp.loadFromText(json, '验证工程'), savedJSON);
const reloaded = await page2.evaluate(() => {
  const { state } = window.__starApp;
  return {
    names: state.constellations.map((c) => c.name),
    edges: state.constellations.map((c) => c.edges.length),
    ranges: state.constellations.map((c) => c.magRange),
    camera: { scale: state.camera.scale, x: state.camera.x, y: state.camera.y },
    threshold: state.magnitudeThreshold,
  };
});
check('reload restores edited name', reloaded.names[0] === '北斗（已编辑）');
check('reload restores all edges',
  reloaded.edges[0] === saved.constellations[0].edges.length &&
  reloaded.edges[1] === saved.constellations[1].edges.length,
  reloaded.edges.join('/'));
check('reload restores visible range and camera',
  reloaded.ranges[0][0] === 1 && reloaded.ranges[0][1] === 6 &&
  Math.abs(reloaded.camera.scale - saved.camera.scale) < 1e-12);
check('reload has no page errors', pageErrors.length === 0, pageErrors.join('; '));
await page2.screenshot({ path: join(root, 'artifacts', '03-reloaded.png') });

await mkdir(join(root, 'artifacts'), { recursive: true });
await writeFile(join(root, 'artifacts', 'e2e-results.json'),
  JSON.stringify(results, null, 2));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
