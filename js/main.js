// 入口：键盘输入、requestAnimationFrame 循环、调试模式与音频联动

import { TowerGame } from './engine.js';
import { Renderer } from './renderer.js';
import { GameAudio } from './audio.js';

const canvas = document.getElementById('scene');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const muteBtn = document.getElementById('muteBtn');
const debugToggle = document.getElementById('debugToggle');
const speedSelect = document.getElementById('speedSelect');
const breakLinkBtn = document.getElementById('breakLinkBtn');
const helpEl = document.getElementById('help');

const renderer = new Renderer(canvas);
const audio = new GameAudio();

// 让测试加速时五分钟目标依然可玩：速度倍率同时作用于引擎时间
let speedMultiplier = 1;
let debugMode = false;
let running = false;
let lastFrame = 0;

const game = new TowerGame();

const KEY_MAP = {
  KeyA: { side: 'top', action: 'left' },
  KeyD: { side: 'top', action: 'right' },
  KeyW: { side: 'top', action: 'pinIn' },
  KeyS: { side: 'top', action: 'pinOut' },
  KeyF: { side: 'top', action: 'alarm' },
  KeyQ: { side: 'bottom', action: 'main' },
  KeyE: { side: 'bottom', action: 'battery' },
  KeyX: { side: 'bottom', action: 'off' },
  Enter: { side: 'bottom', action: 'alarm' }
};

function onKey(event) {
  const mapped = KEY_MAP[event.code];
  if (!mapped) return;
  event.preventDefault();
  if (!running) return;
  audio.ensureAudio();
  const input = mapped.side === 'top' ? { top: mapped.action } : { bottom: mapped.action };
  const before = game.state();
  game.handleInput(input);
  const after = game.state();
  if (mapped.action === 'alarm') audio.alarm();
  if (mapped.action === 'pinIn' && !before.pinEngaged && after.pinEngaged) audio.pin();
  if (mapped.action === 'main' || mapped.action === 'battery') audio.powerOn();
  if (mapped.action === 'off') audio.powerOff();
}

window.addEventListener('keydown', onKey);

startBtn.addEventListener('click', () => {
  audio.ensureAudio();
  running = true;
  lastFrame = performance.now();
  startBtn.disabled = true;
  helpEl.textContent = '任务进行中：塔顶完成三组更换，塔底守住通信链路五分钟。';
});

resetBtn.addEventListener('click', () => {
  game.reset();
  running = false;
  startBtn.disabled = false;
  helpEl.textContent = '已重置。点击开始任务，或先勾选调试模式进行单人调试。';
  renderFrame();
});

muteBtn.addEventListener('click', () => {
  audio.ensureAudio();
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '取消静音' : '静音';
});

debugToggle.addEventListener('change', () => {
  debugMode = debugToggle.checked;
  breakLinkBtn.disabled = !debugMode;
  document.querySelectorAll('.debug-actions').forEach((group) => {
    group.hidden = !debugMode;
  });
  helpEl.textContent = debugMode
    ? '调试模式：显示双方完整状态，可加速时间、强制断链、用辅助按钮代行另一方操作。'
    : '双人协作模式：两人只能看到各自面板，通过共享报警沟通。';
  renderFrame();
});

speedSelect.addEventListener('change', () => {
  speedMultiplier = Number(speedSelect.value);
});

breakLinkBtn.addEventListener('click', () => {
  if (!debugMode || !running) return;
  game.debugBreakLink();
  audio.linkDown();
});

// 单人调试辅助：按钮直接代行另一方输入
document.querySelectorAll('[data-debug-input]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!debugMode || !running) return;
    const spec = btn.dataset.debugInput.split(':');
    const input = spec[0] === 'top' ? { top: spec[1] } : { bottom: spec[1] };
    game.handleInput(input);
  });
});

function renderFrame() {
  const top = debugMode ? game.state() : game.topView();
  const bottom = debugMode ? game.state() : game.bottomView();
  renderer.render(top, bottom, debugMode);
  renderer.drawAlarms(game.state().alarms, 0, canvas.height - 190, canvas.width, 190);

  const state = game.state();
  if (state.status === 'won') {
    renderer.drawOverlay('任务成功', '三组仪器更换完成，通信链路累计在线五分钟', '#4ade80');
  } else if (state.status === 'lost') {
    renderer.drawOverlay('任务失败', state.lostReason === 'link' ? '通信链路中断超过宽限期' : '任务终止', '#f87171');
  }
}

function loop(now) {
  const rawDt = Math.min(100, now - lastFrame);
  lastFrame = now;
  if (running && game.state().status === 'running') {
    const before = game.state();
    game.update(rawDt * speedMultiplier);
    const after = game.state();
    audio.updateWind(after.windLevel);
    if (before.linkOnline && !after.linkOnline) audio.linkDown();
    if (!before.linkOnline && after.linkOnline) audio.powerOn();
    if (after.status === 'won') {
      running = false;
      audio.win();
    } else if (after.status === 'lost') {
      running = false;
      audio.lose();
    }
  } else {
    audio.updateWind(game.state().windLevel);
  }
  renderFrame();
  requestAnimationFrame(loop);
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  renderFrame();
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
renderFrame();
requestAnimationFrame((t) => {
  lastFrame = t;
  requestAnimationFrame(loop);
});
