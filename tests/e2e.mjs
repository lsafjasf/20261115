import { chromium } from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const ART = path.join(ROOT, 'artifacts');
fs.mkdirSync(ART, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.json': 'application/json',
};
const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console.error:', m.text());
});
page.on('pageerror', (e) => {
  throw e;
});

await page.goto(`${base}/index.html`);
await page.waitForFunction(() => window.__app !== undefined);
await page.evaluate(async () => {
  if (document.fonts && document.fonts.load) {
    await Promise.all([
      document.fonts.load('13px "Noto Sans SC"', '高密度技术图局部放大镜采样模式最近邻平滑倍率观察点固定导出对比清除跳转圆形区域中心'),
      document.fonts.load('600 13px "Noto Sans SC"', '高密度技术图局部放大镜采样模式最近邻平滑倍率观察点固定导出对比清除跳转圆形区域中心'),
    ]);
    await document.fonts.ready;
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
});

const results = [];
const check = (name, fn) => {
  fn();
  results.push(name);
};

// Pick a source point rich in thin lines and decimal text (annotation block).
const target = { x: 260.3, y: 775.8 };

await page.evaluate((t) => window.__app.setCenter(t.x, t.y), target);
await page.evaluate(() => window.__app.setZoom(8));

// 1. Nearest lens pixels equal the corresponding source pixels 1:1.
const nearestMatch = await page.evaluate(() => {
  const { sourceData, state, renderLens } = window.__app;
  const size = 320;
  // Re-render without the center crosshair overlay for the exactness check.
  const frame = renderLens(sourceData, size, {
    center: state.center,
    zoom: state.zoom,
    mode: 'nearest',
  }).data;
  const r = size / 2;
  const zoom = state.zoom;
  let ok = true;
  let checked = 0;
  for (let py = 0; py < size; py += 4) {
    for (let px = 0; px < size; px += 4) {
      const dx = px + 0.5 - r;
      const dy = py + 0.5 - r;
      if (Math.sqrt(dx * dx + dy * dy) > r - 2) continue;
      const sx = Math.round(state.center.x + dx / zoom);
      const sy = Math.round(state.center.y + dy / zoom);
      const si = (sy * sourceData.width + sx) * 4;
      const di = (py * size + px) * 4;
      if (frame[di] !== sourceData.data[si] ||
          frame[di + 1] !== sourceData.data[si + 1] ||
          frame[di + 2] !== sourceData.data[si + 2]) {
        ok = false;
      }
      checked++;
    }
  }
  return { ok, checked };
});
check('nearest lens pixels match source 1:1', () => assert.ok(nearestMatch.ok));
console.log('nearest pixels verified:', nearestMatch.checked);

// 2. Circle mask: corner fully transparent.
const cornerAlpha = await page.evaluate(() => {
  const { lens } = window.__app;
  return lens.getContext('2d').getImageData(2, 2, 1, 1).data[3];
});
check('lens corners are transparent (circular mask)', () => assert.equal(cornerAlpha, 0));

// 3. Smooth mode differs from nearest near edges of thin lines.
await page.evaluate(() => window.__app.setMode('smooth'));
const smoothFrame = await page.evaluate(() => {
  const { lens } = window.__app;
  return Array.from(lens.getContext('2d').getImageData(0, 0, lens.width, lens.height).data);
});
await page.evaluate(() => window.__app.setMode('nearest'));
const nearestFrame = await page.evaluate(() => {
  const { lens } = window.__app;
  return Array.from(lens.getContext('2d').getImageData(0, 0, lens.width, lens.height).data);
});
let differing = 0;
for (let i = 0; i < smoothFrame.length; i += 4) {
  if (Math.abs(smoothFrame[i] - nearestFrame[i]) > 4 ||
      Math.abs(smoothFrame[i + 1] - nearestFrame[i + 1]) > 4) {
    differing++;
  }
}
check('bilinear differs from nearest around edges', () => assert.ok(differing > 50, `only ${differing} diff pixels`));
console.log('pixels differing between modes:', differing);

// 4. Zoom keeps the same source point at lens center (crosshair excluded).
const centerPixelAtZoom = (zoom) => page.evaluate((z) => {
  const { sourceData, state, renderLens } = window.__app;
  const size = 320;
  const d = renderLens(sourceData, size, {
    center: state.center, zoom: z, mode: 'nearest',
  }).data;
  const c = size / 2;
  const i = (c * size + c) * 4;
  return [d[i], d[i + 1], d[i + 2]];
}, zoom);
const z4 = await centerPixelAtZoom(4);
const z16 = await centerPixelAtZoom(16);
check('center pixel stays fixed across zoom 4x -> 16x', () => assert.deepEqual(z4, z16));

// 5. At 16x nearest shows blocky source pixels (large uniform runs).
const blockiness = await page.evaluate(() => {
  const { sourceData, state, renderLens } = window.__app;
  const size = 320;
  const d = renderLens(sourceData, size, {
    center: state.center, zoom: 16, mode: 'nearest',
  }).data;
  let same = 0;
  let total = 0;
  for (let py = 40; py < 120; py++) {
    for (let px = 40; px < 119; px++) {
      const a = (py * size + px) * 4;
      const b = (py * size + px + 1) * 4;
      if (d[a] === d[b] && d[a + 1] === d[b + 1] && d[a + 2] === d[b + 2]) same++;
      total++;
    }
  }
  return same / total;
});
check('nearest at 16x shows enlarged source pixels (blocky)', () => assert.ok(blockiness > 0.6, `ratio ${blockiness}`));
console.log('nearest identical-neighbor ratio at 16x:', blockiness.toFixed(3));

// 6. Pins and comparison export.
await page.evaluate(() => {
  window.__app.setZoom(8);
  window.__app.setCenter(260.3, 775.8);
  window.__app.setPin('A');
  window.__app.setCenter(1180.4, 620.8);
  window.__app.setPin('B');
});
const exportInfo = await page.evaluate(() => {
  const c = window.__app.exportImage();
  return { width: c.width, height: c.height, url: c.toDataURL('image/png') };
});
check('exported comparison image is 2x2 grid', () => {
  assert.equal(exportInfo.width, 24 * 3 + 380 * 2);
  assert.equal(exportInfo.height, 24 * 2 + 62 + 380 * 2);
});
fs.writeFileSync(
  path.join(ART, 'comparison.png'),
  Buffer.from(exportInfo.url.split(',')[1], 'base64'),
);

// 7. Visual snapshots for manual comparison.
await page.evaluate(async () => {
  await document.fonts.load('13px "Noto Sans SC"', '高密度技术图局部放大镜采样模式最近邻平滑双线性倍率观察点固定导出对比圆形区域中心');
  await document.fonts.load('600 13px "Noto Sans SC"', '高密度技术图局部放大镜采样模式最近邻平滑双线性倍率观察点固定导出对比圆形区域中心');
  await document.fonts.ready;
});
await page.waitForTimeout(400);
await page.evaluate(() => {
  window.__app.setCenter(182.0, 800.0); // decimal annotation text + thin lines
  window.__app.setZoom(12);
  window.__app.setMode('nearest');
});
await page.screenshot({ path: path.join(ART, 'live-nearest.png') });
await page.evaluate(() => window.__app.setMode('smooth'));
await page.screenshot({ path: path.join(ART, 'live-smooth.png') });
const side = await page.evaluate(() => {
  const c = window.__app.exportSideBySide();
  return c.toDataURL('image/png');
});
fs.writeFileSync(
  path.join(ART, 'side-by-side.png'),
  Buffer.from(side.split(',')[1], 'base64'),
);
await page.evaluate(() => window.__app.setMode('nearest'));
await page.screenshot({ path: path.join(ART, 'overview.png') });

await browser.close();
await new Promise((resolve) => server.close(resolve));
console.log('\nE2E checks passed:');
results.forEach((n) => console.log('  ✔', n));
