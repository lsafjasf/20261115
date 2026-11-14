import { Camera } from './camera.js';
import { generateCity } from './city.js';
import { SceneRenderer } from './scene.js';
import { RainSystem } from './rain.js';
import { paintReflection } from './reflection.js';
import { DEFAULTS, PRESETS, clamp } from './utils.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');

const state = {
  ...DEFAULTS,
  paused: false,
};

const camera = new Camera(960, 600);
const city = generateCity();
const scene = new SceneRenderer(camera, city);
const rain = new RainSystem(camera);

let sceneDirty = true;
let sceneCanvas = null;
let lastTime = performance.now();
let simTime = 0;

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(320, Math.round(rect.width * dpr));
  const h = Math.max(240, Math.round(rect.height * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  camera.resize(w, h);
  camera.setFocal(state.focal);
  camera.setYaw(state.yaw);
  scene.resize();
  sceneDirty = true;
}

function applySceneParams() {
  camera.setFocal(state.focal);
  camera.setYaw(state.yaw);
  rain.setWind(state.wind);
  rain.setRainfall(state.rainfall);
  sceneDirty = true;
}

// 单条渲染管线：预览与截图共用，保证导出 PNG 与画面完全一致
function renderFrame() {
  if (sceneDirty) {
    sceneCanvas = scene.render();
    sceneDirty = false;
  }
  ctx.clearRect(0, 0, camera.width, camera.height);
  ctx.drawImage(sceneCanvas, 0, 0);
  paintReflection(ctx, sceneCanvas, scene, state.reflection / 100, simTime);
  rain.render(ctx, scene);
}

function tick(now) {
  const dt = clamp((now - lastTime) / 1000, 0, 0.05);
  lastTime = now;
  if (!state.paused) {
    simTime += dt;
    rain.update(dt);
  }
  renderFrame();
  updateHud();
  requestAnimationFrame(tick);
}

function updateHud() {
  document.getElementById('hud-state').textContent = state.paused ? '已暂停' : '运行中';
  document.getElementById('hud-params').textContent =
    `雨量 ${state.rainfall} · 风向 ${state.wind}° · ${state.focal}mm · 反射 ${state.reflection}%`;
}

const sliderMeta = {
  rainfall: (v) => `${v}`,
  wind: (v) => `${v}°`,
  focal: (v) => `${v}mm`,
  yaw: (v) => `${v}°`,
  reflection: (v) => `${v}%`,
};

function syncLabels() {
  for (const key of Object.keys(sliderMeta)) {
    document.getElementById(`${key}-val`).textContent = sliderMeta[key](state[key]);
  }
}

function bindSliders() {
  for (const key of Object.keys(sliderMeta)) {
    const input = document.getElementById(key);
    input.value = state[key];
    input.addEventListener('input', () => {
      state[key] = Number(input.value);
      syncLabels();
      applySceneParams();
    });
  }
}

function applyPreset(preset) {
  Object.assign(state, preset);
  for (const key of ['rainfall', 'wind', 'focal', 'reflection']) {
    document.getElementById(key).value = state[key];
  }
  syncLabels();
  applySceneParams();
}

function bindButtons() {
  const pauseBtn = document.getElementById('btn-pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? '继续' : '暂停';
  });

  document.getElementById('btn-shot').addEventListener('click', exportPng);

  document.getElementById('btn-reset').addEventListener('click', () => {
    Object.assign(state, DEFAULTS, { paused: false });
    pauseBtn.textContent = '暂停';
    for (const key of Object.keys(sliderMeta)) {
      document.getElementById(key).value = state[key];
    }
    syncLabels();
    applySceneParams();
  });

  document.getElementById('btn-light').addEventListener('click', () => applyPreset(PRESETS.light));
  document.getElementById('btn-storm').addEventListener('click', () => applyPreset(PRESETS.storm));
  document.getElementById('btn-compare').addEventListener('click', openCompare);
  document.getElementById('btn-close-compare').addEventListener('click', () => {
    document.getElementById('compare-modal').classList.add('hidden');
  });
}

// 截图直接读取同一画布当前像素，保证与预览一致
function exportPng() {
  renderFrame();
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `night-rain-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

// 拖拽改变视角（偏航），与滑块双向同步
function bindDrag() {
  let dragging = false;
  let startX = 0;
  let startYaw = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startYaw = state.yaw;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const next = clamp(startYaw + (e.clientX - startX) * 0.12, -45, 45);
    state.yaw = Math.round(next);
    document.getElementById('yaw').value = state.yaw;
    syncLabels();
    camera.setYaw(state.yaw);
    sceneDirty = true;
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
}

// 对比图：两个独立渲染管线实例，同一帧时刻并排渲染
function openCompare() {
  const modal = document.getElementById('compare-modal');
  modal.classList.remove('hidden');
  for (const [key, preset] of [['compare-light', PRESETS.light], ['compare-storm', PRESETS.storm]]) {
    const cv = document.getElementById(key);
    const W = 560;
    const H = 360;
    cv.width = W;
    cv.height = H;
    const c2 = new Camera(W, H);
    c2.setFocal(preset.focal);
    const sr = new SceneRenderer(c2, city);
    sr.resize();
    const rr = new RainSystem(c2);
    rr.setWind(preset.wind);
    rr.setRainfall(preset.rainfall);
    // 用确定时间推进若干步，保证两组对比可复现
    for (let i = 0; i < 60; i++) rr.update(1 / 60);
    const c = cv.getContext('2d');
    const built = sr.render();
    c.drawImage(built, 0, 0);
    paintReflection(c, built, sr, preset.reflection / 100, 1);
    rr.render(c, sr);
  }
}

function init() {
  bindSliders();
  bindButtons();
  bindDrag();
  resize();
  applySceneParams();
  syncLabels();
  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(canvas.parentElement);
  }
  window.addEventListener('resize', resize);
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

init();
