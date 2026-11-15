import { FACE_META, buildNet, createDefaultVertices } from "./geometry.js";
import {
  hitTestModel,
  prepareCanvas,
  renderModel,
  renderNet,
  screenToVertexDelta,
} from "./render.js";
import { buildSvg, downloadSvg } from "./svg.js";

const modelCanvas = document.querySelector("#modelCanvas");
const netCanvas = document.querySelector("#netCanvas");
const vertexRail = document.querySelector("#vertexRail");
const selectedVertexLabel = document.querySelector("#selectedVertex");
const vertexCoords = document.querySelector("#vertexCoords");
const modelStatus = document.querySelector("#modelStatus");
const validationBadge = document.querySelector("#validationBadge");
const statusMessage = document.querySelector("#statusMessage");
const toast = document.querySelector("#toast");
const panelCount = document.querySelector("#panelCount");
const tabCount = document.querySelector("#tabCount");
const outputSummary = document.querySelector("#outputSummary");
const toggleLabels = document.querySelector("#toggleLabels");

const initialVertices = createDefaultVertices();
const state = {
  vertices: cloneVertices(initialVertices),
  faces: FACE_META,
  net: buildNet(initialVertices),
  selectedVertex: 6,
  hoverVertex: null,
  showVertexLabels: true,
  yaw: -0.68,
  pitch: 0.38,
  zoom: 1,
  pointer: null,
  embeddedFont: "",
};

const views = { model: null, net: null };
let renderFrame = 0;
let toastTimer = 0;
let hadInvalidAttempt = false;

const embeddedFontPromise = fetch(new URL("../assets/foldwork-cjk.woff2", import.meta.url))
  .then((response) => response.arrayBuffer())
  .then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    state.embeddedFont = `data:font/woff2;base64,${btoa(binary)}`;
  })
  .catch(() => {
    state.embeddedFont = "";
  });

function cloneVertices(vertices) {
  return vertices.map((vertex) => ({ id: vertex.id, position: [...vertex.position] }));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function coordinatesText(position) {
  return `X ${position[0].toFixed(2)} · Y ${position[1].toFixed(2)} · Z ${position[2].toFixed(2)}`;
}

function buildVertexRail() {
  vertexRail.replaceChildren();
  for (let id = 0; id < 8; id += 1) {
    const button = document.createElement("button");
    button.className = "vertex-chip";
    button.type = "button";
    button.textContent = `V${id}`;
    button.dataset.vertex = String(id);
    button.setAttribute("aria-label", `选择顶点 V${id}`);
    button.addEventListener("click", () => {
      state.selectedVertex = id;
      refreshReadout();
      requestRender();
    });
    vertexRail.append(button);
  }
}

function refreshReadout() {
  const vertex = state.vertices[state.selectedVertex];
  selectedVertexLabel.textContent = `V${vertex.id}`;
  vertexCoords.textContent = coordinatesText(vertex.position);
  for (const chip of vertexRail.querySelectorAll(".vertex-chip")) {
    const active = Number(chip.dataset.vertex) === state.selectedVertex;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));
  }
  panelCount.textContent = String(state.net.faces.length);
  tabCount.textContent = String(state.net.tabs.length);
  outputSummary.textContent = `${state.net.faces.length} 面板 · ${state.net.tabs.length} 舌片`;
}

function setStatus(message, stateName = "ok") {
  statusMessage.classList.toggle("is-updating", stateName === "busy");
  const label = statusMessage.querySelector("span:last-child");
  label.textContent = message;
  modelStatus.textContent = stateName === "invalid" ? "形状受限" : "几何有效";
  validationBadge.classList.toggle("is-invalid", stateName === "invalid");
  const badgeLabel = validationBadge.lastChild;
  if (badgeLabel && badgeLabel.nodeType === Node.TEXT_NODE) {
    badgeLabel.textContent = stateName === "invalid"
      ? " 展开图约束已阻止"
      : " 无重叠 · 面积有效";
  }
  window.clearTimeout(toastTimer);
  if (stateName === "invalid") statusMessage.classList.remove("is-updating");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function resizeViews() {
  views.model = prepareCanvas(modelCanvas);
  views.net = prepareCanvas(netCanvas);
  requestRender();
}

function render() {
  renderFrame = 0;
  if (views.model) renderModel(views.model.context, views.model.width, views.model.height, state);
  if (views.net) renderNet(views.net.context, views.net.width, views.net.height, state.net, state);
}

function requestRender() {
  if (renderFrame) return;
  renderFrame = requestAnimationFrame(render);
}

function resetState() {
  state.vertices = cloneVertices(initialVertices);
  state.net = buildNet(state.vertices);
  state.selectedVertex = 6;
  state.hoverVertex = null;
  state.yaw = -0.68;
  state.pitch = 0.38;
  state.zoom = 1;
  state.pointer = null;
  hadInvalidAttempt = false;
  refreshReadout();
  setStatus("展开图已重置为初始六面体");
  requestRender();
}

function localPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function commitVertexMove(candidate, id) {
  const candidateNet = buildNet(candidate);
  if (!candidateNet.valid) {
    hadInvalidAttempt = true;
    setStatus(candidateNet.errors[0] || "展开图约束已阻止该位置", "invalid");
    return false;
  }

  state.vertices = candidate;
  state.net = candidateNet;
  state.selectedVertex = id;
  hadInvalidAttempt = false;
  refreshReadout();
  setStatus(`展开图已同步 · ${candidateNet.faces.length} 面板 / ${candidateNet.tabs.length} 舌片`);
  requestRender();
  return true;
}

function startVertexDrag(event, id, point) {
  const vertex = state.vertices[id];
  state.pointer = {
    type: "vertex",
    id,
    startX: event.clientX,
    startY: event.clientY,
    startPosition: [...vertex.position],
  };
  state.selectedVertex = id;
  modelCanvas.setPointerCapture(event.pointerId);
  refreshReadout();
  requestRender();
}

function startOrbit(event, point) {
  state.pointer = {
    type: "orbit",
    startX: event.clientX,
    startY: event.clientY,
    yaw: state.yaw,
    pitch: state.pitch,
  };
  modelCanvas.setPointerCapture(event.pointerId);
  modelCanvas.closest(".canvas-wrap").classList.add("is-rotating");
}

modelCanvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const point = localPoint(event, modelCanvas);
  const hit = hitTestModel(point.x, point.y, state, views.model.width, views.model.height);
  if (hit != null) startVertexDrag(event, hit, point);
  else startOrbit(event, point);
});

modelCanvas.addEventListener("pointermove", (event) => {
  const point = localPoint(event, modelCanvas);
  if (!state.pointer) {
    const hit = hitTestModel(point.x, point.y, state, views.model.width, views.model.height);
    modelCanvas.closest(".canvas-wrap").style.cursor = hit == null ? "grab" : "pointer";
    if (state.hoverVertex !== hit) {
      state.hoverVertex = hit;
      requestRender();
    }
    return;
  }

  if (state.pointer.type === "orbit") {
    state.yaw = state.pointer.yaw - (event.clientX - state.pointer.startX) * 0.007;
    state.pitch = clamp(
      state.pointer.pitch + (event.clientY - state.pointer.startY) * 0.006,
      -1.18,
      1.18,
    );
    requestRender();
    return;
  }

  const dx = event.clientX - state.pointer.startX;
  const dy = event.clientY - state.pointer.startY;
  const delta = screenToVertexDelta(dx, dy, state, views.model.width, views.model.height);
  const nextPosition = [
    clamp(state.pointer.startPosition[0] + delta[0], -2.7, 2.7),
    clamp(state.pointer.startPosition[1] + delta[1], -2.7, 2.7),
    clamp(state.pointer.startPosition[2] + delta[2], -2.7, 2.7),
  ];
  const candidate = state.vertices.map((vertex) => ({
    id: vertex.id,
    position: vertex.id === state.pointer.id ? nextPosition : [...vertex.position],
  }));
  commitVertexMove(candidate, state.pointer.id);
});

function finishPointer(event) {
  if (!state.pointer) return;
  const type = state.pointer.type;
  state.pointer = null;
  modelCanvas.closest(".canvas-wrap").classList.remove("is-rotating");
  if (modelCanvas.hasPointerCapture(event.pointerId)) {
    modelCanvas.releasePointerCapture(event.pointerId);
  }
  if (type === "vertex" && hadInvalidAttempt) {
    showToast("此位置会造成面板重叠或面积反转，已保留上一个有效形状。");
    setStatus("已保留上一个有效形状");
    hadInvalidAttempt = false;
  } else if (type === "vertex") {
    setStatus(`V${state.selectedVertex} 已更新，展开图保持有效`);
  }
  modelCanvas.closest(".canvas-wrap").style.cursor = "grab";
  requestRender();
}

modelCanvas.addEventListener("pointerup", finishPointer);
modelCanvas.addEventListener("pointercancel", finishPointer);
modelCanvas.addEventListener("pointerleave", () => {
  if (!state.pointer && state.hoverVertex != null) {
    state.hoverVertex = null;
    requestRender();
  }
});

modelCanvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.0012), 0.72, 1.65);
  requestRender();
}, { passive: false });

document.querySelector("#resetButton").addEventListener("click", resetState);

toggleLabels.addEventListener("click", () => {
  state.showVertexLabels = !state.showVertexLabels;
  toggleLabels.setAttribute("aria-pressed", String(state.showVertexLabels));
  requestRender();
});

document.querySelector("#exportButton").addEventListener("click", async () => {
  await embeddedFontPromise;
  downloadSvg(buildSvg(state.net, state), "foldwork-hexahedron.svg");
  setStatus("A4 SVG 已导出 · 保持 100% 比例打印");
  showToast("SVG 已导出，可直接打印或继续编辑。");
});

document.querySelector("#printButton").addEventListener("click", async () => {
  await embeddedFontPromise;
  const svg = buildSvg(state.net, state);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank", "width=760,height=980");
  if (!printWindow) {
    showToast("浏览器阻止了打印窗口，请使用“导出 SVG”后打印。");
    URL.revokeObjectURL(url);
    return;
  }
  printWindow.addEventListener("load", () => {
    printWindow.focus();
    printWindow.print();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, { once: true });
});

const resizeObserver = new ResizeObserver(resizeViews);
resizeObserver.observe(modelCanvas.parentElement);
resizeObserver.observe(netCanvas.parentElement);

buildVertexRail();
refreshReadout();
setStatus("展开图已随模型更新");
resizeViews();
document.fonts?.ready.then(() => requestRender());

window.papercraft = {
  state,
  buildNet,
  buildSvg: () => buildSvg(state.net, state),
  moveVertex(id, position) {
    const candidate = state.vertices.map((vertex) => ({
      id: vertex.id,
      position: vertex.id === id ? [...position] : [...vertex.position],
    }));
    const committed = commitVertexMove(candidate, id);
    return { committed, net: state.net };
  },
  reset: resetState,
};

