// 游戏主循环:车辆驾驶、Canvas 渲染(街区+声压表)、标记判定。
import {
  createWorld, GRID, SPACING, WORLD_SIZE,
  segmentAt, snr,
} from './world.js';
import { AudioEngine } from './audio.js';

const MAX_SPEED = 130;      // 单位/秒
const ACCEL = 90;
const BRAKE = 160;
const TURN_DIST = 10;       // 距路口多远内允许转向

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');

let world, car, audio, mistakes, message, messageT;

function reset(seed) {
  world = createWorld(seed);
  car = { x: 0, y: 0, heading: 0, speed: 0, turnReq: 0 };
  mistakes = 0;
  message = '寻找 3 处泄漏。W/S 加减速,路口处 A/D 转向,M 标记当前管段。';
  messageT = 8;
  if (!audio) audio = new AudioEngine();
}

reset((Math.random() * 1e9) | 0);

// ---- 输入 ----
const keys = {};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!audio.started) audio.start(world);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  if (k === 'a' || k === 'arrowleft') car.turnReq = -1;
  if (k === 'd' || k === 'arrowright') car.turnReq = 1;
  if (k === 'm') mark();
  if (k === 'r') { audio.stop(); reset((Math.random() * 1e9) | 0); }
  keys[k] = true;
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('pointerdown', () => {
  if (!audio.started) audio.start(world);
  if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
});

function mark() {
  const seg = segmentAt(world, car.x, car.y);
  const leak = world.leaks.find(l => !l.found && l.segId === seg.id);
  if (leak) {
    leak.found = true;
    const left = world.leaks.filter(l => !l.found).length;
    message = left > 0 ? `命中!修复一处泄漏,还剩 ${left} 处。` : '';
    messageT = 4;
    if (left === 0) {
      message = `全部 3 处泄漏定位成功!误标 ${mistakes} 次。按 R 开新局。`;
      messageT = 1e9;
    }
  } else {
    mistakes++;
    message = '该管段没有泄漏,误标 +1。';
    messageT = 3;
  }
}

// ---- 车辆运动:约束在街道网上 ----
function step(dt) {
  const up = keys['w'] || keys['arrowup'];
  const down = keys['s'] || keys['arrowdown'];
  if (up) car.speed = Math.min(MAX_SPEED, car.speed + ACCEL * dt);
  else if (down) car.speed = Math.max(0, car.speed - BRAKE * dt);
  else car.speed = Math.max(0, car.speed - 30 * dt); // 滑行减速

  // 路口转向:靠近路口且发出过转向请求
  const nx = Math.round(car.x / SPACING) * SPACING;
  const ny = Math.round(car.y / SPACING) * SPACING;
  const nearIx = Math.abs(car.x - nx) < TURN_DIST && Math.abs(car.y - ny) < TURN_DIST;
  if (car.turnReq !== 0 && nearIx) {
    car.x = nx; car.y = ny;
    car.heading += car.turnReq * Math.PI / 2;
    car.turnReq = 0;
  }

  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;

  // 吸附到街道线 + 边界
  if (Math.abs(Math.cos(car.heading)) > 0.5) car.y = ny;
  else car.x = nx;
  if (car.x < 0 || car.x > WORLD_SIZE) { car.x = Math.max(0, Math.min(WORLD_SIZE, car.x)); car.speed = 0; }
  if (car.y < 0 || car.y > WORLD_SIZE) { car.y = Math.max(0, Math.min(WORLD_SIZE, car.y)); car.speed = 0; }
}

// ---- 渲染:只画街区、车、阀门室与声压表,不画地下管网 ----
const MAP = 700, PANEL = 140, SCALE = MAP / WORLD_SIZE;

function draw(levels, time) {
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 街区
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#1d2530' : '#1a212b';
      ctx.fillRect(i * SPACING * SCALE + 6, j * SPACING * SCALE + 6,
        SPACING * SCALE - 12, SPACING * SCALE - 12);
    }
  }
  // 街道
  ctx.strokeStyle = '#3a4552';
  ctx.lineWidth = 10;
  for (let k = 0; k <= GRID; k++) {
    ctx.beginPath(); ctx.moveTo(0, k * SPACING * SCALE); ctx.lineTo(MAP, k * SPACING * SCALE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k * SPACING * SCALE, 0); ctx.lineTo(k * SPACING * SCALE, MAP); ctx.stroke();
  }

  // 阀门室(地面设施,可见)
  for (const v of world.valves) {
    ctx.fillStyle = '#6b5b8d';
    ctx.fillRect(v.x * SCALE - 5, v.y * SCALE - 5, 10, 10);
    ctx.strokeStyle = '#9d8fc0';
    ctx.strokeRect(v.x * SCALE - 5, v.y * SCALE - 5, 10, 10);
  }

  // 已修复漏点(找到后才显示)
  for (const l of world.leaks) {
    if (!l.found) continue;
    ctx.fillStyle = '#3fd97e';
    ctx.beginPath();
    ctx.arc(l.x * SCALE, l.y * SCALE, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 车
  ctx.save();
  ctx.translate(car.x * SCALE, car.y * SCALE);
  ctx.rotate(car.heading);
  ctx.fillStyle = '#e8b23a';
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(-7, -6); ctx.lineTo(-7, 6);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  drawPanel(levels, time);
}

function drawPanel(levels, time) {
  const x0 = MAP + 12;
  ctx.fillStyle = '#161c23';
  ctx.fillRect(MAP, 0, PANEL, canvas.height);

  ctx.fillStyle = '#cfe3ff';
  ctx.font = '13px monospace';
  ctx.fillText('声压表 L/R', x0, 24);

  // 左右声道声压条
  const names = ['L', 'R'];
  for (let c = 0; c < 2; c++) {
    const bx = x0 + c * 56;
    ctx.strokeStyle = '#3a4552';
    ctx.strokeRect(bx, 36, 34, 200);
    const h = Math.min(1, levels[c] * 2.2) * 196;
    const grad = ctx.createLinearGradient(0, 236, 0, 36);
    grad.addColorStop(0, '#2f8f5b');
    grad.addColorStop(0.7, '#d8b13c');
    grad.addColorStop(1, '#d84c3c');
    ctx.fillStyle = grad;
    ctx.fillRect(bx + 2, 236 - h, 30, h);
    ctx.fillStyle = '#cfe3ff';
    ctx.fillText(names[c], bx + 12, 252);
  }

  // 车速与信噪比提示
  const s = snr(world, car.x, car.y, car.speed, MAX_SPEED, time);
  ctx.fillStyle = '#9fb2c8';
  ctx.fillText(`车速 ${car.speed.toFixed(0)}`, x0, 290);
  ctx.fillText(`听感 ${(Math.min(1, s / 3) * 100).toFixed(0)}%`, x0, 310);
  const remaining = world.leaks.filter(l => !l.found).length;
  ctx.fillText(`剩余漏点 ${remaining}`, x0, 330);
  ctx.fillText(`误标 ${mistakes}`, x0, 350);
}

// ---- 主循环 ----
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;
  step(dt);
  if (audio.started) audio.update(car, MAX_SPEED, time);
  const levels = audio.started ? audio.levels() : [0, 0];
  draw(levels, time);
  if (messageT > 0) {
    messageT -= dt;
    hud.textContent = message;
  } else {
    hud.textContent = 'W/S 加减速 · A/D 路口转向 · M 标记管段 · R 新局(先点击页面启用声音)';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
