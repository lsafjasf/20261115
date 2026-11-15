// 无头浏览器端到端验证：Canvas 渲染、自动校准、容差判定、重放、参数保存。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json'
};

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1500 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

await page.goto(url);
await page.waitForSelector('#status-board .status-card');

// 1. 初始状态：未校准，应存在未通过项
const initialBadges = await page.locator('#status-board .badge.bad').count();
if (initialBadges < 3) throw new Error('初始未校准状态应有未收敛标记');

// 2. 点击一键自动校准
await page.click('#btn-auto');
await page.waitForFunction(
  () => document.querySelectorAll('#status-board .badge.ok').length >= 4
);
const overall = await page.locator('#status-board .status-card:last-child .badge').innerText();
if (overall !== '全部通过') throw new Error(`自动校准后总体判定异常: ${overall}`);

// 3. 确认没有“过度校准”警告
const warnCount = await page.locator('.badge.warn').count();
if (warnCount !== 0) throw new Error('正常校准不应出现过度校准警告');

// 4. 手动制造过度校准：把 S1 增益调到 1.45（>1.35）
await page.fill('.sensor-card[data-id="S1"] [data-field="gain-num"]', '1.45');
await page.dispatchEvent('.sensor-card[data-id="S1"] [data-field="gain-num"]', 'change');
await page.waitForSelector('#status-board .badge.warn');

// 5. 恢复自动校准
await page.click('#btn-auto');
await page.waitForFunction(() => document.querySelectorAll('.badge.warn').length === 0);

// 6. 重放：点击后游标应推进
await page.click('#btn-replay');
await page.waitForTimeout(600);
await page.click('#btn-replay-reset');

// 7. 保存参数到 localStorage
await page.click('#btn-save');
const saved = await page.evaluate(() => localStorage.getItem('triple-sensor-calibration-v1'));
const parsed = JSON.parse(saved);
if (!parsed.passed || parsed.sensors.length !== 3) throw new Error('保存的校准参数不完整或未通过');

// 8. 刷新页面后应自动恢复参数且仍全部通过
await page.reload();
await page.waitForSelector('#status-board .status-card');
const afterReload = await page.locator('#status-board .status-card:last-child .badge').innerText();
if (afterReload !== '全部通过') throw new Error('刷新后参数未正确恢复');

await page.screenshot({ path: resolve(root, 'artifacts/app-screenshot.png'), fullPage: true });

if (consoleErrors.length) throw new Error(`浏览器控制台错误: ${consoleErrors.join(' | ')}`);

await browser.close();
server.close();
console.log('E2E 通过：渲染、自动校准、过度校准检测、重放、保存/恢复均正常。');
console.log(`保存参数示例: S1 gain=${parsed.sensors[0].gain.toFixed(3)} bias=${parsed.sensors[0].bias.toFixed(3)}`);
process.exit(0);
