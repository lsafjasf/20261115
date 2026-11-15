import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.APP_URL || 'http://localhost:8317/index.html';
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([true, name]); console.log('PASS ', name); }
  catch (err) { results.push([false, name]); console.log('FAIL ', name, '->', err.message); }
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server = null;
if (!process.env.APP_URL) {
  server = spawn('python3', ['-m', 'http.server', '8317'], { cwd: root });
  await new Promise((resolve) => setTimeout(resolve, 900));
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => {
  const c = document.querySelector('#view');
  return c && c.width > 0 && c.height > 0;
});
await test('页面无 JS 错误并渲染出 WebGL 画布', async () => {
  assert.strictEqual(errors.length, 0, errors.join(' | '));
  const gl = await page.evaluate(() => {
    const c = document.querySelector('#view');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  });
  assert.ok(gl);
});

await test('默认城市与两个 seed 均至少十栋建筑', async () => {
  const counts = await page.evaluate(async () => {
    const { generateCity } = await import('/src/citygen.mjs');
    const { SEEDS } = await import('/src/selftest.mjs');
    return SEEDS.map((s) => [s, generateCity(s).buildings.length]);
  });
  assert.strictEqual(counts.length, 3);
  for (const [seed, n] of counts) assert.ok(n >= 10, `${seed}=${n}`);
});

await test('启用 Y/Z 剖切后滑块与平面状态同步', async () => {
  await page.evaluate(() => {
    const rows = document.querySelectorAll('.axis-row');
    const y = rows[1], z = rows[2];
    y.querySelector('[data-role="enable"]').click();
    const slider = y.querySelector('[data-role="slider"]');
    slider.value = '12'; slider.dispatchEvent(new Event('input'));
    z.querySelector('[data-role="enable"]').click();
  });
  const snap = await page.evaluate(() => {
    // Re-read via DOM since app instance is module-scoped.
    const rows = [...document.querySelectorAll('.axis-row')];
    return rows.map((r) => ({
      axis: r.dataset.axis,
      enabled: r.querySelector('[data-role="enable"]').checked,
      value: Number(r.querySelector('[data-role="slider"]').value),
    }));
  });
  assert.deepStrictEqual(snap, [
    { axis: 'x', enabled: false, value: 0 },
    { axis: 'y', enabled: true, value: 12 },
    { axis: 'z', enabled: true, value: 0 },
  ]);
});

await test('点选建筑并修改楼层/层高后轮廓与剖面立即重算', async () => {
  const box = await page.evaluate(() => {
    const c = document.querySelector('#view').getBoundingClientRect();
    return { x: c.x + c.width * 0.5, y: c.y + c.height * 0.52 };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForSelector('#editPanel:not(.hidden)');
  const selectedId = await page.locator('#editId').innerText();
  const before = await page.evaluate((id) => {
    const app = window.__cityApp;
    const b = app.model.buildings.find((x) => x.id === id);
    return {
      id,
      height: b.floors * b.floorHeight,
      yPlane: app.clip.state.y.value,
      yEnabled: app.clip.state.y.enabled,
    };
  }, selectedId);
  const heightText = await page.locator('#editHeight').innerText();
  const beforeFloors = Number(await page.inputValue('#editFloors'));
  await page.selectOption('#editUsage', 'office');
  await page.fill('#editFloors', '12');
  await page.fill('#editFloorHeight', '4.0');
  await page.dispatchEvent('#editFloorHeight', 'input');
  const after = await page.locator('#editHeight').innerText();
  assert.notStrictEqual(heightText, after);
  assert.strictEqual(after, '48.0 m');
  const sync = await page.evaluate((id) => {
    const app = window.__cityApp;
    const b = app.model.buildings.find((x) => x.id === id);
    const group = app.buildingGroups.get(id);
    const topSlab = group.children.find((m) => m.geometry?.type === 'BoxGeometry' &&
      Math.abs(m.position.y - b.floors * b.floorHeight) < 0.01);
    const allCut = [...app.clip.materials].every((m) =>
      (m.clippingPlanes ?? []).length === app.clip.activePlanes().length);
    return {
      height: b.floors * b.floorHeight,
      floors: b.floors,
      hasTopSlabAtNewHeight: Boolean(topSlab),
      allMaterialsSharePlanes: allCut,
      yPlane: app.clip.state.y.value,
      yEnabled: app.clip.state.y.enabled,
      materials: app.clip.materials.size,
    };
  }, before.id);
  // Fixed global cutting plane; rebuilt building carries more floor/roof meshes.
  assert.strictEqual(sync.yPlane, before.yPlane);
  assert.strictEqual(sync.yEnabled, true);
  assert.strictEqual(selectedId, before.id);
  assert.strictEqual(sync.floors, 12);
  assert.ok(sync.floors > beforeFloors, `${beforeFloors} -> ${sync.floors}`);
  assert.ok(sync.height > before.height, `height ${before.height} -> ${sync.height}`);
  assert.strictEqual(sync.hasTopSlabAtNewHeight, true);
  assert.strictEqual(sync.allMaterialsSharePlanes, true);
  const status = await page.locator('#status').innerText();
  assert.ok(status.includes('剖面即时同步'), status);
});

await test('保存并重新载入后建筑数量与剖切状态保持一致', async () => {
  await page.click('#saveBtn');
  const saved = await page.evaluate(() => localStorage.getItem('lowpoly-city-scene-v1'));
  const parsed = JSON.parse(saved);
  assert.ok(parsed.model.buildings.length >= 10);
  assert.deepStrictEqual(parsed.clipping.find((c) => c.axis === 'y'),
    { axis: 'y', enabled: true, value: 12 });
  await page.click('#loadBtn');
  const yRow = page.locator('.axis-row[data-axis="y"]');
  await assert.doesNotReject(() => yRow.locator('[data-role="enable"]:checked').waitFor());
  assert.strictEqual(await yRow.locator('[data-role="slider"]').inputValue(), '12');
});

await test('截图时隐藏剖切手柄与辅助线并导出 PNG', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#shotBtn'),
  ]);
  const path = '/tmp/city-shot.png';
  await download.saveAs(path);
  const buf = fs.readFileSync(path);
  assert.strictEqual(buf.slice(1, 4).toString(), 'PNG');
  assert.ok(buf.length > 20000);
  const gizmo = await page.evaluate(() => {
    const app = window.__cityApp;
    return {
      groupVisible: app.gizmo.group.visible,
      guideVisible: app.gizmo.guide.visible,
      shot: app.lastShotState,
    };
  });
  assert.strictEqual(gizmo.groupVisible, true);
  assert.strictEqual(gizmo.guideVisible, false);
  assert.deepStrictEqual(gizmo.shot, { helperVisible: false, guideVisible: false });
});

await test('应用内自检全部通过', async () => {
  await page.click('#testBtn');
  await page.waitForSelector('#testResults:not(.hidden)');
  const text = await page.locator('#testResults').innerText();
  assert.ok(text.includes('6/6 通过'), text);
  assert.ok(!text.includes('FAIL'));
});

await browser.close();
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} e2e checks passed`);
if (server) server.kill();
process.exit(failed ? 1 : 0);
