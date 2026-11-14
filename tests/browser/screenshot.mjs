import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8765;
const base = `http://127.0.0.1:${PORT}`;

async function ensureServer() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
    if (res.ok) return null;
  } catch {}
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: root,
    stdio: 'ignore',
    detached: true
  });
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (res.ok) return server;
    } catch {}
  }
  throw new Error('本地 HTTP 服务启动失败');
}

const server = await ensureServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1240, height: 980 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${PORT}/index.html`);
await page.waitForTimeout(1500);
await page.screenshot({ path: resolve(root, 'artifacts/shots/01-mission-start.png') });

// 快进到任务中段（约 40 秒），此时已有车辙、尘土、已拾取样本
await page.evaluate(async (base) => {
  const { world, rover } = window.__game;
  const { autopilot } = await import(base + '/js/autopilot.js')
  const { step } = await import(base + '/js/simulation.js')
  for (let i = 0; i < 60 * 40; i++) step(world, rover, autopilot(world, rover));
}, base);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(root, 'artifacts/shots/02-mid-mission.png') });

// 手动构造打滑场景并在打滑中截图
await page.evaluate(async (base) => {
  const { createWorld } = await import(base + '/js/world.js')
  const { createRover, step } = await import(base + '/js/simulation.js')
  const w = createWorld();
  const r = createRover(w);
  r.x = 4; r.y = 27; r.heading = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const sp = Math.hypot(r.vx, r.vy);
    step(w, r, { throttle: 1, brake: 0, steer: sp > 4 ? 1 : 0 });
  }
  window.__slipWorld = w;
  window.__slipRover = r;
  // 让主循环的 HUD 与该场景同步（渲染器随后用同一世界重绘）
  window.__game.__swap(w, r);
  // 用主画布渲染该场景
  const { Renderer } = await import(base + '/js/renderer.js')
  const canvas = document.getElementById('game');
  const rr = new Renderer(canvas, w);
  rr.render(r);
}, base);
await page.screenshot({ path: resolve(root, 'artifacts/shots/03-slip.png') });

// 任务完成画面
await page.evaluate(async (base) => {
  const { createWorld } = await import(base + '/js/world.js')
  const { runEpisode } = await import(base + '/js/simulation.js')
  const { autopilot } = await import(base + '/js/autopilot.js')
  const { Renderer } = await import(base + '/js/renderer.js')
  const w = createWorld();
  const { rover } = runEpisode(w, autopilot, 60 * 160);
  const canvas = document.getElementById('game');
  window.__game.__swap(w, rover);
  new Renderer(canvas, w).render(rover);
  window.__finalRover = rover;
}, base);
const finalStatus = await page.evaluate(() => ({ status: window.__finalRover.status, jars: window.__finalRover.jars, damage: window.__finalRover.damage }));
await page.screenshot({ path: resolve(root, 'artifacts/shots/04-returned.png') });

// 低重力腾空与落地跳痕
await page.evaluate(async (base) => {
  const { createWorld } = await import(base + '/js/world.js')
  const { createRover, step } = await import(base + '/js/simulation.js')
  const { Renderer } = await import(base + '/js/renderer.js')
  const w = createWorld();
  const r = createRover(w);
  const c = w.craters[4];
  r.x = c.x - c.rim - 6; r.y = c.y; r.heading = 0; r.vx = 5.5;
  for (let i = 0; i < 60 * 6 && r.status === 'active'; i++) {
    step(w, r, { throttle: 1, brake: 0, steer: 0 });
  }
  window.__game.__swap(w, r);
  new Renderer(document.getElementById('game'), w).render(r);
}, base);
await page.screenshot({ path: resolve(root, 'artifacts/shots/05-hop-marks.png') });

// 陨坑边缘滑坡（一次性，边缘变红并提示）
await page.evaluate(async (base) => {
  const { createWorld } = await import(base + '/js/world.js')
  const { createRover, step } = await import(base + '/js/simulation.js')
  const { Renderer } = await import(base + '/js/renderer.js')
  const w = createWorld();
  const r = createRover(w);
  const c = w.craters[4];
  r.x = c.x - c.rim - 4; r.y = c.y; r.heading = 0; r.vx = 5.5;
  for (let i = 0; i < 60 * 4 && r.status === 'active'; i++) {
    step(w, r, { throttle: 1, brake: 0, steer: 0 });
  }
  window.__game.__swap(w, r);
  new Renderer(document.getElementById('game'), w).render(r);
}, base);
await page.screenshot({ path: resolve(root, 'artifacts/shots/06-landslide.png') });
await browser.close();
console.log('FINAL', JSON.stringify(finalStatus));
console.log('PAGE_ERRORS', errors.length ? errors.join(' | ') : 'none');
