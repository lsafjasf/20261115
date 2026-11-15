import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

let pass = 0;
const check = (name, cond) => {
  if (!cond) throw new Error(`断言失败: ${name}`);
  pass += 1;
  console.log(`✔ ${name}`);
};

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  check('页面加载无 JS 错误（初始）', errors.length === 0);

  // 1. 自检四项全部通过
  await page.click('#btnSelfTest');
  await page.waitForSelector('.test-result .pass');
  const resultText = await page.locator('#testResult').innerText();
  check('自检四项与总结全部通过', (resultText.match(/✔/g) || []).length === 5);

  // 2. 声源沿默认路径移动并实际穿越边界
  await page.click('#btnPlay');
  await page.waitForFunction(() => document.querySelector('#hudInside').textContent === '室内', null, { timeout: 5000 });
  check('声源从边界外进入房间', true);
  await page.waitForFunction(() => document.querySelector('#hudInside').textContent === '边界外', null, { timeout: 8000 });
  check('声源再次穿出房间边界', true);

  // 3. 距离随移动变化、增益与距离方向一致（近大远小）
  const samples = await page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push({
        d: parseFloat(document.querySelector('#hudDist').textContent),
        g: parseFloat(document.querySelector('#hudGain').textContent),
      });
      await new Promise((r) => setTimeout(r, 400));
    }
    return out;
  });
  const distanceChanged = new Set(samples.map((s) => s.d.toFixed(2))).size > 1;
  check('声源移动时距离持续变化', distanceChanged);
  const gainConsistent = samples.every((s) => {
    const expected = 1 / Math.max(s.d, 1);
    return Math.abs(s.g - expected) < 0.02;
  });
  check('HUD 增益与 inverse 距离模型一致', gainConsistent);

  // 4. 立体声模式下左/右方向与 pan 一致
  await page.check('input[name="mode"][value="stereo"]');
  await page.selectOption('#pathPreset', 'sweep');
  const db = (s) => (s === '−∞' ? -60 : parseFloat(s));
  await page.waitForFunction(
    () => document.querySelector('#hudPan').textContent.startsWith('L'),
    null, { timeout: 6000 },
  );
  await page.waitForFunction(() => {
    const l = document.querySelector('#meterLVal').textContent;
    const r = document.querySelector('#meterRVal').textContent;
    const dbv = (s) => (s === '−∞' ? -60 : parseFloat(s));
    return dbv(l) > dbv(r);
  }, null, { timeout: 6000 });
  const leftPan = await page.locator('#hudPan').innerText();
  const leftLevels = await page.evaluate(() => ({
    l: document.querySelector('#meterLVal').textContent,
    r: document.querySelector('#meterRVal').textContent,
  }));
  await page.waitForFunction(
    () => document.querySelector('#hudPan').textContent.startsWith('R'),
    null, { timeout: 10000 },
  );
  const rightPan = await page.locator('#hudPan').innerText();
  check(`横向扫描先 L 后 R（${leftPan} → ${rightPan}）`, leftPan.startsWith('L') && rightPan.startsWith('R'));
  await page.waitForFunction(() => {
    const l = document.querySelector('#meterLVal').textContent;
    const r = document.querySelector('#meterRVal').textContent;
    const dbv = (s) => (s === '−∞' ? -60 : parseFloat(s));
    return dbv(r) > dbv(l);
  }, null, { timeout: 6000 });
  const rightLevels = await page.evaluate(() => ({
    l: document.querySelector('#meterLVal').textContent,
    r: document.querySelector('#meterRVal').textContent,
  }));
  check(`电平表声道反转（L侧 L=${leftLevels.l}>R=${leftLevels.r}；R侧 R=${rightLevels.r}>L=${rightLevels.l}）`,
    db(leftLevels.l) > db(leftLevels.r) && db(rightLevels.r) > db(rightLevels.l));

  // 5. 双耳 HRTF 模式切换无错误，且实际产生左右电平
  await page.check('input[name="mode"][value="binaural"]');
  await page.waitForTimeout(1200);
  const levels = await page.evaluate(() => ({
    l: document.querySelector('#meterLVal').textContent,
    r: document.querySelector('#meterRVal').textContent,
  }));
  check('双耳模式左右电平表有读数', levels.l !== '−∞' || levels.r !== '−∞');

  // 6. 调房间参数后 RT60 联动
  await page.fill('#absorption', '0.1');
  await page.dispatchEvent('#absorption', 'input');
  const rtText = await page.locator('#rtInline').innerText();
  const rt = parseFloat(rtText);
  check('吸声系数降低后 RT60 增大（>1s）', rt > 1);

  // 7. localStorage 保存/加载
  await page.fill('#sceneName', 'e2e场景');
  await page.click('#btnSave');
  const saved = await page.locator('#savedList option').first().innerText();
  check('场景出现在保存列表', saved === 'e2e场景');
  const stored = await page.evaluate(() => localStorage.getItem('room-acoustics-scenes-v1'));
  const parsed = JSON.parse(stored);
  check('localStorage 中含房间/路径/监听点字段',
    !!parsed['e2e场景'].room && Array.isArray(parsed['e2e场景'].pathPoints)
    && Array.isArray(parsed['e2e场景'].listener.position));

  // 8. 导出 JSON 的结构与内容
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnExport'),
  ]);
  const tmpPath = join(import.meta.dirname, `dl-${Date.now()}.json`);
  await download.saveAs(tmpPath);
  const exported = JSON.parse(await readFile(tmpPath, 'utf8'));
  await rm(tmpPath);
  check('导出 JSON 含房间、路径、监听点与 RT60',
    !!exported.room && Array.isArray(exported.pathPoints)
    && Array.isArray(exported.listener.position) && typeof exported.rt60 === 'number'
    && download.suggestedFilename().endsWith('.json'));

  check('全程无控制台/页面错误', errors.length === 0);
  console.log(`\n${pass} 项浏览器端到端断言全部通过`);
} catch (err) {
  console.error(err);
  console.error('收集到的页面错误:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
