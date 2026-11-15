import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import "@fontsource-variable/noto-sans-sc";
import "./styles.css";
import { AmbientEngine } from "./audio.js";
import { SceneRenderer, hitTestHandle } from "./renderer.js";
import {
  DURATION,
  FPS,
  HEIGHT,
  LAYER_META,
  LAYER_ORDER,
  SCENES,
  WIDTH,
  clamp,
  cloneScenes,
  evaluateScene,
} from "./scenes.js";
import { exportProject, exportWebM } from "./exporter.js";

const PLAY_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.8v12.4L18.5 12 8 5.8Z" fill="currentColor"/>
  </svg>`;
const PAUSE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="7" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/>
    <rect x="13.5" y="5.5" width="3.5" height="13" rx="1" fill="currentColor"/>
  </svg>`;
const SOUND_ON_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 9v6h4l5 4V5L9 9H5Z" fill="currentColor"/>
    <path d="M17 8.5c2 1.8 2 5.2 0 7M19.5 6c3.4 3.3 3.4 8.7 0 12" fill="none" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;
const SOUND_OFF_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 9v6h4l5 4V5L9 9H5Z" fill="currentColor"/>
    <path d="m17 9 5 6M22 9l-5 6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;

const app = document.querySelector("#app");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Focal Drift 首页">
        <span class="brand-mark"><i></i><i></i><i></i></span>
        <span class="brand-copy">
          <b>FOCAL DRIFT</b>
          <small>焦点转场工作台</small>
        </span>
      </a>
      <nav class="scene-switch" id="scene-switch" aria-label="场景选择"></nav>
      <div class="top-actions">
        <button class="button button-quiet" id="export-json" type="button">
          <span class="json-glyph">{ }</span>工程 JSON
        </button>
        <button class="button button-primary" id="export-webm" type="button">
          <span class="record-dot"></span>导出 WebM
        </button>
      </div>
    </header>

    <main class="workspace">
      <section class="stage-column">
        <div class="stage-heading">
          <div class="scene-heading">
            <span class="section-index" id="scene-index">01 / 02</span>
            <div>
              <h1 id="scene-title">雾岭晨光</h1>
              <p id="scene-subtitle">MIST / PINES</p>
            </div>
          </div>
          <div class="render-badge">
            <i></i>
            <span>LIVE 2D COMPOSITE</span>
            <b>${WIDTH} × ${HEIGHT}</b>
          </div>
        </div>

        <div class="stage-frame" id="stage-frame">
          <canvas id="stage" width="${WIDTH}" height="${HEIGHT}" aria-label="焦点转场预览画布"></canvas>
          <div class="stage-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <div class="canvas-meta canvas-meta-left" aria-hidden="true">
            <span>CAM A</span><i></i><span>FOCUS PULL</span>
          </div>
          <div class="canvas-meta canvas-meta-right" aria-hidden="true">
            <span id="canvas-fps">${FPS} FPS</span><i></i><span>sRGB</span>
          </div>
          <div class="focus-pill">
            <span class="pill-orbit"><i></i></span>
            <span>焦点 <b id="focus-layer-pill">前景</b></span>
            <em id="focus-percent-pill">0%</em>
          </div>
        </div>

        <div class="transport">
          <div class="transport-row">
            <button class="play-button" id="play-button" type="button" aria-label="播放">${PLAY_ICON}</button>
            <div class="timecode">
              <span id="current-time">00:00.00</span>
              <small>/ 00:08.00</small>
            </div>
            <div class="transport-tools">
              <button class="tool-button is-active" id="path-toggle" type="button">
                <span class="tool-icon">⌁</span>焦点曲线
              </button>
              <button class="tool-button is-active" id="sound-toggle" type="button">
                ${SOUND_ON_ICON}<span>氛围声</span>
              </button>
            </div>
          </div>

          <div class="timeline" id="timeline">
            <div class="time-ruler" id="time-ruler"></div>
            <div class="layer-bands" id="layer-bands"></div>
            <div class="playhead" id="playhead"><span></span></div>
            <input class="scrubber" id="scrubber" type="range" min="0" max="${DURATION}" step="0.001" value="0" aria-label="播放头" />
          </div>
          <div class="timeline-legend" id="timeline-legend"></div>
        </div>
      </section>

      <aside class="inspector">
        <div class="inspector-heading">
          <div>
            <span class="section-index">LAYER CONTROL</span>
            <h2>图层与焦点</h2>
          </div>
          <span class="draft-badge">SCENE <b id="inspector-scene-no">01</b></span>
        </div>

        <div class="inspector-scroll">
          <section class="layer-controls" id="layer-controls" aria-label="图层参数"></section>

          <section class="focus-card">
            <div class="card-heading">
              <div>
                <span class="section-index">CAMERA</span>
                <h3>曲线焦点</h3>
              </div>
              <button class="text-button" id="reset-path" type="button">重置曲线</button>
            </div>
            <div class="focus-readout">
              <div class="focus-orb"><span></span></div>
              <div class="focus-copy">
                <small>当前对焦</small>
                <strong id="focused-layer">前景</strong>
              </div>
              <b id="focus-percent">0%</b>
            </div>
            <p class="focus-hint">拖动画面中的 1–4 号控制点。镜头沿三次贝塞尔曲线移动，焦点与各层距离实时驱动景深模糊。</p>
            <div class="curve-scale"><i></i><i></i><i></i><i></i><span>FOCUS IN</span><span>FOCUS OUT</span></div>
          </section>
        </div>

        <div class="inspector-footer">
          <div class="output-line">
            <span>OUTPUT</span>
            <b>8.00s · 30 fps · WebM</b>
          </div>
          <p>两景参数独立保存。工程 JSON 包含两套图层、曲线与当前场景。</p>
        </div>
      </aside>
    </main>
  </div>

  <div class="export-overlay" id="export-overlay" aria-hidden="true">
    <div class="export-dialog">
      <div class="export-dialog-top">
        <span><i></i> VIDEO RENDER</span>
        <b id="export-percent">0%</b>
      </div>
      <h3>正在合成八秒焦点转场</h3>
      <p>Canvas 2D 多层实时合成 · Web Audio 氛围声 · VP9 / Opus</p>
      <div class="export-progress"><i id="export-bar"></i></div>
      <div class="export-clock"><span id="export-clock">00.00 / 08.00s</span><span>请保持窗口可见</span></div>
    </div>
  </div>
  <div class="toast" id="toast" role="status"></div>
`;

const canvas = document.querySelector("#stage");
const renderer = new SceneRenderer(canvas);
const audio = new AmbientEngine();

const state = {
  scenes: cloneScenes(),
  activeSceneId: "grove",
  time: 1.4,
  playing: false,
  showPath: true,
  soundOn: true,
  selectedHandle: -1,
  draggingHandle: -1,
  exportBusy: false,
};

let animationFrame = 0;
let lastFrameTime = 0;
let toastTimer = 0;

const $ = (selector) => document.querySelector(selector);
const activeScene = () => state.scenes.find((scene) => scene.id === state.activeSceneId);
const originalScene = (id) => SCENES.find((scene) => scene.id === id);

function formatTime(seconds) {
  const safe = clamp(seconds, 0, DURATION);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const hundredths = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(
    hundredths,
  ).padStart(2, "0")}`;
}

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  const percent = ((value - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${percent}%`);
}

function showToast(message, tone = "default") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function buildSceneTabs() {
  $("#scene-switch").innerHTML = state.scenes
    .map(
      (scene, index) => `
        <button class="scene-tab${scene.id === state.activeSceneId ? " is-active" : ""}"
          type="button" data-scene-id="${scene.id}" aria-selected="${
            scene.id === state.activeSceneId
          }">
          <span class="scene-tab-index">${String(index + 1).padStart(2, "0")}</span>
          <span class="scene-tab-copy"><b>${scene.name}</b><small>${scene.subtitle}</small></span>
          <span class="scene-tab-dot"></span>
        </button>`,
    )
    .join("");
}

function buildTimeRuler() {
  const ruler = $("#time-ruler");
  ruler.innerHTML = Array.from({ length: 17 }, (_, index) => {
    const seconds = index * 0.5;
    const left = (seconds / DURATION) * 100;
    const major = index % 2 === 0;
    return `
      <span class="ruler-tick${major ? " is-major" : ""}" style="left:${left}%">
        <i></i>${major ? `<b>${String(seconds).padStart(2, "0")}s</b>` : ""}
      </span>`;
  }).join("");
}

function buildTimelineLegend() {
  $("#timeline-legend").innerHTML = LAYER_ORDER.map((id) => {
    const meta = LAYER_META[id];
    return `<span class="legend-item"><i style="--dot:${meta.color}"></i>${meta.label}<b data-legend-start="${id}"></b></span>`;
  }).join("");
}

function updateTimelineBands() {
  const scene = activeScene();
  const bands = $("#layer-bands");
  bands.innerHTML = LAYER_ORDER.map((id, index) => {
    const config = scene.layers[id];
    const left = (config.appear / DURATION) * 100;
    const width = (Math.min(config.fade, DURATION - config.appear) / DURATION) * 100;
    const meta = LAYER_META[id];
    return `
      <div class="layer-band" style="--band:${meta.color};--top:${
        index * 9
      }px;left:${left}%;width:${Math.max(width, 1.5)}%">
        <span>${meta.short}</span>
      </div>`;
  }).join("");
  LAYER_ORDER.forEach((id) => {
    const element = document.querySelector(`[data-legend-start="${id}"]`);
    if (element) element.textContent = `${scene.layers[id].appear.toFixed(2)}s`;
  });
}

function sliderRow({ layerId, key, label, min, max, step, value, suffix, digits = 1 }) {
  return `
    <div class="control-group">
      <div class="control-label">
        <label for="${key}-${layerId}">${label}</label>
        <output data-output="${key}-${layerId}">${Number(value).toFixed(digits)}<small>${suffix}</small></output>
      </div>
      <input id="${key}-${layerId}" data-layer="${layerId}" data-key="${key}"
        type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    </div>`;
}

function buildLayerControls() {
  const scene = activeScene();
  const ordered = LAYER_ORDER.slice().reverse();
  $("#layer-controls").innerHTML = ordered
    .map((id) => {
      const meta = LAYER_META[id];
      const config = scene.layers[id];
      return `
        <article class="layer-card" data-layer-card="${id}" style="--layer-color:${meta.color}">
          <div class="layer-card-head">
            <span class="z-index">Z 0${meta.z}</span>
            <span class="layer-identity"><i></i><h3>${meta.label}</h3><small>${meta.short}</small></span>
            <span class="focus-tag" data-focus-tag="${id}">FOCUS</span>
          </div>
          ${sliderRow({
            layerId: id,
            key: "blur",
            label: "模糊半径",
            min: 0,
            max: 24,
            step: 0.5,
            value: config.blur,
            suffix: " px",
          })}
          <div class="paired-controls">
            ${sliderRow({
              layerId: id,
              key: "appear",
              label: "出现时机",
              min: 0,
              max: 7.5,
              step: 0.01,
              value: config.appear,
              suffix: " s",
              digits: 2,
            })}
            ${sliderRow({
              layerId: id,
              key: "fade",
              label: "淡入时长",
              min: 0.1,
              max: 2.5,
              step: 0.01,
              value: config.fade,
              suffix: " s",
              digits: 2,
            })}
          </div>
          <div class="effective-row">
            <span>当前模糊</span>
            <b data-effective="${id}">0.0</b><small>px</small>
            <i class="effective-bar"><span data-effective-bar="${id}"></span></i>
          </div>
        </article>`;
    })
    .join("");

  document.querySelectorAll("#layer-controls input[type=range]").forEach(setRangeFill);
}

function syncControlOutputs() {
  const scene = activeScene();
  document.querySelectorAll("#layer-controls input[data-key]").forEach((input) => {
    const config = scene.layers[input.dataset.layer];
    const key = input.dataset.key;
    input.value = config[key];
    setRangeFill(input);
    const output = document.querySelector(`[data-output="${key}-${input.dataset.layer}"]`);
    const digits = key === "blur" ? 1 : 2;
    const suffix = key === "blur" ? " px" : " s";
    output.innerHTML = `${Number(config[key]).toFixed(digits)}<small>${suffix}</small>`;
  });
}

function syncSceneChrome() {
  const scene = activeScene();
  const index = state.scenes.findIndex((item) => item.id === scene.id) + 1;
  $("#scene-index").textContent = `${String(index).padStart(2, "0")} / 02`;
  $("#scene-title").textContent = scene.name;
  $("#scene-subtitle").textContent = scene.subtitle;
  $("#inspector-scene-no").textContent = String(index).padStart(2, "0");
  document.querySelectorAll(".scene-tab").forEach((tab) => {
    const active = tab.dataset.sceneId === scene.id;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function updateDynamicReadouts(composition) {
  const timeLabel = formatTime(state.time);
  $("#current-time").textContent = timeLabel;
  $("#scrubber").value = state.time;
  $("#playhead").style.left = `${(state.time / DURATION) * 100}%`;

  const layerMeta = LAYER_META[composition.focusedLayer];
  const percent = Math.round(composition.progress * 100);
  $("#focus-layer-pill").textContent = layerMeta.label;
  $("#focus-percent-pill").textContent = `${percent}%`;
  $("#focused-layer").textContent = layerMeta.label;
  $("#focus-percent").textContent = `${percent}%`;

  composition.layers.forEach((layer) => {
    const card = document.querySelector(`[data-layer-card="${layer.id}"]`);
    if (!card) return;
    card.classList.toggle("is-focused", layer.id === composition.focusedLayer);
    const focusTag = document.querySelector(`[data-focus-tag="${layer.id}"]`);
    focusTag.classList.toggle("is-visible", layer.id === composition.focusedLayer);
    const effective = document.querySelector(`[data-effective="${layer.id}"]`);
    const bar = document.querySelector(`[data-effective-bar="${layer.id}"]`);
    effective.textContent = layer.blur.toFixed(1);
    bar.style.width = `${Math.min(100, (layer.blur / 24) * 100)}%`;
  });
}

function renderCurrent(editor = !state.playing) {
  if (state.exportBusy) return null;
  const composition = renderer.render(activeScene(), state.time, {
    editor: editor && state.showPath,
    selectedHandle: state.selectedHandle,
  });
  updateDynamicReadouts(composition);
  return composition;
}

function selectScene(sceneId) {
  if (state.exportBusy || sceneId === state.activeSceneId) return;
  pausePlayback();
  state.activeSceneId = sceneId;
  state.selectedHandle = -1;
  state.draggingHandle = -1;
  syncSceneChrome();
  buildLayerControls();
  updateTimelineBands();
  renderCurrent(true);
}

function handleLayerInput(input) {
  const scene = activeScene();
  const layerId = input.dataset.layer;
  const key = input.dataset.key;
  let value = Number(input.value);
  if (key === "appear") value = clamp(value, 0, DURATION - 0.1);
  if (key === "fade") value = clamp(value, 0.1, 2.5);
  if (key === "blur") value = clamp(value, 0, 24);
  scene.layers[layerId][key] = value;
  setRangeFill(input);

  const output = document.querySelector(`[data-output="${key}-${layerId}"]`);
  const suffix = key === "blur" ? " px" : " s";
  const digits = key === "blur" ? 1 : 2;
  output.innerHTML = `${value.toFixed(digits)}<small>${suffix}</small>`;
  if (key === "appear" || key === "fade") updateTimelineBands();
  renderCurrent(true);
}

function updatePlayButton() {
  const button = $("#play-button");
  button.innerHTML = state.playing ? PAUSE_ICON : PLAY_ICON;
  button.setAttribute("aria-label", state.playing ? "暂停" : "播放");
  button.classList.toggle("is-playing", state.playing);
}

function pausePlayback() {
  state.playing = false;
  lastFrameTime = 0;
  cancelAnimationFrame(animationFrame);
  updatePlayButton();
  audio.setPlaying(false).catch(() => {});
}

function finishPlayback() {
  state.time = DURATION;
  pausePlayback();
  renderCurrent(false);
  showToast("转场预览已结束");
}

function tick(now) {
  if (!state.playing) return;
  if (!lastFrameTime) lastFrameTime = now;
  const delta = Math.min(0.08, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  state.time = Math.min(DURATION, state.time + delta);
  renderCurrent(false);
  if (state.time >= DURATION) {
    finishPlayback();
    return;
  }
  animationFrame = requestAnimationFrame(tick);
}

async function startPlayback() {
  if (state.exportBusy) return;
  if (state.time >= DURATION - 0.001) state.time = 0;
  state.playing = true;
  lastFrameTime = 0;
  updatePlayButton();
  audio.setPlaying(true).catch(() => showToast("浏览器未允许音频播放", "error"));
  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(tick);
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
    renderCurrent(true);
  } else {
    startPlayback();
  }
}

function syncSoundButton() {
  const button = $("#sound-toggle");
  button.classList.toggle("is-active", state.soundOn);
  button.setAttribute("aria-pressed", String(state.soundOn));
  button.innerHTML = `${state.soundOn ? SOUND_ON_ICON : SOUND_OFF_ICON}<span>氛围声</span>`;
}

function setExportBusy(busy) {
  state.exportBusy = busy;
  [$("#export-webm"), $("#export-json")].forEach((button) => {
    button.disabled = busy;
  });
  document.querySelectorAll(".scene-tab").forEach((button) => {
    button.disabled = busy;
  });
}

function setExportProgress(elapsed) {
  const percent = Math.round((elapsed / DURATION) * 100);
  $("#export-percent").textContent = `${percent}%`;
  $("#export-bar").style.width = `${percent}%`;
  $("#export-clock").textContent = `${elapsed.toFixed(2).padStart(5, "0")} / 08.00s`;
  state.time = elapsed;
  updateDynamicReadouts(evaluateScene(activeScene(), elapsed));
}

async function runWebMExport() {
  if (state.exportBusy) return;
  pausePlayback();
  setExportBusy(true);
  state.time = 0;
  const overlay = $("#export-overlay");
  overlay.classList.add("is-visible");
  overlay.setAttribute("aria-hidden", "false");
  overlay.querySelector("h3").textContent = "正在合成八秒焦点转场";
  setExportProgress(0);

  try {
    const result = await exportWebM({
      renderer,
      scene: activeScene(),
      audio,
      onProgress: setExportProgress,
    });
    overlay.classList.add("is-complete");
    overlay.querySelector("h3").textContent = "八秒转场已导出";
    showToast(`${result.filename} · ${result.mimeType.split(";")[0]}`);
    state.time = 0;
    await new Promise((resolve) => setTimeout(resolve, 850));
  } catch (error) {
    console.error(error);
    overlay.querySelector("h3").textContent = "导出失败";
    showToast(error.message || "WebM 导出失败", "error");
    await new Promise((resolve) => setTimeout(resolve, 1300));
  } finally {
    overlay.classList.remove("is-visible", "is-complete");
    overlay.setAttribute("aria-hidden", "true");
    setExportBusy(false);
    renderCurrent(true);
  }
}

function exportJSON() {
  if (state.exportBusy) return;
  exportProject(state.scenes, state.activeSceneId);
  showToast("工程 JSON 已导出 · 两景参数独立");
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
}

function handleCanvasPointerDown(event) {
  if (!state.showPath || state.playing || state.exportBusy) return;
  const scene = activeScene();
  const point = canvasPoint(event);
  const handle = hitTestHandle(scene, point);
  if (handle < 0) return;
  event.preventDefault();
  state.selectedHandle = handle;
  state.draggingHandle = handle;
  canvas.setPointerCapture(event.pointerId);
  renderCurrent(true);
}

function handleCanvasPointerMove(event) {
  if (state.draggingHandle < 0 || state.exportBusy) return;
  const scene = activeScene();
  const point = canvasPoint(event);
  scene.focus.points[state.draggingHandle] = {
    x: clamp(point.x, 0.02, 0.98),
    y: clamp(point.y, 0.04, 0.96),
  };
  renderCurrent(true);
}

function finishCanvasDrag(event) {
  if (state.draggingHandle < 0) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  state.draggingHandle = -1;
  renderCurrent(true);
}

function bindEvents() {
  $("#play-button").addEventListener("click", togglePlayback);
  $("#scrubber").addEventListener("input", (event) => {
    state.time = clamp(Number(event.target.value), 0, DURATION);
    if (state.playing) lastFrameTime = performance.now();
    renderCurrent(!state.playing);
  });
  $("#layer-controls").addEventListener("input", (event) => {
    if (event.target.matches("input[type=range]")) handleLayerInput(event.target);
  });
  $("#scene-switch").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-scene-id]");
    if (tab) selectScene(tab.dataset.sceneId);
  });
  $("#path-toggle").addEventListener("click", () => {
    state.showPath = !state.showPath;
    $("#path-toggle").classList.toggle("is-active", state.showPath);
    renderCurrent(!state.playing);
  });
  $("#sound-toggle").addEventListener("click", async () => {
    state.soundOn = !state.soundOn;
    try {
      await audio.toggleMute();
    } catch {
      state.soundOn = false;
    }
    syncSoundButton();
  });
  $("#reset-path").addEventListener("click", () => {
    const scene = activeScene();
    const original = originalScene(scene.id);
    scene.focus.points = original.focus.points.map((point) => ({ ...point }));
    state.selectedHandle = -1;
    renderCurrent(true);
    showToast("焦点曲线已重置");
  });
  $("#export-webm").addEventListener("click", runWebMExport);
  $("#export-json").addEventListener("click", exportJSON);

  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", (event) => {
    if (state.draggingHandle >= 0) {
      handleCanvasPointerMove(event);
      return;
    }
    if (state.playing || !state.showPath) {
      canvas.style.cursor = "default";
      return;
    }
    canvas.style.cursor = hitTestHandle(activeScene(), canvasPoint(event)) >= 0 ? "grab" : "default";
  });
  canvas.addEventListener("pointerup", finishCanvasDrag);
  canvas.addEventListener("pointercancel", finishCanvasDrag);
  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space") return;
    const tag = event.target.tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "TEXTAREA") return;
    event.preventDefault();
    togglePlayback();
  });
}

function installDebugApi() {
  window.__focal = {
    ready: true,
    duration: DURATION,
    fps: FPS,
    getState: () =>
      JSON.parse(
        JSON.stringify({
          activeSceneId: state.activeSceneId,
          time: state.time,
          playing: state.playing,
          showPath: state.showPath,
          soundOn: state.soundOn,
          scenes: state.scenes,
        }),
      ),
    getLayerOrder: () => LAYER_ORDER.slice(),
    getComposition: (time = state.time, sceneId = state.activeSceneId) => {
      const scene = state.scenes.find((item) => item.id === sceneId);
      return evaluateScene(scene, time);
    },
    setTime: (time) => {
      state.time = clamp(Number(time), 0, DURATION);
      if (state.playing) lastFrameTime = performance.now();
      renderCurrent(!state.playing);
      return state.time;
    },
    setScene: (sceneId) => {
      selectScene(sceneId);
      return state.activeSceneId;
    },
    setLayer: (sceneId, layerId, key, value) => {
      const scene = state.scenes.find((item) => item.id === sceneId);
      if (!scene || !scene.layers[layerId] || !(key in scene.layers[layerId])) {
        throw new Error("Unknown scene layer parameter");
      }
      scene.layers[layerId][key] = Number(value);
      if (scene.id === state.activeSceneId) {
        syncControlOutputs();
        updateTimelineBands();
        renderCurrent(true);
      }
      return { ...scene.layers[layerId] };
    },
  };
}

buildSceneTabs();
buildTimeRuler();
buildTimelineLegend();
syncSceneChrome();
buildLayerControls();
updateTimelineBands();
syncSoundButton();
bindEvents();
renderCurrent(true);
installDebugApi();
