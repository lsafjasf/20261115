import { CAMP, DRILL, SITES } from "./config.js";
import { IceAudio } from "./audio.js";
import { IceCoreGame, audioCueForEvent } from "./game.js";
import { createNavigation } from "./pathfinding.js";
import { SceneRenderer } from "./renderer.js";

const canvas = document.querySelector("#gameCanvas");
const startScreen = document.querySelector("#startScreen");
const resultScreen = document.querySelector("#resultScreen");
const interfaceLayer = document.querySelector("#interface");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");
const toastStack = document.querySelector("#toastStack");
const damageFlash = document.querySelector("#damageFlash");

const elements = {
  routeStatus: document.querySelector("#routeStatus"),
  routeDetail: document.querySelector("#routeDetail"),
  missionClock: document.querySelector("#missionClock"),
  objectiveTitle: document.querySelector("#objectiveTitle"),
  objectiveDetail: document.querySelector("#objectiveDetail"),
  coreSlots: [...document.querySelectorAll(".core-slot")],
  hullValue: document.querySelector("#hullValue"),
  hullBar: document.querySelector("#hullBar"),
  loadValue: document.querySelector("#loadValue"),
  loadBar: document.querySelector("#loadBar"),
  speedValue: document.querySelector("#speedValue"),
  baySlots: [...document.querySelectorAll("#baySlots i")],
  weightWarning: document.querySelector("#weightWarning"),
  sitePrompt: document.querySelector("#sitePrompt"),
  promptTitle: document.querySelector("#promptTitle"),
  promptCopy: document.querySelector("#promptCopy"),
  drillConsole: document.querySelector("#drillConsole"),
  drillSite: document.querySelector("#drillSite"),
  drillProgress: document.querySelector("#drillProgress"),
  drillProgressBar: document.querySelector("#drillProgressBar"),
  rpmValue: document.querySelector("#rpmValue"),
  rpmBar: document.querySelector("#rpmBar"),
  pressureValue: document.querySelector("#pressureValue"),
  pressureBar: document.querySelector("#pressureBar"),
  torqueValue: document.querySelector("#torqueValue"),
  torqueBar: document.querySelector("#torqueBar"),
  heatValue: document.querySelector("#heatValue"),
  heatBar: document.querySelector("#heatBar"),
  drillAdvice: document.querySelector("#drillAdvice"),
  audioState: document.querySelector("#audioState"),
  resultEyebrow: document.querySelector("#resultEyebrow"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCopy: document.querySelector("#resultCopy"),
  resultStats: document.querySelector("#resultStats"),
};

const navigation = createNavigation();
const game = new IceCoreGame(navigation);
const renderer = new SceneRenderer(canvas, game);
const audio = new IceAudio();
const keys = new Set();
let lastFrame = performance.now();
let lastHudUpdate = 0;
let resultVisible = false;
let resultDelay = null;
let toastSequence = 0;

document.fonts?.ready.then(() => renderer.drawBaseWorld());

const DRIVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "r",
  "f",
  "e",
  "m",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "enter",
  " ",
]);

function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const rest = String(safe % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function showToast(message, kind = "", duration = 2600) {
  const toast = document.createElement("div");
  toast.className = `toast ${kind}`.trim();
  toast.dataset.sequence = String(toastSequence++);
  toast.textContent = message;
  toastStack.append(toast);
  while (toastStack.children.length > 4) {
    toastStack.firstElementChild.remove();
  }
  window.setTimeout(() => {
    toast.classList.add("out");
    window.setTimeout(() => toast.remove(), 360);
  }, duration);
}

function flashDamage() {
  damageFlash.classList.add("active");
  window.setTimeout(() => damageFlash.classList.remove("active"), 180);
}

function inputState() {
  return {
    forward: keys.has("w") || keys.has("arrowup"),
    reverse: keys.has("s") || keys.has("arrowdown"),
    left: keys.has("a") || keys.has("arrowleft"),
    right: keys.has("d") || keys.has("arrowright"),
    rpm: keys.has("r"),
    pressure: keys.has("f"),
  };
}

async function enableAudio() {
  try {
    const enabled = await audio.enable();
    elements.audioState.textContent = enabled ? "音频在线 · M 静音" : "音频不可用";
  } catch {
    elements.audioState.textContent = "音频初始化失败";
  }
}

async function beginMission() {
  await enableAudio();
  if (game.mode === "title") game.start();
  startScreen.classList.add("hidden");
  interfaceLayer.classList.remove("hidden-ui");
  showToast("任务开始 · 沿安全路线前往 S-01", "good", 3000);
  lastFrame = performance.now();
}

async function restartMission() {
  await enableAudio();
  if (resultDelay) window.clearTimeout(resultDelay);
  toastStack.replaceChildren();
  resultVisible = false;
  resultScreen.classList.add("hidden");
  startScreen.classList.add("hidden");
  game.reset();
  game.start();
  renderer.resize();
  showToast("再次出勤 · 样本仓已清空", "good", 2400);
  lastFrame = performance.now();
}

function handleGameEvents(events) {
  for (const event of events) {
    const cue = audioCueForEvent(event);
    if (cue) audio.playEvent(cue);
    switch (event.type) {
      case "crack":
        showToast(
          `裂口受损 · 载重 ${event.load} · 车体 -${event.damage}%`,
          "warn",
          3000,
        );
        flashDamage();
        break;
      case "bridge":
        if (game.vehicle.load > 0) {
          showToast(`雪桥 ${event.label} 承重通过`, "", 1700);
        }
        break;
      case "jam":
        showToast("卡钻！立即松开 R / F，等待钻头卸载", "warn", 4200);
        flashDamage();
        break;
      case "jam-cleared":
        showToast("卡钻解除 · 可重新缓慢进给", "good", 2200);
        break;
      case "torque-warning":
        showToast("扭矩进入危险区 · 降低转速", "warn", 2400);
        break;
      case "low-rpm-warning":
        showToast("转速过低 · 钻头摩擦升温", "warn", 2400);
        break;
      case "heat-warning":
        showToast("钻头温度 75°C · 提高转速或减小下压力", "warn", 3000);
        break;
      case "overheat":
        showToast("钻头过热 · 自动收钻冷却", "warn", 3400);
        flashDamage();
        break;
      case "core-ready":
        showToast("钻透目标深度 · 正在回收冰芯", "good", 2600);
        break;
      case "sample-complete":
        showToast(
          `${event.siteId} ${event.core.name}入仓 · 载重 ${event.load}/3`,
          "good",
          3300,
        );
        break;
      case "mission-complete":
        showToast("三根冰芯安全返航", "good", 4200);
        break;
      case "mission-failed":
        showToast("车辆结构失效 · 任务中止", "warn", 4200);
        break;
      default:
        break;
    }
  }
}

function updatePrompt(snapshot) {
  const site = SITES[snapshot.activeSiteIndex];
  const vehicle = snapshot.vehicle;
  let visible = false;
  if (snapshot.mode === "driving" && site) {
    const distance = Math.hypot(vehicle.x - site.x, vehicle.y - site.y);
    if (distance < (site.radius || 48) + 40) {
      visible = true;
      if (snapshot.canDrill) {
        elements.promptTitle.textContent = `部署钻机 · ${site.id}`;
        elements.promptCopy.textContent = "按 E 锁定车体并开始双参数钻探";
      } else {
        elements.promptTitle.textContent = "减速并停稳";
        elements.promptCopy.textContent = "速度低于 7 后才能部署钻机";
      }
    }
  }
  if (
    snapshot.mode === "driving" &&
    snapshot.activeSiteIndex >= SITES.length
  ) {
    const distance = Math.hypot(vehicle.x - CAMP.x, vehicle.y - CAMP.y);
    if (distance < CAMP.radius + 50) {
      visible = true;
      elements.promptTitle.textContent = snapshot.canReturn
        ? "返航交接"
        : "减速进入营地";
      elements.promptCopy.textContent = snapshot.canReturn
        ? "按 E 或驶入内圈完成任务"
        : "在岸基停机坪内停稳";
    }
  }
  elements.sitePrompt.classList.toggle("hidden", !visible);
}

function updateDrillConsole(snapshot) {
  const drilling = snapshot.mode === "drilling";
  elements.drillConsole.classList.toggle("hidden", !drilling);
  if (!drilling) return;
  const drill = snapshot.drilling;
  const site = game.currentSite;
  elements.drillSite.textContent = site?.id || "—";
  elements.drillProgress.textContent = Math.floor(site?.progress || 0);
  elements.drillProgressBar.style.width = `${site?.progress || 0}%`;
  elements.rpmValue.textContent = Math.round(drill.rpm);
  elements.pressureValue.textContent = Math.round(drill.pressure);
  elements.torqueValue.textContent = Math.round(drill.torque);
  elements.heatValue.textContent = Math.round(drill.heat);
  elements.rpmBar.style.width = `${(drill.rpm / DRILL.maxRpm) * 100}%`;
  elements.pressureBar.style.width =
    `${(drill.pressure / DRILL.maxPressure) * 100}%`;
  elements.torqueBar.style.width =
    `${Math.min(100, (drill.torque / DRILL.maxTorque) * 100)}%`;
  elements.heatBar.style.width =
    `${Math.min(100, (drill.heat / DRILL.maxHeat) * 100)}%`;

  if (drill.jam) {
    elements.drillAdvice.textContent = `卡钻中 · 松开双控 ${Math.max(0, 2.4 - drill.jamTime).toFixed(1)}s`;
  } else if (drill.overheated) {
    elements.drillAdvice.textContent = "过热保护 · 正在收钻冷却";
  } else if (drill.completeTimer > 0) {
    elements.drillAdvice.textContent = "目标深度到达 · 冰芯提取中";
  } else if (drill.torque > 82) {
    elements.drillAdvice.textContent = "扭矩临限 · 降低转速";
  } else if (drill.rpm > 74) {
    elements.drillAdvice.textContent = "转速过高 · 即将卡钻";
  } else if (drill.rpm < 34 && drill.pressure > 24) {
    elements.drillAdvice.textContent = "转速过低 · 接触面升温";
  } else if (
    drill.rpm >= DRILL.safeRpm[0] &&
    drill.rpm <= DRILL.safeRpm[1] &&
    drill.pressure >= DRILL.safePressure[0] &&
    drill.pressure <= DRILL.safePressure[1]
  ) {
    elements.drillAdvice.textContent = "双控均衡 · 稳定进尺";
  } else {
    elements.drillAdvice.textContent = "调整 R / F 保持绿色区间";
  }
}

function updateObjective(snapshot) {
  if (snapshot.mode === "drilling") {
    const site = SITES[snapshot.activeSiteIndex];
    elements.objectiveTitle.textContent = `钻取 ${site.id} ${site.name}`;
    elements.objectiveDetail.textContent =
      "转速与下压力共同决定进尺；高转速卡钻，低转速升温。";
    return;
  }
  if (snapshot.activeSiteIndex >= SITES.length) {
    elements.objectiveTitle.textContent =
      snapshot.mode === "complete" ? "冰芯交接完成" : "返回岸基营地";
    elements.objectiveDetail.textContent =
      "样本仓满载，车辆更重；沿安全路线返回岸边。";
    return;
  }
  const site = SITES[snapshot.activeSiteIndex];
  elements.objectiveTitle.textContent = `前往 ${site.id} ${site.name}`;
  elements.objectiveDetail.textContent =
    `沿虚线安全路线抵达第 ${snapshot.activeSiteIndex + 1} 个采样层位。`;
}

function updateHud(snapshot) {
  elements.missionClock.textContent = formatClock(snapshot.elapsed);
  const route = snapshot.route;
  if (route?.found) {
    elements.routeStatus.textContent =
      route.violations === 0 ? "可通行" : "路线危险";
    elements.routeDetail.textContent =
      `${route.length} m · ${route.bridges.length} 处雪桥`;
  } else {
    elements.routeStatus.textContent = "重新扫描";
    elements.routeDetail.textContent = "正在寻找安全路径";
  }

  updateObjective(snapshot);
  elements.hullValue.textContent = `${Math.round(snapshot.hull)}%`;
  elements.hullBar.style.width = `${snapshot.hull}%`;
  elements.hullBar.style.background =
    snapshot.hull < 35
      ? "linear-gradient(90deg,#ff705b,#ffb46c)"
      : "linear-gradient(90deg,#5ce6d4,#c1ffdb)";
  elements.loadValue.textContent = `${snapshot.load} / 3`;
  elements.loadBar.style.width = `${(snapshot.load / 3) * 100}%`;
  elements.speedValue.textContent = `${Math.round(Math.abs(snapshot.speed) * 0.46)} km/h`;
  elements.baySlots.forEach((slot, index) => {
    slot.classList.toggle("filled", index < snapshot.load);
  });
  elements.weightWarning.textContent =
    snapshot.load === 0
      ? "空载"
      : snapshot.load === 1
        ? "重量 +24% · 裂口风险上升"
        : snapshot.load === 2
          ? "重量 +48% · 谨慎跨桥"
          : "满载 · 避开一切裂口";

  for (let index = 0; index < elements.coreSlots.length; index += 1) {
    const slot = elements.coreSlots[index];
    const site = snapshot.sites[index];
    const done = site?.done;
    const active = index === snapshot.activeSiteIndex && !done;
    slot.classList.toggle("done", Boolean(done));
    slot.classList.toggle("active", active);
    slot.querySelector(".core-state").textContent = done
      ? "已封装"
      : active
        ? "采样中"
        : index === snapshot.activeSiteIndex + 1
          ? "下一层位"
          : "未解锁";
  }

  updatePrompt(snapshot);
  updateDrillConsole(snapshot);
}

function showResult(result) {
  if (!result) return;
  resultVisible = true;
  resultScreen.classList.remove("hidden");
  if (result.success) {
    elements.resultEyebrow.textContent = "任务完成 / CORE SET";
    elements.resultTitle.textContent = "三根冰芯已返航";
    elements.resultCopy.textContent =
      "样本仓密封，钻取车已停靠岸基。三层冰芯完整移交分析舱。";
  } else {
    elements.resultEyebrow.textContent = "任务中止 / VEHICLE";
    elements.resultTitle.textContent =
      result.reason === "hull-failure" ? "车体结构失效" : "采样未能返航";
    elements.resultCopy.textContent =
      "冰面载荷超过车体极限。重新出勤时，请沿安全路线并使用雪桥。";
  }
  const stats = [
    { value: formatClock(result.elapsed), label: "任务用时" },
    { value: `${result.cores} / 3`, label: "回收冰芯" },
    { value: String(result.jamCount), label: "卡钻次数" },
    { value: `${result.hull}%`, label: "剩余车体" },
    { value: String(result.crackCrossings), label: "裂口穿越" },
    { value: String(result.safeBridgeCrossings), label: "雪桥通过" },
  ];
  elements.resultStats.replaceChildren(
    ...stats.map((stat) => {
      const cell = document.createElement("div");
      const value = document.createElement("strong");
      value.textContent = stat.value;
      const label = document.createElement("span");
      label.textContent = stat.label;
      cell.append(value, label);
      return cell;
    }),
  );
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  game.update(dt, inputState());
  const snapshot = game.getSnapshot();
  handleGameEvents(game.consumeEvents());
  audio.update(snapshot);
  renderer.render(now);

  if (now - lastHudUpdate > 28) {
    updateHud(snapshot);
    lastHudUpdate = now;
  }

  if (snapshot.mode === "complete" && !resultVisible && !resultDelay) {
    resultDelay = window.setTimeout(() => {
      resultDelay = null;
      showResult(game.result);
    }, 1150);
  }
  requestAnimationFrame(frame);
}

window.addEventListener("resize", () => renderer.resize());
window.addEventListener("blur", () => keys.clear());
document.addEventListener("visibilitychange", () => {
  keys.clear();
  lastFrame = performance.now();
});

window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (
    !startScreen.classList.contains("hidden") &&
    (key === "enter" || key === " ")
  ) {
    event.preventDefault();
    beginMission();
    return;
  }
  if (
    !resultScreen.classList.contains("hidden") &&
    (key === "r" || key === "enter")
  ) {
    event.preventDefault();
    restartMission();
    return;
  }
  if (DRIVE_KEYS.has(key)) event.preventDefault();
  if (event.repeat) return;
  if (key === "e") {
    if (game.interact()) {
      if (game.mode === "drilling") {
        showToast("钻机锁定 · 使用 R / F 控制双参数", "", 2400);
      }
    }
  }
  if (key === "m") {
    if (!audio.enabled) {
      enableAudio();
    } else {
      const muted = audio.toggleMute();
      elements.audioState.textContent = muted
        ? "已静音 · M 恢复"
        : "音频在线 · M 静音";
      showToast(muted ? "环境音频已静音" : "环境音频已恢复", "", 1600);
    }
  }
  keys.add(key);
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.key.toLowerCase());
});

startButton.addEventListener("click", beginMission);
restartButton.addEventListener("click", restartMission);

window.__iceGame = {
  getSnapshot: () => game.getSnapshot(),
  getRoutes: () => game.debugRoutes(),
  teleportToSite: (index) => game.debugTeleportToSite(index),
  teleportToCamp: () => game.debugTeleportToCamp(),
  restart: () => restartMission(),
  getAudioState: () => audio.getState(),
  getCurrentSite: () =>
    game.currentSite
      ? {
          id: game.currentSite.id,
          name: game.currentSite.name,
          progress: game.currentSite.progress,
        }
      : null,
};

updateHud(game.getSnapshot());
requestAnimationFrame(frame);
