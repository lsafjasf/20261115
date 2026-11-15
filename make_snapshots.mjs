// make_snapshots.mjs — 截取演播台界面与导出视频的代表帧,供人工核对。
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PORT = 8778;
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.join(ROOT, decodeURIComponent(url));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm' };
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1600 } });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  await page.waitForFunction(() => window.__project);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
  await page.screenshot({ path: 'artifacts/studio-ui.png' });

  // 从导出的 WebM 中抓取代表帧(新建页面 + 新建 video,从头播放,不做 seek)
  const vpage = await browser.newPage();
  vpage.on('pageerror', (e) => console.log('[snap ERROR]', e.message));
  await vpage.goto(`http://127.0.0.1:${PORT}/index.html`);
  const targets = [2.0, 4.3, 6.0, 8.7, 10.0, 12.3, 13.5];
  const shots = await vpage.evaluate(async (targets) => {
    const v = document.createElement('video');
    v.muted = true;
    v.src = 'artifacts/program-15s.webm';
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const cx = c.getContext('2d');
    const out = {};
    let idx = 0;
    await v.play();
    await new Promise((res) => {
      function step() {
        while (idx < targets.length && v.currentTime >= targets[idx]) {
          cx.drawImage(v, 0, 0);
          out[targets[idx]] = c.toDataURL('image/png');
          idx++;
        }
        if (idx >= targets.length) { v.pause(); res(); return; }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(step);
        else setTimeout(step, 16);
      }
      step();
      setTimeout(res, 60000);
    });
    return out;
  }, targets);
  for (const t of targets) {
    if (shots[t]) fs.writeFileSync(`artifacts/frame-${t.toFixed(1)}s.png`, Buffer.from(shots[t].split(',')[1], 'base64'));
  }
  console.log('快照已保存到 artifacts/');
} finally {
  await browser.close();
  server.close();
}
