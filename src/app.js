import {
  MATERIALS,
  SIZE,
  buildBrokenControl,
  generateTexture,
  repairAt,
  seamReport,
  touchedEdges,
} from "./texture-engine.js";

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const els = {
  textureCanvas: $("#textureCanvas"),
  overlayCanvas: $("#overlayCanvas"),
  canvasWrap: $("#canvasWrap"),
  tilePreview: $("#tilePreview"),
  generating: $("#generating"),
  materialCards: $$(".material-card"),
  viewButtons: $$(".view-switch button"),
  toolButtons: $$(".tool-switch button"),
  crumbMaterial: $("#crumbMaterial"),
  crumbCode: $("#crumbCode"),
  stageTitle: $("#stageTitle"),
  stageHint: $("#stageHint"),
  scaleRange: $("#scaleRange"),
  directionRange: $("#directionRange"),
  contrastRange: $("#contrastRange"),
  scaleOutput: $("#scaleOutput"),
  directionOutput: $("#directionOutput"),
  contrastOutput: $("#contrastOutput"),
  brushRange: $("#brushRange"),
  brushOutput: $("#brushOutput"),
  resetButton: $("#resetButton"),
  exportButton: $("#exportButton"),
  tilePreviewButton: $("#tilePreviewButton"),
  seamState: $("#seamState"),
  seamRatio: $("#seamRatio"),
  samplingMeta: $("#samplingMeta"),
  toast: $("#toast"),
  edgeBadges: {
    left: $("#edgeLeft"),
    right: $("#edgeRight"),
    top: $("#edgeTop"),
    bottom: $("#edgeBottom"),
  },
};

const ctx = els.textureCanvas.getContext("2d", { alpha: false });
const overlayCtx = els.overlayCanvas.getContext("2d");
const previewCtx = els.tilePreview.getContext("2d");
const sourceCanvas = document.createElement("canvas");
sourceCanvas.width = SIZE;
sourceCanvas.height = SIZE;
const sourceCtx = sourceCanvas.getContext("2d", { alpha: false });

const state = {
  material: "stone",
  view: "single",
  tool: "heal",
  brush: Number(els.brushRange.value),
  params: { ...MATERIALS.stone.defaults },
  textureData: null,
  undo: [],
  redo: [],
  painting: false,
  pointer: { x: 0, y: 0, inside: false },
  lastPoint: null,
  strokeSource: null,
  renderQueued: false,
  metricQueued: false,
  toastTimer: null,
  generationTimer: null,
  generationToken: 0,
};

const paramMemory = Object.fromEntries(
  Object.entries(MATERIALS).map(([id, meta]) => [id, { ...meta.defaults }]),
);

const toolNames = {
  heal: "愈合",
  clone: "克隆",
};

function rangeProgress(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const value = Number(input.value);
  input.style.setProperty("--value", `${((value - min) / (max - min)) * 100}%`);
}

function setParams(meta) {
  state.params = { ...meta.defaults };
  els.scaleRange.value = state.params.scale;
  els.directionRange.value = state.params.direction;
  els.contrastRange.value = state.params.contrast;
  updateParameterLabels();
}

function updateParameterLabels() {
  els.scaleOutput.textContent = `${state.params.scale} px`;
  els.directionOutput.textContent = `${state.params.direction}°`;
  els.contrastOutput.textContent = `${state.params.contrast}`;
  [els.scaleRange, els.directionRange, els.contrastRange].forEach(rangeProgress);
}

function updateBrushLabel() {
  els.brushOutput.textContent = String(state.brush);
  rangeProgress(els.brushRange);
}

function showToast(message, duration = 2200) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, duration);
}

function setSeamState(report) {
  const ratioText = report.ratio.toFixed(2);
  els.seamRatio.textContent = ratioText;
  els.seamState.innerHTML = `<i></i> ${report.passed ? "已闭合" : "需检查"}`;
  els.seamState.style.color = report.passed ? "#a8b78a" : "#e7a382";
  els.seamState.querySelector("i").style.background = report.passed
    ? "var(--acid)"
    : "var(--orange)";
}

function scheduleMetrics() {
  if (state.metricQueued) return;
  state.metricQueued = true;
  window.setTimeout(() => {
    state.metricQueued = false;
    if (state.textureData) setSeamState(seamReport(state.textureData, SIZE));
  }, 140);
}

function drawSource() {
  if (!state.textureData) return;
  const image = new ImageData(state.textureData, SIZE, SIZE);
  sourceCtx.putImageData(image, 0, 0);
}

function renderMain() {
  if (!state.textureData) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, SIZE, SIZE);

  if (state.view === "tile") {
    const half = SIZE / 2;
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 2; x += 1) {
        ctx.drawImage(sourceCanvas, x * half, y * half, half, half);
      }
    }
  } else {
    ctx.drawImage(sourceCanvas, 0, 0);
  }
}

function renderPreview() {
  if (!state.textureData) return;
  const half = els.tilePreview.width / 2;
  previewCtx.imageSmoothingEnabled = true;
  previewCtx.clearRect(0, 0, els.tilePreview.width, els.tilePreview.height);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      previewCtx.drawImage(sourceCanvas, x * half, y * half, half, half);
    }
  }
}

function renderAll() {
  state.renderQueued = false;
  drawSource();
  renderMain();
  renderPreview();
  scheduleMetrics();
}

function queueRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  window.requestAnimationFrame(renderAll);
}

function updateMaterialMeta() {
  const meta = MATERIALS[state.material];
  els.crumbMaterial.textContent = meta.name;
  els.crumbCode.textContent = meta.code;
  els.stageTitle.textContent = meta.title;
  document.title = `${meta.name} · Seam Lab 程序化无缝材质`;
}

function updateMaterialCards() {
  els.materialCards.forEach((card) => {
    const active = card.dataset.material === state.material;
    card.classList.toggle("is-active", active);
    card.setAttribute("aria-pressed", String(active));
  });
}

function commitGeneration() {
  const meta = MATERIALS[state.material];
  els.generating.classList.add("is-visible");
  const token = ++state.generationToken;

  window.setTimeout(() => {
    if (token !== state.generationToken) return;
    const started = performance.now();
    state.textureData = generateTexture({
      material: state.material,
      size: SIZE,
      grain: state.params.scale,
      direction: state.params.direction,
      contrast: state.params.contrast,
      seed: 266 + Object.keys(MATERIALS).indexOf(state.material) * 97,
    });
    state.undo = [];
    state.redo = [];
    renderAll();
    setSeamState(seamReport(state.textureData, SIZE));
    els.generating.classList.remove("is-visible");
    els.samplingMeta.textContent = `PERIODIC · ${(performance.now() - started).toFixed(0)} MS`;
    els.stageHint.textContent =
      state.view === "tile"
        ? "2×2 检查为只读视图，切回单张可修补"
        : `按住画笔可直接修补${meta.name}纹理`;
  }, 24);
}

function scheduleGeneration() {
  window.clearTimeout(state.generationTimer);
  els.generating.classList.add("is-visible");
  state.generationTimer = window.setTimeout(commitGeneration, 90);
}

function updateAllMaterialThumbnails() {
  els.materialCards.forEach((card) => {
    const canvas = $("canvas", card);
    const material = card.dataset.material;
    const data = generateTexture({
      material,
      size: canvas.width,
      seed: 266 + Object.keys(MATERIALS).indexOf(material) * 97,
    });
    const thumbCtx = canvas.getContext("2d", { alpha: false });
    thumbCtx.putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
  });
}

function setView(view) {
  state.view = view;
  els.viewButtons.forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  els.canvasWrap.classList.toggle("is-tiled", view === "tile");
  els.overlayCanvas.classList.toggle("is-readonly", view === "tile");
  if (view === "tile") {
    overlayCtx.clearRect(0, 0, SIZE, SIZE);
    els.stageHint.textContent = "2×2 检查为只读视图，切回单张可修补";
    updateEdgeBadges({});
  } else {
    els.stageHint.textContent = `按住画笔可直接修补${MATERIALS[state.material].name}纹理`;
  }
  renderMain();
}

function selectMaterial(material) {
  if (!MATERIALS[material] || material === state.material) return;
  paramMemory[state.material] = { ...state.params };
  state.material = material;
  state.params = { ...paramMemory[material] };
  updateMaterialCards();
  updateMaterialMeta();
  updateParameterLabels();
  scheduleGeneration();
  showToast(`已切换到${MATERIALS[material].name} · ${MATERIALS[material].title}`);
}

function resetParameters() {
  state.params = { ...MATERIALS[state.material].defaults };
  paramMemory[state.material] = { ...state.params };
  updateParameterLabels();
  scheduleGeneration();
  showToast("参数已恢复默认");
}

function updateEdgeBadges(edges) {
  Object.entries(els.edgeBadges).forEach(([edge, badge]) => {
    badge.classList.toggle("is-on", Boolean(edges[edge]));
  });
}

function pointerPosition(event) {
  const rect = els.canvasWrap.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * SIZE,
    y: ((event.clientY - rect.top) / rect.height) * SIZE,
  };
}

function drawCursor(x, y) {
  overlayCtx.clearRect(0, 0, SIZE, SIZE);
  if (state.view !== "single" || !state.pointer.inside) return;

  const radius = state.brush;
  const ghostPositions = [[x, y]];
  if (x - radius < 0) ghostPositions.push([x + SIZE, y]);
  if (x + radius > SIZE) ghostPositions.push([x - SIZE, y]);
  if (y - radius < 0) ghostPositions.push([x, y + SIZE]);
  if (y + radius > SIZE) ghostPositions.push([x, y - SIZE]);
  if (x - radius < 0 && y - radius < 0) ghostPositions.push([x + SIZE, y + SIZE]);
  if (x + radius > SIZE && y + radius > SIZE) ghostPositions.push([x - SIZE, y - SIZE]);
  if (x - radius < 0 && y + radius > SIZE) ghostPositions.push([x + SIZE, y - SIZE]);
  if (x + radius > SIZE && y - radius < 0) ghostPositions.push([x - SIZE, y + SIZE]);

  overlayCtx.save();
  overlayCtx.lineCap = "round";
  ghostPositions.forEach(([gx, gy], index) => {
    const primary = index === 0;
    overlayCtx.beginPath();
    overlayCtx.arc(gx, gy, radius, 0, Math.PI * 2);
    overlayCtx.strokeStyle = primary
      ? "rgba(216, 255, 99, 0.9)"
      : "rgba(216, 255, 99, 0.34)";
    overlayCtx.lineWidth = primary ? 1.2 : 0.85;
    overlayCtx.setLineDash(primary ? [5, 4] : [3, 5]);
    overlayCtx.stroke();
  });
  overlayCtx.setLineDash([]);
  overlayCtx.strokeStyle = "rgba(17, 19, 15, 0.7)";
  overlayCtx.lineWidth = 1;
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, Math.max(2, radius * 0.22), 0, Math.PI * 2);
  overlayCtx.stroke();
  overlayCtx.restore();
}

function paintSegment(from, to) {
  if (!state.textureData || !state.strokeSource) return;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / Math.max(2.5, state.brush * 0.2)));
  const angle = Math.atan2(dy, dx);
  const seed = 710 + Math.floor(performance.now() % 997);

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    repairAt(state.textureData, SIZE, x, y, state.brush, {
      tool: state.tool,
      source: state.strokeSource,
      angle,
      strength: 0.9,
      seed: seed + step,
    });
  }

  state.lastTouchedEdges = {
    ...state.lastTouchedEdges,
    ...touchedEdges(to.x, to.y, state.brush, SIZE),
  };
  updateEdgeBadges(state.lastTouchedEdges);
  const nearEdge = Object.values(state.lastTouchedEdges).some(Boolean);
  els.stageHint.textContent = nearEdge
    ? "边缘环绕中 · 对边同步修补"
    : `${toolNames[state.tool]}笔刷 · 拖动继续修补`;
  queueRender();
}

function beginStroke(event) {
  if (event.button !== 0) return;
  if (state.view === "tile") {
    showToast("2×2 检查为只读视图，请切回单张后修补");
    return;
  }
  if (!state.textureData) return;

  event.preventDefault();
  els.overlayCanvas.setPointerCapture(event.pointerId);
  state.painting = true;
  state.lastPoint = pointerPosition(event);
  state.lastTouchedEdges = {};
  state.undo.push(new Uint8ClampedArray(state.textureData));
  if (state.undo.length > 8) state.undo.shift();
  state.redo = [];
  state.strokeSource = new Uint8ClampedArray(state.textureData);
  drawCursor(state.lastPoint.x, state.lastPoint.y);
  paintSegment(state.lastPoint, state.lastPoint);
}

function continueStroke(event) {
  const point = pointerPosition(event);
  state.pointer = { ...point, inside: true };
  if (!state.painting || !state.lastPoint) {
    updateEdgeBadges(touchedEdges(point.x, point.y, state.brush, SIZE));
    drawCursor(point.x, point.y);
    return;
  }
  paintSegment(state.lastPoint, point);
  state.lastPoint = point;
  drawCursor(point.x, point.y);
}

function endStroke(event) {
  if (!state.painting) return;
  state.painting = false;
  state.lastPoint = null;
  state.strokeSource = null;
  const wrapped = Object.values(state.lastTouchedEdges ?? {}).some(Boolean);
  showToast(wrapped ? "修补完成 · 已环绕同步到对边" : "修补完成 · 周期边界保持连续");
  scheduleMetrics();
  if (event && els.overlayCanvas.hasPointerCapture(event.pointerId)) {
    els.overlayCanvas.releasePointerCapture(event.pointerId);
  }
  drawCursor(state.pointer.x, state.pointer.y);
}

function undo() {
  if (!state.undo.length || !state.textureData) return;
  state.redo.push(new Uint8ClampedArray(state.textureData));
  state.textureData = state.undo.pop();
  renderAll();
  showToast("已撤销上一步修补");
}

function redo() {
  if (!state.redo.length || !state.textureData) return;
  state.undo.push(new Uint8ClampedArray(state.textureData));
  state.textureData = state.redo.pop();
  renderAll();
  showToast("已重做修补");
}

function exportTexture() {
  if (!state.textureData) return;
  drawSource();
  const filename = `seamlab-${state.material}-512.png`;
  sourceCanvas.toBlob((blob) => {
    if (!blob) {
      showToast("导出失败，请重试");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`已导出 ${filename} · 512 × 512`);
  }, "image/png");
}

els.materialCards.forEach((card) => {
  card.addEventListener("click", () => selectMaterial(card.dataset.material));
});

els.viewButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.tilePreviewButton.addEventListener("click", () => {
  setView("tile");
  showToast("正在显示 2×2 平铺检查视图");
});

els.toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.tool = button.dataset.tool;
    els.toolButtons.forEach((item) => {
      item.classList.toggle("is-active", item === button);
    });
    showToast(`已切换为${toolNames[state.tool]}笔刷`);
  });
});

[
  ["scale", els.scaleRange],
  ["direction", els.directionRange],
  ["contrast", els.contrastRange],
].forEach(([key, input]) => {
  input.addEventListener("input", () => {
    state.params[key] = Number(input.value);
    paramMemory[state.material] = { ...state.params };
    updateParameterLabels();
    scheduleGeneration();
  });
});

els.brushRange.addEventListener("input", () => {
  state.brush = Number(els.brushRange.value);
  updateBrushLabel();
  drawCursor(state.pointer.x, state.pointer.y);
});

els.resetButton.addEventListener("click", resetParameters);
els.exportButton.addEventListener("click", exportTexture);

els.overlayCanvas.addEventListener("pointerdown", beginStroke);
els.overlayCanvas.addEventListener("pointermove", continueStroke);
els.overlayCanvas.addEventListener("pointerup", endStroke);
els.overlayCanvas.addEventListener("pointercancel", endStroke);
els.overlayCanvas.addEventListener("pointerenter", () => {
  state.pointer.inside = true;
});
els.overlayCanvas.addEventListener("pointerleave", () => {
  if (state.painting) return;
  state.pointer.inside = false;
  overlayCtx.clearRect(0, 0, SIZE, SIZE);
  updateEdgeBadges({});
  els.stageHint.textContent =
    state.view === "tile"
      ? "2×2 检查为只读视图，切回单张可修补"
      : `按住画笔可直接修补${MATERIALS[state.material].name}纹理`;
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});

updateMaterialCards();
updateMaterialMeta();
updateParameterLabels();
updateBrushLabel();
setView("single");
updateAllMaterialThumbnails();
commitGeneration();
