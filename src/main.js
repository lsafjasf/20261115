import "@fontsource/noto-sans-sc/chinese-simplified-400.css";
import "@fontsource/noto-sans-sc/chinese-simplified-600.css";
import { GlassAudio } from "./audio.js";
import { GlassRenderer } from "./renderer.js";
import { GlassSimulation, TUNING } from "./simulation.js";

const canvas = document.querySelector("#stage");
const overlay = document.querySelector("#overlay");
const overlayKicker = document.querySelector("#overlayKicker");
const overlayTitle = document.querySelector("#overlayTitle");
const overlayBody = document.querySelector("#overlayBody");
const overlayAction = document.querySelector("#overlayAction");
const briefingGrid = document.querySelector(".briefing-grid");

const sim = new GlassSimulation();
const renderer = new GlassRenderer(canvas);
const audio = new GlassAudio();
const controls = {
  blow: false,
  spin: false,
  brake: false,
  heaterLeft: false,
  heaterRight: false,
};

const ui = {
  timer: document.querySelector("#timer"),
  tempValue: document.querySelector("#tempValue"),
  heatFill: document.querySelector("#heatFill"),
  plasticityLabel: document.querySelector("#plasticityLabel"),
  wallValue: document.querySelector("#wallValue"),
  wallFill: document.querySelector("#wallFill"),
  wallDelta: document.querySelector("#wallDelta"),
  contourValue: document.querySelector("#contourValue"),
  contourFill: document.querySelector("#contourFill"),
  contourDelta: document.querySelector("#contourDelta"),
  rpmValue: document.querySelector("#rpmValue"),
  rpmFill: document.querySelector("#rpmFill"),
  bubbleValue: document.querySelector("#bubbleValue"),
  bubbleDots: document.querySelector("#bubbleDots"),
  pressureFill: document.querySelector("#pressureFill"),
  spinLight: document.querySelector("#spinLight"),
  heaterSlider: document.querySelector("#heaterSlider"),
  heaterOffset: document.querySelector("#heaterOffset"),
  statusBanner: document.querySelector("#statusBanner"),
  tipText: document.querySelector("#tipText"),
  processNote: document.querySelector("#processNote"),
  blowButton: document.querySelector("#blowButton"),
  spinButton: document.querySelector("#spinButton"),
  finishButton: document.querySelector("#finishButton"),
  resetButton: document.querySelector("#resetButton"),
  soundToggle: document.querySelector("#soundToggle"),
  soundLabel: document.querySelector("#soundLabel"),
};

let overlayMode = "briefing";
let lastTime = performance.now();
let uiClock = 0;
let failureAnnounced = false;
let successAnnounced = false;
let finishHint = "";
let finishHintUntil = 0;

for (let i = 0; i < 6; i += 1) {
  const dot = document.createElement("i");
  ui.bubbleDots.append(dot);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function setOverlay(mode) {
  overlayMode = mode;
  if (mode === "success") {
    const stats = sim.finalStats || sim.getStats();
    overlayKicker.textContent = "PIECE 07 / FORM LOCKED";
    overlayTitle.textContent = "瓶体完成。火与旋转达成了共识。";
    overlayBody.textContent = `玻璃在 ${formatTime(stats.elapsed)} 内抵达目标轮廓，壁厚差 ${stats.wallDelta.toFixed(2)} mm，已进入退火。`;
    briefingGrid.innerHTML = `
      <div><b>01</b><span>${Math.round(stats.contour * 100)}%</span><small>轮廓吻合</small></div>
      <div><b>02</b><span>Δ ${stats.wallDelta.toFixed(2)} mm</span><small>壁厚差值</small></div>
      <div><b>03</b><span>${Math.round(stats.temperature)}°C</span><small>退火温度</small></div>
    `;
    overlayAction.innerHTML = "<span>再做一只</span><em>→</em>";
  } else if (mode === "failed") {
    const stats = sim.finalStats || sim.getStats();
    overlayKicker.textContent = "KILN ALERT / NO PLASTICITY";
    overlayTitle.textContent = "玻璃已经冷却过度。";
    overlayBody.textContent =
      "温度跌破 500°C 并持续过久，玻璃失去可塑性，轮廓无法继续修正。下一轮记得在表面失去光泽前，把炉口移至瓶底。";
    briefingGrid.innerHTML = `
      <div><b>01</b><span>${Math.round(stats.temperature)}°C</span><small>最终温度</small></div>
      <div><b>02</b><span>${formatTime(stats.elapsed)}</span><small>坚持时间</small></div>
      <div><b>03</b><span>${Math.round(stats.contour * 100)}%</span><small>轮廓进度</small></div>
    `;
    overlayAction.innerHTML = "<span>重新点火</span><em>↺</em>";
  } else {
    overlayKicker.textContent = "SHIFT BRIEF / 07";
    overlayTitle.textContent = "让一团火，成为一只瓶。";
    overlayBody.textContent =
      "交替吹气、稳住旋转，并把炉口对准瓶底回温。吹得太猛会留下气泡，转速失稳会让瓶身倾斜；离开炉火太久，玻璃将失去可塑性。";
    briefingGrid.innerHTML = `
      <div><b>01</b><span>轻吹成形</span><small>气泡风险随气压升高</small></div>
      <div><b>02</b><span>匀速旋转</span><small>目标 30–46 rpm</small></div>
      <div><b>03</b><span>及时回炉</span><small>保持 560°C 以上</small></div>
    `;
    overlayAction.innerHTML = "<span>点火开炉</span><em>→</em>";
  }
  overlay.classList.remove("hidden");
}

function hideOverlay() {
  overlay.classList.add("hidden");
}

function beginRound() {
  sim.reset();
  sim.start();
  controls.blow = false;
  controls.spin = false;
  controls.brake = false;
  controls.heaterLeft = false;
  controls.heaterRight = false;
  failureAnnounced = false;
  successAnnounced = false;
  lastTime = performance.now();
  hideOverlay();
  audio.start();
  updateUi(true);
}

function announceFailure() {
  if (failureAnnounced) return;
  failureAnnounced = true;
  audio.playFailure();
  setOverlay("failed");
}

function announceSuccess() {
  if (successAnnounced) return;
  successAnnounced = true;
  audio.playSuccess();
  setOverlay("success");
}

function heaterDirectionLabel() {
  const difference = sim.heaterPosition - TUNING.heaterCenter;
  if (Math.abs(difference) < 0.07) return "对准";
  return difference < 0 ? "偏左" : "偏右";
}

function getGuidance() {
  const checks = sim.getChecks();
  const ready = Object.values(checks).every(Boolean);
  if (sim.phase === "success") {
    return {
      banner: "瓶体完成 · 已进入退火",
      tone: "warn",
      note: "轮廓与壁厚均达标。",
      tip: "FORM LOCKED / PIECE 07",
    };
  }
  if (sim.phase === "failed") {
    return {
      banner: "冷却过度 · 玻璃失去可塑性",
      tone: "danger",
      note: "温度低于 500°C 过久。将炉口对准瓶底，比继续吹气更重要。",
      tip: "SHIFT ENDED / KILN ALERT",
    };
  }
  if (sim.temperature < 540) {
    return {
      banner: "温度过低 · 立即回炉",
      tone: "danger",
      note: "玻璃正在失去可塑性。按住 Q / E，把炉口移到瓶底中心。",
      tip: "THERMAL ALERT · MOVE GLORY HOLE",
    };
  }
  if (sim.pressure > 0.82) {
    return {
      banner: "气压过高 · 松开吹气",
      tone: "danger",
      note: "气压已越过安全区。继续强吹会在玻璃内部封入气泡。",
      tip: "AIRFLOW HIGH · RELEASE",
    };
  }
  if (sim.rpm < 22) {
    return {
      banner: "转速不足 · 瓶身开始下垂",
      tone: "warn",
      note: "按住 D 补转，让玻璃在 30–46 rpm 的稳定区间内均匀延展。",
      tip: "ROTATION LOW · SPIN UP",
    };
  }
  if (sim.rpm > 50) {
    return {
      banner: "转速过高 · 壁厚开始漂移",
      tone: "warn",
      note: "停止加速，让转速自然回落到绿色区间。",
      tip: "ROTATION HIGH · COAST",
    };
  }
  if (ready) {
    return {
      banner: "轮廓与壁厚达标 · 可以退火定型",
      tone: "warn",
      note: "目标轮廓已经闭合，壁厚差在容差内。点击“完成瓶体”。",
      tip: "FORM READY · CLICK TO ANNEAL",
    };
  }
  if (sim.isHeating) {
    return {
      banner: "回炉中 · 玻璃正在恢复可塑性",
      tone: "",
      note: "炉口已对准。趁温度回升时补吹，再移开炉口继续塑形。",
      tip: "REHEAT CYCLE · TEMPERATURE RISING",
    };
  }
  if (sim.contourScore > 0.72) {
    return {
      banner: "接近轮廓 · 小口补气",
      tone: "",
      note: "每次吹气 0.6–1 秒，气压回落后再吹下一口，避免过压起泡。",
      tip: "FINAL PASS · SHORT BREATHS",
    };
  }
  return {
    banner: "夹持稳定 · 开始吹制",
    tone: "",
    note: "先吹一小口气，再按住 D 维持转速。玻璃离开炉口后会持续降温。",
    tip: "BLOW / ROTATE / REHEAT",
  };
}

function updateUi(force = false) {
  const stats = sim.getStats();
  const guide = getGuidance();
  const checks = sim.getChecks();
  const allReady = Object.values(checks).every(Boolean);
  const heatPercent = Math.max(0, Math.min(100, (stats.temperature / 1070) * 100));
  const rotationPercent = Math.max(0, Math.min(100, (stats.rpm / 86) * 100));
  const wallUniformity = Math.max(0, Math.min(100, (1 - stats.wallDelta / 0.84) * 100));
  const contourPercent = Math.max(0, Math.min(100, stats.contour * 100));

  ui.timer.textContent = formatTime(stats.elapsed);
  ui.tempValue.textContent = Math.round(stats.temperature);
  ui.heatFill.style.width = `${heatPercent}%`;
  ui.wallValue.textContent = stats.wallMin.toFixed(2);
  ui.wallFill.style.width = `${wallUniformity}%`;
  ui.wallDelta.textContent = `Δ ${stats.wallDelta.toFixed(2)}`;
  ui.contourValue.textContent = Math.round(contourPercent);
  ui.contourFill.style.width = `${contourPercent}%`;
  ui.contourDelta.textContent = `误差 ${Math.max(0, 1 - stats.contour).toFixed(2)}`;
  ui.rpmValue.innerHTML = `${Math.round(stats.rpm)} <small>rpm</small>`;
  ui.rpmFill.style.width = `${rotationPercent}%`;
  ui.bubbleValue.textContent = String(stats.bubbles);
  ui.pressureFill.style.height = `${Math.min(100, (sim.pressure / 1.22) * 100)}%`;
  ui.spinLight.classList.toggle("active", sim.rpm > 2);
  ui.heaterSlider.value = String(Math.round(sim.heaterPosition * 100));
  ui.heaterOffset.textContent = heaterDirectionLabel();

  const workability = sim.workability;
  if (workability > 0.72) ui.plasticityLabel.textContent = "可塑性良好";
  else if (workability > 0.34) ui.plasticityLabel.textContent = "可塑性下降";
  else if (sim.temperature > TUNING.plasticFloor) ui.plasticityLabel.textContent = "接近失去可塑性";
  else ui.plasticityLabel.textContent = "已失去可塑性";

  const showFinishHint = performance.now() < finishHintUntil && finishHint;
  ui.statusBanner.textContent = showFinishHint ? finishHint : guide.banner;
  ui.statusBanner.className = `status-banner ${showFinishHint ? "danger" : guide.tone}`.trim();
  ui.tipText.textContent = guide.tip;
  ui.processNote.textContent = showFinishHint
    ? "先满足全部三项条件，再退火定型。轮廓与壁厚会随温度、转速和气压继续变化。"
    : guide.note;
  ui.finishButton.classList.toggle("is-ready", allReady);

  [...ui.bubbleDots.children].forEach((dot, index) => {
    dot.classList.toggle("active", index < stats.bubbles);
  });

  ui.blowButton.classList.toggle("is-held", controls.blow);
  ui.spinButton.classList.toggle("is-held", controls.spin);
  void force;
}

function resetFinishHint() {
  finishHint = "";
  finishHintUntil = 0;
}

function finishReason(checks) {
  const missing = [];
  if (!checks.contour) missing.push("轮廓未合");
  if (!checks.wall) missing.push("壁厚差超限");
  if (!checks.warmth) missing.push("温度过低");
  if (!checks.clean) missing.push("内部有气泡");
  return `尚不能退火：${missing.join("、")}`;
}

function tryFinish() {
  if (sim.phase !== "playing") return;
  const result = sim.tryFinish();
  updateUi(true);
  if (result.ok) {
    announceSuccess();
    return;
  }
  resetFinishHint();
  finishHint = finishReason(result.checks);
  finishHintUntil = performance.now() + 2600;
  ui.statusBanner.textContent = finishHint;
  ui.statusBanner.className = "status-banner danger";
  if (ui.finishButton.animate) {
    ui.finishButton.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 240, easing: "ease-out" },
    );
  }
}

function bindHold(element, press, release) {
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    element.setPointerCapture?.(event.pointerId);
    press();
    updateUi(true);
  });
  const stop = (event) => {
    event.preventDefault();
    release();
    updateUi(true);
  };
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
  element.addEventListener("lostpointercapture", () => {
    release();
    updateUi(true);
  });
}

bindHold(
  ui.blowButton,
  () => {
    controls.blow = true;
    audio.start();
  },
  () => {
    controls.blow = false;
  },
);

ui.heaterSlider.addEventListener("input", () => {
  sim.setHeaterPosition(Number(ui.heaterSlider.value) / 100);
  audio.start();
});
ui.finishButton.addEventListener("click", tryFinish);
ui.resetButton.addEventListener("click", () => {
  resetFinishHint();
  beginRound();
});
ui.soundToggle.addEventListener("click", () => {
  const next = !audio.enabled;
  audio.setEnabled(next);
  ui.soundToggle.setAttribute("aria-pressed", String(next));
  ui.soundLabel.textContent = next ? "声音" : "静音";
  audio.start();
});
overlayAction.addEventListener("click", () => {
  resetFinishHint();
  beginRound();
});

const keyControls = {
  Space: ["blow", true],
  KeyD: ["spin", true],
  KeyA: ["brake", true],
  KeyQ: ["heaterLeft", true],
  KeyE: ["heaterRight", true],
};

window.addEventListener("keydown", (event) => {
  if (!overlay.classList.contains("hidden")) {
    if ((event.code === "Enter" || event.code === "Space") && !event.repeat) {
      event.preventDefault();
      overlayAction.click();
    }
    return;
  }
  const mapping = keyControls[event.code];
  if (mapping) {
    event.preventDefault();
    controls[mapping[0]] = mapping[1];
    audio.start();
  }
  if (event.code === "KeyF" && !event.repeat) {
    event.preventDefault();
    tryFinish();
  }
});

window.addEventListener("keyup", (event) => {
  const mapping = keyControls[event.code];
  if (mapping) {
    event.preventDefault();
    controls[mapping[0]] = false;
  }
});

window.addEventListener("blur", () => {
  controls.blow = false;
  controls.spin = false;
  controls.brake = false;
  controls.heaterLeft = false;
  controls.heaterRight = false;
});

function checkPhaseTransition() {
  if (sim.phase === "failed") announceFailure();
  if (sim.phase === "success") announceSuccess();
}

function stepHeater(dt) {
  const direction = Number(controls.heaterRight) - Number(controls.heaterLeft);
  if (direction !== 0) {
    sim.setHeaterPosition(sim.heaterPosition + direction * dt * 0.64);
  }
}

function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;

  if (sim.phase === "playing") {
    stepHeater(dt);
    sim.update(dt, controls);
    audio.update(sim);
    checkPhaseTransition();
  }

  uiClock += dt;
  if (uiClock >= 0.08) {
    uiClock = 0;
    updateUi();
  }
  renderer.render(sim, now / 1000, { showTarget: sim.phase !== "success" });
  requestAnimationFrame(frame);
}

function advanceForTest(seconds, controller, heaterPosition) {
  if (sim.phase === "ready") sim.start();
  const steps = Math.max(1, Math.ceil(seconds / 0.02));
  for (let index = 0; index < steps; index += 1) {
    if (sim.phase !== "playing") break;
    if (typeof heaterPosition === "function") {
      sim.setHeaterPosition(heaterPosition(sim));
    } else if (typeof heaterPosition === "number") {
      sim.setHeaterPosition(heaterPosition);
    }
    const input =
      typeof controller === "function" ? controller(sim) : controller || {};
    sim.update(0.02, input);
  }
  audio.update(sim);
  checkPhaseTransition();
  updateUi(true);
  renderer.render(sim, performance.now() / 1000, { showTarget: sim.phase !== "success" });
  return sim.getStats();
}

window.__glassGame = {
  sim,
  controls,
  renderer,
  advance: advanceForTest,
  finish: tryFinish,
  begin: beginRound,
};

updateUi(true);
renderer.render(sim, performance.now() / 1000);
requestAnimationFrame(frame);
bindHold(
  ui.spinButton,
  () => {
    controls.spin = true;
    audio.start();
  },
  () => {
    controls.spin = false;
  },
);
