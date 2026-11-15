import { createScene, serializeScene, deserializeScene, resetScene, hitTest } from "./engine/scene.js";
import { Renderer } from "./engine/renderer.js";
import { buildScript, applyFrame, applyRecordingFrame, REPLAY_FPS } from "./engine/replay.js";
import { runBenchmark, runBenchmarkSuite, hashCanvas, CONFIGS } from "./engine/benchmark.js";

const SEED = 42;
const SHAPE_COUNT = 600;

const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");
const renderer = new Renderer(ctx);

const scene = createScene(SEED, SHAPE_COUNT);
const script = buildScript(scene, SEED + 1000);
const camera = { x: 0, y: 0 };

const state = {
  options: { shadows: true, spatialSort: true, culling: true },
  mode: "idle", // idle | drag | pan | replay | recording | benchmark
  replay: null,
  recording: null,
  loadedRecording: null,
  emaFrameMs: 0,
};

const els = {
  shadows: document.getElementById("opt-shadows"),
  spatial: document.getElementById("opt-spatial"),
  culling: document.getElementById("opt-culling"),
  frame: document.getElementById("m-frame"),
  layout: document.getElementById("m-layout"),
  draw: document.getElementById("m-draw"),
  calls: document.getElementById("m-calls"),
  objects: document.getElementById("m-objects"),
  visible: document.getElementById("m-visible"),
  replayState: document.getElementById("m-replay-state"),
  replayFrame: document.getElementById("m-replay-frame"),
  bench: document.getElementById("bench-out"),
  parity: document.getElementById("parity-out"),
  overlay: document.getElementById("overlay"),
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.viewW = rect.width;
  state.viewH = rect.height;
}
window.addEventListener("resize", resizeCanvas);

function viewSize() {
  return { viewW: state.viewW || canvas.clientWidth, viewH: state.viewH || canvas.clientHeight };
}

function toWorld(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left + camera.x,
    y: event.clientY - rect.top + camera.y,
    sx: event.clientX - rect.left,
    sy: event.clientY - rect.top,
  };
}

// ---------------- Pointer interaction (drag shapes, pan camera) ----------
let drag = null;

canvas.addEventListener("pointerdown", (event) => {
  if (state.mode === "replay" || state.mode === "benchmark") return;
  canvas.setPointerCapture(event.pointerId);
  const p = toWorld(event);
  if (event.shiftKey || event.button === 1) {
    drag = { kind: "pan", startX: event.clientX, startY: event.clientY, camX: camera.x, camY: camera.y };
    state.mode = "pan";
  } else {
    const shape = hitTest(scene, p.x, p.y);
    if (shape) {
      drag = { kind: "shape", shape, offsetX: p.x - shape.x, offsetY: p.y - shape.y };
      state.mode = "drag";
      canvas.classList.add("dragging");
      beginRecordingEvent(event, shape.id);
    }
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const p = toWorld(event);
  if (drag.kind === "pan") {
    camera.x = drag.camX - (event.clientX - drag.startX);
    camera.y = drag.camY - (event.clientY - drag.startY);
  } else {
    drag.shape.x = p.x - drag.offsetX;
    drag.shape.y = p.y - drag.offsetY;
    recordMove(event);
  }
});

function endPointer(event) {
  if (!drag) return;
  drag = null;
  state.mode = state.recording ? "recording" : "idle";
  canvas.classList.remove("dragging");
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// ---------------- Manual recording (fixed 10 s user actions) -------------
function beginRecordingEvent(event, shapeId) {
  if (!state.recording) return;
  state.recording.events.push({
    type: "drag",
    shapeId,
    t: performance.now() - state.recording.startedAt,
    points: [],
  });
}
function recordMove(event) {
  const rec = state.recording;
  if (!rec || !rec.events.length) return;
  const current = rec.events[rec.events.length - 1];
  const p = toWorld(event);
  current.points.push({ t: performance.now() - rec.startedAt, x: p.x, y: p.y });
}
// ---------------- Render loop --------------------------------------------
function frame() {
  const { viewW, viewH } = viewSize();
  const result = renderer.renderFrame(scene, camera, viewW, viewH, state.options);

  const alpha = 0.12;
  state.emaFrameMs = state.emaFrameMs
    ? state.emaFrameMs * (1 - alpha) + (result.layoutMs + result.drawMs) * alpha
    : result.layoutMs + result.drawMs;

  els.frame.textContent = state.emaFrameMs.toFixed(2);
  els.layout.textContent = result.layoutMs.toFixed(3);
  els.draw.textContent = result.drawMs.toFixed(3);
  els.calls.textContent = String(result.drawCalls);
  els.objects.textContent = String(scene.shapes.length);
  els.visible.textContent =
    `${renderer.lastFrameCount.visible} / ${renderer.lastFrameCount.culled}`;

  requestAnimationFrame(frame);
}

// ---------------- Deterministic 10 s replay ------------------------------
async function playReplay() {
  if (state.mode === "replay" || state.mode === "benchmark") return;
  resetScene(scene);
  camera.x = 0;
  camera.y = 0;
  state.mode = "replay";
  els.replayState.textContent = "回放中";
  const stepMs = 1000 / REPLAY_FPS;
  for (let f = 0; f < script.frames; f++) {
    applyFrame(scene, camera, script, f);
    els.replayFrame.textContent = `${f + 1} / ${script.frames}（${(f * stepMs / 1000).toFixed(2)}s）`;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  els.replayState.textContent = "回放完成";
  state.mode = "idle";
}

document.getElementById("btn-replay").addEventListener("click", playReplay);

async function playLoadedRecording() {
  if (!state.loadedRecording || state.mode === "replay" || state.mode === "benchmark") return;
  resetScene(scene);
  camera.x = 0;
  camera.y = 0;
  state.mode = "replay";
  els.replayState.textContent = "回放录制中";
  const duration = state.loadedRecording.durationMs || 10_000;
  const stepMs = 1000 / REPLAY_FPS;
  const frames = Math.round(duration / stepMs);
  for (let f = 0; f < frames; f++) {
    applyRecordingFrame(scene, state.loadedRecording, f * stepMs);
    els.replayFrame.textContent = `${f + 1} / ${frames}`;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  els.replayState.textContent = "录制回放完成";
  state.mode = "idle";
}
document.getElementById("btn-replay-rec").addEventListener("click", () => {
  if (!state.loadedRecording) {
    els.replayState.textContent = "请先加载录制 JSON";
    return;
  }
  playLoadedRecording();
});

document.getElementById("btn-export-script").addEventListener("click", () => {
  downloadJson("fixed-replay-script.json", {
    kind: "deterministic-script",
    seed: SEED + 1000,
    durationMs: script.durationMs,
    frames: script.frames,
    frameMs: script.frameMs,
    actions: script.actions,
  });
});

// ---------------- Recording controls --------------------------------------
document.getElementById("btn-record").addEventListener("click", () => {
  if (state.recording) {
    stopRecording();
  } else {
    state.recording = { startedAt: performance.now(), events: [] };
    state.mode = "recording";
    els.replayState.textContent = "录制中（10s）";
    document.getElementById("btn-record").textContent = "停止并保存";
    setTimeout(() => state.recording && stopRecording(), 10_000);
  }
});

function stopRecording() {
  const rec = state.recording;
  state.recording = null;
  state.mode = "idle";
  document.getElementById("btn-record").textContent = "录制动作";
  els.replayState.textContent = "录制已保存";
  downloadJson("recording.json", {
    seed: SEED,
    durationMs: 10_000,
    events: rec.events,
  });
}

// ---------------- Save / load scene --------------------------------------
document.getElementById("btn-save").addEventListener("click", () => {
  downloadJson("scene.json", JSON.parse(serializeScene(scene)));
});

document.getElementById("btn-load").addEventListener("click", () => {
  document.getElementById("file-load").click();
});
document.getElementById("file-load").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    const loaded = deserializeScene(text);
    if (Array.isArray(loaded.events)) {
      state.loadedRecording = loaded;
      els.replayState.textContent = `已加载录制（${loaded.events.length} 个动作）`;
      return;
    }
    scene.seed = loaded.seed;
    scene.count = loaded.count;
    scene.worldW = loaded.worldW;
    scene.worldH = loaded.worldH;
    scene.shapes.length = 0;
    scene.shapes.push(...loaded.shapes);
  });
});

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------- Option toggles ------------------------------------------
for (const [key, el] of [["shadows", els.shadows], ["spatialSort", els.spatial], ["culling", els.culling]]) {
  el.addEventListener("change", () => {
    state.options[key] = el.checked;
  });
}

// ---------------- Parity check --------------------------------------------
document.getElementById("btn-parity").addEventListener("click", () => {
  const { viewW, viewH } = viewSize();
  const current = { ...state.options };
  const combos = [
    { name: "线性+不裁剪", spatialSort: false, culling: false },
    { name: "线性+裁剪", spatialSort: false, culling: true },
    { name: "网格+不裁剪", spatialSort: true, culling: false },
    { name: "网格+裁剪", spatialSort: true, culling: true },
  ];
  const hashes = combos.map((combo) => {
    Object.assign(state.options, combo);
    renderer.renderFrame(scene, camera, viewW, viewH, state.options);
    return { name: combo.name, hash: hashCanvas(canvas) };
  });
  Object.assign(state.options, current);
  const base = hashes[0].hash;
  const allEqual = hashes.every((h) => h.hash === base);
  els.parity.innerHTML = hashes
    .map((h) => `<div class="${h.hash === base ? "ok" : "fail"}">${h.hash === base ? "✓" : "✗"} ${h.name} <span class="code-inline">${h.hash}</span></div>`)
    .join("") + `<div class="${allEqual ? "ok" : "fail"}">${allEqual ? "四种组合像素完全一致" : "存在像素差异！"}</div>`;
});

// ---------------- Benchmark ------------------------------------------------
document.getElementById("btn-bench").addEventListener("click", async () => {
  if (state.mode === "benchmark") return;
  state.mode = "benchmark";
  els.overlay.classList.remove("hidden");
  els.overlay.textContent = "正在运行确定性基准（4 × 10s 回放）…";
  await new Promise((resolve) => setTimeout(resolve, 30));
  const { viewW, viewH } = viewSize();
  const report = runBenchmark({
    seed: SEED,
    shapeCount: SHAPE_COUNT,
    viewW,
    viewH,
    canvas,
  });
  els.bench.textContent = formatReport(report);
  els.overlay.classList.add("hidden");
  state.mode = "idle";
  window.__lastBenchmark = report;
});

function formatReport(report) {
  const lines = [];
  lines.push(`回放 ${report.replayFrames} 帧 / ${report.replayDurationMs}ms，对象 ${report.shapeCount}，视口 ${report.viewport.width}×${report.viewport.height}`);
  lines.push("");
  for (const r of report.results) {
    lines.push(`[${r.configId}] ${r.label}`);
    lines.push(`  帧均 ${r.avgFrameMs.toFixed(3)}ms  p50 ${r.p50FrameMs.toFixed(3)}  p95 ${r.p95FrameMs.toFixed(3)}`);
    lines.push(`  布局 ${r.avgLayoutMs.toFixed(3)}ms  绘制 ${r.avgDrawMs.toFixed(3)}ms  调用均 ${r.avgDrawCalls.toFixed(0)}  可见均 ${r.avgVisible.toFixed(0)}`);
  }
  lines.push("");
  for (const p of report.parity) {
    lines.push(`${p.identical ? "✓ 像素一致" : "✗ 像素差异"}：${p.configId}（对比帧 ${p.comparedFrames.join(",")}）`);
  }
  return lines.join("\n");
}

// Expose for the headless benchmark harness.
window.__profiler = { runBenchmark, runBenchmarkSuite, CONFIGS, scene, camera, renderer, getState: () => state };

resizeCanvas();
requestAnimationFrame(frame);
