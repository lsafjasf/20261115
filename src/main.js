import { WatchAudio } from "./audio.js";
import {
  GEAR_PARTS,
  MAX_ATTEMPTS,
  SLOT_ORDER,
  SLOTS,
  STABLE_SECONDS,
  TARGETS,
  radiusForTeeth
} from "./config.js";
import { WatchRenderer } from "./render.js";

const TAU = Math.PI * 2;
const canvas = document.querySelector("#watchCanvas");
const renderer = new WatchRenderer(canvas);
const audio = new WatchAudio();

const ui = {
  tray: document.querySelector("#gearTray"),
  trayTitle: document.querySelector("#trayTitle"),
  selectionHint: document.querySelector("#selectionHint"),
  statusKicker: document.querySelector("#statusKicker"),
  statusMessage: document.querySelector("#statusMessage"),
  statusLed: document.querySelector("#statusLed"),
  runTime: document.querySelector("#runTime"),
  runProgress: document.querySelector("#runProgress"),
  attempts: document.querySelector("#attemptPips"),
  powerFill: document.querySelector("#powerFill"),
  powerTitle: document.querySelector("#powerTitle"),
  powerHint: document.querySelector("#powerHint"),
  windingReadout: document.querySelector("#windingReadout"),
  beatReadout: document.querySelector("#beatReadout"),
  crown: document.querySelector("#crownButton"),
  reset: document.querySelector("#resetButton"),
  sound: document.querySelector("#soundButton"),
  soundLabel: document.querySelector("#soundLabel"),
  guide: document.querySelector("#guideButton"),
  guideDrawer: document.querySelector("#guideDrawer"),
  guideBackdrop: document.querySelector("#guideBackdrop"),
  guideClose: document.querySelector("#guideClose"),
  resultModal: document.querySelector("#resultModal"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCopy: document.querySelector("#resultCopy"),
  resultSeal: document.querySelector("#resultSeal"),
  resultEyebrow: document.querySelector("#resultEyebrow"),
  resultAction: document.querySelector("#resultAction"),
  resultCard: document.querySelector(".result-card"),
  slotButtons: [...document.querySelectorAll(".slot-hotspot")]
};

function createState() {
  return {
    mode: "idle",
    installed: { center: null, third: null, fourth: null },
    selectedPartId: null,
    usedPartIds: new Set(),
    attemptsLeft: MAX_ATTEMPTS,
    crownSteps: 0,
    runTime: 0,
    speedFactor: 1,
    failure: null,
    failureSlot: null,
    failureReason: "",
    tickCount: 0,
    nextTickAt: 0,
    driveAngle: 0,
    barrelAngle: 0,
    escapeAngle: 0,
    balancePhase: 0,
    palletAngle: 0,
    secondsAngle: 0,
    minuteAngle: 60,
    hourAngle: 305,
    hoveredSlot: null,
    now: performance.now(),
    pulse: null,
    audioLive: false,
    resultTimer: 0
  };
}

let state = createState();
let lastFrame = performance.now();
let statusSignature = "";

function selectedPart() {
  return GEAR_PARTS.find((part) => part.id === state.selectedPartId) || null;
}

function allInstalled() {
  return SLOT_ORDER.every((slotId) => state.installed[slotId]);
}

function installedCount() {
  return SLOT_ORDER.filter((slotId) => state.installed[slotId]).length;
}

function slotAtCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 1200;
  const y = ((event.clientY - rect.top) / rect.height) * 720;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const slotId of SLOT_ORDER) {
    const slot = SLOTS[slotId];
    const distance = Math.hypot(x - slot.x, y - slot.y);
    if (distance < radiusForTeeth(slot.target) + 18 && distance < nearestDistance) {
      nearest = slotId;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function buildTray() {
  ui.tray.innerHTML = "";
  for (const part of GEAR_PARTS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tray-gear";
    button.dataset.partId = part.id;
    button.dataset.toothCount = String(part.teeth);
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `${part.teeth}齿${part.kind}，点击选择`);
    button.innerHTML = `
      <span class="gear-glyph" aria-hidden="true"></span>
      <span class="gear-teeth">${part.teeth}<span>T</span></span>
      <span class="gear-kind">${part.kind}</span>
    `;
    button.addEventListener("click", () => selectPart(part.id));
    ui.tray.append(button);
  }
}

async function selectPart(partId) {
  const part = GEAR_PARTS.find((item) => item.id === partId);
  if (!part || state.usedPartIds.has(partId)) return;
  if (state.mode === "running") return;

  await audio.ensure();
  if (state.mode === "failed") clearFailure();
  if (state.mode === "success") return;

  if (state.selectedPartId === partId) {
    state.selectedPartId = null;
    updateUI();
    return;
  }

  state.selectedPartId = partId;
  audio.select();
  updateUI();
}

function installPart(slotId) {
  const slot = SLOTS[slotId];
  if (!slot || state.mode === "running" || state.mode === "success") return;
  if (state.mode === "failed") clearFailure();

  const part = selectedPart();
  if (part) {
    const previous = state.installed[slotId];
    if (previous) state.usedPartIds.delete(previous.id);
    state.installed[slotId] = part;
    state.usedPartIds.add(part.id);
    state.selectedPartId = null;
    state.pulse = { slot: slotId, started: performance.now() };
    audio.install();
    updateUI();
    return;
  }

  if (state.installed[slotId]) {
    const removed = state.installed[slotId];
    state.usedPartIds.delete(removed.id);
    state.installed[slotId] = null;
    state.crownSteps = 0;
    audio.remove();
    updateUI();
    return;
  }

  state.feedback = "先从右侧零件盘选择一枚齿轮，再点击轴位安装。";
  state.feedbackUntil = performance.now() + 2800;
  updateUI();
}

function clearFailure() {
  if (state.mode !== "failed") return;
  state.mode = "idle";
  state.failure = null;
  state.failureSlot = null;
  state.failureReason = "";
  state.speedFactor = 1;
  state.runTime = 0;
  state.crownSteps = 0;
  state.nextTickAt = 0;
}

function evaluateTrain() {
  for (const slotId of SLOT_ORDER) {
    const gear = state.installed[slotId];
    if (gear && gear.teeth > SLOTS[slotId].target) {
      return { type: "jam", slotId, excess: gear.teeth - SLOTS[slotId].target };
    }
  }

  const deficit = SLOT_ORDER.reduce((total, slotId) => {
    const gear = state.installed[slotId];
    if (!gear) return total;
    return total + Math.max(0, (SLOTS[slotId].target - gear.teeth) / SLOTS[slotId].target);
  }, 0);

  if (deficit > 0.0001) {
    return { type: "fast", speedFactor: 1 + deficit * 4 };
  }
  return { type: "stable", speedFactor: 1 };
}

function startTest() {
  if (state.mode === "running" || state.mode === "success") return;
  if (!allInstalled()) {
    state.feedback = `还缺 ${3 - installedCount()} 枚齿轮，先把轮系补齐。`;
    state.feedbackUntil = performance.now() + 2800;
    updateUI();
    return;
  }
  if (state.attemptsLeft <= 0) {
    showResultModal(false);
    return;
  }

  const evaluation = evaluateTrain();
  state.attemptsLeft -= 1;
  state.mode = "running";
  state.runTime = 0;
  state.tickCount = 0;
  state.nextTickAt = 1;
  state.failure = null;
  state.failureSlot = null;
  state.failureReason = "";
  state.feedback = "";
  state.failure = evaluation.type === "stable" ? null : evaluation.type;
  state.speedFactor = evaluation.type === "jam" ? 0 : evaluation.speedFactor;
  if (evaluation.type === "jam") {
    state.failureSlot = SLOTS[evaluation.slotId];
    state.jamOriginalAlive = true;
  }
  updateUI();
}

function finishFailure() {
  const wasJam = state.failure === "jam";
  state.mode = "failed";
  state.crownSteps = 0;
  state.balancePhase = 0;
  state.palletAngle = 0;
  if (wasJam) {
    state.speedFactor = 0;
    state.failureReason = "齿数偏大，齿顶顶死相邻轴位，轮系无法释放。";
    audio.jam();
  } else {
    state.failureReason = `传动比偏高，擒纵频率达到 ${Math.round(28800 * state.speedFactor).toLocaleString()} bph，走时过快。`;
    audio.fail();
  }
  updateUI();
  if (state.attemptsLeft === 0) {
    state.resultTimer = performance.now() + 850;
  }
}

function finishSuccess() {
  state.mode = "success";
  state.runTime = STABLE_SECONDS;
  state.secondsAngle = 180;
  state.speedFactor = 1;
  state.failure = null;
  state.balancePhase = 0;
  audio.stopFriction();
  audio.success();
  updateUI();
  showResultModal(true);
}

function updateRunning(dt) {
  if (state.failure === "jam") {
    state.runTime += dt;
    state.balancePhase += dt * 7;
    state.palletAngle = Math.sin(state.balancePhase) * 0.08 * Math.max(0, 1 - state.runTime / 1.2);
    if (state.runTime > 0.3 && !state.audioLive) {
      audio.startFriction();
      state.audioLive = true;
    }
    if (state.runTime >= 1.45) {
      state.audioLive = false;
      finishFailure();
    }
    return;
  }

  state.runTime += dt;
  if (state.failure === "fast") {
    if (!state.audioLive && state.runTime > 0.45) {
      audio.startFriction();
      state.audioLive = true;
    }
    if (state.runTime >= 5) {
      state.audioLive = false;
      finishFailure();
      return;
    }
  } else if (state.runTime >= STABLE_SECONDS) {
    finishSuccess();
    return;
  }

  state.driveAngle += dt * 0.88 * state.speedFactor;
  state.barrelAngle = -state.driveAngle * (48 / 64);
  state.escapeAngle = state.driveAngle * 2.15;
  state.balancePhase += dt * TAU * 4 * Math.min(state.speedFactor, 1.2);
  state.palletAngle = Math.sin(state.balancePhase) * 0.12;
  state.secondsAngle = state.runTime * 6 * state.speedFactor;
  state.minuteAngle = 60 + state.runTime * 0.1;
  state.hourAngle = 305 + state.runTime * (0.1 / 12);

  const tickInterval = 1 / state.speedFactor;
  while (state.runTime >= state.nextTickAt) {
    audio.tick(state.tickCount % 2 === 1);
    state.tickCount += 1;
    state.nextTickAt += tickInterval;
  }
}

function tick(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  state.now = now;

  if (state.mode === "running") updateRunning(dt);

  if (state.pulse && now - state.pulse.started > 720) state.pulse = null;
  if (state.resultTimer && now >= state.resultTimer) {
    state.resultTimer = 0;
    showResultModal(false);
  }

  updateLiveHUD();
  renderer.draw(rendererState());
  requestAnimationFrame(tick);
}

function rendererState() {
  return {
    ...state,
    gearAngles: {
      center: state.driveAngle,
      third: -state.driveAngle * (48 / 36),
      fourth: state.driveAngle * (48 / 24)
    },
    pulse: state.pulse
      ? {
          slot: state.pulse.slot,
          value: Math.max(0, 1 - (state.now - state.pulse.started) / 720)
        }
      : null
  };
}

function statusForState() {
  const selected = selectedPart();
  if (state.mode === "running") {
    if (state.failure === "jam") {
      return {
        kicker: "FRICTION / 轴距过紧",
        message: "齿数偏大，轮齿顶死。摆轮正在失去振幅……",
        led: "is-error"
      };
    }
    if (state.failure === "fast") {
      return {
        kicker: "RUNNING / 传动比异常",
        message: `齿数偏小，秒针速度达到 ${state.speedFactor.toFixed(2)} 倍，走时过快。`,
        led: "is-error"
      };
    }
    return {
      kicker: "RUNNING / 稳定走时",
      message: "擒纵叉交替释放，摆轮振幅正常。让秒针连续走过三十秒。",
      led: "is-running"
    };
  }

  if (state.mode === "success") {
    return {
      kicker: "ACCEPTED / 交付通过",
      message: "秒针稳定通过三十秒，动力释放均匀。机芯验收完成。",
      led: "is-success"
    };
  }

  if (state.mode === "failed") {
    return {
      kicker: state.failure === "jam" ? "FAIL / 轴距卡死" : "FAIL / 走时过快",
      message: state.failureReason,
      led: "is-error"
    };
  }

  if (state.feedback && state.now < state.feedbackUntil) {
    return { kicker: "NOTE / 装配提示", message: state.feedback, led: "" };
  }
  if (selected) {
    return {
      kicker: "SELECTED / 已取件",
      message: `已取起 ${selected.teeth}T ${selected.kind}。点击机芯轴位完成安装。`,
      led: ""
    };
  }
  if (allInstalled()) {
    return {
      kicker: state.crownSteps >= 5 ? "POWER READY / 满弦" : "ASSEMBLED / 待上弦",
      message: state.crownSteps >= 5
        ? "动力已满。再次按下表冠，释放擒纵并开始三十秒验收。"
        : "轮系已补齐。点击表冠五次，蓄满发条后开始验收。",
      led: ""
    };
  }
  if (installedCount() > 0) {
    return {
      kicker: "ASSEMBLY / 装配中",
      message: `已安装 ${installedCount()} / 3 枚齿轮。继续根据轮系卡选择正确齿数。`,
      led: ""
    };
  }
  return {
    kicker: "READY / 待装",
    message: "轮系空缺。从零件盘选择齿轮，装入三个轴位。",
    led: ""
  };
}

function updateStatus() {
  const status = statusForState();
  const signature = `${status.kicker}|${status.message}|${status.led}`;
  if (signature === statusSignature) return;
  statusSignature = signature;
  ui.statusKicker.textContent = status.kicker;
  ui.statusMessage.textContent = status.message;
  ui.statusLed.className = `status-led ${status.led}`.trim();
}

function updateHUD() {
  const usedCount = state.usedPartIds.size;
  ui.trayTitle.textContent = `${usedCount} / ${GEAR_PARTS.length} 已取用`;
  ui.selectionHint.textContent = selectedPart() ? `已选 ${selectedPart().teeth}T` : "点选齿轮";
  ui.selectionHint.classList.toggle("is-active", Boolean(selectedPart()));

  for (const button of ui.tray.querySelectorAll(".tray-gear")) {
    const id = button.dataset.partId;
    button.classList.toggle("is-used", state.usedPartIds.has(id));
    button.classList.toggle("is-selected", state.selectedPartId === id);
    button.setAttribute("aria-pressed", String(state.selectedPartId === id));
  }

  ui.attempts.innerHTML = Array.from({ length: MAX_ATTEMPTS }, (_, index) => (
    `<i class="${index >= state.attemptsLeft ? "spent" : ""}"></i>`
  )).join("");
  ui.attempts.setAttribute("aria-label", `剩余 ${state.attemptsLeft} 次调试机会`);

  const powerRatio = state.crownSteps / 5;
  ui.powerFill.style.width = `${powerRatio * 100}%`;
  ui.windingReadout.textContent = `${state.crownSteps} / 5 格`;
  ui.crown.classList.toggle("is-full", state.crownSteps >= 5);
  if (state.mode === "running") {
    ui.powerTitle.textContent = "动力释放";
    ui.powerHint.textContent = "发条正在驱动轮系";
  } else if (state.crownSteps >= 5) {
    ui.powerTitle.textContent = "满弦待放";
    ui.powerHint.textContent = allInstalled() ? "按下表冠释放擒纵" : "等待轮系完成";
  } else if (state.crownSteps > 0) {
    ui.powerTitle.textContent = "动力蓄积";
    ui.powerHint.textContent = `再上 ${5 - state.crownSteps} 格，蓄满发条`;
  } else {
    ui.powerTitle.textContent = "发条松弛";
    ui.powerHint.textContent = "点击表冠五次，蓄满动力";
  }

  for (const button of ui.slotButtons) {
    const slotId = button.dataset.slot;
    const gear = state.installed[slotId];
    const slot = SLOTS[slotId];
    button.setAttribute(
      "aria-label",
      gear
        ? `${slot.label}轴位，已安装${gear.teeth}齿，原厂要求${slot.target}齿`
        : `${slot.label}轴位，需要${slot.target}齿`
    );
  }
  updateStatus();
  updateLiveHUD();
}

function updateLiveHUD() {
  const time = Math.min(state.runTime, STABLE_SECONDS);
  ui.runTime.textContent = `${time.toFixed(1).padStart(4, "0")} / 30.0s`;
  ui.runProgress.style.width = `${Math.min(100, (time / STABLE_SECONDS) * 100)}%`;
  const badRun = state.mode === "running" && state.failure !== null;
  const failed = state.mode === "failed";
  ui.runProgress.classList.toggle("is-error", badRun || failed);

  if (state.mode === "running" && state.failure !== "jam") {
    ui.beatReadout.textContent = `${Math.round(28800 * state.speedFactor).toLocaleString()} bph`;
  } else if (state.mode === "running" || state.mode === "success") {
    ui.beatReadout.textContent = state.mode === "success" ? "28,800 bph" : "0 bph";
  } else if (state.mode === "failed" && state.failure === "fast") {
    ui.beatReadout.textContent = "超频";
  } else {
    ui.beatReadout.textContent = "0 bph";
  }
}

function updateUI() {
  updateHUD();
}

function showResultModal(success) {
  ui.resultCard.classList.toggle("is-failure", !success);
  ui.resultEyebrow.textContent = success ? "BENCH ACCEPTANCE / PASS" : "BENCH FAILURE / STOP";
  ui.resultSeal.textContent = success ? "30" : "×";
  ui.resultTitle.textContent = success ? "走时稳定" : "调试机会用尽";
  ui.resultCopy.textContent = success
    ? "秒针连续通过 30 秒。轮系装配完成，机芯可以交付。"
    : "轮系仍未达到验收标准。请检查齿数与轴距，重新开始调试。";
  ui.resultAction.textContent = success ? "查看机芯" : "重新开始";
  ui.resultModal.dataset.action = success ? "close" : "reset";
  ui.resultModal.classList.add("is-open");
  ui.resultModal.setAttribute("aria-hidden", "false");
}

function closeResultModal() {
  ui.resultModal.classList.remove("is-open");
  ui.resultModal.setAttribute("aria-hidden", "true");
}

async function windCrown() {
  await audio.ensure();
  if (state.mode === "running" || state.mode === "success") return;
  if (state.mode === "failed") clearFailure();

  if (state.crownSteps >= 5) {
    if (allInstalled()) startTest();
    else {
      state.feedback = "发条已满，但轮系尚未补齐。先安装剩余齿轮。";
      state.feedbackUntil = performance.now() + 2600;
      updateUI();
    }
    return;
  }

  state.crownSteps += 1;
  audio.wind(state.crownSteps / 5);
  ui.crown.classList.remove("is-winding");
  void ui.crown.offsetWidth;
  ui.crown.classList.add("is-winding");
  window.setTimeout(() => ui.crown.classList.remove("is-winding"), 340);

  if (state.crownSteps >= 5 && allInstalled()) {
    startTest();
    return;
  }

  updateUI();
}

function resetGame() {
  state = createState();
  lastFrame = performance.now();
  statusSignature = "";
  audio.stopFriction();
  closeResultModal();
  ui.guideDrawer.classList.remove("is-open");
  ui.guideDrawer.setAttribute("aria-hidden", "true");
  updateUI();
}

function openGuide() {
  ui.guideDrawer.classList.add("is-open");
  ui.guideDrawer.setAttribute("aria-hidden", "false");
}

function closeGuide() {
  ui.guideDrawer.classList.remove("is-open");
  ui.guideDrawer.setAttribute("aria-hidden", "true");
}

async function toggleSound() {
  await audio.ensure();
  const enabled = !audio.enabled;
  audio.setEnabled(enabled);
  ui.sound.setAttribute("aria-pressed", String(enabled));
  ui.soundLabel.textContent = enabled ? "声音开启" : "声音关闭";
  if (enabled) audio.select();
}

for (const button of ui.slotButtons) {
  const slotId = button.dataset.slot;
  button.addEventListener("click", () => installPart(slotId));
  button.addEventListener("mouseenter", () => {
    state.hoveredSlot = slotId;
  });
  button.addEventListener("mouseleave", () => {
    state.hoveredSlot = null;
  });
  button.addEventListener("focus", () => {
    state.hoveredSlot = slotId;
  });
  button.addEventListener("blur", () => {
    state.hoveredSlot = null;
  });
}

canvas.addEventListener("pointermove", (event) => {
  state.hoveredSlot = slotAtCanvasPoint(event);
});
canvas.addEventListener("pointerleave", () => {
  state.hoveredSlot = null;
});
canvas.addEventListener("click", (event) => {
  const slotId = slotAtCanvasPoint(event);
  if (slotId) installPart(slotId);
});

ui.crown.addEventListener("click", windCrown);
ui.reset.addEventListener("click", resetGame);
ui.sound.addEventListener("click", toggleSound);
ui.guide.addEventListener("click", openGuide);
ui.guideBackdrop.addEventListener("click", closeGuide);
ui.guideClose.addEventListener("click", closeGuide);
ui.resultAction.addEventListener("click", () => {
  if (ui.resultModal.dataset.action === "reset") resetGame();
  else closeResultModal();
});
window.addEventListener("resize", () => renderer.resize());

window.__watchGame = {
  getSnapshot() {
    return {
      mode: state.mode,
      installed: Object.fromEntries(
        SLOT_ORDER.map((slotId) => [slotId, state.installed[slotId]?.teeth ?? null])
      ),
      attemptsLeft: state.attemptsLeft,
      crownSteps: state.crownSteps,
      runTime: state.runTime,
      speedFactor: state.speedFactor,
      secondsAngle: state.secondsAngle,
      failure: state.failure,
      selectedTeeth: selectedPart()?.teeth ?? null,
      targets: { ...TARGETS },
      audio: {
        contextState: audio.context?.state ?? "uninitialized",
        enabled: audio.enabled,
        frictionActive: Boolean(audio.friction)
      }
    };
  }
};

buildTray();
updateUI();
requestAnimationFrame(tick);
