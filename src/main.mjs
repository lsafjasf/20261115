import {
  CONFIG,
  allGatesClosed,
  createGame,
  nextGateIndex,
  requestCloseGate,
  secondsRemaining,
  setPump,
  startGame,
  tick,
  togglePump,
} from "./game-model.mjs";
import { HarborRenderer } from "./renderer.mjs";
import { StormAudio } from "./audio.mjs";

const canvas = document.querySelector("#gameCanvas");
const renderer = new HarborRenderer(canvas);
const audio = new StormAudio();
let state = createGame();
let lastFrame = performance.now();
let lastUiUpdate = 0;
let eventCursor = 0;
let resultShownFor = null;

const elements = {
  startOverlay: document.querySelector("#startOverlay"),
  resultOverlay: document.querySelector("#resultOverlay"),
  startButton: document.querySelector("#startButton"),
  restartButton: document.querySelector("#restartButton"),
  resetButton: document.querySelector("#resetButton"),
  pumpButton: document.querySelector("#pumpButton"),
  pumpButtonText: document.querySelector("#pumpButtonText"),
  pumpState: document.querySelector("#pumpState"),
  gateControls: document.querySelector("#gateControls"),
  timeValue: document.querySelector("#timeValue"),
  timeBar: document.querySelector("#timeBar"),
  waterValue: document.querySelector("#waterValue"),
  waterState: document.querySelector("#waterState"),
  powerValue: document.querySelector("#powerValue"),
  powerBar: document.querySelector("#powerBar"),
  gateValue: document.querySelector("#gateValue"),
  stormLabel: document.querySelector("#stormLabel"),
  stormLevel: document.querySelector("#stormLevel"),
  tideValue: document.querySelector("#tideValue"),
  windValue: document.querySelector("#windValue"),
  marginValue: document.querySelector("#marginValue"),
  safeValue: document.querySelector("#safeValue"),
  statusMessage: document.querySelector("#statusMessage"),
  pumpPercent: document.querySelector("#pumpPercent"),
  pumpRing: document.querySelector("#pumpRing"),
  batteryFill: document.querySelector("#batteryFill"),
  audioStatus: document.querySelector("#audioStatus"),
  audioBars: document.querySelector(".audio-bars"),
  resultEyebrow: document.querySelector("#resultEyebrow"),
  resultTitle: document.querySelector("#resultTitle"),
  resultReason: document.querySelector("#resultReason"),
  resultTime: document.querySelector("#resultTime"),
  resultWater: document.querySelector("#resultWater"),
  resultSafe: document.querySelector("#resultSafe"),
};

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function buildGateControls() {
  elements.gateControls.replaceChildren();
  state.gates.forEach((gate, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gate-control";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="gate-index">${gate.id}</span>
      <span class="gate-copy">
        <b>${gate.name}</b>
        <span>卷扬 ${gate.closeDuration}s · 门区清空后落闸</span>
      </span>
      <span class="gate-progress">待命</span>
    `;
    button.addEventListener("click", () => closeGate(index));
    elements.gateControls.append(button);
  });
}

function gateControlAt(index) {
  return elements.gateControls.querySelector(`[data-index="${index}"]`);
}

function processEvents() {
  while (eventCursor < state.events.length) {
    const event = state.events[eventCursor];
    eventCursor += 1;
    audio.playEvent(event);
    if (event.type === "gate-closed") {
      const gate = state.gates.find((item) => item.id === event.gateId);
      setStatus(`${gate.shortName} 已闭合 · 检查下一段撤离路线`);
    } else if (event.type === "battery-empty") {
      setStatus("泵站电池耗尽 · 排水停止");
    } else if (event.type === "warning") {
      setStatus("港区水位越过警戒线 · 启动水泵争取时间");
    } else if (event.type === "won") {
      setStatus("四闸闭合，水位回到警戒线以下");
    } else if (event.type === "lost") {
      setStatus(event.message);
    }
  }
}

function closeGate(index) {
  const result = requestCloseGate(state, index);
  if (!result.ok) {
    setStatus(result.message);
    return;
  }
  setStatus(result.message);
  processEvents();
  updateInterface(true);
}

function togglePumpAction() {
  const result = togglePump(state);
  setStatus(result.message);
  processEvents();
  updateInterface(true);
}

async function beginGame() {
  if (state.status !== "ready") {
    return;
  }
  const soundReady = await audio.start().catch(() => false);
  startGame(state);
  processEvents();
  elements.startOverlay.classList.add("hidden");
  elements.audioStatus.textContent = soundReady
    ? "风暴声场已启用 · 音量随风力变化"
    : "当前浏览器未提供 Web Audio";
  elements.audioBars.classList.toggle("muted", !soundReady);
  setStatus("A 闸待命 · 等最后一辆车通过门区再落闸");
  updateInterface(true);
}

function resetGame() {
  state = createGame();
  eventCursor = 0;
  resultShownFor = null;
  renderer.reset();
  elements.startOverlay.classList.remove("hidden");
  elements.resultOverlay.classList.add("hidden");
  elements.resultOverlay.classList.remove("won", "lost");
  elements.audioStatus.textContent = "点击开始后启用风暴声场";
  elements.audioBars.classList.add("muted");
  buildGateControls();
  setStatus("系统待命 · 所有闸门开启");
  updateInterface(true);
}

function updateInterface(force = false) {
  const now = performance.now();
  if (!force && now - lastUiUpdate < 80) {
    return;
  }
  lastUiUpdate = now;

  const remaining = secondsRemaining(state);
  const progress = remaining / CONFIG.duration;
  const closedCount = state.gates.filter((gate) => gate.state === "closed").length;
  const nextIndex = nextGateIndex(state);
  const closing = state.gates.some((gate) => gate.state === "closing");
  const windLevel = Math.round(4 + state.storm * 8);

  elements.timeValue.textContent = formatClock(remaining);
  elements.timeBar.style.transform = `scaleX(${progress})`;
  elements.timeBar.style.background = remaining < 30 ? "var(--red)" : "var(--teal)";
  elements.waterValue.textContent = `${state.water.toFixed(2)} m`;
  elements.gateValue.textContent = `${closedCount} / 4`;
  elements.powerValue.textContent = `${state.power.toFixed(0)}%`;
  elements.powerBar.style.transform = `scaleX(${state.power / 100})`;
  elements.powerBar.style.background = state.power < 20 ? "var(--red)" : "var(--teal)";
  elements.stormLabel.textContent = `风力 ${windLevel}`;
  elements.stormLevel.textContent = String(windLevel);
  elements.tideValue.textContent = `${state.tide.toFixed(2)} m`;
  elements.windValue.textContent = `${windLevel} 级`;
  const margin = CONFIG.warningLevel - state.water;
  elements.marginValue.textContent = `${margin >= 0 ? "+" : "−"}${Math.abs(margin).toFixed(2)} m`;
  elements.marginValue.style.color = margin >= 0 ? "" : "var(--orange)";
  elements.safeValue.textContent = `${state.safeCount} / ${state.vehicles.length}`;

  if (state.water >= CONFIG.dangerLevel) {
    elements.waterState.textContent = "倒灌";
    elements.waterState.className = "state-tag danger";
  } else if (state.water >= CONFIG.warningLevel) {
    elements.waterState.textContent = "警戒";
    elements.waterState.className = "state-tag watch";
  } else {
    elements.waterState.textContent = "安全";
    elements.waterState.className = "state-tag safe";
  }

  state.gates.forEach((gate, index) => {
    const button = gateControlAt(index);
    if (!button) {
      return;
    }
    const trapped = state.status === "lost"
      && state.fail?.code === "vehicle-trapped"
      && state.fail?.gateId === gate.id;
    const progressLabel = button.querySelector(".gate-progress");
    const classes = ["gate-control"];
    if (gate.state === "closed") {
      classes.push("closed");
      progressLabel.textContent = "已闭合";
    } else if (gate.state === "closing") {
      classes.push("closing");
      progressLabel.textContent = `${Math.round(gate.progress * 100)}%`;
    } else if (trapped) {
      classes.push("trapped");
      progressLabel.textContent = "阻断";
    } else if (index === nextIndex) {
      progressLabel.textContent = "可落闸";
    } else {
      classes.push("locked");
      progressLabel.textContent = "锁定";
    }
    if (trapped) {
      classes.push("trapped");
      progressLabel.textContent = "阻断";
    }
    button.className = classes.join(" ");
    button.disabled = state.status !== "running"
      || gate.state !== "open"
      || closing
      || index !== nextIndex;
    button.title = trapped
      ? "车辆被困，撤离通道阻断"
      : gate.state === "open" && index === nextIndex
        ? `关闭 ${gate.name}`
        : "等待前序闸门闭合";
  });

  const pumpActive = state.pumpOn && state.power > 0;
  elements.pumpPercent.textContent = pumpActive ? "9.0" : "0.0";
  elements.pumpRing.classList.toggle("active", pumpActive);
  elements.batteryFill.style.transform = `scaleX(${state.power / 100})`;
  elements.batteryFill.style.background = state.power < 20
    ? "linear-gradient(90deg, var(--orange), var(--red))"
    : "linear-gradient(90deg, var(--teal), var(--lime))";
  elements.pumpButton.classList.toggle("active", pumpActive);
  elements.pumpButton.classList.toggle("exhausted", state.power <= 0);
  elements.pumpButton.disabled = state.status !== "running" || state.power <= 0;
  elements.pumpButtonText.textContent = pumpActive
    ? "停止水泵"
    : state.power > 0
      ? "启动水泵"
      : "电池耗尽";
  const pumpTag = pumpActive ? "排水" : state.power > 0 ? "待机" : "耗尽";
  elements.pumpState.textContent = pumpTag;
  elements.pumpState.className = `state-tag ${pumpActive ? "safe" : state.power <= 0 ? "danger" : "off"}`;
  if (state.status === "ready") {
    elements.pumpState.textContent = "待机";
    elements.pumpState.className = "state-tag off";
  }

  if (state.power < 20 && state.status === "running" && !pumpActive) {
    elements.audioStatus.textContent = "电量低 · 泵站仅可短时启动";
  } else if (state.status === "lost") {
    elements.audioStatus.textContent = "失败 · 风暴声场已锁定";
  } else if (state.status === "won") {
    elements.audioStatus.textContent = "港区守住 · 风暴正在减弱";
  }
  audio.update({
    storm: state.storm,
    pumpFlow: state.pumpFlow,
    pumpOn: pumpActive,
    status: state.status,
  });
}

function showResult() {
  if (resultShownFor === state.status) {
    return;
  }
  resultShownFor = state.status;
  const won = state.status === "won";
  const code = state.fail?.code;
  elements.resultOverlay.classList.remove("hidden", "won", "lost");
  elements.resultOverlay.classList.add(won ? "won" : "lost");
  elements.resultEyebrow.textContent = won
    ? "SIMULATION COMPLETE / HARBOR SECURED"
    : code === "vehicle-trapped"
      ? "ROUTE BLOCKED / VEHICLE TRAPPED"
      : "SIMULATION FAILED / FLOOD CONTROL";
  elements.resultTitle.textContent = won
    ? "港区守住"
    : code === "vehicle-trapped"
      ? "撤离通道阻断"
      : code === "flooded"
        ? "海水倒灌"
        : "潮峰失守";
  elements.resultReason.textContent = won
    ? "四道防洪闸全部闭合，港区水位回落到警戒线以下，所有车辆抵达高地。"
    : state.fail?.message ?? "本局未能满足全部防洪条件。";
  elements.resultTime.textContent = formatClock(state.time);
  elements.resultWater.textContent = `${state.water.toFixed(2)} m`;
  elements.resultSafe.textContent = `${state.safeCount} / ${state.vehicles.length}`;
  elements.audioStatus.textContent = won ? "港区守住 · 风暴正在减弱" : "失败 · 风暴声场已锁定";
  updateInterface(true);
}

function frame(now) {
  const delta = Math.min(0.2, (now - lastFrame) / 1000);
  lastFrame = now;
  if (state.status === "running") {
    tick(state, delta);
    processEvents();
  }
  updateInterface();
  renderer.render(state, now / 1000);
  if (state.status === "won" || state.status === "lost") {
    showResult();
  }
  requestAnimationFrame(frame);
}

function advanceDebug(seconds, { render = true, update = true } = {}) {
  if (state.status === "running") {
    tick(state, seconds);
    processEvents();
  }
  if (update) {
    updateInterface(true);
  }
  if (render) {
    renderer.render(state, performance.now() / 1000);
  }
  if (state.status === "won" || state.status === "lost") {
    showResult();
  }
}

elements.startButton.addEventListener("click", beginGame);
elements.restartButton.addEventListener("click", resetGame);
elements.resetButton.addEventListener("click", resetGame);
elements.pumpButton.addEventListener("click", togglePumpAction);

canvas.addEventListener("pointerdown", (event) => {
  const gateIndex = renderer.gateAtPoint(event.clientX, event.clientY);
  if (gateIndex >= 0) {
    closeGate(gateIndex);
  }
});

window.addEventListener("keydown", (event) => {
  if (event.code === "KeyR") {
    event.preventDefault();
    resetGame();
    return;
  }
  if (event.code === "Enter" && state.status === "ready") {
    event.preventDefault();
    beginGame();
    return;
  }
  if (state.status !== "running") {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    togglePumpAction();
    return;
  }
  if (/^Digit[1-4]$/.test(event.code)) {
    closeGate(Number(event.code.slice(-1)) - 1);
  }
});

window.__harborDebug = {
  getState: () => state,
  closeGate,
  togglePump: togglePumpAction,
  setPump: (enabled) => {
    const result = setPump(state, enabled);
    processEvents();
    updateInterface(true);
    return result;
  },
  open: () => allGatesClosed(state),
  advance: advanceDebug,
  reset: resetGame,
  render: () => renderer.render(state, performance.now() / 1000),
};

buildGateControls();
updateInterface(true);
renderer.render(state, performance.now() / 1000);
requestAnimationFrame((now) => {
  lastFrame = now;
  requestAnimationFrame(frame);
});
