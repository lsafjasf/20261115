"use strict";

const W = 960;
const H = 600;
const stage = document.getElementById("stage");
const sctx = stage.getContext("2d");

const PATTERNS = ["圆点阵列", "斜条纹", "网格", "波浪", "星芒"];
const BLEND_MODES = [
  ["source-over", "正常 (source-over)"],
  ["screen", "滤色 (screen)"],
  ["multiply", "正片叠底 (multiply)"],
  ["overlay", "叠加 (overlay)"],
  ["difference", "差值 (difference)"],
  ["lighten", "变亮 (lighten)"],
  ["color-dodge", "颜色减淡 (color-dodge)"],
];

const state = {
  projX: 0,
  projY: 0,
  spacing: 0.4,
  layers: [
    { name: "前层纱幕", pattern: "星芒", opacity: 0.85, blend: "source-over", hue: 45 },
    { name: "中层纱幕", pattern: "波浪", opacity: 0.8, blend: "screen", hue: 200 },
    { name: "后层纱幕", pattern: "圆点阵列", opacity: 0.9, blend: "source-over", hue: 280 },
  ],
  presetsDone: [false, false, false],
};

try {
  const saved = JSON.parse(localStorage.getItem("presetsDone") || "null");
  if (Array.isArray(saved) && saved.length === 3) state.presetsDone = saved;
} catch (e) { /* ignore */ }

// ---------- 图案绘制 ----------
function drawPattern(ctx, layer) {
  const { pattern, hue } = layer;
  ctx.clearRect(0, 0, W, H);
  const c1 = `hsl(${hue}, 85%, 60%)`;
  const c2 = `hsl(${(hue + 40) % 360}, 80%, 45%)`;
  ctx.lineWidth = 3;

  if (pattern === "圆点阵列") {
    const step = 60;
    for (let y = step / 2; y < H; y += step) {
      for (let x = step / 2; x < W; x += step) {
        const r = 10 + 8 * Math.sin(x * 0.02 + y * 0.013);
        ctx.fillStyle = (x / step + y / step) % 2 ? c1 : c2;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === "斜条纹") {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-Math.PI / 6);
    for (let x = -W; x < W; x += 56) {
      ctx.fillStyle = (x / 56) % 2 ? c1 : c2;
      ctx.fillRect(x, -H, 28, H * 2);
    }
    ctx.restore();
  } else if (pattern === "网格") {
    ctx.strokeStyle = c1;
    for (let x = 0; x <= W; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    ctx.strokeStyle = c2;
    for (let y = 0; y <= H; y += 48) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  } else if (pattern === "波浪") {
    for (let row = 0; row < 12; row++) {
      ctx.strokeStyle = row % 2 ? c1 : c2;
      ctx.lineWidth = 6;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = 40 + row * 46 + Math.sin(x * 0.02 + row * 0.9) * 18;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (pattern === "星芒") {
    for (let i = 0; i < 26; i++) {
      const x = ((i * 197) % W);
      const y = ((i * 131) % H);
      const spikes = 5 + (i % 3);
      const rOut = 22 + (i % 4) * 8;
      ctx.fillStyle = i % 2 ? c1 : c2;
      ctx.beginPath();
      for (let s = 0; s < spikes * 2; s++) {
        const r = s % 2 ? rOut * 0.4 : rOut;
        const a = (s / (spikes * 2)) * Math.PI * 2 + i;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

// ---------- 梯形变形（逐竖条近似透视） ----------
// 根据投影机偏斜计算目标四边形四角
function keystoneQuad(depth) {
  const kx = state.projX;
  const ky = state.projY;
  const depthScale = 1 - depth * 0.06; // 后层略小，营造纵深
  const insetX = (1 - depthScale) * W * 0.5;
  const insetY = (1 - depthScale) * H * 0.5;
  // 偏斜量：光源偏左则右侧拉伸，形成梯形
  const skew = 90 * (1 - depth * 0.18);
  const sx = kx * skew;
  const sy = ky * skew * 0.7;
  const shift = kx * 60;
  const lift = ky * 45;
  return {
    tl: { x: insetX - sx + shift, y: insetY - sy + lift },
    tr: { x: W - insetX + sx + shift, y: insetY + sy + lift },
    br: { x: W - insetX - sx + shift, y: H - insetY - sy + lift },
    bl: { x: insetX + sx + shift, y: H - insetY + sy + lift },
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function drawWarped(dst, src, quad) {
  const STRIPS = 192;
  const sw = W / STRIPS;
  for (let i = 0; i < STRIPS; i++) {
    const t0 = i / STRIPS;
    const t1 = (i + 1) / STRIPS;
    const tm = (t0 + t1) / 2;
    // 上下边缘双线性插值
    const topX = lerp(quad.tl.x, quad.tr.x, tm);
    const topY = lerp(quad.tl.y, quad.tr.y, tm);
    const botX = lerp(quad.bl.x, quad.br.x, tm);
    const botY = lerp(quad.bl.y, quad.br.y, tm);
    const h = botY - topY;
    if (h <= 0) continue;
    dst.drawImage(src, i * sw, 0, sw, H, topX, topY, W / STRIPS + 1, h);
  }
}

// ---------- 光斑 ----------
function drawLightSpot(ctx) {
  const cx = W / 2 + state.projX * 220;
  const cy = H / 2 + state.projY * 150;
  const g = ctx.createRadialGradient(cx, cy, 40, cx, cy, 520);
  g.addColorStop(0, "rgba(255,244,214,0.35)");
  g.addColorStop(0.5, "rgba(255,240,200,0.12)");
  g.addColorStop(1, "rgba(255,240,200,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- 主渲染 ----------
const patternCanvases = state.layers.map(() => {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  return c;
});
const warpCanvas = document.createElement("canvas");
warpCanvas.width = W; warpCanvas.height = H;

function refreshPattern(i) {
  drawPattern(patternCanvases[i].getContext("2d"), state.layers[i]);
}

function render() {
  // 舞台背景
  const bg = sctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0b10");
  bg.addColorStop(1, "#171a24");
  sctx.globalCompositeOperation = "source-over";
  sctx.globalAlpha = 1;
  sctx.filter = "none";
  sctx.fillStyle = bg;
  sctx.fillRect(0, 0, W, H);

  // 由后向前合成：前层自然遮挡后层
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const depth = state.layers.length - 1 - i; // 0=最前
    const wctx = warpCanvas.getContext("2d");
    wctx.clearRect(0, 0, W, H);
    drawWarped(wctx, patternCanvases[i], keystoneQuad(depth));

    // 布间距 -> 后层边缘模糊（景深）
    const blur = state.spacing * depth * 9;
    sctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
    sctx.globalAlpha = layer.opacity;
    sctx.globalCompositeOperation = layer.blend;
    sctx.drawImage(warpCanvas, 0, 0);
  }
  sctx.filter = "none";
  sctx.globalAlpha = 1;
  sctx.globalCompositeOperation = "source-over";

  drawLightSpot(sctx);

  // 投影机指示灯
  sctx.fillStyle = "rgba(120,220,120,0.9)";
  sctx.beginPath();
  sctx.arc(W / 2 + state.projX * 220, 18 + state.projY * 8, 5, 0, Math.PI * 2);
  sctx.fill();
}

// ---------- 图层控制面板 ----------
function buildLayerPanel() {
  const host = document.getElementById("layers");
  host.innerHTML = "<h2>纱幕图层（前 → 后）</h2>";
  state.layers.forEach((layer, i) => {
    const card = document.createElement("div");
    card.className = "layer-card";

    const title = document.createElement("h3");
    title.textContent = layer.name;
    card.appendChild(title);

    const sel = document.createElement("select");
    PATTERNS.forEach((p) => {
      const o = document.createElement("option");
      o.value = p; o.textContent = "图案：" + p;
      sel.appendChild(o);
    });
    sel.value = layer.pattern;
    sel.addEventListener("change", () => {
      layer.pattern = sel.value;
      refreshPattern(i);
      render();
    });
    card.appendChild(sel);

    const blend = document.createElement("select");
    BLEND_MODES.forEach(([v, label]) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = "混合：" + label;
      blend.appendChild(o);
    });
    blend.value = layer.blend;
    blend.addEventListener("change", () => {
      layer.blend = blend.value;
      render();
    });
    card.appendChild(blend);

    const opLabel = document.createElement("label");
    opLabel.textContent = "透明度 ";
    const opVal = document.createElement("span");
    opVal.textContent = layer.opacity.toFixed(2);
    const op = document.createElement("input");
    op.type = "range"; op.min = "0"; op.max = "1"; op.step = "0.01";
    op.value = String(layer.opacity);
    op.addEventListener("input", () => {
      layer.opacity = parseFloat(op.value);
      opVal.textContent = layer.opacity.toFixed(2);
      render();
    });
    opLabel.appendChild(opVal);
    opLabel.appendChild(op);
    card.appendChild(opLabel);

    host.appendChild(card);
  });
}

// ---------- 投影机控制 ----------
const projX = document.getElementById("projX");
const projY = document.getElementById("projY");
const spacing = document.getElementById("spacing");

function syncProjectorUI() {
  projX.value = String(state.projX);
  projY.value = String(state.projY);
}

projX.addEventListener("input", () => { state.projX = parseFloat(projX.value); render(); });
projY.addEventListener("input", () => { state.projY = parseFloat(projY.value); render(); });
spacing.addEventListener("input", () => { state.spacing = parseFloat(spacing.value); render(); });

// 拖动画布移动投影机
let dragging = false;
stage.addEventListener("pointerdown", (e) => {
  dragging = true;
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const r = stage.getBoundingClientRect();
  state.projX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
  state.projY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  syncProjectorUI();
  render();
});
stage.addEventListener("pointerup", () => { dragging = false; });

// ---------- 预设 ----------
const PRESETS = [
  {
    name: "晨曦森林", projX: -0.3, projY: 0.15, spacing: 0.35,
    layers: [
      { pattern: "星芒", opacity: 0.8, blend: "screen", hue: 40 },
      { pattern: "波浪", opacity: 0.85, blend: "source-over", hue: 120 },
      { pattern: "圆点阵列", opacity: 0.9, blend: "source-over", hue: 90 },
    ],
  },
  {
    name: "霓虹都市", projX: 0.45, projY: -0.2, spacing: 0.6,
    layers: [
      { pattern: "网格", opacity: 0.9, blend: "color-dodge", hue: 300 },
      { pattern: "斜条纹", opacity: 0.7, blend: "difference", hue: 180 },
      { pattern: "圆点阵列", opacity: 0.85, blend: "multiply", hue: 220 },
    ],
  },
  {
    name: "深海气泡", projX: 0, projY: 0.4, spacing: 0.8,
    layers: [
      { pattern: "圆点阵列", opacity: 0.75, blend: "lighten", hue: 190 },
      { pattern: "波浪", opacity: 0.85, blend: "overlay", hue: 210 },
      { pattern: "网格", opacity: 0.6, blend: "screen", hue: 240 },
    ],
  },
];

function applyPreset(idx) {
  const p = PRESETS[idx];
  state.projX = p.projX;
  state.projY = p.projY;
  state.spacing = p.spacing;
  spacing.value = String(p.spacing);
  syncProjectorUI();
  p.layers.forEach((pl, i) => {
    Object.assign(state.layers[i], pl);
    refreshPattern(i);
  });
  buildLayerPanel();
  state.presetsDone[idx] = true;
  localStorage.setItem("presetsDone", JSON.stringify(state.presetsDone));
  updatePresetStatus();
  render();
}

function updatePresetStatus() {
  const done = state.presetsDone.filter(Boolean).length;
  const el = document.getElementById("presetStatus");
  el.textContent = done >= 3
    ? "✅ 三个预设画面均已完成（3 / 3）"
    : `尚未完成任何预设（${done} / 3）`.replace("任何", done ? "部分" : "任何");
  document.querySelectorAll(".preset-btn").forEach((b, i) => {
    b.classList.toggle("active", state.presetsDone[i]);
  });
}

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(parseInt(btn.dataset.preset, 10)));
});

// ---------- 导出当前帧 ----------
document.getElementById("exportBtn").addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = `projection-frame-${Date.now()}.png`;
  a.href = stage.toDataURL("image/png");
  a.click();
});

// ---------- Web Audio：投影机风扇噪声 ----------
let audioCtx = null;
let noiseNodes = null;

function buildNoiseGraph(ctx) {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.94 + white * 0.06; // 布朗化，更像风扇
    data[i] = last * 3;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 420;

  const hum = ctx.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 120;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.015;

  const master = ctx.createGain();
  master.gain.value = 0.25;

  src.connect(lowpass).connect(master);
  hum.connect(humGain).connect(master);
  master.connect(ctx.destination);
  src.start();
  hum.start();
  return { src, hum, master };
}

const noiseBtn = document.getElementById("noiseToggle");
noiseBtn.addEventListener("click", () => {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (noiseNodes) {
    noiseNodes.src.stop();
    noiseNodes.hum.stop();
    noiseNodes.master.disconnect();
    noiseNodes = null;
    noiseBtn.textContent = "🔇 投影机噪声：关";
    noiseBtn.classList.remove("active");
  } else {
    audioCtx.resume();
    noiseNodes = buildNoiseGraph(audioCtx);
    noiseBtn.textContent = "🔊 投影机噪声：开";
    noiseBtn.classList.add("active");
  }
});

// ---------- 初始化 ----------
state.layers.forEach((_, i) => refreshPattern(i));
buildLayerPanel();
updatePresetStatus();
render();
