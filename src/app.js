import {
  LANES,
  advanceSimulation,
  createSimulation,
  drainEvents,
  getForecast,
  getSnapshot,
  selectLane,
  setControl,
  setControlValues,
  stepSimulation,
  toggleSpray,
  triggerWarmFront,
} from "./simulation.js";
import { SnowAudio } from "./audio.js";
import { SnowScene } from "./scene.js";

const $ = (selector) => document.querySelector(selector);
const elements = {
  canvas: $("#snowCanvas"),
  temperature: $("#temperature"),
  humidity: $("#humidity"),
  wind: $("#wind"),
  windVector: $("#windVector"),
  clock: $("#clock"),
  countdown: $("#countdown"),
  phaseBadge: $("#phaseBadge"),
  phaseText: $("#phaseText"),
  activeLaneLabel: $("#activeLaneLabel"),
  laneStrip: $("#laneStrip"),
  laneSelector: $("#laneSelector"),
  targetName: $("#targetName"),
  targetThickness: $("#targetThickness"),
  targetHardness: $("#targetHardness"),
  water: $("#waterControl"),
  air: $("#airControl"),
  angle: $("#angleControl"),
  waterValue: $("#waterValue"),
  airValue: $("#airValue"),
  angleValue: $("#angleValue"),
  qualityLabel: $("#qualityLabel"),
  qualityFill: $("#qualityFill"),
  predictedHardness: $("#predictedHardness"),
  catchRate: $("#catchRate"),
  gunStatus: $("#gunStatus"),
  sprayButton: $("#sprayButton"),
  sprayLabel: $("#sprayLabel"),
  consoleMessage: $("#consoleMessage"),
  audioButton: $("#audioButton"),
  audioLabel: $("#audioLabel"),
  warmButton: $("#warmButton"),
  resetButton: $("#resetButton"),
  toastStack: $("#toastStack"),
  resultDialog: $("#resultDialog"),
  resultTitle: $("#resultTitle"),
  resultCopy: $("#resultCopy"),
  resultGrid: $("#resultGrid"),
  continueButton: $("#continueButton"),
  closeResultButton: $("#closeResultButton"),
};

let simulation = createSimulation();
let lastFrameTime = 0;
let lastUiUpdate = 0;
let messageUntil = 0;
let messageText = "";
let dialogShown = false;
let previousSuccess = false;

const scene = new SnowScene(elements.canvas);
const audio = new SnowAudio();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = (value) => String(value).padStart(2, "0");
const formatTime = (seconds) => {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
};

elements.laneStrip.innerHTML = LANES.map(
  (lane, index) => `
    <button class="lane-summary" type="button" data-lane="${index}">
      <span class="lane-summary-top">
        <span class="lane-summary-name"><i>${lane.code}</i>${lane.name}</span>
        <span class="lane-state">待造雪</span>
      </span>
      <span class="mini-progress"><span style="width:0%"></span></span>
      <span class="lane-summary-meta">
        <span>厚度 <b class="lane-thickness">0.0</b> / ${lane.targetThickness}</span>
        <span>硬 <b class="lane-hardness">—</b></span>
      </span>
    </button>
  `,
).join("");

const laneSummaryNodes = [...elements.laneStrip.querySelectorAll(".lane-summary")];
const laneTabNodes = [...elements.laneSelector.querySelectorAll(".lane-tab")];

function setMessage(text, duration = 2800) {
  messageText = text;
  messageUntil = performance.now() + duration;
  elements.consoleMessage.textContent = text;
}

function syncAudioButton() {
  const audioState = audio.getState();
  elements.audioButton.setAttribute("aria-pressed", String(audioState.enabled));
  elements.audioLabel.textContent = audioState.enabled ? "关闭声场" : "开启声场";
}

async function ensureAudio() {
  if (audio.getState().enabled) return;
  try {
    await audio.enable();
    syncAudioButton();
  } catch {
    elements.audioLabel.textContent = "音频不可用";
  }
}

function updateRange(input, value) {
  const minimum = Number(input.min);
  const maximum = Number(input.max);
  const progress = ((value - minimum) / (maximum - minimum)) * 100;
  input.value = String(value);
  input.style.setProperty("--range-progress", `${progress}%`);
}

function toast(message, tone = "") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`.trim();
  node.textContent = message;
  elements.toastStack.append(node);
  while (elements.toastStack.children.length > 2) {
    elements.toastStack.firstElementChild.remove();
  }
  window.setTimeout(() => node.classList.add("out"), 3200);
  window.setTimeout(() => node.remove(), 3550);
}

function phaseLabel(snapshot) {
  if (snapshot.environment.warmFront.active && !snapshot.environment.warmFront.settled) {
    return "暖锋过境";
  }
  if (snapshot.phase === "open") return "可营业";
  if (snapshot.phase === "testing") return "雪质复检";
  if (snapshot.phase === "warming") return "暖锋过境";
  return snapshot.controls.spraying ? "造雪进行中" : "等待校准";
}

function qualityWord(forecast) {
  if (forecast.quality > 0.88) return "优";
  if (forecast.quality > 0.72) return "稳定";
  if (forecast.quality > 0.55) return "偏弱";
  return "不达标";
}

function defaultMessage(snapshot) {
  if (snapshot.environment.warmFront.active && !snapshot.environment.warmFront.settled) {
    return "暖锋正在抬升露点：增加压缩空气、降低水量，并重新抬高喷筒。";
  }
  if (snapshot.phase === "testing") {
    return "暖锋后雪层已软化。按 1–3 切道，逐条补喷并重新匹配目标硬度。";
  }
  if (snapshot.phase === "open") {
    return "三条雪道已过线。可启动暖锋压测，检查高温下的自适应能力。";
  }
  if (snapshot.controls.spraying) {
    const lane = snapshot.lanes[snapshot.activeLane];
    return `正在向${LANES[snapshot.activeLane].name}补雪；当前雪质 ${Math.round(
      lane.quality * 100,
    )}。`;
  }
  return "选择雪道，匹配目标后启动雪炮。";
}

function updateUI(snapshot) {
  elements.temperature.innerHTML = `${snapshot.environment.temperature.toFixed(1)}<small>°C</small>`;
  elements.humidity.innerHTML = `${Math.round(snapshot.environment.humidity)}<small>%</small>`;
  elements.wind.innerHTML = `${snapshot.environment.wind.toFixed(1)}<small>m/s</small>`;
  elements.windVector.textContent = `${snapshot.environment.wind > 6 ? "强" : "西南"}风 ${
    snapshot.environment.wind > 6 ? "↗↗" : "↗"
  }`;
  elements.countdown.textContent = formatTime(snapshot.remaining);
  const clockSeconds = 5 * 3600 + 54 * 60 + Math.floor(snapshot.time);
  elements.clock.textContent = `${pad(Math.floor(clockSeconds / 3600) % 24)}:${pad(
    Math.floor(clockSeconds / 60) % 60,
  )}`;

  const phase = phaseLabel(snapshot);
  elements.phaseText.textContent = phase;
  elements.phaseBadge.classList.toggle(
    "warm",
    snapshot.environment.warmFront.active &&
      !snapshot.environment.warmFront.settled,
  );
  elements.phaseBadge.classList.toggle("ready", snapshot.phase === "open");

  const activeLane = LANES[snapshot.activeLane];
  elements.activeLaneLabel.textContent = `${activeLane.code} / ${activeLane.name}`;
  elements.targetName.textContent = `${activeLane.name} · ${activeLane.subtitle}`;
  elements.targetThickness.textContent = String(activeLane.targetThickness);
  elements.targetHardness.textContent = String(activeLane.targetHardness);

  updateRange(elements.water, snapshot.controls.water);
  updateRange(elements.air, snapshot.controls.air);
  updateRange(elements.angle, snapshot.controls.angle);
  elements.waterValue.textContent = `${Math.round(snapshot.controls.water)} bar`;
  elements.airValue.textContent = `${Math.round(snapshot.controls.air)} bar`;
  elements.angleValue.textContent = `${Math.round(snapshot.controls.angle)}°`;

  const forecast = snapshot.forecast;
  const tone =
    forecast.quality > 0.72 ? "#86d8c4" : forecast.quality > 0.55 ? "#f4a261" : "#ee7867";
  elements.qualityFill.style.width = `${clamp(forecast.quality * 100, 4, 100)}%`;
  elements.qualityFill.style.background = tone;
  elements.qualityLabel.textContent = qualityWord(forecast);
  elements.qualityLabel.style.color = tone;
  elements.predictedHardness.textContent = `${Math.round(forecast.hardness)} / ${
    activeLane.targetHardness
  }`;
  elements.catchRate.textContent = `${Math.round(forecast.catchRate * 100)}%`;
  elements.qualityLabel.title =
    forecast.hardnessError > 0 ? "混合偏湿，落地后更硬" : "混合偏干，易被风吹散";

  elements.sprayButton.setAttribute("aria-pressed", String(snapshot.controls.spraying));
  elements.sprayLabel.textContent = snapshot.controls.spraying ? "停止雪炮" : "启动雪炮";
  elements.gunStatus.textContent = snapshot.controls.spraying ? "运行中" : "待机";
  elements.gunStatus.classList.toggle("active", snapshot.controls.spraying);
  elements.gunStatus.classList.toggle(
    "warn",
    snapshot.environment.warmFront.active && !snapshot.environment.warmFront.settled,
  );

  laneTabNodes.forEach((node, index) => {
    node.classList.toggle("active", index === snapshot.activeLane);
    node.setAttribute("aria-selected", String(index === snapshot.activeLane));
  });

  laneSummaryNodes.forEach((node, index) => {
    const lane = snapshot.lanes[index];
    const stateNode = node.querySelector(".lane-state");
    node.classList.toggle("active", index === snapshot.activeLane);
    node.querySelector(".lane-thickness").textContent = lane.thickness.toFixed(1);
    node.querySelector(".lane-hardness").textContent =
      lane.thickness > 0 ? Math.round(lane.hardness) : "—";
    node.querySelector(".mini-progress span").style.width = `${clamp(
      (lane.thickness / LANES[index].targetThickness) * 100,
      0,
      100,
    )}%`;
    const stateClass = lane.certified ? "ok" : lane.thickness > 0 ? "warn" : "";
    stateNode.className = `lane-state ${stateClass}`.trim();
    stateNode.textContent = lane.certified
      ? "验收通过"
      : lane.thickness > 0
        ? lane.issue
        : "待造雪";
  });

  if (performance.now() > messageUntil) {
    elements.consoleMessage.textContent = defaultMessage(snapshot);
  } else {
    elements.consoleMessage.textContent = messageText;
  }
}

function showResult(snapshot, forced = false) {
  if (!forced && elements.resultDialog.open) return;
  elements.resultTitle.textContent = snapshot.warmFronts
    ? "暖锋后重新达标"
    : "雪道已通过验收";
  elements.resultCopy.textContent = snapshot.warmFronts
    ? `升温后雪层曾出现软化与掉厚，当前三条雪道已按新露点重新完成补喷，平均雪质 ${Math.round(
        snapshot.averageQuality * 100,
      )}。`
    : `三条雪道均达到厚度与硬度标准，平均雪质 ${Math.round(
        snapshot.averageQuality * 100,
      )}。雪场可以按时开门。`;
  elements.resultGrid.innerHTML = snapshot.lanes
    .map(
      (lane) => `
        <div class="result-item">
          <span>${lane.code} ${lane.name}</span>
          <b>${lane.thickness.toFixed(1)} cm</b>
          <small>硬度 ${Math.round(lane.hardness)} · 雪质 ${Math.round(
            lane.quality * 100,
          )}</small>
        </div>
      `,
    )
    .join("");
  elements.resultDialog.showModal();
  dialogShown = true;
}

function handleEvents(events) {
  const snapshot = getSnapshot(simulation);
  for (const event of events) {
    if (event.type === "lane-certified") {
      audio.chime();
      toast(event.message, "good");
    } else if (event.type === "lane-revoked") {
      toast(`${event.message} · ${event.reason}`, "warn");
    } else if (event.type === "opening-ready") {
      window.setTimeout(() => showResult(getSnapshot(simulation)), 260);
    } else if (event.type === "warm-front") {
      if (elements.resultDialog.open) elements.resultDialog.close();
      audio.warmGust();
      setMessage("暖锋压测启动：温度、湿度同步抬升，等待雪层反应。", 4200);
      toast("暖锋压测启动 · 观察硬度与雪质变化", "warn");
    } else if (event.type === "warm-front-peak") {
      setMessage("露点已升高。建议：降低泵压、增加空气、把喷筒略抬高。", 8000);
      toast("暖锋抵达峰值 · 雪质开始下降", "warn");
    } else if (event.type === "warm-front-blocked") {
      toast(event.message);
    }
  }
  const nowSuccess = snapshot.success;
  if (nowSuccess && !previousSuccess && snapshot.warmFronts > 0) {
    toast("暖锋后重新达标 · 三条雪道恢复营业标准", "good");
    audio.chime();
  }
  previousSuccess = nowSuccess;
}

function applyControl(key, rawValue) {
  setControl(simulation, key, Number(rawValue));
  const snapshot = getSnapshot(simulation);
  updateUI(snapshot);
  audio.update(snapshot);
}

elements.water.addEventListener("input", (event) => applyControl("water", event.target.value));
elements.air.addEventListener("input", (event) => applyControl("air", event.target.value));
elements.angle.addEventListener("input", (event) => applyControl("angle", event.target.value));

function chooseLane(index) {
  selectLane(simulation, index);
  setMessage(`已切换至${LANES[index].name}，正在同步该雪道目标。`, 2200);
  const events = drainEvents(simulation);
  handleEvents(events);
  updateUI(getSnapshot(simulation));
}

elements.laneSelector.addEventListener("click", (event) => {
  const button = event.target.closest(".lane-tab");
  if (button) chooseLane(Number(button.dataset.lane));
});

elements.laneStrip.addEventListener("click", (event) => {
  const button = event.target.closest(".lane-summary");
  if (button) chooseLane(Number(button.dataset.lane));
});

async function setSpraying(next) {
  const applied = toggleSpray(simulation, next);
  if (applied) await ensureAudio();
  setMessage(
    applied
      ? `泵组启动，正在向${LANES[simulation.activeLane].name}喷射。`
      : "雪炮已暂停，当前雪层保持原状。",
    2400,
  );
  handleEvents(drainEvents(simulation));
  updateUI(getSnapshot(simulation));
}

elements.sprayButton.addEventListener("click", () => {
  setSpraying(!simulation.controls.spraying);
});

elements.audioButton.addEventListener("click", async () => {
  if (audio.getState().enabled) {
    audio.disable();
  } else {
    await ensureAudio();
  }
  syncAudioButton();
});

elements.warmButton.addEventListener("click", async () => {
  await ensureAudio();
  const started = triggerWarmFront(simulation);
  if (started) {
    if (elements.resultDialog.open) elements.resultDialog.close();
    setMessage("暖锋压测启动：观察温度抬升后的雪层反应。", 5000);
  }
  handleEvents(drainEvents(simulation));
  updateUI(getSnapshot(simulation));
});

elements.resetButton.addEventListener("click", () => {
  simulation = createSimulation();
  scene.particles.length = 0;
  previousSuccess = false;
  dialogShown = false;
  setMessage("雪季已重置。三条雪道回到待造雪状态。", 2600);
  if (elements.resultDialog.open) elements.resultDialog.close();
  elements.toastStack.replaceChildren();
  updateUI(getSnapshot(simulation));
  audio.update(getSnapshot(simulation));
});

elements.continueButton.addEventListener("click", () => elements.resultDialog.close());
elements.closeResultButton.addEventListener("click", () => elements.resultDialog.close());
elements.resultDialog.addEventListener("click", (event) => {
  if (event.target === elements.resultDialog) elements.resultDialog.close();
});

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (elements.resultDialog.open) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (!event.repeat) setSpraying(!simulation.controls.spraying);
  } else if (["1", "2", "3"].includes(event.key)) {
    chooseLane(Number(event.key) - 1);
  }
});

function drawAcceleratedFrame() {
  const snapshot = getSnapshot(simulation);
  scene.draw(snapshot, performance.now());
  updateUI(snapshot);
  audio.update(snapshot);
}

function frame(timestamp) {
  if (!lastFrameTime) lastFrameTime = timestamp;
  const delta = Math.min(0.12, Math.max(0, (timestamp - lastFrameTime) / 1000));
  lastFrameTime = timestamp;
  if (!document.hidden) stepSimulation(simulation, delta);
  handleEvents(drainEvents(simulation));
  const snapshot = getSnapshot(simulation);
  scene.draw(snapshot, timestamp);
  audio.update(snapshot);
  if (timestamp - lastUiUpdate > 75) {
    lastUiUpdate = timestamp;
    updateUI(snapshot);
  }
  requestAnimationFrame(frame);
}

updateUI(getSnapshot(simulation));
scene.draw(getSnapshot(simulation), performance.now());
requestAnimationFrame(frame);

window.snowGame = {
  getSnapshot: () => getSnapshot(simulation),
  getAudioState: () => audio.getState(),
  setControls: (values) => {
    setControlValues(simulation, values);
    drawAcceleratedFrame();
    return getSnapshot(simulation);
  },
  setActiveLane: (index) => {
    selectLane(simulation, index);
    handleEvents(drainEvents(simulation));
    drawAcceleratedFrame();
    return getSnapshot(simulation);
  },
  spray: (forced) => {
    setSpraying(typeof forced === "boolean" ? forced : !simulation.controls.spraying);
    return getSnapshot(simulation);
  },
  advance: (seconds, controls) => {
    if (controls) setControlValues(simulation, controls);
    advanceSimulation(simulation, seconds);
    handleEvents(drainEvents(simulation));
    drawAcceleratedFrame();
    return getSnapshot(simulation);
  },
  warmFront: () => {
    triggerWarmFront(simulation);
    handleEvents(drainEvents(simulation));
    drawAcceleratedFrame();
    return getSnapshot(simulation);
  },
  reset: () => {
    elements.resetButton.click();
    return getSnapshot(simulation);
  },
  getCanvasStats: () => ({
    width: elements.canvas.width,
    height: elements.canvas.height,
    dataUrlLength: elements.canvas.toDataURL("image/png").length,
  }),
};
