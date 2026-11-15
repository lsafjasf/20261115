import { CONFIG, DT, createInitialState, step, cargoSpeed, PX_PER_M } from "./physics.js";
import { createRecording, recordFrame, serializeRecording, parseRecording } from "./recorder.js";
import { Replayer, snapshot } from "./replayer.js";
import { drawScene } from "./renderer.js";
import { drawTelemetryChart, drawBrakeCurve, pointFromEvent } from "./chart.js";
import { AudioEngine } from "./audio.js";
import {
  buildSuccessRecording,
  buildOverloadRecording,
  buildCollisionRecording,
} from "./scenario.js";

const els = {
  scene: document.getElementById("sceneCanvas"),
  chart: document.getElementById("chartCanvas"),
  curve: document.getElementById("curveCanvas"),
  badge: document.getElementById("modeBadge"),
  boom: document.getElementById("boomSlider"),
  cable: document.getElementById("cableSlider"),
  brake: document.getElementById("brakeSlider"),
  boomVal: document.getElementById("boomVal"),
  cableVal: document.getElementById("cableVal"),
  brakeVal: document.getElementById("brakeVal"),
  status: document.getElementById("statusValue"),
  time: document.getElementById("timeValue"),
  speed: document.getElementById("speedValue"),
  tension: document.getElementById("tensionValue"),
  air: document.getElementById("airValue"),
  maxTension: document.getElementById("maxTensionValue"),
  eventLog: document.getElementById("eventLog"),
  record: document.getElementById("recordBtn"),
  runDemoBtn: document.getElementById("runDemoBtn"),
  play: document.getElementById("playBtn"),
  pause: document.getElementById("pauseBtn"),
  stepBtn: document.getElementById("stepBtn"),
  reset: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  file: document.getElementById("fileInput"),
  addPoint: document.getElementById("addPointBtn"),
  resetCurve: document.getElementById("resetCurveBtn"),
};

const sceneCtx = els.scene.getContext("2d");
const chartCtx = els.chart.getContext("2d");
const curveCtx = els.curve.getContext("2d");
const audio = new AudioEngine();

const DEFAULT_CURVE = [
  { v: 0, b: 0 },
  { v: 1, b: 0.25 },
  { v: 2, b: 0.6 },
  { v: 3, b: 1 },
];

const app = {
  mode: "live",
  state: createInitialState(),
  recording: null,
  replayer: null,
  frames: [],
  brakeCurve: DEFAULT_CURVE.map((p) => ({ ...p })),
  dragIndex: -1,
  liveInput: { boomTargetVel: 0, cableTargetVel: 0, brake: 0 },
  accumulator: 0,
  lastTime: 0,
  seenEvents: 0,
};

function currentInput() {
  return {
    boomTargetVel: Number(els.boom.value),
    cableTargetVel: Number(els.cable.value),
    brake: Number(els.brake.value),
    brakeCurve: app.brakeCurve,
  };
}

function syncSliders() {
  els.boom.value = app.liveInput.boomTargetVel;
  els.cable.value = app.liveInput.cableTargetVel;
  els.brake.value = app.liveInput.brake;
  updateSliderLabels();
}

function updateSliderLabels() {
  els.boomVal.textContent = `${Number(els.boom.value).toFixed(2)} rad/s`;
  els.cableVal.textContent = `${els.cable.value} px/s`;
  els.brakeVal.textContent = Number(els.brake.value).toFixed(2);
}

function setMode(mode) {
  app.mode = mode;
  els.badge.textContent = mode === "live" ? "实时操作" : "回放模式";
  els.badge.classList.toggle("replay", mode !== "live");
  const replay = mode !== "live";
  els.play.disabled = !replay;
  els.pause.disabled = !replay;
  els.stepBtn.disabled = !replay;
  els.record.disabled = replay;
}

function resetLive() {
  app.state = createInitialState();
  app.frames = [snapshot(app.state)];
  app.seenEvents = 0;
  els.eventLog.innerHTML = "";
  app.liveInput = { boomTargetVel: 0, cableTargetVel: 0, brake: 0 };
  syncSliders();
  setMode("live");
  render();
}

function startRecording() {
  resetLive();
  app.recording = createRecording({ name: `录制 ${new Date().toLocaleTimeString()}`, createdAt: Date.now() });
  els.record.textContent = "录制中…";
  els.status.textContent = "录制中";
}

function liveTick() {
  const input = currentInput();
  app.state = step(app.state, input);
  if (app.recording) recordFrame(app.recording, app.state.frame - 1, input);
  app.frames.push(snapshot(app.state));
  if (app.frames.length > 2400) app.frames.shift();
  audio.update(app.state.tension, !app.state.finished);
  if (app.state.finished && app.recording) finishRecording();
}

function finishRecording() {
  els.record.textContent = "开始录制";
  els.status.textContent = app.state.result === "success" ? "吊装成功" : `终止：${app.state.result}`;
  audio.blip(app.state.result === "success" ? 720 : 220);
  loadReplayer(app.recording, "回放（刚录制）");
}

function loadReplayer(recording, label) {
  app.recording = recording;
  app.replayer = new Replayer(recording);
  app.frames = [snapshot(app.replayer.state)];
  app.seenEvents = 0;
  els.eventLog.innerHTML = "";
  setMode("replay");
  els.status.textContent = label;
}

function replayTick() {
  const replayer = app.replayer;
  if (!replayer || replayer.paused || replayer.ended) return;
  replayer.advanceFrame();
  app.state = replayer.state;
  app.frames.push(snapshot(app.state));
  if (app.frames.length > 2400) app.frames.shift();
  audio.update(app.state.tension, !app.state.finished);
  if (replayer.ended) {
    replayer.pause();
    els.status.textContent = app.state.finished
      ? `回放结束：${app.state.result}`
      : "回放结束（已到记录末尾）";
    audio.blip(app.state.result === "success" ? 720 : 220);
  }
}

function renderEvents() {
  const events = app.state.events || [];
  while (app.seenEvents < events.length) {
    const event = events[app.seenEvents];
    const li = document.createElement("li");
    li.textContent = `[${event.t.toFixed(2)}s] ${event.message}`;
    if (event.type === "success") li.classList.add("success");
    els.eventLog.appendChild(li);
    app.seenEvents += 1;
  }
}

function render() {
  const input = app.mode === "live" ? currentInput() : { ...app.liveInput, brakeCurve: app.brakeCurve };
  drawScene(sceneCtx, app.state, input, els.scene.width, els.scene.height);
  drawTelemetryChart(chartCtx, app.frames, els.chart.width, els.chart.height);
  drawBrakeCurve(curveCtx, app.brakeCurve, els.curve.width, els.curve.height, app.dragIndex);

  els.time.textContent = `${app.state.t.toFixed(2)} s`;
  els.speed.textContent = `${(cargoSpeed(app.state) / PX_PER_M).toFixed(2)} m/s`;
  els.tension.textContent = `${app.state.tension.toFixed(0)} N`;
  els.air.textContent = `${app.state.airTime.toFixed(2)} s`;
  els.maxTension.textContent = `${app.state.maxTensionSeen.toFixed(0)} N`;
  if (app.state.tension > CONFIG.maxTension) {
    els.tension.style.color = "#ff8080";
  } else {
    els.tension.style.color = "";
  }
  renderEvents();
}

function frame(now) {
  if (!app.lastTime) app.lastTime = now;
  const elapsed = Math.min(0.1, (now - app.lastTime) / 1000);
  app.lastTime = now;
  app.accumulator += elapsed;
  while (app.accumulator >= DT) {
    if (app.mode === "live") liveTick();
    else replayTick();
    app.accumulator -= DT;
  }
  render();
  requestAnimationFrame(frame);
}

function bindControls() {
  [els.boom, els.cable, els.brake].forEach((slider) => {
    slider.addEventListener("input", () => {
      app.liveInput.boomTargetVel = Number(els.boom.value);
      app.liveInput.cableTargetVel = Number(els.cable.value);
      app.liveInput.brake = Number(els.brake.value);
      updateSliderLabels();
    });
  });

  els.scene.addEventListener("mousemove", (event) => {
    if (app.mode !== "live") return;
    const rect = els.scene.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    app.liveInput.boomTargetVel = Number(((nx - 0.5) * 2 * CONFIG.maxBoomSpeed).toFixed(2));
    app.liveInput.cableTargetVel = Number(((ny - 0.5) * 2 * CONFIG.maxCableSpeed).toFixed(0));
    if (event.shiftKey) app.liveInput.brake = 1;
    syncSliders();
  });
  els.scene.addEventListener("mousedown", () => audio.start());
  els.scene.addEventListener("mouseleave", () => {
    if (app.mode !== "live") return;
    app.liveInput.boomTargetVel = 0;
    app.liveInput.cableTargetVel = 0;
    syncSliders();
  });

  els.record.addEventListener("click", () => {
    audio.start();
    startRecording();
  });
  els.reset.addEventListener("click", resetLive);
  els.play.addEventListener("click", () => {
    app.replayer?.play();
    audio.start();
  });
  els.pause.addEventListener("click", () => app.replayer?.pause());
  els.stepBtn.addEventListener("click", () => {
    if (!app.replayer) return;
    app.replayer.stepOnce();
    app.state = app.replayer.state;
    app.frames.push(snapshot(app.state));
    render();
  });

  els.runDemoBtn.addEventListener("click", () => loadReplayer(buildSuccessRecording(), "标准成功吊装"));
  document.getElementById("overloadBtn").addEventListener("click", () => loadReplayer(buildOverloadRecording(), "超载演示"));
  document.getElementById("collisionBtn").addEventListener("click", () => loadReplayer(buildCollisionRecording(), "碰撞演示"));

  els.exportBtn.addEventListener("click", () => {
    if (!app.recording) return;
    const blob = new Blob([serializeRecording(app.recording)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crane-recording.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  els.importBtn.addEventListener("click", () => els.file.click());
  els.file.addEventListener("change", async () => {
    const file = els.file.files[0];
    if (!file) return;
    const text = await file.text();
    loadReplayer(parseRecording(text), "导入记录回放");
    els.file.value = "";
  });

  bindCurveEditor();
}

function bindCurveEditor() {
  els.curve.addEventListener("mousedown", (event) => {
    const pos = pointFromEvent(event, els.curve, app.brakeCurve);
    let nearest = 0;
    let best = Infinity;
    app.brakeCurve.forEach((point, i) => {
      const d = Math.hypot(point.v - pos.v, point.b - pos.b);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    app.dragIndex = nearest;
  });
  window.addEventListener("mousemove", (event) => {
    if (app.dragIndex < 0) return;
    const pos = pointFromEvent(event, els.curve, app.brakeCurve);
    const point = app.brakeCurve[app.dragIndex];
    point.v = Number(pos.v.toFixed(2));
    point.b = Number(pos.b.toFixed(2));
    app.brakeCurve.sort((a, b) => a.v - b.v);
  });
  window.addEventListener("mouseup", () => {
    app.dragIndex = -1;
  });
  els.addPoint.addEventListener("click", () => {
    app.brakeCurve.push({ v: 1.5, b: 0.4 });
    app.brakeCurve.sort((a, b) => a.v - b.v);
  });
  els.resetCurve.addEventListener("click", () => {
    app.brakeCurve = DEFAULT_CURVE.map((p) => ({ ...p }));
  });
}

bindControls();
resetLive();
requestAnimationFrame(frame);
