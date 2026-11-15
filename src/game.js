import {
  CargoSimulation,
  CONFIG,
  LINES,
  PRIORITY_NAMES,
  dispatchAuto,
  formatClock,
  routeBetween,
  wrap
} from "./simulation.js";

const $ = (selector) => document.querySelector(selector);
const dom = {
  canvas: $("#stationCanvas"),
  tooltip: $("#canvasTooltip"),
  fleetList: $("#fleetList"),
  taskList: $("#taskList"),
  eventLog: $("#eventLog"),
  waitingCount: $("#waitingCount"),
  clockLabel: $("#clockLabel"),
  remainingLabel: $("#remainingLabel"),
  timeValue: $("#timeValue"),
  nextWaveValue: $("#nextWaveValue"),
  completedValue: $("#completedValue"),
  requiredValue: $("#requiredValue"),
  reserveValue: $("#reserveValue"),
  energyValue: $("#energyValue"),
  depletedValue: $("#depletedValue"),
  progressText: $("#missionProgressText"),
  progressBar: $("#missionProgressBar"),
  logTime: $("#logTime"),
  seedInput: $("#seedInput"),
  pauseBtn: $("#pauseBtn"),
  pauseIcon: $("#pauseIcon"),
  speedSelect: $("#speedSelect"),
  newRunBtn: $("#newRunBtn"),
  autoDispatchBtn: $("#autoDispatchBtn"),
  successDemoBtn: $("#successDemoBtn"),
  failureDemoBtn: $("#failureDemoBtn"),
  resultOverlay: $("#resultOverlay"),
  resultCard: $("#resultOverlay .result-card"),
  resultKicker: $("#resultKicker"),
  resultGlyph: $("#resultGlyph"),
  resultTitle: $("#resultTitle"),
  resultReason: $("#resultReason"),
  resultDelivered: $("#resultDelivered"),
  resultReserve: $("#resultReserve"),
  resultDepleted: $("#resultDepleted"),
  replayBtn: $("#replayBtn"),
  closeResultBtn: $("#closeResultBtn"),
  toast: $("#toast")
};

const STATE_LABELS = {
  idle: "待命",
  to_pickup: "前往取货",
  loading: "装载中",
  to_dropoff: "运载中",
  unloading: "卸载中",
  to_charger: "返航补电",
  charging: "充电中",
  depleted: "电量耗尽"
};

const PRIORITY_KEYS = [
  ["docking", "停"],
  ["charging", "充"],
  ["avoidance", "避"]
];

const state = {
  sim: null,
  paused: false,
  speed: 4,
  autoEnabled: false,
  demoPolicy: null,
  selectedTaskId: null,
  dragTaskId: null,
  selectedVehicleId: null,
  lastFrame: 0,
  lastUiRender: 0,
  lastCanvasSize: "",
  lastTaskSignature: "",
  lastFleetSignature: "",
  lastLogId: 0,
  resultVisible: false,
  toastTimer: null,
  hits: [],
  hoverPointer: null,
  nextDispatchAt: 0,
  scenario: null,
  replayAuto: false
};

function createSimulation({ seed = dom.seedInput.value, initialBattery = null, incidentCount = 2 } = {}) {
  const sim = new CargoSimulation({ seed, initialBattery, incidentCount });
  state.sim = sim;
  state.paused = false;
  state.autoEnabled = false;
  state.demoPolicy = null;
  state.selectedTaskId = null;
  state.dragTaskId = null;
  state.selectedVehicleId = null;
  state.lastTaskSignature = "";
  state.lastFleetSignature = "";
  state.lastLogId = 0;
  state.resultVisible = false;
  state.nextDispatchAt = 0;
  state.scenario = { seed, initialBattery, incidentCount };
  dom.resultOverlay.hidden = true;
  dom.pauseIcon.textContent = "Ⅱ";
  dom.autoDispatchBtn.classList.remove("active");
  dom.autoDispatchBtn.textContent = "自动派单";
  dom.seedInput.value = sim.seed;
  window.__ringGame = {
    sim,
    state,
    assignTask: (taskId, vehicleId) => assignTask(taskId, vehicleId),
    advance: (seconds) => {
      state.sim.advance(seconds);
      renderAll(true);
    }
  };
  return sim;
}

function seedFromInput() {
  return dom.seedInput.value.trim() || "RING-305";
}

function toast(message, type = "info") {
  clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.className = `toast visible${type === "error" ? " error" : ""}`;
  state.toastTimer = setTimeout(() => {
    dom.toast.className = "toast";
  }, 2200);
}

function vehicleStateLabel(vehicle) {
  if (vehicle.state === "depleted") return "电量耗尽";
  if (vehicle.faultUntil > state.sim.time) return `故障 · ${vehicle.faultReason}`;
  if (vehicle.waitingDock !== null) return `${LINES[vehicle.waitingDock].id} 线排队`;
  if (vehicle.waitingCharger) return "等待充电位";
  const base = STATE_LABELS[vehicle.state] ?? vehicle.state;
  const taskId = vehicle.activeTask ? ` · ${vehicle.activeTask}` : "";
  return `${base}${taskId}`;
}

function taskById(id) {
  return state.sim.taskById.get(id);
}

function assignTask(taskId, vehicleId) {
  const sim = state.sim;
  const result = sim.assignTask(taskId, vehicleId);
  if (!result.ok) {
    toast(result.reason, "error");
    return false;
  }
  state.selectedTaskId = null;
  state.selectedVehicleId = vehicleId;
  renderAll(true);
  return true;
}

function updateAutoMode() {
  state.autoEnabled = !state.autoEnabled;
  state.nextDispatchAt = Math.floor(state.sim.time / 0.5) * 0.5 + 0.5;
  dom.autoDispatchBtn.classList.toggle("active", state.autoEnabled);
  dom.autoDispatchBtn.textContent = state.autoEnabled ? "自动派单中" : "自动派单";
  toast(state.autoEnabled ? "自动派单已开启，仍可手动拖拽调整" : "自动派单已关闭");
}

function startDemo(kind) {
  if (kind === "success") {
    createSimulation({ seed: "RING-305" });
    state.autoEnabled = true;
    state.speed = 8;
    dom.speedSelect.value = "8";
    dom.autoDispatchBtn.classList.add("active");
    dom.autoDispatchBtn.textContent = "自动派单中";
    toast("成功局演示：4 车派单，保留 1 辆备用车");
  } else {
    createSimulation({ seed: "RING-305", initialBattery: 8, incidentCount: 3 });
    state.autoEnabled = true;
    state.demoPolicy = { vehicleLimit: 4, maxQueued: 1, minBattery: 0 };
    state.speed = 8;
    dom.speedSelect.value = "8";
    dom.autoDispatchBtn.classList.add("active");
    dom.autoDispatchBtn.textContent = "自动派单中";
    toast("电量耗尽演示：低电量车队仍被持续派单");
  }
}

function replayCurrentRun() {
  const scenario = state.scenario ?? { seed: seedFromInput(), initialBattery: null, incidentCount: 2 };
  const auto = state.autoEnabled;
  const policy = state.demoPolicy ? { ...state.demoPolicy } : null;
  createSimulation(scenario);
  if (auto) {
    state.autoEnabled = true;
    state.demoPolicy = policy;
    dom.autoDispatchBtn.classList.add("active");
    dom.autoDispatchBtn.textContent = "自动派单中";
  }
}

function priorityMarkup(vehicle) {
  return PRIORITY_KEYS.map(([key, label]) => `
    <div class="priority-group" title="${label === "停" ? "停靠" : label === "充" ? "充电" : "避让"}优先级">
      <span class="priority-label">${label}</span>
      <div class="priority-buttons" role="group" aria-label="${label}优先级">
        ${PRIORITY_NAMES.map((name, value) => `
          <button
            class="priority-btn${vehicle.priorities[key] === value ? " active" : ""}"
            data-action="priority"
            data-vehicle="${vehicle.id}"
            data-kind="${key}"
            data-value="${value}"
            title="${label}优先级：${name}"
          >${value + 1}</button>
        `).join("")}
      </div>
    </div>
  `).join("");
}

function renderFleet() {
  const sim = state.sim;
  const signature = sim.vehicles.map((vehicle) => [
    vehicle.id,
    vehicle.state,
    vehicle.faultUntil > sim.time ? "fault" : "ok",
    vehicle.activeTask ?? "-",
    vehicle.queue.join(","),
    vehicle.waitingDock,
    vehicle.priorities.docking,
    vehicle.priorities.charging,
    vehicle.priorities.avoidance,
    vehicle.chargerSlot
  ].join(":")).join("|");
  if (signature === state.lastFleetSignature) {
    updateFleetEnergy();
    return;
  }
  state.lastFleetSignature = signature;

  dom.fleetList.innerHTML = sim.vehicles.map((vehicle) => {
    const batteryClass = vehicle.battery < 16 ? "danger" : vehicle.battery < 32 ? "warn" : "";
    return `
      <article
        class="fleet-card${state.selectedVehicleId === vehicle.id ? " is-selected" : ""}${vehicle.state === "depleted" ? " is-depleted" : ""}${vehicle.faultUntil > sim.time ? " is-faulted" : ""}"
        data-vehicle="${vehicle.id}"
        style="--vehicle-color:${vehicle.color}"
        tabindex="0"
      >
        <div class="fleet-avatar">${vehicle.id.slice(-2)}</div>
        <div class="fleet-main">
          <div class="fleet-topline">
            <span class="fleet-name">${vehicle.name}</span>
            <span class="fleet-state" data-state-for="${vehicle.id}">${vehicleStateLabel(vehicle)}</span>
          </div>
          <div class="battery-row">
            <div class="battery-track">
              <div class="battery-fill ${batteryClass}" data-battery-for="${vehicle.id}" style="width:${vehicle.battery}%"></div>
            </div>
            <span class="battery-value" data-battery-label="${vehicle.id}">${Math.round(vehicle.battery)}%</span>
            ${vehicle.queue.length > 0 ? `<span class="fleet-queue">+${vehicle.queue.length}</span>` : ""}
          </div>
        </div>
        <div class="priority-cluster">${priorityMarkup(vehicle)}</div>
      </article>
    `;
  }).join("");
}

function updateFleetEnergy() {
  const sim = state.sim;
  for (const vehicle of sim.vehicles) {
    const label = dom.fleetList.querySelector(`[data-battery-label="${vehicle.id}"]`);
    const fill = dom.fleetList.querySelector(`[data-battery-for="${vehicle.id}"]`);
    if (label) label.textContent = `${Math.round(vehicle.battery)}%`;
    if (fill) {
      fill.style.width = `${vehicle.battery}%`;
      fill.className = `battery-fill ${vehicle.battery < 16 ? "danger" : vehicle.battery < 32 ? "warn" : ""}`;
    }
  }
}

function taskCardMarkup(task) {
  const origin = LINES[task.originIndex];
  const destination = LINES[task.destinationIndex];
  const age = Math.max(0, Math.floor(state.sim.time - task.revealAt));
  return `
    <article
      class="task-card${state.selectedTaskId === task.id ? " selected" : ""}"
      draggable="true"
      data-task="${task.id}"
      tabindex="0"
    >
      <div class="task-id">${task.id.replace("T-", "")}</div>
      <div class="task-main">
        <div class="task-route">
          <span class="line-tag" style="--line-color:${origin.color}">${origin.id}</span>
          <span class="route-arrow">→</span>
          <span class="line-tag" style="--line-color:${destination.color}">${destination.id}</span>
        </div>
        <div class="task-cargo">${task.cargo} · ${task.serviceTime.toFixed(1)}s 作业</div>
      </div>
      <div class="task-meta">
        <b data-task-age="${task.id}">${formatClock(age)}</b>
        <span>等待</span>
      </div>
    </article>
  `;
}

function renderTasks() {
  const tasks = state.sim.waitingTasks;
  const signature = `${tasks.map((task) => task.id).join(",")}|${state.selectedTaskId}`;
  if (signature === state.lastTaskSignature) {
    updateTaskAges();
    return;
  }
  state.lastTaskSignature = signature;
  dom.waitingCount.textContent = String(tasks.length);
  dom.taskList.innerHTML = tasks.length
    ? tasks.map(taskCardMarkup).join("")
    : `<div class="empty-state">暂无待派任务<br>${state.sim.revealedWaves < CONFIG.waveCount ? "下一波将在整分钟入库" : "本轮任务已全部派发"}</div>`;
}

function updateTaskAges() {
  for (const task of state.sim.waitingTasks) {
    const ageLabel = dom.taskList.querySelector(`[data-task-age="${task.id}"]`);
    if (ageLabel) {
      ageLabel.textContent = formatClock(Math.max(0, state.sim.time - task.revealAt));
    }
  }
}

function renderLog() {
  const last = state.sim.events.at(-1);
  if (!last || last.id === state.lastLogId) return;
  state.lastLogId = last.id;
  const entries = state.sim.events.slice(-18);
  dom.eventLog.innerHTML = entries.map((event) => `
    <div class="log-entry ${event.type}">
      <time>${formatClock(event.at)}</time>
      <span>${event.message}</span>
    </div>
  `).join("");
  dom.eventLog.scrollTop = dom.eventLog.scrollHeight;
}

function renderMetrics() {
  const sim = state.sim;
  const completed = sim.completedTasks.length;
  const total = sim.tasks.length;
  const required = sim.requiredCompleted;
  const depleted = sim.vehicles.filter((vehicle) => vehicle.state === "depleted").length;
  const average = Math.round(sim.vehicles.reduce((sum, vehicle) => sum + vehicle.battery, 0) / sim.vehicles.length);
  const nextWaveAt = sim.revealedWaves * CONFIG.waveInterval;

  dom.clockLabel.textContent = formatClock(sim.time);
  dom.remainingLabel.textContent = formatClock(CONFIG.duration - sim.time);
  dom.timeValue.textContent = formatClock(CONFIG.duration - sim.time);
  dom.nextWaveValue.textContent = sim.revealedWaves < CONFIG.waveCount
    ? formatClock(nextWaveAt - sim.time)
    : "已全部入库";
  dom.completedValue.textContent = String(completed);
  dom.requiredValue.textContent = String(required);
  dom.reserveValue.textContent = String(sim.reserveVehicles.length);
  dom.energyValue.textContent = String(average);
  dom.depletedValue.textContent = depleted > 0 ? `${depleted} 辆车已掉线` : "无车辆掉线";
  dom.depletedValue.style.color = depleted > 0 ? "var(--red)" : "";
  dom.progressText.textContent = `${completed} / ${required}`;
  dom.progressBar.style.width = `${Math.min(100, (completed / total) * 100)}%`;
  dom.logTime.textContent = formatClock(sim.time);
}

function renderResult() {
  const sim = state.sim;
  if (!sim.finished || !sim.result || state.resultVisible) return;
  state.resultVisible = true;
  const result = sim.result;
  const success = result.status === "success";
  dom.resultCard.classList.toggle("failure", !success);
  dom.resultKicker.textContent = success ? "SHIFT COMPLETE / 验收通过" : "SHIFT HALTED / 任务失败";
  dom.resultGlyph.textContent = success ? "✓" : "×";
  dom.resultTitle.textContent = success ? "任务成功" : "任务失败";
  dom.resultReason.textContent = result.reason;
  dom.resultDelivered.textContent = `${result.completed} / ${result.totalTasks}`;
  dom.resultReserve.textContent = `${result.reserveVehicles.length} 辆`;
  dom.resultDepleted.textContent = `${result.depletedVehicles.length} 辆`;
  dom.resultOverlay.hidden = false;
}

function renderAll(force = false) {
  if (!state.sim) return;
  renderFleet();
  renderTasks();
  renderLog();
  renderMetrics();
  if (force || state.sim.finished) renderResult();
}

function withAlpha(hex, alpha) {
  const normalized = hex.replace("#", "");
  const number = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, safeRadius);
}

function pointOnRing(geometry, s, radius = geometry.radius) {
  const angle = -Math.PI / 2 + (wrap(s, CONFIG.ringLength) / CONFIG.ringLength) * Math.PI * 2;
  return {
    x: geometry.cx + Math.cos(angle) * radius,
    y: geometry.cy + Math.sin(angle) * radius,
    angle
  };
}

function canvasGeometry() {
  const width = state.canvasWidth;
  const height = state.canvasHeight;
  const limit = Math.min(width / 2 - 82, width * 0.38, height * 0.375);
  return {
    width,
    height,
    cx: width / 2,
    cy: height * 0.52,
    radius: Math.max(72, limit)
  };
}

function drawBackground(ctx, geometry, now) {
  const { width, height, cx, cy, radius } = geometry;
  ctx.clearRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.5);
  glow.addColorStop(0, "rgba(24, 91, 94, 0.13)");
  glow.addColorStop(0.58, "rgba(12, 52, 57, 0.04)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(87, 230, 255, 0.055)";
  ctx.lineWidth = 1;
  for (const scale of [0.56, 0.79, 1.2]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([3, 8]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 1.31, now * 0.00002, Math.PI * 2 + now * 0.00002);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "rgba(87, 230, 255, 0.07)";
  ctx.beginPath();
  ctx.moveTo(cx - radius * 1.4, cy);
  ctx.lineTo(cx + radius * 1.4, cy);
  ctx.moveTo(cx, cy - radius * 1.4);
  ctx.lineTo(cx, cy + radius * 1.4);
  ctx.stroke();

  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const inner = radius * 1.37;
    const outer = radius * (index % 6 === 0 ? 1.43 : 1.39);
    ctx.strokeStyle = index % 6 === 0 ? "rgba(87, 230, 255, 0.14)" : "rgba(87, 230, 255, 0.06)";
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

function drawHeat(ctx, geometry) {
  const sim = state.sim;
  const binAngle = (Math.PI * 2) / sim.heat.length;
  for (let index = 0; index < sim.heat.length; index += 1) {
    const heat = sim.heat[index];
    if (heat < 0.055) continue;
    const start = -Math.PI / 2 + index * binAngle;
    const alpha = Math.min(0.52, heat * 0.31);
    ctx.strokeStyle = `rgba(255, 88, 78, ${alpha})`;
    ctx.lineWidth = 36 + Math.min(15, heat * 13);
    ctx.shadowColor = `rgba(255, 79, 69, ${alpha})`;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(geometry.cx, geometry.cy, geometry.radius, start - 0.006, start + binAngle + 0.006);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "#092028";
  ctx.lineWidth = 29;
  ctx.beginPath();
  ctx.arc(geometry.cx, geometry.cy, geometry.radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawRail(ctx, geometry, now) {
  const { cx, cy, radius } = geometry;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(101, 211, 220, 0.17)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 14.5, 0, Math.PI * 2);
  ctx.arc(cx, cy, radius + 14.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([10, 12]);
  ctx.lineDashOffset = -now * 0.004;
  ctx.strokeStyle = "rgba(87, 230, 255, 0.10)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * Math.PI * 2 + now * 0.000012;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.fillStyle = "rgba(87, 230, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(-3, -10);
    ctx.lineTo(4, -10);
    ctx.lineTo(0.5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function drawStations(ctx, geometry) {
  const sim = state.sim;
  ctx.textAlign = "center";
  for (const line of LINES) {
    const point = pointOnRing(geometry, line.s);
    const labelPoint = pointOnRing(geometry, line.s, geometry.radius + 39);
    const busy = sim.dockOwners[line.id.charCodeAt(0) - 65];
    const queueLength = sim.vehicles.filter((vehicle) => vehicle.waitingDock === line.id.charCodeAt(0) - 65).length;

    ctx.strokeStyle = withAlpha(line.color, 0.46);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(labelPoint.x, labelPoint.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle + Math.PI / 2);
    ctx.fillStyle = withAlpha(line.color, 0.2);
    roundedRect(ctx, -22, -14, 44, 28, 6);
    ctx.fill();
    ctx.strokeStyle = withAlpha(line.color, 0.72);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    const width = 84;
    const height = 43;
    roundedRect(ctx, labelPoint.x - width / 2, labelPoint.y - height / 2, width, height, 8);
    ctx.fillStyle = busy === null ? "rgba(6, 21, 25, 0.88)" : withAlpha(line.color, 0.12);
    ctx.fill();
    ctx.strokeStyle = withAlpha(line.color, busy === null ? 0.22 : 0.54);
    ctx.stroke();
    ctx.fillStyle = line.color;
    ctx.font = "600 10px 'IBM Plex Mono', 'Noto Sans SC', monospace";
    ctx.fillText(`${line.id} / ${line.name}`, labelPoint.x, labelPoint.y - 5);
    ctx.fillStyle = queueLength > 0 ? "#ffbe5c" : "#617f85";
    ctx.font = "9px 'Noto Sans SC', sans-serif";
    ctx.fillText(queueLength > 0 ? `停靠队列 ${queueLength}` : "停靠位空闲", labelPoint.x, labelPoint.y + 10);
    state.hits.push({
      kind: "station",
      id: line.id,
      x: labelPoint.x,
      y: labelPoint.y,
      r: 46,
      text: `${line.name} · ${queueLength > 0 ? `${queueLength} 辆排队` : "停靠位空闲"}`
    });
  }
}

function drawChargingBay(ctx, geometry) {
  const point = pointOnRing(geometry, CONFIG.chargerS);
  const labelPoint = pointOnRing(geometry, CONFIG.chargerS, geometry.radius + 41);
  const occupied = state.sim.chargerOwners.filter(Boolean).length;

  ctx.strokeStyle = "rgba(85, 230, 193, 0.45)";
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(labelPoint.x, labelPoint.y);
  ctx.stroke();

  roundedRect(ctx, labelPoint.x - 40, labelPoint.y - 18, 80, 36, 7);
  ctx.fillStyle = "rgba(7, 29, 28, 0.88)";
  ctx.fill();
  ctx.strokeStyle = "rgba(85, 230, 193, 0.26)";
  ctx.stroke();
  ctx.fillStyle = "#55e6c1";
  ctx.font = "600 9px 'IBM Plex Mono', 'Noto Sans SC', monospace";
  ctx.textAlign = "center";
  ctx.fillText("CHARGE / POWER", labelPoint.x, labelPoint.y - 4);
  ctx.fillStyle = "#6f9e96";
  ctx.font = "9px 'Noto Sans SC', sans-serif";
  ctx.fillText(`${occupied} / ${CONFIG.chargerSlots} 位占用`, labelPoint.x, labelPoint.y + 10);
  state.hits.push({
    kind: "charger",
    id: "charger",
    x: labelPoint.x,
    y: labelPoint.y,
    r: 42,
    text: `充电区 · ${occupied}/${CONFIG.chargerSlots} 位占用`
  });

  for (let slot = 0; slot < CONFIG.chargerSlots; slot += 1) {
    const slotPoint = pointOnRing(geometry, CONFIG.chargerS + slot * 5 - 2.5, geometry.radius - 9);
    ctx.fillStyle = state.sim.chargerOwners[slot] ? "rgba(85, 230, 193, 0.24)" : "rgba(85, 230, 193, 0.06)";
    ctx.strokeStyle = "rgba(85, 230, 193, 0.4)";
    roundedRect(ctx, slotPoint.x - 7, slotPoint.y - 7, 14, 14, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#55e6c1";
    ctx.font = "600 8px 'IBM Plex Mono', 'Noto Sans SC', monospace";
    ctx.fillText("ϟ", slotPoint.x, slotPoint.y + 3);
  }
}

function drawTaskMarkers(ctx, geometry) {
  const sim = state.sim;
  const groups = new Map();
  for (const task of sim.waitingTasks) {
    if (!groups.has(task.originIndex)) groups.set(task.originIndex, []);
    groups.get(task.originIndex).push(task);
  }

  for (const [originIndex, tasks] of groups) {
    const line = LINES[originIndex];
    const baseRadius = geometry.radius * 0.55;
    tasks.forEach((task, index) => {
      const offset = (index - (tasks.length - 1) / 2) * 0.13;
      const angle = -Math.PI / 2 + (line.s / CONFIG.ringLength) * Math.PI * 2 + offset;
      const radius = baseRadius + (index % 2) * 24;
      const x = geometry.cx + Math.cos(angle) * radius;
      const y = geometry.cy + Math.sin(angle) * radius;
      const station = pointOnRing(geometry, line.s);
      const width = 72;
      const height = 24;

      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = withAlpha(line.color, 0.25);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(station.x, station.y);
      ctx.stroke();
      ctx.setLineDash([]);

      roundedRect(ctx, x - width / 2, y - height / 2, width, height, 5);
      ctx.fillStyle = "rgba(26, 25, 19, 0.86)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 190, 92, 0.44)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#ffbe5c";
      ctx.textAlign = "left";
      ctx.font = "600 8px 'IBM Plex Mono', 'Noto Sans SC', monospace";
      ctx.fillText(task.id, x - width / 2 + 7, y + 3.5);
      ctx.fillStyle = "#8ba2a5";
      ctx.font = "8px 'IBM Plex Mono', 'Noto Sans SC', monospace";
      ctx.fillText(`→ ${task.destination}`, x + 7, y + 3.5);
      state.hits.push({
        kind: "task",
        id: task.id,
        x,
        y,
        r: 18,
        text: `${task.id} · ${task.origin}→${task.destination} · ${task.cargo}，拖动卡片派单`
      });
    });
  }
}

function drawVehicleRoutes(ctx, geometry) {
  for (const vehicle of state.sim.vehicles) {
    if (vehicle.state === "depleted" || vehicle.targetS === null || vehicle.routeRemaining <= 0) continue;
    const selected = vehicle.id === state.selectedVehicleId;
    if (!selected && !state.autoEnabled && !vehicle.activeTask) continue;
    const route = routeBetween(vehicle.s, vehicle.targetS);
    const start = -Math.PI / 2 + (vehicle.s / CONFIG.ringLength) * Math.PI * 2;
    const end = -Math.PI / 2 + (vehicle.targetS / CONFIG.ringLength) * Math.PI * 2;
    ctx.setLineDash([4, 7]);
    ctx.lineDashOffset = -performance.now() * 0.008;
    ctx.strokeStyle = withAlpha(vehicle.color, selected ? 0.62 : 0.2);
    ctx.lineWidth = selected ? 2 : 1;
    ctx.beginPath();
    ctx.arc(
      geometry.cx,
      geometry.cy,
      geometry.radius,
      start,
      end,
      route.direction < 0
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawVehicles(ctx, geometry, now) {
  const sim = state.sim;
  for (const vehicle of sim.vehicles) {
    const laneOffset = (vehicle.index - 2) * 2.2;
    const point = pointOnRing(geometry, vehicle.s, geometry.radius + laneOffset);
    const faulted = vehicle.faultUntil > sim.time;
    const depleted = vehicle.state === "depleted";
    const selected = state.selectedVehicleId === vehicle.id;
    const pulse = 0.5 + Math.sin(now * 0.006 + vehicle.index) * 0.5;

    if (selected || faulted || vehicle.state === "charging") {
      ctx.strokeStyle = faulted
        ? `rgba(255, 190, 92, ${0.25 + pulse * 0.32})`
        : withAlpha(vehicle.color, 0.28 + pulse * 0.26);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 19 + pulse * 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle + Math.PI / 2 + (vehicle.routeDirection < 0 ? Math.PI : 0));
    ctx.globalAlpha = depleted ? 0.38 : 1;
    ctx.shadowColor = withAlpha(vehicle.color, 0.5);
    ctx.shadowBlur = 10;
    roundedRect(ctx, -14, -8, 28, 16, 5);
    ctx.fillStyle = withAlpha(vehicle.color, 0.19);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = depleted ? "#51656a" : withAlpha(vehicle.color, 0.92);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = depleted ? "#60757a" : vehicle.color;
    ctx.font = "600 8px 'IBM Plex Mono', 'Noto Sans SC', monospace";
    ctx.textAlign = "center";
    ctx.fillText(vehicle.id.slice(-2), 0, 2.5);

    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(-10, 10, 20, 2.5);
    ctx.fillStyle = vehicle.battery < 20 ? "#ff5f70" : vehicle.battery < 38 ? "#ffbe5c" : "#55e6c1";
    ctx.fillRect(-10, 10, 20 * (vehicle.battery / 100), 2.5);
    ctx.restore();

    if (faulted) {
      ctx.fillStyle = "#ffbe5c";
      ctx.font = "600 10px 'IBM Plex Mono', 'Noto Sans SC', monospace";
      ctx.textAlign = "center";
      ctx.fillText("!", point.x + 13, point.y - 11);
    }

    state.hits.push({
      kind: "vehicle",
      id: vehicle.id,
      x: point.x,
      y: point.y,
      r: 18,
      text: `${vehicle.id} · ${vehicleStateLabel(vehicle)} · 电量 ${Math.round(vehicle.battery)}%`
    });
  }
}

function drawCenterHud(ctx, geometry) {
  const sim = state.sim;
  const completed = sim.completedTasks.length;
  const x = geometry.cx;
  const y = geometry.cy;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(5, 19, 23, 0.86)";
  roundedRect(ctx, -55, -36, 110, 72, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(87, 230, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#5f7f85";
  ctx.font = "8px 'IBM Plex Mono', 'Noto Sans SC', monospace";
  ctx.fillText("NETWORK FLOW", 0, -18);
  ctx.fillStyle = "#ecfbfb";
  ctx.font = "600 24px 'IBM Plex Mono', 'Noto Sans SC', monospace";
  ctx.fillText(`${completed}`, -5, 10);
  ctx.fillStyle = "#55747a";
  ctx.font = "10px 'IBM Plex Mono', 'Noto Sans SC', monospace";
  ctx.fillText(`/${sim.tasks.length}`, 23, 10);
  ctx.fillStyle = "#55e6c1";
  ctx.font = "8px 'Noto Sans SC', sans-serif";
  ctx.fillText(`目标 ${sim.requiredCompleted} 件`, 0, 26);
  ctx.restore();
}

function drawScene(now = performance.now()) {
  if (!state.sim || !state.canvasWidth || !state.canvasHeight) return;
  const ctx = dom.canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.hits = [];
  const geometry = canvasGeometry();
  drawBackground(ctx, geometry, now);
  drawHeat(ctx, geometry);
  drawRail(ctx, geometry, now);
  drawVehicleRoutes(ctx, geometry);
  drawStations(ctx, geometry);
  drawChargingBay(ctx, geometry);
  drawTaskMarkers(ctx, geometry);
  drawCenterHud(ctx, geometry);
  drawVehicles(ctx, geometry, now);
  updateTooltip();
}

function updateTooltip() {
  const tooltip = dom.tooltip;
  if (!state.hoverPointer) {
    tooltip.style.display = "none";
    return;
  }
  const { x, y } = state.hoverPointer;
  let closest = null;
  let closestDistance = Infinity;
  for (const hit of state.hits) {
    const distance = Math.hypot(hit.x - x, hit.y - y);
    if (distance <= hit.r && distance < closestDistance) {
      closest = hit;
      closestDistance = distance;
    }
  }
  if (!closest) {
    tooltip.style.display = "none";
    return;
  }
  tooltip.textContent = closest.text;
  tooltip.style.display = "block";
  const maxX = state.canvasWidth - 230;
  tooltip.style.left = `${Math.min(maxX, x + 14)}px`;
  tooltip.style.top = `${Math.max(8, y - 12)}px`;
}

function selectVehicle(vehicleId) {
  state.selectedVehicleId = state.selectedVehicleId === vehicleId ? null : vehicleId;
  state.lastFleetSignature = "";
  renderFleet();
}

function isDropTarget(target) {
  return target instanceof Element ? target.closest(".fleet-card") : null;
}

function bindDnD() {
  dom.taskList.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".task-card");
    if (!card) return;
    state.dragTaskId = card.dataset.task;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.dragTaskId);
    requestAnimationFrame(() => card.classList.add("dragging"));
  });

  dom.taskList.addEventListener("dragend", () => {
    state.dragTaskId = null;
    document.querySelectorAll(".task-card.dragging").forEach((card) => card.classList.remove("dragging"));
    document.querySelectorAll(".fleet-card.drop-ready, .fleet-card.drop-hover")
      .forEach((card) => card.classList.remove("drop-ready", "drop-hover"));
  });

  dom.taskList.addEventListener("click", (event) => {
    const card = event.target.closest(".task-card");
    if (!card) return;
    const taskId = card.dataset.task;
    if (state.selectedTaskId === taskId) {
      state.selectedTaskId = null;
    } else {
      state.selectedTaskId = taskId;
      state.selectedVehicleId = null;
      toast("已选中任务，再点击一辆搬运车完成派单");
    }
    state.lastTaskSignature = "";
    state.lastFleetSignature = "";
    renderAll(true);
  });

  dom.fleetList.addEventListener("dragover", (event) => {
    const card = isDropTarget(event.target);
    if (!card || !state.dragTaskId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    document.querySelectorAll(".fleet-card.drop-hover")
      .forEach((item) => item.classList.remove("drop-hover"));
    card.classList.add("drop-hover");
  });

  dom.fleetList.addEventListener("dragleave", (event) => {
    const card = isDropTarget(event.target);
    if (!card || card.contains(event.relatedTarget)) return;
    card.classList.remove("drop-hover");
  });

  dom.fleetList.addEventListener("drop", (event) => {
    const card = isDropTarget(event.target);
    if (!card) return;
    event.preventDefault();
    const taskId = state.dragTaskId || event.dataTransfer.getData("text/plain");
    if (taskId) assignTask(taskId, card.dataset.vehicle);
    state.dragTaskId = null;
    card.classList.remove("drop-hover");
  });

  dom.fleetList.addEventListener("click", (event) => {
    const priorityButton = event.target.closest("[data-action='priority']");
    if (priorityButton) {
      const { vehicle, kind, value } = priorityButton.dataset;
      state.sim.setPriority(vehicle, kind, Number(value));
      state.lastFleetSignature = "";
      renderFleet();
      return;
    }
    const card = isDropTarget(event.target);
    if (!card) return;
    if (state.selectedTaskId) {
      assignTask(state.selectedTaskId, card.dataset.vehicle);
      return;
    }
    selectVehicle(card.dataset.vehicle);
  });

  dom.fleetList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = isDropTarget(event.target);
    if (!card) return;
    event.preventDefault();
    if (state.selectedTaskId) assignTask(state.selectedTaskId, card.dataset.vehicle);
    else selectVehicle(card.dataset.vehicle);
  });
}

function resizeCanvas() {
  const rect = dom.canvas.parentElement.getBoundingClientRect();
  const width = Math.max(320, rect.width);
  const height = Math.max(320, rect.height);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = `${Math.round(width)}x${Math.round(height)}@${dpr}`;
  if (size === state.lastCanvasSize) return;
  state.lastCanvasSize = size;
  state.canvasWidth = width;
  state.canvasHeight = height;
  dom.canvas.width = Math.round(width * dpr);
  dom.canvas.height = Math.round(height * dpr);
}

function bindControls() {
  dom.newRunBtn.addEventListener("click", () => {
    createSimulation({ seed: seedFromInput() });
    toast(`新一局已启动 · seed ${state.sim.seed}`);
  });

  dom.pauseBtn.addEventListener("click", () => {
    if (state.sim.finished) return;
    state.paused = !state.paused;
    dom.pauseIcon.textContent = state.paused ? "▶" : "Ⅱ";
    dom.pauseBtn.classList.toggle("active", state.paused);
    toast(state.paused ? "仿真已暂停" : "仿真继续");
  });

  dom.speedSelect.addEventListener("change", () => {
    state.speed = Number(dom.speedSelect.value);
  });

  dom.autoDispatchBtn.addEventListener("click", () => {
    updateAutoMode();
    if (state.autoEnabled) dispatchAuto(state.sim, state.demoPolicy ?? {});
  });

  dom.successDemoBtn.addEventListener("click", () => startDemo("success"));
  dom.failureDemoBtn.addEventListener("click", () => startDemo("failure"));
  dom.replayBtn.addEventListener("click", replayCurrentRun);
  dom.closeResultBtn.addEventListener("click", () => {
    dom.resultOverlay.hidden = true;
  });

  dom.canvas.addEventListener("mousemove", (event) => {
    const rect = dom.canvas.getBoundingClientRect();
    state.hoverPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  });
  dom.canvas.addEventListener("mouseleave", () => {
    state.hoverPointer = null;
  });
  dom.canvas.addEventListener("click", (event) => {
    const rect = dom.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const vehicleHit = state.hits
      .filter((hit) => hit.kind === "vehicle")
      .find((hit) => Math.hypot(hit.x - x, hit.y - y) <= hit.r + 5);
    if (vehicleHit) {
      state.lastFleetSignature = "";
      selectVehicle(vehicleHit.id);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      dom.pauseBtn.click();
    }
  });

  window.addEventListener("resize", resizeCanvas);
  new ResizeObserver(resizeCanvas).observe(dom.canvas.parentElement);
}

function frame(now) {
  const elapsed = state.lastFrame ? Math.min(0.12, (now - state.lastFrame) / 1000) : 0;
  state.lastFrame = now;
  const sim = state.sim;

  if (sim && !state.paused && !sim.finished) {
    const simDelta = elapsed * state.speed;
    advanceSimulation(simDelta);
    if (now - state.lastUiRender > 90 || sim.finished) {
      renderAll(sim.finished);
      state.lastUiRender = now;
    }
  } else if (sim && now - state.lastUiRender > 250) {
    renderAll(false);
    state.lastUiRender = now;
  }

  drawScene(now);
  requestAnimationFrame(frame);
}

function advanceSimulation(delta) {
  const sim = state.sim;
  let remaining = Math.max(0, delta);
  let guard = 0;
  while (remaining > 1e-7 && !sim.finished && guard < 200) {
    if (state.autoEnabled && sim.time + 1e-7 >= state.nextDispatchAt) {
      dispatchAuto(sim, state.demoPolicy ?? {});
      state.nextDispatchAt += 0.5;
    }
    let chunk = remaining;
    if (state.autoEnabled) {
      chunk = Math.min(chunk, Math.max(0.001, state.nextDispatchAt - sim.time));
    }
    sim.advance(chunk);
    remaining -= chunk;
    guard += 1;
  }
  if (state.autoEnabled && !sim.finished && sim.time + 1e-7 >= state.nextDispatchAt) {
    dispatchAuto(sim, state.demoPolicy ?? {});
    state.nextDispatchAt += 0.5;
  }
}

function init() {
  bindDnD();
  bindControls();
  resizeCanvas();
  createSimulation({ seed: "RING-305" });
  renderAll(true);
  requestAnimationFrame((now) => {
    state.lastFrame = now;
    state.lastUiRender = now;
    frame(now);
  });
}

init();
