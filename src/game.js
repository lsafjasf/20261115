import { GreenhouseAudio } from "./audio.js";
import { drawGreenhouse, VIEW } from "./render.js";
import {
  ROWS,
  SIM,
  consumeNotifications,
  createSimulation,
  getCycle,
  getLighting,
  getSnapshot,
  moveRack,
  normalizeControl,
  pauseSimulation,
  setControl,
  startSimulation,
  stepSimulation,
} from "./sim.js";

const canvas = document.querySelector("#greenhouse");
const ctx = canvas.getContext("2d");
const audio = new GreenhouseAudio();

const ui = {
  time: document.querySelector("#time-readout"),
  rack: document.querySelector("#rack-readout"),
  temp: document.querySelector("#temp-readout"),
  toast: document.querySelector("#event-toast"),
  rackPosition: document.querySelector("#rack-position"),
  height: document.querySelector("#lamp-height"),
  duty: document.querySelector("#lamp-duty"),
  darkEvery: document.querySelector("#dark-every"),
  darkFor: document.querySelector("#dark-for"),
  heightOutput: document.querySelector("#height-output"),
  dutyOutput: document.querySelector("#duty-output"),
  everyOutput: document.querySelector("#every-output"),
  darkOutput: document.querySelector("#dark-output"),
  ppfdFill: document.querySelector("#ppfd-fill"),
  ppfdReadout: document.querySelector("#ppfd-readout"),
  cycleState: document.querySelector("#cycle-state"),
  mission: document.querySelector("#mission-message"),
  run: document.querySelector("#run-toggle"),
  reset: document.querySelector("#reset-button"),
  sound: document.querySelector("#sound-toggle"),
  moveLeft: document.querySelector("#move-left"),
  moveRight: document.querySelector("#move-right"),
  rowTargets: [...document.querySelectorAll(".row-target")],
  speedButtons: [...document.querySelectorAll(".speed-button")],
};

let sim = createSimulation();
let speed = 1;
let lastFrame = performance.now();
let lastStatus = sim.status;
let heldDirection = 0;
let pointerDirection = 0;
let dragging = false;
let toastUntil = 0;
let lastUiUpdate = 0;
let audioUnlockAttempted = false;
let previousRackX = sim.control.rackX;
let rackSpeed = 0;
let rackMovingUntil = 0;

function unlockAudio() {
  if (audioUnlockAttempted || audio.muted) return;
  audioUnlockAttempted = true;
  audio.ensureStarted().catch(() => {});
}

function applyControl(key, value) {
  setControl(sim, key, value);
  syncControlsFromSim();
}

function syncControlsFromSim() {
  ui.rackPosition.value = String(sim.control.rackX);
  ui.height.value = String(Math.round(sim.control.height * 100));
  ui.duty.value = String(Math.round(sim.control.duty * 100));
  ui.darkEvery.value = String(Math.round(sim.control.darkEvery));
  ui.darkFor.value = String(Math.round(sim.control.darkFor));
  updateUi(true);
}

function setRunButton() {
  if (sim.status === "running") ui.run.textContent = "暂停值守";
  else if (sim.status === "paused") ui.run.textContent = "继续值守";
  else if (sim.status === "won") ui.run.textContent = "完成 · 再开一轮";
  else if (sim.status === "failed") ui.run.textContent = "灼伤/超时 · 再来";
  else ui.run.textContent = "开始值守";
}

function toggleRun() {
  unlockAudio();
  if (sim.status === "running") {
    pauseSimulation(sim);
  } else if (sim.status === "ready" || sim.status === "paused") {
    startSimulation(sim);
  } else {
    resetRound();
    startSimulation(sim);
  }
  setRunButton();
  updateUi(true);
}

function resetRound() {
  sim = createSimulation();
  speed = 1;
  heldDirection = 0;
  previousRackX = sim.control.rackX;
  rackSpeed = 0;
  lastStatus = sim.status;
  ui.toast.classList.remove("visible", "danger");
  for (const button of ui.speedButtons) {
    button.classList.toggle("active", button.dataset.speed === "1");
  }
  syncControlsFromSim();
  setRunButton();
  ui.run.textContent = "开始值守";
}

function showToast(notice) {
  if (!notice) return;
  ui.toast.textContent = notice.message;
  ui.toast.classList.toggle("danger", notice.tone === "danger" || notice.tone === "warning");
  ui.toast.classList.add("visible");
  toastUntil = performance.now() + (notice.tone === "danger" ? 4200 : 2800);
}

function rowNearestRack() {
  let best = 0;
  let distance = Infinity;
  for (let index = 0; index < ROWS.length; index += 1) {
    const candidate = Math.abs(ROWS[index].x - sim.control.rackX);
    if (candidate < distance) {
      distance = candidate;
      best = index;
    }
  }
  return { index: best, distance };
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function missionText(nearest, maxTemp) {
  if (sim.status === "won") {
    const rowText = sim.rows.map((row) => `${row.id} ${Math.round(row.growth)}%`).join(" · ");
    return `补光完成，无灼伤。${rowText}，用时 ${formatTime(sim.time)}。`;
  }
  if (sim.status === "failed") {
    if (sim.failReason === "burn") {
      const burned = sim.rows.find((row) => row.burned);
      return `${burned?.id ?? "?"} 排叶片灼伤。灯架停留过久，请缩短单排停留并保留暗周期。`;
    }
    return "十二分钟已到，仍有幼苗未达到 100%。缩短移动间隔、避免相邻遮光后再试。";
  }
  if (sim.status === "paused") return "值守已暂停。继续后可重新移动灯架或调节光照。";
  if (sim.status === "ready") {
    return "先向任意一排补光。每排达到 100% 且无灼伤即可提前完成。";
  }
  if (maxTemp >= 43.3) return `叶温升至 ${maxTemp.toFixed(1)}°C，马上移开灯架或等待暗周期。`;
  if (nearest.distance < 0.2) {
    const row = sim.rows[nearest.index];
    if (row.dwell >= 32) return `${row.id} 排已连续受光 ${Math.floor(row.dwell)} 秒，换排可避免积热。`;
    return `${row.id} 排补光中 · 生长 ${Math.round(row.growth)}% · 单排建议停留 35–45 秒`;
  }
  return "灯架位于排间。靠边停驻会遮挡相邻区域，请对准一排再观察光斑。";
}

function updateUi(force = false) {
  const now = performance.now();
  if (!force && now - lastUiUpdate < 95) return;
  lastUiUpdate = now;

  const nearest = rowNearestRack();
  const lighting = sim.rows.map((_, index) => getLighting(sim, index));
  const maxTemp = Math.max(...sim.rows.map((row) => row.temp));
  const maxPpfd = Math.max(...lighting.map((light) => light.ppfd));
  const cycle = getCycle(sim);

  ui.time.textContent = formatTime(sim.duration - sim.time);
  ui.temp.textContent = `${maxTemp.toFixed(1)}°C`;
  ui.temp.style.color = maxTemp >= 43.3 ? "var(--coral)" : maxTemp >= 40 ? "var(--amber)" : "";
  ui.rack.textContent =
    nearest.distance < 0.2 ? `${ROWS[nearest.index].id} 排` : "排间 · 遮光";
  ui.heightOutput.textContent = `${Math.round(sim.control.height * 100)} cm`;
  ui.dutyOutput.textContent = `${Math.round(sim.control.duty * 100)}%`;
  ui.everyOutput.textContent = `${Math.round(sim.control.darkEvery)} s`;
  ui.darkOutput.textContent = `${Math.round(sim.control.darkFor)} s`;
  ui.ppfdReadout.textContent = `${Math.round(maxPpfd)} µmol`;
  ui.ppfdFill.style.width = `${Math.min(100, (maxPpfd / 110) * 100)}%`;
  ui.ppfdFill.style.background =
    maxPpfd > 92
      ? "var(--coral)"
      : maxPpfd > 70
        ? "linear-gradient(90deg, var(--lime), var(--amber))"
        : "var(--lime)";
  ui.cycleState.textContent = cycle.dark
    ? `暗周期中 · ${Math.ceil(cycle.untilLight)} 秒后复光 · 叶温下降`
    : `灯照中 · 下次暗周期 ${Math.ceil(cycle.nextDark)}s · 每 ${Math.round(
        sim.control.darkEvery,
      )}s 熄灯 ${Math.round(sim.control.darkFor)}s`;
  ui.mission.textContent = missionText(nearest, maxTemp);
  ui.mission.style.color =
    sim.status === "failed" ? "var(--coral)" : sim.status === "won" ? "var(--lime)" : "";

  for (let index = 0; index < ui.rowTargets.length; index += 1) {
    ui.rowTargets[index].classList.toggle(
      "active",
      Math.abs(sim.control.rackX - ROWS[index].x) < 0.2,
    );
  }
  setRunButton();

  if (sim.status !== lastStatus) {
    if (sim.status === "won") {
      showToast({
        message: `任务完成 · 用时 ${formatTime(sim.time)} · 三排均未灼伤`,
        tone: "success",
      });
    } else if (sim.status === "failed") {
      showToast({
        message:
          sim.failReason === "burn"
            ? `灼伤失败：${sim.rows.find((row) => row.burned)?.id ?? "?"} 排灯架停留过久`
            : "超时失败：三排未全部达到 100%",
        tone: "danger",
      });
    }
    lastStatus = sim.status;
  }
}

ui.rackPosition.addEventListener("input", (event) => {
  unlockAudio();
  applyControl("rackX", event.target.value);
});
ui.height.addEventListener("input", (event) => {
  applyControl("height", Number(event.target.value) / 100);
});
ui.duty.addEventListener("input", (event) => {
  applyControl("duty", Number(event.target.value) / 100);
});
ui.darkEvery.addEventListener("input", (event) => {
  applyControl("darkEvery", event.target.value);
});
ui.darkFor.addEventListener("input", (event) => {
  applyControl("darkFor", event.target.value);
});

for (const button of ui.rowTargets) {
  button.addEventListener("click", () => {
    unlockAudio();
    applyControl("rackX", ROWS[Number(button.dataset.row)].x);
  });
}

for (const button of ui.speedButtons) {
  button.addEventListener("click", () => {
    speed = Number(button.dataset.speed);
    for (const candidate of ui.speedButtons) {
      candidate.classList.toggle("active", candidate === button);
    }
  });
}

ui.run.addEventListener("click", toggleRun);
ui.reset.addEventListener("click", () => {
  unlockAudio();
  resetRound();
});
ui.sound.addEventListener("click", async () => {
  await audio.ensureStarted().catch(() => {});
  const on = audio.toggle();
  ui.sound.textContent = on ? "声音 开" : "声音 关";
  ui.sound.setAttribute("aria-pressed", String(on));
  audioUnlockAttempted = true;
});

for (const [button, direction] of [
  [ui.moveLeft, -1],
  [ui.moveRight, 1],
]) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    unlockAudio();
    pointerDirection = direction;
    button.setPointerCapture(event.pointerId);
  });
  const stop = () => {
    pointerDirection = 0;
  };
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("lostpointercapture", stop);
}

function pointerToRack(event) {
  const bounds = canvas.getBoundingClientRect();
  const canvasX = ((event.clientX - bounds.left) / bounds.width) * VIEW.width;
  const ratio = (canvasX - VIEW.left) / (VIEW.right - VIEW.left);
  return Math.min(SIM.rackMax, Math.max(SIM.rackMin, ratio * SIM.rackMax));
}

canvas.addEventListener("pointerdown", (event) => {
  unlockAudio();
  dragging = true;
  canvas.setPointerCapture(event.pointerId);
  applyControl("rackX", pointerToRack(event));
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  applyControl("rackX", pointerToRack(event));
});
const stopDragging = () => {
  dragging = false;
};
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);

window.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "BUTTON") return;
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") {
    event.preventDefault();
    heldDirection = -1;
    unlockAudio();
  } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") {
    event.preventDefault();
    heldDirection = 1;
    unlockAudio();
  } else if (event.code === "Space") {
    event.preventDefault();
    toggleRun();
  }
});
window.addEventListener("keyup", (event) => {
  if (
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight" ||
    event.key.toLowerCase() === "a" ||
    event.key.toLowerCase() === "d"
  ) {
    heldDirection = 0;
  }
});
window.addEventListener("blur", () => {
  heldDirection = 0;
  pointerDirection = 0;
  dragging = false;
});

function animate(now) {
  const realDt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const direction = Math.sign(heldDirection + pointerDirection);

  if (direction !== 0 && !["won", "failed"].includes(sim.status)) {
    moveRack(sim, direction * 0.82 * realDt * Math.min(speed, 4));
  }

  if (sim.status === "running") stepSimulation(sim, realDt * speed);

  const rackDelta = Math.abs(sim.control.rackX - previousRackX);
  if (rackDelta > 0.0001) rackMovingUntil = now + 90;
  rackSpeed = rackDelta / Math.max(realDt, 0.001);
  previousRackX = sim.control.rackX;

  const maxTemp = Math.max(...sim.rows.map((row) => row.temp));
  audio.update({
    moving: now < rackMovingUntil,
    rackSpeed,
    maxTemp,
    running: sim.status === "running",
    muted: audio.muted,
  });

  for (const notice of consumeNotifications(sim)) showToast(notice);
  if (now > toastUntil) ui.toast.classList.remove("visible");

  drawGreenhouse(ctx, sim);
  updateUi();
  requestAnimationFrame(animate);
}

function advanceSimulation(seconds) {
  let remaining = Math.max(0, Number(seconds) || 0);
  while (remaining > 1e-6 && sim.status === "running") {
    const dt = Math.min(0.1, remaining);
    stepSimulation(sim, dt);
    remaining -= dt;
  }
  for (const notice of consumeNotifications(sim)) showToast(notice);
  drawGreenhouse(ctx, sim);
  updateUi(true);
  return getSnapshot(sim);
}

window.__greenhouse = Object.freeze({
  snapshot: () => getSnapshot(sim),
  start: () => {
    startSimulation(sim);
    updateUi(true);
    return getSnapshot(sim);
  },
  pause: () => {
    pauseSimulation(sim);
    updateUi(true);
    return getSnapshot(sim);
  },
  reset: () => {
    resetRound();
    return getSnapshot(sim);
  },
  setSpeed: (value) => {
    speed = [1, 4, 12].includes(Number(value)) ? Number(value) : speed;
    return speed;
  },
  setControl: (key, value) => {
    setControl(sim, key, normalizeControl(key, value));
    syncControlsFromSim();
    return getSnapshot(sim);
  },
  moveToRow: (index) => {
    setControl(sim, "rackX", ROWS[index]?.x ?? sim.control.rackX);
    syncControlsFromSim();
    return getSnapshot(sim);
  },
  advance: advanceSimulation,
  config: { duration: SIM.duration, target: SIM.growthTarget, rows: ROWS },
});

syncControlsFromSim();
setRunButton();
drawGreenhouse(ctx, sim);
requestAnimationFrame((now) => {
  lastFrame = now;
  animate(now);
});
