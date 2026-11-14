// app.js — Canvas 渲染、缩放/平移/拖边界交互、SVG/PNG 导出
import { Island, marchingSquares, chainSegments, CONTROL_POINTS } from './terrain.js';

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const seedInput = document.getElementById('seed');

let island = null;
let controlPoints = [];
let contourCache = []; // {level, segs}
let coastPath = null;  // Path2D 海岸线（用于裁剪湿地绘制）
let baseLayer = null;  // 离屏地形底色
const view = { scale: 1, ox: 0, oy: 0 };

const RIVER_NAMES = ['青川', '芦溪', '澜江'];
const VILLAGE_NAMES = ['东浦村', '望潮村', '石湾村', '林尾村', '白沙村'];

function worldToScreen(x, y) {
  return [x * view.scale + view.ox, y * view.scale + view.oy];
}
function screenToWorld(sx, sy) {
  return [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  render();
}

function fitView() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  view.scale = Math.min(w, h) * 0.92;
  view.ox = (w - view.scale) / 2;
  view.oy = (h - view.scale) / 2;
}

function buildIsland(seed) {
  island = new Island(seed);
  refreshCaches();
}

function refreshCaches() {
  controlPoints = island.getControlPoints();
  contourCache = [];
  for (let lv = 1; lv <= 8; lv++) contourCache.push({ level: lv / 10, segs: marchingSquares(island.h, island.n, lv / 10) });
  const coastSegs = marchingSquares(island.h, island.n, 0);
  contourCache.push({ level: 0, segs: coastSegs });
  coastPath = new Path2D();
  for (const line of chainSegments(coastSegs)) {
    coastPath.moveTo(line[0][0], line[0][1]);
    for (let k = 1; k < line.length; k++) coastPath.lineTo(line[k][0], line[k][1]);
    coastPath.closePath();
  }
  buildBaseLayer();
}

function buildBaseLayer() {
  const n = island.n;
  baseLayer = document.createElement('canvas');
  baseLayer.width = baseLayer.height = n;
  const bctx = baseLayer.getContext('2d');
  const img = bctx.createImageData(n, n);
  for (let idx = 0; idx < n * n; idx++) {
    const h = island.h[idx];
    let r, g, b;
    if (h <= 0) {
      const d = Math.min(1, -h * 2.2);
      r = 26 + 20 * (1 - d); g = 78 + 40 * (1 - d); b = 122 + 40 * (1 - d);
    } else if (h < 0.06) {
      r = 224; g = 205; b = 150;
    } else if (h < 0.3) {
      const t = (h - 0.06) / 0.24;
      r = 150 - 40 * t; g = 178 - 30 * t; b = 110 - 30 * t;
    } else {
      const t = Math.min(1, (h - 0.3) / 0.5);
      r = 120 + 60 * t; g = 140 - 30 * t; b = 95 - 20 * t;
    }
    img.data[idx * 4] = r; img.data[idx * 4 + 1] = g; img.data[idx * 4 + 2] = b; img.data[idx * 4 + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
}
function render() {
  if (!island) return;
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = '#0d1c26';
  ctx.fillRect(0, 0, w, hgt);
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);
  const lw = (px) => px / view.scale; // 恒定屏幕线宽

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baseLayer, 0, 0, 1, 1);

  // 等高线
  for (const { level, segs } of contourCache) {
    ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); }
    if (level === 0) {
      ctx.strokeStyle = '#20313d'; ctx.lineWidth = lw(2.2);
    } else {
      ctx.strokeStyle = 'rgba(60,50,30,0.35)'; ctx.lineWidth = lw(0.8);
    }
    ctx.stroke();
  }

  // 禁入湿地（裁剪到海岸线以内）
  const wt = island.wetland;
  ctx.save();
  ctx.clip(coastPath);
  ctx.translate(wt.cx, wt.cy);
  ctx.rotate(wt.rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, wt.rx, wt.ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46, 125, 110, 0.45)';
  ctx.fill();
  ctx.setLineDash([lw(6), lw(4)]);
  ctx.strokeStyle = '#e74c3c';
  ctx.lineWidth = lw(1.6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  drawLabel(wt.cx, wt.cy, '禁入湿地', '#ff8a80', 13);

  // 河流
  const n = island.n;
  island.rivers.forEach((path, ri) => {
    ctx.beginPath();
    path.forEach((idx, k) => {
      const x = ((idx % n) + 0.5) / n, y = (((idx / n) | 0) + 0.5) / n;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#3fa7f5';
    ctx.lineWidth = lw(2.4);
    ctx.lineJoin = 'round';
    ctx.stroke();
    const mid = path[Math.floor(path.length / 2)];
    drawLabel(((mid % n) + 0.5) / n, (((mid / n) | 0) + 0.5) / n, RIVER_NAMES[ri] || `河${ri + 1}`, '#bfe6ff', 11);
  });

  // 村落
  island.villages.forEach((v, vi) => {
    ctx.beginPath();
    ctx.arc(v.x, v.y, lw(4), 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = lw(1.2);
    ctx.stroke();
    drawLabel(v.x, v.y - lw(9), VILLAGE_NAMES[vi] || `村落${vi + 1}`, '#fff', 11);
  });

  // 海岸控制点
  for (const cp of controlPoints) {
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, lw(5), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 214, 64, 0.9)';
    ctx.fill();
    ctx.strokeStyle = '#5d4a00';
    ctx.lineWidth = lw(1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLabel(x, y, text, color, px) {
  ctx.save();
  ctx.font = `${px / view.scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 / view.scale;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
// ---------- 交互：缩放 / 平移 / 拖动海岸控制点 ----------
let dragMode = null; // 'pan' | 'point'
let dragPoint = null;
let lastMouse = [0, 0];
let rafPending = false;

function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const [wx, wy] = screenToWorld(mx, my);
  view.scale *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
  view.scale = Math.max(50, Math.min(20000, view.scale));
  view.ox = mx - wx * view.scale;
  view.oy = my - wy * view.scale;
  scheduleRender();
}, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  lastMouse = [mx, my];
  const [wx, wy] = screenToWorld(mx, my);
  dragPoint = null;
  for (const cp of controlPoints) {
    if (Math.hypot(cp.x - wx, cp.y - wy) * view.scale < 12) { dragPoint = cp; break; }
  }
  dragMode = dragPoint ? 'point' : 'pan';
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragMode) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  if (dragMode === 'pan') {
    view.ox += mx - lastMouse[0];
    view.oy += my - lastMouse[1];
  } else if (dragPoint) {
    const [wx, wy] = screenToWorld(mx, my);
    const r = Math.min(0.47, Math.max(0.1, Math.hypot(wx - 0.5, wy - 0.5)));
    island.applyBoundaryEdit(dragPoint.index, r);
    refreshCaches();
  }
  lastMouse = [mx, my];
  scheduleRender();
});

canvas.addEventListener('pointerup', () => { dragMode = null; dragPoint = null; });

// ---------- 导出 ----------
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildSVG() {
  const S = 1200;
  const P = (x, y) => `${(x * S).toFixed(1)},${(y * S).toFixed(1)}`;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">`);
  parts.push(`<rect width="${S}" height="${S}" fill="#1a4e7a"/>`);
  const coast = chainSegments(marchingSquares(island.h, island.n, 0));
  for (const line of coast) {
    const d = line.map((p, i) => `${i ? 'L' : 'M'}${P(p[0], p[1])}`).join('') + 'Z';
    parts.push(`<path d="${d}" fill="#96b46e" stroke="#20313d" stroke-width="2"/>`);
  }
  for (let lv = 1; lv <= 8; lv++) {
    const segs = marchingSquares(island.h, island.n, lv / 10);
    const d = segs.map((s) => `M${P(s[0], s[1])}L${P(s[2], s[3])}`).join('');
    parts.push(`<path d="${d}" stroke="rgba(60,50,30,0.4)" stroke-width="1" fill="none"/>`);
  }
  const wt = island.wetland;
  parts.push(`<g transform="translate(${wt.cx * S},${wt.cy * S}) rotate(${(wt.rot * 180 / Math.PI).toFixed(1)})">` +
    `<ellipse rx="${wt.rx * S}" ry="${wt.ry * S}" fill="rgba(46,125,110,0.45)" stroke="#e74c3c" stroke-width="2" stroke-dasharray="8 5"/></g>`);
  parts.push(`<text x="${wt.cx * S}" y="${wt.cy * S}" fill="#ff8a80" font-size="20" text-anchor="middle">禁入湿地</text>`);
  const n = island.n;
  island.rivers.forEach((path, ri) => {
    const d = path.map((idx, k) => `${k ? 'L' : 'M'}${P(((idx % n) + 0.5) / n, (((idx / n) | 0) + 0.5) / n)}`).join('');
    parts.push(`<path d="${d}" stroke="#3fa7f5" stroke-width="3" fill="none" stroke-linejoin="round"/>`);
    const mid = path[Math.floor(path.length / 2)];
    parts.push(`<text x="${((mid % n) + 0.5) / n * S}" y="${(((mid / n) | 0) + 0.5) / n * S}" fill="#bfe6ff" font-size="15" text-anchor="middle">${RIVER_NAMES[ri] || `河${ri + 1}`}</text>`);
  });
  island.villages.forEach((v, vi) => {
    parts.push(`<circle cx="${v.x * S}" cy="${v.y * S}" r="6" fill="#c0392b" stroke="#fff" stroke-width="1.5"/>`);
    parts.push(`<text x="${v.x * S}" y="${v.y * S - 12}" fill="#fff" font-size="15" text-anchor="middle">${VILLAGE_NAMES[vi] || `村落${vi + 1}`}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n');
}

document.getElementById('svg').addEventListener('click', () => {
  download(`island-${island.seed}.svg`, new Blob([buildSVG()], { type: 'image/svg+xml' }));
});
document.getElementById('png').addEventListener('click', () => {
  canvas.toBlob((b) => download(`island-${island.seed}.png`, b), 'image/png');
});
document.getElementById('gen').addEventListener('click', () => {
  buildIsland(seedInput.value.trim() || '0');
  fitView();
  render();
});
document.getElementById('rand').addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 1e9));
  document.getElementById('gen').click();
});

window.addEventListener('resize', resize);
buildIsland(seedInput.value.trim());
fitView();
resize();
