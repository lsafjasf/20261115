import { MATERIALS, MATERIAL_IDS, ROOM_LIMITS } from "./materials.js";
import { DEFAULT_STATE, computeAcoustics, computePaths, clampDimensions } from "./acoustics.js";
import { StudioEngine } from "./engine.js";
import { RoomView } from "./roomview.js";
import { Visualizers } from "./viz.js";
import {
  loadPresets, savePreset, deletePreset, loadSession, saveSession,
} from "./presets.js";

const $ = (id) => document.getElementById(id);

const state = loadSession();
let engine = null;
let lastAc = null;
let saveTimer = null;

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSession(state), 250);
}

function refreshAll() {
  lastAc = computeAcoustics(state);
  const paths = computePaths(state);
  roomView.setPaths(paths);
  renderMetrics(lastAc);
  renderPaths(paths);
  renderDims();
  if (engine) {
    engine.updateFDN(lastAc);
    engine.updateEarly(state);
  }
  persistSoon();
}

function renderDims() {
  $("dimsLabel").textContent =
    `宽 ${state.width.toFixed(2)} m × 深 ${state.depth.toFixed(2)} m × 高 ${state.height.toFixed(2)} m`;
}

function renderMetrics(ac) {
  const paths = computePaths(state);
  const firstOrder = paths.filter((p) => p.order === 1)
    .sort((a, b) => a.relDelay - b.relDelay);
  const first = firstOrder[0];
  const earlySpread = firstOrder.at(-1).relDelay - first.relDelay;
  $("metrics").innerHTML = `
    <div class="metric"><div class="k">RT60 理论（Eyring）</div>
      <div class="v">${ac.rt60.toFixed(2)}<small> s</small></div></div>
    <div class="metric"><div class="k">平均吸声系数</div>
      <div class="v">${ac.alphaAvg.toFixed(3)}</div></div>
    <div class="metric"><div class="k">首条早期反射延迟</div>
      <div class="v">${(first.relDelay * 1000).toFixed(1)}<small> ms</small></div></div>
    <div class="metric"><div class="k">一次反射时间跨度</div>
      <div class="v">${(earlySpread * 1000).toFixed(0)}<small> ms</small></div></div>
    <div class="metric"><div class="k">房间容积</div>
      <div class="v">${ac.volume.toFixed(1)}<small> m³</small></div></div>
    <div class="metric"><div class="k">高频阻尼截止</div>
      <div class="v">${(ac.dampingCutoff / 1000).toFixed(1)}<small> kHz</small></div></div>
  `;
}

function renderPaths(paths) {
  const rows = paths.map((p) => `
    <tr>
      <td>${p.order === 0 ? "⚪" : p.order === 1 ? "🔵" : "🟡"} ${p.label}</td>
      <td>${p.order} 阶</td>
      <td>${(p.relDelay * 1000).toFixed(1)} ms</td>
      <td>${p.distance.toFixed(2)} m</td>
      <td>${(20 * Math.log10(p.gain + 1e-6)).toFixed(1)} dB</td>
    </tr>`).join("");
  $("pathsTable").innerHTML =
    `<thead><tr><th>路径</th><th>阶数</th><th>相对延迟</th><th>路程</th><th>相对幅度</th></tr></thead><tbody>${rows}</tbody>`;
}

// ---------- 材质面板与拖放 ----------
function buildPalette() {
  const pal = $("palette");
  pal.innerHTML = "";
  MATERIAL_IDS.forEach((id) => {
    const m = MATERIALS[id];
    const chip = document.createElement("div");
    chip.className = "mat-chip";
    chip.draggable = true;
    chip.dataset.matId = id;
    chip.innerHTML = `<span class="mat-swatch" style="background:${m.color}"></span>${m.name}<small>α=${m.alpha}</small>`;
    chip.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/material-id", id);
      e.dataTransfer.effectAllowed = "copy";
      const ghost = $("dragGhost");
      ghost.textContent = `${m.name} → 拖到墙上`;
      ghost.hidden = false;
      e.dataTransfer.setDragImage(ghost, 80, 12);
    });
    chip.addEventListener("dragend", () => { $("dragGhost").hidden = true; });
    // 点击材质 → 点击墙（触屏/无拖放兜底）
    chip.addEventListener("click", () => {
      pendingMaterial = pendingMaterial === id ? null : id;
      pal.querySelectorAll(".mat-chip").forEach((el) =>
        el.style.outline = el.dataset.matId === pendingMaterial ? "2px solid #4cc2ff" : "none");
    });
    pal.appendChild(chip);
  });
}

let pendingMaterial = null;

// ---------- 房间视图 ----------
const roomView = new RoomView($("roomCanvas"), state, {
  onResize: (partial) => {
    Object.assign(state, clampDimensions({ ...state, ...partial }));
    refreshAll();
  },
  onMaterialDrop: (wall, matId) => {
    state.walls[wall] = matId;
    refreshAll();
  },
});
window.__roomView = roomView; // 供自动化测试取精确几何

// 点击墙面应用待选材质（兜底交互）
$("roomCanvas").addEventListener("click", (e) => {
  if (!pendingMaterial) return;
  const b = e.target.getBoundingClientRect();
  const p = {
    x: (e.clientX - b.left) * (e.target.width / b.width),
    y: (e.clientY - b.top) * (e.target.height / b.height),
  };
  const wall = roomView.hitWall(p.x, p.y);
  if (wall && wall !== "front") {
    state.walls[wall] = pendingMaterial;
    refreshAll();
  }
});

// ---------- 引擎与播放 ----------
async function ensureEngine() {
  if (engine) { await engine.resume(); return engine; }
  engine = new StudioEngine();
  await engine.init(state, computeAcoustics(state));
  window.__engine = engine;
  refreshAll();
  return engine;
}

$("playBtn").addEventListener("click", async () => {
  const eng = await ensureEngine();
  if (eng.drums.playing) {
    eng.drums.stop();
    $("playBtn").textContent = "▶ 开始鼓循环";
  } else {
    eng.drums.start();
    $("playBtn").textContent = "⏸ 停止鼓循环";
  }
});

$("kickBtn").addEventListener("click", async () => {
  const eng = await ensureEngine();
  eng.drums.kick(eng.ctx.currentTime + 0.01);
});

$("measureBtn").addEventListener("click", async () => {
  const eng = await ensureEngine();
  const ac = computeAcoustics(state);
  eng.drums.kick(eng.ctx.currentTime + 0.01, 1);
  viz.markPulse();
  // 渲染窗口必须覆盖完整 T30 区间，否则拟合会被截断
  const renderSec = Math.min(8, Math.max(3, ac.rt60 * 2.5 + 0.6));
  $("measureResult").textContent = "离线渲染脉冲响应中…";
  const result = await eng.offlineRT60(ac, renderSec);
  $("measureResult").innerHTML =
    `实测 RT60（${result.method} 拟合）：<b>${result.rt60.toFixed(2)} s</b> ｜ ` +
    `理论 Eyring：<b>${ac.rt60.toFixed(2)} s</b>`;
});

// ---------- 滑杆 ----------
const hSlider = $("heightSlider"), wSlider = $("wetSlider");
hSlider.value = state.height;
wSlider.value = state.wet;
$("heightVal").textContent = state.height.toFixed(2);
$("wetVal").textContent = state.wet.toFixed(2);

hSlider.addEventListener("input", () => {
  state.height = clampDimensions({ ...state, height: +hSlider.value }).height;
  $("heightVal").textContent = state.height.toFixed(2);
  refreshAll();
});
wSlider.addEventListener("input", () => {
  state.wet = +wSlider.value;
  $("wetVal").textContent = state.wet.toFixed(2);
  if (engine) engine.setWet(state.wet);
  persistSoon();
});

// ---------- 预设 ----------
function renderPresetList() {
  const ul = $("presetList");
  const list = loadPresets();
  ul.innerHTML = list.length ? "" : `<li class="meta">还没有保存的预设</li>`;
  list.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="name">${p.name}<br><span class="meta">
      ${p.savedAt} · ${p.state.width.toFixed(1)}×${p.state.depth.toFixed(1)}×${p.state.height.toFixed(1)} m</span></span>`;
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "恢复";
    loadBtn.addEventListener("click", () => applyState(p.state));
    const delBtn = document.createElement("button");
    delBtn.textContent = "删除";
    delBtn.className = "danger";
    delBtn.addEventListener("click", () => { deletePreset(p.id); renderPresetList(); });
    li.append(loadBtn, delBtn);
    ul.appendChild(li);
  });
}

$("savePresetBtn").addEventListener("click", () => {
  const name = $("presetName").value.trim() || `预设 ${loadPresets().length + 1}`;
  savePreset(name, state);
  $("presetName").value = "";
  renderPresetList();
});

function applyState(next) {
  const dims = clampDimensions(next);
  Object.assign(state, dims);
  state.walls = { ...next.walls };
  state.wet = next.wet ?? DEFAULT_STATE.wet;
  hSlider.value = state.height;
  wSlider.value = state.wet;
  $("heightVal").textContent = state.height.toFixed(2);
  $("wetVal").textContent = state.wet.toFixed(2);
  if (engine) engine.setWet(state.wet);
  refreshAll();
}

// ---------- 场景对比 ----------
const SCENES = {
  small: {
    name: "小房间",
    state: { width: 3.0, depth: 3.2, height: 2.4, wet: 0.35,
      walls: { left: "wood", right: "wood", back: "acoustic" } },
  },
  hall: {
    name: "长走廊",
    state: { width: 2.6, depth: 22, height: 3.2, wet: 0.45,
      walls: { left: "concrete", right: "concrete", back: "plaster" } },
  },
};

function sceneMetrics(s) {
  const ac = computeAcoustics(s);
  const paths = computePaths(s);
  const firstOrder = paths.filter((p) => p.order === 1)
    .sort((a, b) => a.relDelay - b.relDelay);
  const secondOrder = paths.filter((p) => p.order === 2)
    .sort((a, b) => a.relDelay - b.relDelay);
  const thirdOrder = paths.filter((p) => p.order === 3)
    .sort((a, b) => a.relDelay - b.relDelay);
  const first = firstOrder[0];
  return {
    rt60: ac.rt60,
    firstMs: first.relDelay * 1000,
    lastFirstMs: firstOrder.at(-1).relDelay * 1000,
    spanMs: (firstOrder.at(-1).relDelay - firstOrder[0].relDelay) * 1000,
    secondLastMs: secondOrder.at(-1).relDelay * 1000,
    axialMs: thirdOrder[0].relDelay * 1000,
    volume: ac.volume,
    alpha: ac.alphaAvg,
  };
}

function renderCompareTable() {
  const a = sceneMetrics(SCENES.small.state);
  const b = sceneMetrics(SCENES.hall.state);
  const row = (k, label, unit, digits) => `
    <tr><td>${label}</td>
      <td>${a[k].toFixed(digits)} ${unit}</td>
      <td class="hl">${b[k].toFixed(digits)} ${unit}</td>
      <td>${(b[k] / a[k]).toFixed(1)}×</td></tr>`;
  $("compareTable").innerHTML = `
    <thead><tr><th>指标</th><th>小房间</th><th>长走廊</th><th>倍数</th></tr></thead>
    <tbody>
      ${row("rt60", "RT60", "s", 2)}
      ${row("firstMs", "首反射延迟", "ms", 1)}
      ${row("lastFirstMs", "最晚一次反射", "ms", 1)}
      ${row("spanMs", "一次反射跨度", "ms", 1)}
      ${row("secondLastMs", "最晚二阶反射", "ms", 1)}
      ${row("axialMs", "三阶轴向回声", "ms", 1)}
      ${row("volume", "容积", "m³", 1)}
      ${row("alpha", "平均吸声系数", "", 3)}
    </tbody>`;
}

$("loadSmall").addEventListener("click", () => applyState(SCENES.small.state));
$("loadHall").addEventListener("click", () => applyState(SCENES.hall.state));

// ---------- 可视化与启动 ----------
const viz = new Visualizers($("tailCanvas"), $("spectrumCanvas"), () => engine, () => lastAc);

buildPalette();
renderPresetList();
renderCompareTable();
refreshAll();
