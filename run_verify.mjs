// run_verify.mjs — 自动化:在浏览器中实时导出 15s WebM + 工程 JSON,
// 然后重新播放并运行全部验证,报告写入 artifacts/verification-report.json。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8777;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webm': 'video/webm' };

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(ROOT, decodeURIComponent(url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

fs.mkdirSync('artifacts', { recursive: true });

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

try {
  // 1) 打开演播台,实时导出 15 秒节目
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(120000);
  page.on('console', (m) => console.log('[studio]', m.text()));
  page.on('pageerror', (e) => console.log('[studio ERROR]', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__project && window.__exportAndGetBase64);

  console.log('开始实时导出 15 秒节目(含音频节拍)…');
  const [b64, projectJson] = await Promise.all([
    page.evaluate(() => window.__exportAndGetBase64()),
    page.evaluate(() => JSON.stringify(window.__project, null, 2)),
  ]);
  fs.writeFileSync('artifacts/program-15s.webm', Buffer.from(b64, 'base64'));
  fs.writeFileSync('artifacts/project.json', projectJson);
  const mb = (fs.statSync('artifacts/program-15s.webm').size / 1024 / 1024).toFixed(2);
  console.log(`导出完成: artifacts/program-15s.webm (${mb} MB), artifacts/project.json`);
  await page.close();

  // 2) 重新播放并验证
  const vpage = await browser.newPage();
  vpage.on('console', (m) => console.log('[verify]', m.text()));
  vpage.on('pageerror', (e) => console.log('[verify ERROR]', e.message));
  await vpage.goto(`http://127.0.0.1:${PORT}/verify.html`);
  await vpage.waitForFunction(() => window.__report, null, { timeout: 120000 });
  const report = await vpage.evaluate(() => window.__report);
  fs.writeFileSync('artifacts/verification-report.json', JSON.stringify(report, null, 2));

  const failed = (report.checks || []).filter((c) => !c.ok);
  console.log('\n===== 验证结果 =====');
  for (const c of report.checks || []) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.detail)}`);
  }
  if (report.error) console.log('ERROR:', report.error);
  console.log(`\n总计 ${(report.checks || []).length - failed.length}/${(report.checks || []).length} 通过`);
  console.log('报告: artifacts/verification-report.json');
  process.exitCode = report.pass ? 0 : 1;
} finally {
  await browser.close();
  server.close();
}
