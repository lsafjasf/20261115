'use strict';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const bgCanvas = document.createElement('canvas');      // 清晰城市
const bgCtx = bgCanvas.getContext('2d');
const bgBlurCanvas = document.createElement('canvas');  // 失焦城市（雨滴折射采样源）
const bgBlurCtx = bgBlurCanvas.getContext('2d');
const dropCanvas = document.createElement('canvas');    // 雨滴层（整体可做失焦模糊）
const dropCtx = dropCanvas.getContext('2d');

const TAU = Math.PI * 2;
let W = 0, H = 0, DPR = 1;

const state = { speed: 60, rain: 0.55, focus: 8, lamp: '#ffb46b', paused: false };
const city = { far: [], mid: [], near: [], midWin: [], nearWin: [], lamps: [] };

function rand(a, b) { return a + Math.random() * (b - a); }

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function buildCity() {
  for (const k in city) city[k].length = 0;
  const horizon = H * 0.86;
  const layers = [
    { list: city.far, win: null, minH: 0.16, maxH: 0.40, wMin: 40, wMax: 90 },
    { list: city.mid, win: city.midWin, minH: 0.26, maxH: 0.55, wMin: 50, wMax: 110, litP: 0.32 },
    { list: city.near, win: city.nearWin, minH: 0.36, maxH: 0.70, wMin: 70, wMax: 150, litP: 0.26 },
  ];
  for (const L of layers) {
    let x = -20;
    while (x < W + 40) {
      const bw = rand(L.wMin, L.wMax) * (W / 1200 + 0.5);
      const bh = rand(L.minH, L.maxH) * H;
      const b = { x, w: bw, top: horizon - bh };
      L.list.push(b);
      if (L.win) {
        const cols = Math.max(2, Math.floor(bw / 17));
        const rows = Math.max(3, Math.floor(bh / 24));
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            if (Math.random() < L.litP) {
              L.win.push({
                x: b.x + 4 + (i + 0.5) * (bw - 8) / cols,
                y: b.top + 7 + (j + 0.5) * (bh - 12) / rows,
                warm: Math.random() < 0.7,
              });
            }
          }
        }
      }
      x += bw + rand(4, 26);
    }
  }
  const nLamps = Math.max(3, Math.round(W / 230));
  for (let i = 0; i < nLamps; i++) {
    city.lamps.push({
      x: (i + 0.5) * W / nLamps + rand(-24, 24),
      y: horizon, h: H * 0.13, ph: Math.random() * TAU,
    });
  }
}

function paintBg() {
  const c = bgCtx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  const lamp = hexRgb(state.lamp);
  const horizon = H * 0.86;

  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#03050c');
  sky.addColorStop(0.72, '#0a0e1a');
  sky.addColorStop(1, `rgb(${14 + lamp.r * 0.09 | 0},${11 + lamp.g * 0.07 | 0},${15 + lamp.b * 0.05 | 0})`);
  c.fillStyle = sky;
  c.fillRect(0, 0, W, horizon + 1);

  c.fillStyle = '#0b101d';
  for (const b of city.far) c.fillRect(b.x, b.top, b.w, horizon - b.top);
  c.fillStyle = '#070b14';
  for (const b of city.mid) c.fillRect(b.x, b.top, b.w, horizon - b.top);
  paintWindows(c, city.midWin, 0.75);
  c.fillStyle = '#04060c';
  for (const b of city.near) c.fillRect(b.x, b.top, b.w, horizon - b.top);
  paintWindows(c, city.nearWin, 0.9);

  const road = c.createLinearGradient(0, horizon, 0, H);
  road.addColorStop(0, '#0a0c12');
  road.addColorStop(1, '#030407');
  c.fillStyle = road;
  c.fillRect(0, horizon, W, H - horizon);

  for (const L of city.lamps) {
    const topY = L.y - L.h;
    c.strokeStyle = '#10131c';
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(L.x, L.y); c.lineTo(L.x, topY); c.stroke();
    const glow = c.createRadialGradient(L.x, topY, 0, L.x, topY, 24);
    glow.addColorStop(0, state.lamp);
    glow.addColorStop(0.25, state.lamp + 'aa');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.beginPath(); c.arc(L.x, topY, 24, 0, TAU); c.fill();
    c.save();
    c.translate(L.x, L.y + 8);
    c.scale(1, 0.28);
    const pool = c.createRadialGradient(0, 0, 0, 0, 0, 80);
    pool.addColorStop(0, state.lamp + '55');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = pool;
    c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.fill();
    c.restore();
  }
}

function paintWindows(c, list, alpha) {
  for (const wn of list) {
    c.fillStyle = wn.warm
      ? `rgba(255, 209, 150, ${alpha})`
      : `rgba(150, 190, 255, ${alpha * 0.85})`;
    c.fillRect(wn.x - 1.6, wn.y - 2.2, 3.2, 4.4);
  }
}

// ---------------- 雨滴系统 ----------------

const drops = [];   // 玻璃上的主雨滴
const trails = [];  // 滑动后留下的蒸发小水珠
const MAX_DROPS = 260;
const MAX_TRAILS = 520;
let spawnAcc = 0;

function spawnDrop() {
  const big = Math.random() < 0.2;
  drops.push({
    x: rand(0, W), y: rand(-12, H),
    r: big ? rand(3.4, 5.6) : rand(1.0, 3.3),
    vx: 0, vy: 0, lx: 0, ly: 0,
    grip: rand(0.75, 1.3),          // 个体差异：附着力 / 受力系数
    seed: Math.random() * TAU,
  });
}

// 风压：车速越快，水平向后的加速度越大，并带轻微上抬气流
function windForce() {
  const s = state.speed / 160;
  const w = s * s * 1600;
  return { x: -w, y: -w * 0.35 };
}

function update(dt, t) {
  spawnAcc += state.rain * 70 * dt * (W * H) / (1280 * 720);
  while (spawnAcc >= 1) {
    spawnAcc -= 1;
    if (drops.length < MAX_DROPS) spawnDrop();
  }

  const wind = windForce();
  const g = 640;
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    const mobility = Math.max(0, (d.r - 1.4) / 2.6) * d.grip;
    if (mobility > 0.02) {
      d.vx += (wind.x + Math.sin(t * 2.6 + d.seed) * 26) * mobility * dt;
      d.vy += (wind.y + g) * mobility * dt;
      const damp = Math.exp(-2.4 * dt);
      d.vx *= damp; d.vy *= damp;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      const dx = d.x - d.lx, dy = d.y - d.ly;
      if (dx * dx + dy * dy > d.r * d.r * 0.7) {
        d.lx = d.x; d.ly = d.y;
        trails.push({
          x: d.x + rand(-1, 1), y: d.y + rand(-1, 1),
          r: d.r * rand(0.22, 0.45), life: 1,
        });
        if (trails.length > MAX_TRAILS) trails.shift();
        d.r *= 0.996; // 留下水痕后自身略微损耗
      }
    }
    if (d.x < -30 || d.y > H + 30 || d.r < 0.7) drops.splice(i, 1);
  }
  for (let i = trails.length - 1; i >= 0; i--) {
    trails[i].life -= dt * 0.045;
    if (trails[i].life <= 0) trails.splice(i, 1);
  }
}

// 折射透镜：圆形程序化遮罩内倒绘失焦背景，再加边缘暗角与高光
function drawLens(c, x, y, r, alpha) {
  const z = 1.7;
  c.save();
  c.globalAlpha = alpha;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
  c.translate(x, y);
  c.scale(-1, -1); // 水滴透镜成像上下左右颠倒
  c.drawImage(bgBlurCanvas,
    (x - r * z) * DPR, (y - r * z) * DPR, r * 2 * z * DPR, r * 2 * z * DPR,
    -r * z, -r * z, r * 2 * z, r * 2 * z);
  c.restore();

  c.save();
  c.globalAlpha = alpha;
  const shade = c.createLinearGradient(x, y - r, x, y + r);
  shade.addColorStop(0, 'rgba(210,225,255,0.16)');
  shade.addColorStop(0.45, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.3)');
  c.fillStyle = shade;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  const rim = c.createRadialGradient(x, y, r * 0.5, x, y, r);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(0.85, 'rgba(0,0,0,0.16)');
  rim.addColorStop(1, 'rgba(0,0,0,0.45)');
  c.fillStyle = rim;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(190,210,240,0.4)';
  c.lineWidth = Math.max(0.8, r * 0.09);
  c.beginPath(); c.arc(x, y, r * 0.94, 0, TAU); c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath();
  c.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.15, -0.6, 0, TAU);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.beginPath();
  c.ellipse(x + r * 0.3, y + r * 0.42, r * 0.18, r * 0.1, -0.6, 0, TAU);
  c.fill();
  c.restore();
}

function drawBead(c, x, y, r, alpha) {
  if (r >= 2.2) { drawLens(c, x, y, r, alpha); return; }
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = 'rgba(150,180,220,0.22)';
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath(); c.arc(x - r * 0.3, y - r * 0.35, r * 0.34, 0, TAU); c.fill();
  c.restore();
}

function paintDrops() {
  const c = dropCtx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  for (const tr of trails) {
    drawBead(c, tr.x, tr.y, tr.r * (0.4 + 0.6 * tr.life), Math.min(1, tr.life * 1.5) * 0.9);
  }
  for (const d of drops) drawBead(c, d.x, d.y, d.r, 1);
}

// ---------------- 对焦 / 散景 / 合成 ----------------

function focusAmounts() {
  const f = state.focus;
  const bgDef = Math.min(1, Math.abs(Math.log(f / 70)) / Math.log(70 / 3));
  const dropDef = Math.min(1, Math.abs(Math.log(f / 0.35)) / Math.log(70 / 0.35));
  return { bgBlur: bgDef * 9, bokeh: bgDef, dropBlur: dropDef * 6 };
}

function drawBokeh(def, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const L of city.lamps) {
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.1 + L.ph);
    const R = (8 + def * 30) * pulse;
    const y = L.y - L.h;
    const g = ctx.createRadialGradient(L.x, y, 0, L.x, y, R);
    g.addColorStop(0, state.lamp);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.45 * pulse;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(L.x, y, R, 0, TAU); ctx.fill();
  }
  if (def > 0.2) {
    ctx.globalAlpha = 0.07 + def * 0.1;
    const R = (def - 0.15) * 6;
    for (const list of [city.midWin, city.nearWin]) {
      for (const wn of list) {
        ctx.fillStyle = wn.warm ? '#ffcf9a' : '#a9c8ff';
        ctx.beginPath(); ctx.arc(wn.x, wn.y, R, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
}

function render(t) {
  const F = focusAmounts();
  const b = bgBlurCtx;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, bgBlurCanvas.width, bgBlurCanvas.height);
  b.filter = F.bgBlur > 0.15 ? `blur(${(F.bgBlur * DPR).toFixed(1)}px)` : 'none';
  const m = F.bgBlur * 2 * DPR; // 放大绘制避免模糊边缘透明
  b.drawImage(bgCanvas, -m, -m, bgCanvas.width + 2 * m, bgCanvas.height + 2 * m);
  b.filter = 'none';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bgBlurCanvas, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBokeh(F.bokeh, t);

  paintDrops();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = F.dropBlur > 0.15 ? `blur(${(F.dropBlur * DPR).toFixed(1)}px)` : 'none';
  ctx.drawImage(dropCanvas, 0, 0);
  ctx.filter = 'none';
}

// ---------------- 主循环（暂停时全部动态冻结） ----------------

let last = performance.now();
let simT = 0;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!state.paused) {
    simT += dt;
    update(dt, simT);
  }
  render(simT);
  requestAnimationFrame(frame);
}

// ---------------- 控制与导出 ----------------

const $ = id => document.getElementById(id);

function focusFromSlider(v) { return 0.2 * Math.pow(400, v / 1000); } // 0.2m ~ 80m 对数映射

function focusLabel(f) {
  return f < 1 ? Math.round(f * 100) + ' cm' : f.toFixed(1) + ' m';
}

function togglePause() {
  state.paused = !state.paused;
  $('pauseBtn').textContent = state.paused ? '继续' : '暂停';
}

function exportFrame() {
  canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rain-window-' + Date.now() + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  });
}

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [canvas, bgCanvas, bgBlurCanvas, dropCanvas]) {
    c.width = Math.round(W * DPR);
    c.height = Math.round(H * DPR);
  }
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  buildCity();
  paintBg();
}

$('speed').addEventListener('input', e => {
  state.speed = +e.target.value;
  $('speedVal').textContent = state.speed + ' km/h';
});
$('rain').addEventListener('input', e => {
  state.rain = +e.target.value / 100;
  $('rainVal').textContent = e.target.value + '%';
});
$('focus').addEventListener('input', e => {
  state.focus = focusFromSlider(+e.target.value);
  $('focusVal').textContent = focusLabel(state.focus);
});
$('lamp').addEventListener('input', e => {
  state.lamp = e.target.value;
  paintBg();
});
$('pauseBtn').addEventListener('click', togglePause);
$('exportBtn').addEventListener('click', exportFrame);
window.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    togglePause();
  }
});
window.addEventListener('resize', resize);

// 支持 URL 参数预设，如 ?speed=120&rain=80&focus=0.35&lamp=%23ffb46b
(function applyParams() {
  const q = new URLSearchParams(location.search);
  if (q.has('speed')) {
    state.speed = Math.max(0, Math.min(160, +q.get('speed')));
    $('speed').value = state.speed;
    $('speedVal').textContent = state.speed + ' km/h';
  }
  if (q.has('rain')) {
    state.rain = Math.max(0, Math.min(100, +q.get('rain'))) / 100;
    $('rain').value = state.rain * 100;
    $('rainVal').textContent = Math.round(state.rain * 100) + '%';
  }
  if (q.has('focus')) {
    state.focus = Math.max(0.2, Math.min(80, +q.get('focus')));
  } else {
    state.focus = focusFromSlider(620);
  }
  $('focus').value = Math.round(1000 * Math.log(state.focus / 0.2) / Math.log(400));
  $('focusVal').textContent = focusLabel(state.focus);
  if (q.has('lamp')) {
    state.lamp = q.get('lamp');
    $('lamp').value = state.lamp;
  }
  if (q.get('panel') === '0') $('panel').style.display = 'none';
})();
resize();
requestAnimationFrame(frame);
