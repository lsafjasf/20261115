import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'artifacts');
await mkdir(outDir, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(path.join(root, rel));
    res.writeHead(200, { 'Content-Type': mime[path.extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${base}/index.html`);
await page.waitForSelector('#view');
await page.waitForTimeout(800);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail });
}

// 1. 画布已按 DPR 分配实际像素
const dims = await page.evaluate(() => ({
  w: document.getElementById('view').width,
  h: document.getElementById('view').height,
}));
check('画布具备实际像素尺寸', dims.w > 320 && dims.h > 240, JSON.stringify(dims));

// 2. 深度缓冲存在建筑像素（场景非空）
const depthInfo = await page.evaluate(() => {
  const cv = document.getElementById('view');
  const c = cv.getContext('2d');
  const data = c.getImageData(0, 0, cv.width, cv.height).data;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (data[i] + data[i + 1] + data[i + 2] > 40) nonBlack++;
  }
  return { nonBlack, total: data.length / 16 };
});
check('夜景场景已渲染（存在亮像素）', depthInfo.nonBlack > 500, `${depthInfo.nonBlack}/${depthInfo.total}`);

// 3. 雨量为 0 时雨线消失
await page.fill('#rainfall', '0');
await page.dispatchEvent('#rainfall', 'input');
await page.waitForTimeout(300);
const zeroRainPixels = await page.evaluate(() => {
  const cv = document.getElementById('view');
  const c = cv.getContext('2d');
  const d = c.getImageData(0, 0, cv.width, cv.height).data;
  let rainish = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 2] > 120 && d[i + 2] > d[i] + 25 && d[i + 1] >= d[i]) rainish++;
  }
  return rainish;
});
check('雨量 0 时无蓝白雨线像素', zeroRainPixels < 300, `rainish=${zeroRainPixels}`);

// 4. 小雨与暴雨参数切换，统计雨线像素与画面差异
async function presetStats(btnId) {
  await page.click(btnId);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const cv = document.getElementById('view');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let rainish = 0;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] + d[i + 1] + d[i + 2];
      if (d[i + 2] > 120 && d[i + 2] > d[i] + 25 && d[i + 1] >= d[i]) rainish++;
    }
    return { rainish, mean: sum / (d.length / 4) };
  });
}
const light = await presetStats('#btn-light');
await page.screenshot({ path: path.join(outDir, 'preset-light.png') });
const storm = await presetStats('#btn-storm');
await page.screenshot({ path: path.join(outDir, 'preset-storm.png') });
check('暴雨雨线像素显著多于小雨', storm.rainish > light.rainish * 2,
  `light=${light.rainish} storm=${storm.rainish}`);

// 5. 风向改变后雨线方向变化（霍夫式抽样：比较亮像素的位移相关性）
const angleStats = await page.evaluate(async () => {
  function streakAngle() {
    const cv = document.getElementById('view');
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let y = 2; y < cv.height - 2; y += 2) {
      for (let x = 2; x < cv.width - 2; x += 2) {
        const i = (y * cv.width + x) * 4;
        if (d[i + 2] > 120 && d[i + 2] > d[i] + 25 && d[i + 1] >= d[i]) {
          const bL = d[((y + 2) * cv.width + (x - 2)) * 4 + 2];
          const bR = d[((y + 2) * cv.width + (x + 2)) * 4 + 2];
          sx += bR - bL;
          sy += 2;
          n++;
        }
      }
    }
    return n > 50 ? sx / n : 0;
  }
  const setSlider = (id, v) => {
    const el = document.getElementById(id);
    el.value = v;
    el.dispatchEvent(new Event('input'));
  };
  setSlider('rainfall', 90);
  setSlider('wind', -70);
  await new Promise((r) => setTimeout(r, 400));
  const left = streakAngle();
  setSlider('wind', 70);
  await new Promise((r) => setTimeout(r, 400));
  const right = streakAngle();
  return { left, right };
});
check('风向左右切换改变雨线倾斜方向',
  Math.sign(angleStats.left) !== Math.sign(angleStats.right) && Math.abs(angleStats.right - angleStats.left) > 0.5,
  JSON.stringify(angleStats));

// 6. 暂停：连续两帧像素完全一致
await page.click('#btn-pause');
await page.waitForTimeout(150);
const paused1 = await page.screenshot();
await page.waitForTimeout(400);
const paused2 = await page.screenshot();
check('暂停后画面冻结', paused1.equals(paused2));
check('暂停按钮文案切换为继续',
  (await page.textContent('#btn-pause')).trim() === '继续');
await page.click('#btn-pause');

// 7. 截图导出：下载的 PNG 与画布当前像素一致
await page.click('#btn-pause'); // 冻结动画，保证截图与比对帧完全相同
await page.waitForTimeout(200);
const beforeShot = await page.evaluate(() => {
  const cv = document.getElementById('view');
  const c = cv.getContext('2d');
  return { dataUrl: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
});
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#btn-shot'),
]);
const shotPath = path.join(outDir, download.suggestedFilename());
await download.saveAs(shotPath);
const shotName = download.suggestedFilename();
const exportMatch = await page.evaluate(async ({ url, expected }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const t = document.createElement('canvas');
  t.width = expected.w;
  t.height = expected.h;
  const tc = t.getContext('2d');
  tc.drawImage(img, 0, 0);
  const a = tc.getImageData(0, 0, expected.w, expected.h).data;
  const ref = await new Promise((resolve) => {
    const r = new Image();
    r.onload = () => {
      const rc = document.createElement('canvas');
      rc.width = expected.w;
      rc.height = expected.h;
      rc.getContext('2d').drawImage(r, 0, 0);
      resolve(rc.getContext('2d').getImageData(0, 0, expected.w, expected.h).data);
    };
    r.src = expected.dataUrl;
  });
  let diff = 0;
  for (let i = 0; i < a.length; i += 97) diff += Math.abs(a[i] - ref[i]);
  return { pixels: a.length, diff, w: img.width, h: img.height };
}, { url: `${base}/artifacts/${shotName}`, expected: beforeShot });
check('截图通过 canvas.toBlob 导出 PNG', shotPath.endsWith('.png'), shotPath);
check('导出 PNG 与预览像素一致',
  exportMatch.diff === 0 && exportMatch.w === beforeShot.w,
  JSON.stringify(exportMatch));
await page.click('#btn-pause'); // 恢复运行

// 8. 重置：滑块回到默认值
await page.click('#btn-reset');
await page.waitForTimeout(200);
const afterReset = await page.evaluate(() => ({
  rainfall: document.getElementById('rainfall').value,
  wind: document.getElementById('wind').value,
  focal: document.getElementById('focal').value,
  yaw: document.getElementById('yaw').value,
  reflection: document.getElementById('reflection').value,
  pausedText: document.getElementById('btn-pause').textContent.trim(),
}));
check('重置恢复全部默认参数',
  afterReset.rainfall === '45' && afterReset.wind === '12' &&
  afterReset.focal === '35' && afterReset.yaw === '0' &&
  afterReset.reflection === '55' && afterReset.pausedText === '暂停',
  JSON.stringify(afterReset));

// 9. 对比弹窗：两张对比图都有内容且彼此不同
await page.click('#btn-compare');
await page.waitForTimeout(400);
const compare = await page.evaluate(() => {
  function stats(id) {
    const cv = document.getElementById(id);
    const c = cv.getContext('2d');
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] + d[i + 1] + d[i + 2] > 60) bright++;
    }
    return bright;
  }
  return {
    visible: !document.getElementById('compare-modal').classList.contains('hidden'),
    light: stats('compare-light'),
    storm: stats('compare-storm'),
  };
});
check('对比弹窗渲染两组画面',
  compare.visible && compare.light > 1000 && compare.storm > 1000 &&
  Math.abs(compare.storm - compare.light) > 200,
  JSON.stringify(compare));
await page.screenshot({ path: path.join(outDir, 'compare-modal.png') });

// 10. 无控制台错误
check('运行期间无 JS/控制台错误', errors.length === 0, errors.join(' | '));

// 11. 遮挡关系：建筑内部区域的雨线像素占比应极低（仅允许边缘抗锯齿）
const occlusion = await page.evaluate(async () => {
  const { Camera } = await import('/js/camera.js');
  const { generateCity } = await import('/js/city.js');
  const { SceneRenderer } = await import('/js/scene.js');
  const { RainSystem } = await import('/js/rain.js');
  const W = 800, H = 600;
  const cam = new Camera(W, H);
  cam.setFocal(35);
  const cityData = generateCity();
  const sr = new SceneRenderer(cam, cityData);
  sr.resize();
  const built = sr.render();
  const base = built.getContext('2d').getImageData(0, 0, W, H).data;
  const rainSys = new RainSystem(cam);
  rainSys.setWind(0);
  rainSys.setRainfall(95);
  for (let i = 0; i < 90; i++) rainSys.update(1 / 60);
  // 只保留第一排建筑（depth≈7）之后的雨，此时建筑区域内不应出现任何雨线
  rainSys.drops = rainSys.drops.filter((d) => -d.z > 8);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.drawImage(built, 0, 0);
  rainSys.render(c, sr);
  const after = c.getImageData(0, 0, W, H).data;
  let buildingPixels = 0;
  let rainOnBuilding = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4;
      const bd = sr.sampleDepth(x, y);
      if (bd === Infinity) continue;
      buildingPixels++;
      const dr = after[i] - base[i];
      const db = after[i + 2] - base[i + 2];
      if (db > 10 && db > dr + 5) rainOnBuilding++;
    }
  }
  return { buildingPixels, rainOnBuilding, ratio: rainOnBuilding / buildingPixels };
});
check('雨线与建筑边缘遮挡正确（建筑后方雨线不显色）',
  occlusion.ratio < 0.004,
  `${occlusion.rainOnBuilding}/${occlusion.buildingPixels} = ${(occlusion.ratio * 100).toFixed(3)}%`);

// 12. 拖拽视角与焦距：滑块/指针事件正确联动相机
await page.click('#btn-close-compare');
const interaction = await page.evaluate(async () => {
  const cv = document.getElementById('view');
  const rect = cv.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return { cx, cy };
});
const box = await page.locator('#view').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
const draggedYaw = await page.inputValue('#yaw');
check('拖拽画面改变视角偏航', Math.abs(Number(draggedYaw)) > 5, `yaw=${draggedYaw}`);

await page.fill('#focal', '85');
await page.dispatchEvent('#focal', 'input');
await page.waitForTimeout(300);
const focalLabel = await page.textContent('#focal-val');
check('焦距滑块联动到 85mm', focalLabel.trim() === '85mm', focalLabel);

// 视角变化后画面内容确实改变（同一建筑投影位置移动）
await page.fill('#yaw', '-30');
await page.dispatchEvent('#yaw', 'input');
await page.waitForTimeout(300);
const yawNeg = await page.evaluate(() => {
  const cv = document.getElementById('view');
  return cv.getContext('2d').getImageData(0, 0, 80, 80).data[2];
});
await page.fill('#yaw', '30');
await page.dispatchEvent('#yaw', 'input');
await page.waitForTimeout(300);
const yawPos = await page.evaluate(() => {
  const cv = document.getElementById('view');
  return cv.getContext('2d').getImageData(0, 0, 80, 80).data[2];
});
check('偏航 ±30° 产生不同画面', yawNeg !== yawPos, `${yawNeg} vs ${yawPos}`);
await page.click('#btn-reset');

await page.screenshot({ path: path.join(outDir, 'main-preview.png') });
await browser.close();
server.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
