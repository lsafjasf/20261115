import {
  createState,
  step,
  setPitch,
  setGate,
  closeGates,
  CONFIG,
  FIELDS,
} from './engine.js';
import { createController, control } from './controller.js';
import { drawScene } from './render.js';
import { SoundEngine } from './audio.js';

const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');
const sound = new SoundEngine();
let state = createState();
let controller = null;
let running = false;
let lastHammerCount = 0;
let acc = 0;
let lastFrame = performance.now();

const $ = (id) => document.getElementById(id);

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function bindControls() {
  $('pitch').addEventListener('input', (e) => {
    controller = null;
    setPitch(state, (Number(e.target.value) * Math.PI) / 180);
  });
  FIELDS.forEach((f) => {
    $(`gate${f.id}`).addEventListener('input', (e) => {
      controller = null;
      setGate(state, f.id, Number(e.target.value) / 100);
    });
  });
  $('auto').addEventListener('click', () => {
    sound.start();
    controller = createController();
    running = true;
  });
  $('pause').addEventListener('click', () => {
    running = !running;
    $('pause').textContent = running ? '暂停' : '继续';
  });
  $('slowClose').addEventListener('click', () => closeGates(state, false));
  $('snapClose').addEventListener('click', () => {
    sound.start();
    closeGates(state, true);
  });
  $('reset').addEventListener('click', reset);
  $('sound').addEventListener('click', () => sound.start());
}

function reset() {
  state = createState();
  controller = null;
  running = false;
  acc = 0;
  lastHammerCount = 0;
  $('pause').textContent = '暂停';
  syncSliders();
}

function syncSliders() {
  const pitchDeg = ((state.pitch * 180) / Math.PI).toFixed(0);
  $('pitch').value = pitchDeg;
  $('pitchVal').textContent = `${pitchDeg}°`;
  FIELDS.forEach((f) => {
    $(`gate${f.id}`).value = Math.round(state.gate[f.id] * 100);
  });
}

function loop(now) {
  const frameDt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (running && !state.finished) {
    acc += frameDt;
    while (acc >= CONFIG.dt) {
      if (controller) control(state, controller);
      step(state);
      acc -= CONFIG.dt;
    }
  }
  if (state.events.length > lastHammerCount) {
    const ev = state.events[state.events.length - 1];
    sound.hammer(ev.peak);
    lastHammerCount = state.events.length;
  }
  sound.update(state);
  const rect = canvas.getBoundingClientRect();
  drawScene(ctx, state, rect.width, rect.height);
  updateReadout();
  requestAnimationFrame(loop);
}

function updateReadout() {
  $('readout').innerHTML =
    `时间 ${state.t.toFixed(1)}/${CONFIG.duration}s · ` +
    `风速 ${state.wind.toFixed(1)}m/s · ` +
    `泵压 ${state.pressure.toFixed(1)}m · ` +
    `耗水 ${state.totalPumped.toFixed(1)}/${CONFIG.budgetLitres}L · ` +
    `湿度 [${state.moisture.map((m) => m.toFixed(0)).join(', ')}]%`;
  const banner = $('banner');
  if (state.finished) {
    banner.textContent =
      state.result === 'success'
        ? `调水成功：${state.t.toFixed(0)}s 完成，耗水 ${state.totalPumped.toFixed(0)}L`
        : `失败：${state.result === 'timeout' ? '超时未达标' : '耗水超标'}`;
    banner.className = state.result === 'success' ? 'ok' : 'fail';
  } else if (state.alarmLatch) {
    banner.textContent = '水锤警报已触发！';
    banner.className = 'fail';
  } else {
    banner.textContent = '风车旱地水车调水模拟';
    banner.className = '';
  }
}

bindControls();
syncSliders();
requestAnimationFrame(loop);
