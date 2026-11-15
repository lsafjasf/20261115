// 浏览器入口：输入、主循环、HUD、失败/胜利后的平面图复盘
import { createGame, step, togglePause, getFloorPlan, REQUIRED_CHIPS } from './game.js';
import { MATERIALS } from './maze.js';
import { AudioEngine } from './audio.js';

const params = new URLSearchParams(location.search);
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);

let state = createGame(seed);
const audio = new AudioEngine();
const keys = new Set();
let lastTs = 0;

const view = document.getElementById('view');
const ctx2d = view.getContext('2d');
const hud = document.getElementById('hud');

function resize() {
  view.width = innerWidth;
  view.height = innerHeight;
}
addEventListener('resize', resize);
resize();

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  ensureAudio(); // 浏览器要求用户手势后启动音频
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    const s = togglePause(state);
    if (s === 'paused') audio.suspend(); else audio.resume();
    return;
  }
  if ((e.key === 'r' || e.key === 'R') && state.status !== 'playing') {
    restart();
    return;
  }
  keys.add(e.key);
});
addEventListener('keyup', (e) => keys.delete(e.key));

function ensureAudio() {
  audio.resume();
  if (!audio.machines || !audio.machines.length) audio.startAmbience(state);
}

function restart() {
  state = createGame(seed);
  audio.stopAmbience();
  audio.startAmbience(state);
}

function readInput() {
  const fwd = (keys.has('ArrowUp') || keys.has('w') || keys.has('W') ? 1 : 0) -
              (keys.has('ArrowDown') || keys.has('s') || keys.has('S') ? 1 : 0);
  const turn = (keys.has('ArrowRight') || keys.has('d') || keys.has('D') ? 1 : 0) -
               (keys.has('ArrowLeft') || keys.has('a') || keys.has('A') ? 1 : 0);
  return { forward: fwd, turn };
}

function handleEvents() {
  for (const ev of state.events) {
    if (ev.type === 'step') audio.footstep(ev.material);
    else if (ev.type === 'bump') audio.bump(ev.pan, ev.material);
    else if (ev.type === 'chip') audio.chipPickup();
    else if (ev.type === 'win') { audio.win(); audio.stopAmbience(); }
    else if (ev.type === 'fail') { audio.fail(); audio.stopAmbience(); }
  }
}

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  if (state.status === 'playing') {
    step(state, readInput(), dt);
    handleEvents();
    audio.update(state);
  }
  render();
  requestAnimationFrame(frame);
}

function render() {
  ctx2d.fillStyle = '#050608';
  ctx2d.fillRect(0, 0, view.width, view.height);
  if (state.status === 'failed' || state.status === 'won') {
    drawFloorPlan(getFloorPlan(state));
  } else {
    drawDarkness();
  }
  drawHud();
}

// 游玩中画面保持全黑，仅中央一点微光提示"正在聆听"
function drawDarkness() {
  const cx = view.width / 2, cy = view.height / 2;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 900);
  const r = 40 + pulse * 25;
  const grad = ctx2d.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
  grad.addColorStop(0, 'rgba(70,110,140,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx2d.fillStyle = grad;
  ctx2d.fillRect(0, 0, view.width, view.height);
  if (state.status === 'paused') {
    drawCenterText('已暂停', '按 P / Esc 继续');
  }
}

function drawCenterText(title, sub) {
  ctx2d.textAlign = 'center';
  ctx2d.fillStyle = '#cfe3ef';
  ctx2d.font = '42px sans-serif';
  ctx2d.fillText(title, view.width / 2, view.height / 2 - 10);
  ctx2d.font = '18px sans-serif';
  ctx2d.fillStyle = '#7d93a3';
  ctx2d.fillText(sub, view.width / 2, view.height / 2 + 28);
}

function drawHud() {
  const mat = MATERIALS[currentMaterialLabel()];
  const lines = [
    `芯片 ${state.chipsCollected}/${REQUIRED_CHIPS}`,
    `材质 ${mat ? mat.label : '-'}`,
    `seed ${state.seed}`,
    `时间 ${state.time.toFixed(1)}s`,
  ];
  hud.textContent = lines.join('　');
  if (state.status === 'failed') {
    drawCenterText('证据不足', '平面图已展开：绿线为正确路线，红线为你的足迹。按 R 重试');
  } else if (state.status === 'won') {
    drawCenterText('成功脱困', '按 R 再来一局');
  }
}

function currentMaterialLabel() {
  const cx = Math.floor(state.player.x), cy = Math.floor(state.player.y);
  const row = state.maze.cells[cy];
  return row && row[cx] ? row[cx].material : 'stone';
}

// 平面图：墙体、材质分区、声源、芯片、出口、正确路径与玩家足迹
function drawFloorPlan(plan) {
  const margin = 60;
  const scale = Math.min(
    (view.width - margin * 2) / plan.width,
    (view.height - margin * 2) / plan.height);
  const ox = (view.width - plan.width * scale) / 2;
  const oy = (view.height - plan.height * scale) / 2 + 20;
  const X = (x) => ox + x * scale;
  const Y = (y) => oy + y * scale;

  const matColors = { stone: '#1c2126', metal: '#232a33', wood: '#26211a', wet: '#18242a' };
  for (let y = 0; y < plan.height; y++)
    for (let x = 0; x < plan.width; x++) {
      ctx2d.fillStyle = matColors[plan.cells[y][x].material] || '#1c2126';
      ctx2d.fillRect(X(x), Y(y), scale, scale);
    }

  ctx2d.strokeStyle = '#8fa7b8';
  ctx2d.lineWidth = 2;
  ctx2d.beginPath();
  for (const w of plan.walls) {
    ctx2d.moveTo(X(w.x1), Y(w.y1));
    ctx2d.lineTo(X(w.x2), Y(w.y2));
  }
  ctx2d.stroke();

  // 正确路径（绿）与玩家足迹（红）
  drawPath(plan.correctPath.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })),
    'rgba(80,220,120,0.8)', 3);
  drawPath(plan.playerTrail, 'rgba(230,80,80,0.75)', 2);

  for (const s of plan.sources) {
    dot(s.x + 0.5, s.y + 0.5, s.kind === 'drip' ? '#4fb3ff' : '#ffab40', 6);
  }
  for (const c of plan.chips) {
    dot(c.x + 0.5, c.y + 0.5, c.taken ? '#888' : '#ffe14f', 7);
  }
  dot(plan.exit.x + 0.5, plan.exit.y + 0.5, '#7dff9a', 9);
  dot(plan.start.x + 0.5, plan.start.y + 0.5, '#ffffff', 5);

  ctx2d.textAlign = 'left';
  ctx2d.font = '14px sans-serif';
  ctx2d.fillStyle = '#9fb4c2';
  ctx2d.fillText(
    `seed ${plan.seed}　● 出口　● 芯片　● 滴水　● 机械　● 起点　绿线=正确路线 红线=足迹`,
    ox, oy - 12);

  function drawPath(points, color, width) {
    if (points.length < 2) return;
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = width;
    ctx2d.beginPath();
    ctx2d.moveTo(X(points[0].x), Y(points[0].y));
    for (const p of points.slice(1)) ctx2d.lineTo(X(p.x), Y(p.y));
    ctx2d.stroke();
  }
  function dot(x, y, color, r) {
    ctx2d.fillStyle = color;
    ctx2d.beginPath();
    ctx2d.arc(X(x), Y(y), r, 0, Math.PI * 2);
    ctx2d.fill();
  }
}

// 启动
addEventListener('pointerdown', () => {
  ensureAudio();
}, { once: true });
requestAnimationFrame(frame);
