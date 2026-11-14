import { Sim, TOTAL_PASSENGERS, MAX_TICKS, TICK_S, dirLabel } from './sim.js';
import { draw, CELL } from './render.js';
import { AudioEngine } from './audio.js';

const sim = new Sim();
const audio = new AudioEngine();
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
canvas.width = sim.layout.cols * CELL;
canvas.height = sim.layout.rows * CELL;

const ui = {
  time: document.getElementById('time'),
  evacuated: document.getElementById('evacuated'),
  aboard: document.getElementById('aboard'),
  maxOcc: document.getElementById('maxOcc'),
  risk: document.getElementById('risk'),
  status: document.getElementById('status'),
  events: document.getElementById('events'),
  heatmap: document.getElementById('heatmap'),
  mute: document.getElementById('mute'),
  start: document.getElementById('start'),
  reset: document.getElementById('reset'),
};

let running = false;
let lastTs = 0;
let acc = 0;
let alarmAnnounced = false;
const heatOpts = { heatmap: true };

function refreshHud() {
  const m = sim.metrics;
  ui.time.textContent = `${sim.time.toFixed(1)}s / 120s`;
  ui.evacuated.textContent = `${sim.evacuated}/${TOTAL_PASSENGERS}`;
  ui.aboard.textContent = sim.agents.length;
  ui.maxOcc.textContent = m.maxOccupancy;
  ui.risk.textContent = m.riskTicks;
  ui.status.textContent = sim.over
    ? (sim.result.win ? '✅ 疏散成功' : '❌ 疏散失败')
    : (running ? '运行中' : '已暂停');
  ui.status.className = sim.over ? (sim.result.win ? 'ok' : 'bad') : '';
  ui.events.innerHTML = sim.events
    .slice(-7)
    .map((e) => `<li><span>${e.time.toFixed(1)}s</span>${e.text}</li>`)
    .join('');
}

function frame(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.1, (ts - lastTs) / 1000);
  lastTs = ts;
  if (running && !sim.over) {
    acc += dt;
    while (acc >= TICK_S) {
      sim.step();
      acc -= TICK_S;
      handleAlarms();
      if (sim.over) {
        running = false;
        audio.stopSiren();
        audio.fanfare(sim.result.win);
        break;
      }
    }
  }
  heatOpts.heatmap = ui.heatmap.checked;
  draw(ctx, sim, heatOpts);
  refreshHud();
  requestAnimationFrame(frame);
}

function handleAlarms() {
  const anyAlarm = sim.layout.sensors.some((s) => s.alarm);
  if (anyAlarm && !alarmAnnounced) {
    alarmAnnounced = true;
    audio.startSiren();
    audio.broadcast('请注意，站台检测到烟雾，请听从指引，沿最近通道有序疏散，不要停留。');
  }
  if (!anyAlarm && alarmAnnounced) {
    alarmAnnounced = false;
    audio.stopSiren();
  }
}

// 点击：闸门/通道循环切换 双向 -> 单向向上 -> 关闭；点击风扇切换开关
canvas.addEventListener('click', (e) => {
  audio.resume();
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width / CELL);
  const row = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height / CELL);
  const fan = sim.layout.fans.find((f) => f.row === row && f.col === col);
  if (fan) {
    sim.toggleFan(fan.id);
    audio.click();
    return;
  }
  const ctl = sim.controlAt(row, col);
  if (ctl) {
    sim.cycleControl(ctl.id);
    audio.click();
    audio.broadcast(`通道 ${ctl.id} 已调整为${dirLabel(ctl.dir)}。`);
  }
});

ui.start.addEventListener('click', () => {
  audio.resume();
  if (sim.over) return;
  running = !running;
  ui.start.textContent = running ? '暂停' : '开始';
});

ui.reset.addEventListener('click', () => {
  location.reload();
});

ui.mute.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  ui.mute.textContent = audio.muted ? '取消静音' : '静音';
});

ui.heatmap.addEventListener('change', () => { heatOpts.heatmap = ui.heatmap.checked; });

requestAnimationFrame(frame);
refreshHud();
