/* 自动化验证：
 * 1. 同一模拟偏差（90ms）做两次测试，验证补偿方向正确；
 * 2. 保存档案后刷新页面，验证档案恢复；
 * 3. 验证重置与报告导出。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 自动定位 Playwright 浏览器缓存（未显式设置时）
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  const candidates = [
    path.join(os.homedir(), '.cache/ms-playwright'),
    '/home/hj/.cache/ms-playwright',
  ];
  const found = candidates.find((d) => existsSync(path.join(d, 'chromium_headless_shell-1255'))
    || existsSync(path.join(d, 'chromium-1255')));
  if (found) process.env.PLAYWRIGHT_BROWSERS_PATH = found;
}

const { chromium } = await import('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const BIAS_MS = 90;
const TOL = 12;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function serve() {
  const server = http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

async function runMeasurement(page, tag) {
  await page.click('#btnStart');
  await page.waitForFunction(
    () => document.getElementById('runState').textContent.includes('已完成'),
    null,
    { timeout: 20000 }
  );
  await page.click('#btnAutoListen');
  await page.screenshot({ path: path.join(ARTIFACTS, `verify-${tag}-marked.png`) });
  return page.evaluate(() => window.__calib.estimate());
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('页面错误:', e.message));
  await page.goto(`http://127.0.0.1:${port}/?simLatency=${BIAS_MS}`);

  // ---- 第一次测试（未补偿）----
  const est1 = await runMeasurement(page, 'run1');
  check('第一次估计幅度≈偏差', Math.abs(est1.mean - BIAS_MS) <= TOL,
    `mean=${est1.mean.toFixed(1)}ms, 期望≈${BIAS_MS}ms`);
  check('第一次估计方向为正(声音晚于闪烁)', est1.mean > BIAS_MS - TOL,
    `mean=${est1.mean.toFixed(1)}ms`);

  await page.click('#btnApplyEstimate');
  const comp1 = await page.evaluate(() => window.__calib.app.compensationMs);
  check('补偿值已应用', Math.abs(comp1 - BIAS_MS) <= TOL, `compensation=${comp1}ms`);

  // ---- 第二次测试（同一偏差，已补偿）----
  const est2 = await runMeasurement(page, 'run2');
  check('补偿后残余误差≈0（方向正确）', Math.abs(est2.mean) <= TOL,
    `residual=${est2.mean.toFixed(1)}ms（方向错误时约为 ${2 * BIAS_MS}ms）`);

  // ---- 保存档案并刷新恢复 ----
  await page.fill('#inpProfileName', '测试设备A');
  await page.click('#btnSaveProfile');
  await page.reload();
  await page.waitForFunction(() => window.__calib && window.__calib.app);
  const restored = await page.evaluate(() => window.__calib.app.compensationMs);
  check('刷新后恢复档案补偿', Math.abs(restored - comp1) <= 0.11,
    `restored=${restored}ms, saved=${comp1}ms`);
  const activeName = await page.evaluate(() => {
    const sel = document.getElementById('selProfiles');
    return sel.options[sel.selectedIndex]?.textContent || '';
  });
  check('刷新后档案为激活状态', activeName.includes('测试设备A'), activeName);
  await page.screenshot({ path: path.join(ARTIFACTS, 'verify-restored.png') });

  // ---- 导出报告 ----
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnExport'),
  ]);
  const reportPath = path.join(ARTIFACTS, 'calibration-report.json');
  await download.saveAs(reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  check('报告包含补偿与档案', report.activeProfile?.name === '测试设备A'
    && Math.abs(report.currentCompensationMs - comp1) <= 0.11,
    `compensation=${report.currentCompensationMs}ms, runs=${report.sessionRuns.length}`);

  // ---- 重置 ----
  await page.click('#btnReset');
  const afterReset = await page.evaluate(() => window.__calib.app.compensationMs);
  check('重置后补偿归零', afterReset === 0, `compensation=${afterReset}ms`);

  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
await writeFile(
  path.join(ARTIFACTS, 'verify-results.json'),
  JSON.stringify({ biasMs: BIAS_MS, toleranceMs: TOL, results }, null, 2)
);
console.log(failed.length ? `\n${failed.length} 项失败` : '\n全部通过');
process.exit(failed.length ? 1 : 0);
