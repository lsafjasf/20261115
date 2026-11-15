export const CONFIG = Object.freeze({
  duration: 180,
  waveInterval: 60,
  tasksPerWave: 3,
  waveCount: 3,
  ringLength: 360,
  vehicleCount: 5,
  vehicleSpeed: 18,
  vehicleQueueLimit: 3,
  loadingTime: 4,
  unloadingTime: 3,
  batteryMax: 100,
  moveDrainPerSecond: 0.52,
  idleDrainPerSecond: 0.018,
  faultDrainPerSecond: 0.08,
  chargeRate: [3.2, 5.2, 7.6],
  chargeThreshold: [15, 30, 46],
  reserveBattery: 30,
  successRatio: 0.8,
  clearChargeLevel: 88,
  chargerS: 330,
  chargerSlots: 2,
  safeGap: 11,
  fixedStep: 0.1
});

export const LINES = Object.freeze([
  { id: "A", name: "一号线", short: "A", color: "#57e6ff", s: 18, angle: -Math.PI / 2 },
  { id: "B", name: "二号线", short: "B", color: "#ffbe5c", s: 137, angle: -Math.PI / 2 + 0.333 * Math.PI * 2 },
  { id: "C", name: "三号线", short: "C", color: "#ff6c9d", s: 256, angle: -Math.PI / 2 + 0.666 * Math.PI * 2 }
]);

export const PRIORITY_NAMES = Object.freeze(["低", "标准", "高"]);

const CARGO = [
  ["冷链箱", "cold"],
  ["精密件", "precision"],
  ["标准托", "standard"],
  ["急件包", "urgent"],
  ["原料卷", "raw"]
];

const FAULTS = ["导轮异响", "定位丢失", "货叉卡滞", "通讯中断", "电机过热"];
const VEHICLE_COLORS = ["#55e6c1", "#6cb8ff", "#ffd166", "#ff7a90", "#c49bff"];

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let state = hashSeed(seed);
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function wrap(value, max = CONFIG.ringLength) {
  return ((value % max) + max) % max;
}

export function clockwiseDelta(from, to) {
  return wrap(to - from);
}

export function routeBetween(from, to) {
  const clockwise = clockwiseDelta(from, to);
  if (clockwise <= CONFIG.ringLength / 2) {
    return { distance: clockwise, direction: 1 };
  }
  return { distance: CONFIG.ringLength - clockwise, direction: -1 };
}

export function completeRoute(from, to, distance = Infinity) {
  const route = routeBetween(from, to);
  return route.distance <= distance ? route : { distance: Infinity, direction: route.direction };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function generateTasks(seed) {
  const random = mulberry32(`${seed}:task-sequence:v1`);
  const tasks = [];
  let sequence = 1;

  for (let wave = 0; wave < CONFIG.waveCount; wave += 1) {
    const origins = [0, 1, 2];
    for (let index = origins.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [origins[index], origins[swap]] = [origins[swap], origins[index]];
    }
    for (let index = 0; index < CONFIG.tasksPerWave; index += 1) {
      const originIndex = origins[index];
      const destinationOffset = random() < 0.58 ? 1 : 2;
      const destinationIndex = (originIndex + destinationOffset) % LINES.length;
      const cargo = CARGO[Math.floor(random() * CARGO.length)];
      const loadFactor = random();
      const serviceTime = 3.2 + loadFactor * 2.8;
      tasks.push({
        id: `T-${String(sequence).padStart(2, "0")}`,
        sequence,
        wave,
        revealAt: wave * CONFIG.waveInterval,
        originIndex,
        destinationIndex,
        origin: LINES[originIndex].id,
        destination: LINES[destinationIndex].id,
        cargo: cargo[0],
        cargoType: cargo[1],
        pickupS: LINES[originIndex].s,
        dropoffS: LINES[destinationIndex].s,
        serviceTime,
        visible: false,
        stage: "hidden",
        assignedVehicle: null,
        assignedAt: null,
        completedAt: null,
        attempt: 0
      });
      sequence += 1;
    }
  }

  return tasks;
}

function generateIncidents(seed, count = 2) {
  const random = mulberry32(`${seed}:incident-sequence:v1`);
  const incidents = [];
  const baseWindows = [
    [34, 52],
    [93, 116],
    [151, 171]
  ];

  for (let index = 0; index < count; index += 1) {
    const window = baseWindows[index % baseWindows.length];
    incidents.push({
      id: `F-${index + 1}`,
      at: window[0] + random() * (window[1] - window[0]),
      vehicleIndex: Math.floor(random() * CONFIG.vehicleCount),
      duration: 8 + random() * 10,
      reason: FAULTS[Math.floor(random() * FAULTS.length)],
      applied: false
    });
  }

  return incidents.sort((a, b) => a.at - b.at);
}

function makeVehicle(index, seed, initialBattery) {
  const random = mulberry32(`${seed}:fleet:${index}:v1`);
  const battery = initialBattery ?? 58 + random() * 18;
  return {
    id: `AGV-${String(index + 1).padStart(2, "0")}`,
    index,
    name: `搬运车 ${String(index + 1).padStart(2, "0")}`,
    color: VEHICLE_COLORS[index],
    s: wrap(CONFIG.chargerS + (index - 2) * 7.5),
    speed: CONFIG.vehicleSpeed,
    battery,
    initialBattery: battery,
    state: "idle",
    activeTask: null,
    queue: [],
    targetS: null,
    routeRemaining: 0,
    routeDirection: 1,
    waitingDock: null,
    waitingSince: null,
    waitingCharger: false,
    chargerSlot: null,
    serviceRemaining: 0,
    faultUntil: 0,
    faultReason: "",
    odometer: 0,
    distanceSinceCharge: 0,
    completed: 0,
    priorities: {
      docking: 1,
      charging: 1,
      avoidance: 1
    }
  };
}

export class CargoSimulation {
  constructor({
    seed = "RING-305",
    initialBattery = null,
    incidentCount = 2
  } = {}) {
    this.seed = String(seed);
    this.time = 0;
    this.advanceRemainder = 0;
    this.finished = false;
    this.result = null;
    this.tasks = generateTasks(this.seed);
    this.taskById = new Map(this.tasks.map((task) => [task.id, task]));
    this.incidents = generateIncidents(this.seed, incidentCount);
    this.vehicles = Array.from(
      { length: CONFIG.vehicleCount },
      (_, index) => makeVehicle(index, this.seed, initialBattery)
    );
    this.vehicleById = new Map(this.vehicles.map((vehicle) => [vehicle.id, vehicle]));
    this.dockOwners = [null, null, null];
    this.chargerOwners = Array(CONFIG.chargerSlots).fill(null);
    this.heat = Array(72).fill(0);
    this.events = [];
    this.revealedWaves = 0;
    this.completedCount = 0;
    this.revealNextWave();
  }

  emit(type, message, vehicleId = null) {
    this.events.push({
      id: this.events.length + 1,
      at: this.time,
      type,
      message,
      vehicleId
    });
    if (this.events.length > 220) this.events.shift();
  }

  revealNextWave() {
    if (this.revealedWaves >= CONFIG.waveCount) return;
    const wave = this.revealedWaves;
    const revealed = this.tasks.filter((task) => task.wave === wave);
    for (const task of revealed) {
      task.visible = true;
      task.stage = "waiting";
    }
    this.revealedWaves += 1;
    this.emit("wave", `第 ${wave + 1} 波任务入库：${revealed.length} 件`);
  }

  get waitingTasks() {
    return this.tasks.filter((task) => task.visible && task.stage === "waiting" && task.revealAt <= this.time);
  }

  get visibleTasks() {
    return this.tasks.filter((task) => task.visible);
  }

  get completedTasks() {
    return this.tasks.filter((task) => task.stage === "done");
  }

  get requiredCompleted() {
    return Math.ceil(this.tasks.length * CONFIG.successRatio);
  }

  get reserveVehicles() {
    return this.vehicles.filter((vehicle) => (
      vehicle.state === "idle" &&
      !vehicle.activeTask &&
      vehicle.queue.length === 0 &&
      vehicle.battery >= CONFIG.reserveBattery &&
      vehicle.faultUntil <= this.time
    ));
  }

  get activeVehicleCount() {
    return this.vehicles.filter((vehicle) => (
      vehicle.activeTask || vehicle.queue.length > 0 || vehicle.state === "charging"
    )).length;
  }

  get lowBatteryVehicle() {
    return this.vehicles
      .filter((vehicle) => vehicle.state !== "depleted" && vehicle.battery < 24)
      .sort((a, b) => a.battery - b.battery)[0] ?? null;
  }

  setPriority(vehicleId, kind, value) {
    const vehicle = this.vehicleById.get(vehicleId);
    const priority = clamp(Math.round(Number(value)), 0, 2);
    if (!vehicle || !["docking", "charging", "avoidance"].includes(kind)) return false;
    vehicle.priorities[kind] = priority;
    return true;
  }

  assignTask(taskId, vehicleId) {
    if (this.finished) return { ok: false, reason: "本局已经结束" };
    const task = this.taskById.get(taskId);
    const vehicle = this.vehicleById.get(vehicleId);
    if (!task || !vehicle) return { ok: false, reason: "任务或车辆不存在" };
    if (!task.visible || task.stage !== "waiting") {
      return { ok: false, reason: "该任务已经被分配" };
    }
    if (vehicle.state === "depleted") return { ok: false, reason: "车辆电量耗尽" };
    if (vehicle.queue.length >= CONFIG.vehicleQueueLimit) {
      return { ok: false, reason: "车辆任务队列已满" };
    }

    task.stage = "assigned";
    task.assignedVehicle = vehicle.id;
    task.assignedAt = this.time;
    vehicle.queue.push(task.id);
    this.emit("assign", `${task.id} 已派给 ${vehicle.id}`, vehicle.id);

    if (!vehicle.activeTask) this.startNextTask(vehicle);
    return { ok: true };
  }

  startNextTask(vehicle) {
    if (vehicle.activeTask || vehicle.queue.length === 0 || vehicle.state === "depleted") return;
    if (vehicle.state === "charging" || vehicle.state === "to_charger" || vehicle.waitingCharger) return;
    const task = this.taskById.get(vehicle.queue[0]);
    if (!task) {
      vehicle.queue.shift();
      return;
    }

    vehicle.activeTask = task.id;
    vehicle.state = "to_pickup";
    const route = routeBetween(vehicle.s, task.pickupS);
    vehicle.targetS = task.pickupS;
    vehicle.routeRemaining = route.distance;
    vehicle.routeDirection = route.direction;
    vehicle.waitingDock = null;
    vehicle.waitingSince = null;
    task.stage = "to_pickup";
    this.emit("pickup", `${vehicle.id} 前往 ${task.origin} 线提取 ${task.id}`, vehicle.id);
  }

  update(dt = CONFIG.fixedStep) {
    if (this.finished) return;
    const safeDt = clamp(Number(dt) || 0, 0, 0.25);
    if (safeDt <= 0) return;
    this.time = Math.min(CONFIG.duration, Math.round((this.time + safeDt) * 1e6) / 1e6);

    this.applyIncidents();
    const nextWaveAt = this.revealedWaves * CONFIG.waveInterval;
    if (this.revealedWaves < CONFIG.waveCount && this.time >= nextWaveAt) {
      this.revealNextWave();
    }

    for (const vehicle of this.vehicles) this.updateVehicle(vehicle, safeDt);
    this.updateDockQueues();
    this.updateChargerQueues();
    this.updateHeat(safeDt);

    if (this.vehicles.every((vehicle) => vehicle.state === "depleted")) {
      this.finish("failure", "五辆搬运车全部电量耗尽，货站停摆");
      return;
    }
    if (this.time >= CONFIG.duration) this.evaluateDeadline();
  }

  advance(seconds) {
    this.advanceRemainder += Math.max(0, seconds);
    while (this.advanceRemainder + 1e-9 >= CONFIG.fixedStep && !this.finished) {
      this.update(CONFIG.fixedStep);
      this.advanceRemainder -= CONFIG.fixedStep;
    }
    if (this.advanceRemainder < 1e-6) this.advanceRemainder = 0;
    return this.result;
  }

  applyIncidents() {
    for (const incident of this.incidents) {
      if (incident.applied || incident.at > this.time) continue;
      incident.applied = true;
      const vehicle = this.vehicles[incident.vehicleIndex];
      if (!vehicle || vehicle.state === "depleted") continue;
      vehicle.faultUntil = Math.max(vehicle.faultUntil, this.time + incident.duration);
      vehicle.faultReason = incident.reason;
      this.emit(
        "fault",
        `${vehicle.id} 发生${incident.reason}，预计停摆 ${Math.round(incident.duration)} 秒`,
        vehicle.id
      );
    }
  }

  updateVehicle(vehicle, dt) {
    if (vehicle.state === "depleted") {
      this.drainBattery(vehicle, CONFIG.idleDrainPerSecond * dt);
      return;
    }

    if (vehicle.faultUntil > this.time) {
      this.drainBattery(vehicle, CONFIG.faultDrainPerSecond * dt);
      return;
    }
    if (vehicle.faultUntil > 0 && vehicle.faultUntil <= this.time) {
      this.emit("recover", `${vehicle.id} 故障排除，恢复运行`, vehicle.id);
      vehicle.faultUntil = 0;
      vehicle.faultReason = "";
    }

    if (vehicle.state === "loading" || vehicle.state === "unloading") {
      vehicle.serviceRemaining -= dt;
      this.drainBattery(vehicle, CONFIG.idleDrainPerSecond * dt);
      if (vehicle.serviceRemaining <= 0) this.finishService(vehicle);
      return;
    }

    if (vehicle.state === "charging") {
      const rate = CONFIG.chargeRate[vehicle.priorities.charging];
      vehicle.battery = Math.min(CONFIG.batteryMax, vehicle.battery + rate * dt);
      if (vehicle.battery >= CONFIG.clearChargeLevel) {
        this.emit("charge", `${vehicle.id} 补电完成，电量 ${Math.round(vehicle.battery)}%`, vehicle.id);
        this.releaseCharger(vehicle);
      }
      return;
    }

    if (vehicle.waitingDock !== null || vehicle.waitingCharger) {
      this.drainBattery(vehicle, CONFIG.idleDrainPerSecond * dt);
      return;
    }

    if (vehicle.state === "idle") {
      if (vehicle.queue.length > 0) {
        this.startNextTask(vehicle);
        return;
      }
      const threshold = CONFIG.chargeThreshold[vehicle.priorities.charging];
      if (vehicle.battery < threshold) {
        this.startChargingTrip(vehicle);
        return;
      }
      this.drainBattery(vehicle, CONFIG.idleDrainPerSecond * dt);
      return;
    }

    if (vehicle.state === "to_charger") {
      this.moveVehicle(vehicle, dt, "charger");
      return;
    }

    if (vehicle.state === "to_pickup" || vehicle.state === "to_dropoff") {
      this.moveVehicle(vehicle, dt, vehicle.state === "to_pickup" ? "pickup" : "dropoff");
    }
  }

  moveVehicle(vehicle, dt, arrivalKind) {
    if (vehicle.routeRemaining <= 0) {
      this.arriveAtTarget(vehicle, arrivalKind);
      return;
    }

    let speedFactor = 1;
    const bin = Math.round((vehicle.s / CONFIG.ringLength) * this.heat.length) % this.heat.length;
    const localHeat = Math.max(
      this.heat[bin],
      this.heat[(bin + 1) % this.heat.length] * 0.7,
      this.heat[(bin - 1 + this.heat.length) % this.heat.length] * 0.7
    );
    if (localHeat > 0.2) speedFactor *= 1 - Math.min(0.42, (localHeat - 0.2) * 0.52);
    if (vehicle.battery < 15) speedFactor *= 0.62;

    for (const other of this.vehicles) {
      if (other === vehicle || other.state === "depleted") continue;
      const ahead = wrap((other.s - vehicle.s) * vehicle.routeDirection, CONFIG.ringLength);
      if (ahead <= 0 || ahead >= CONFIG.safeGap) continue;
      if (ahead < 4) {
        speedFactor *= 0.06;
        continue;
      }
      const avoidFactor = [0.22, 0.42, 0.68][vehicle.priorities.avoidance];
      speedFactor *= avoidFactor;
    }

    const move = Math.min(vehicle.routeRemaining, vehicle.speed * speedFactor * dt);
    vehicle.routeRemaining -= move;
    vehicle.s = wrap(vehicle.s + vehicle.routeDirection * move);
    vehicle.odometer += move;
    vehicle.distanceSinceCharge += move;
    if (move > 0) {
      this.drainBattery(vehicle, CONFIG.moveDrainPerSecond * (move / Math.max(0.01, vehicle.speed * dt)) * dt);
    }
    if (vehicle.state === "depleted") return;
    if (vehicle.routeRemaining <= 0.001) {
      vehicle.s = vehicle.targetS;
      vehicle.routeRemaining = 0;
      this.arriveAtTarget(vehicle, arrivalKind);
    }
  }

  arriveAtTarget(vehicle, kind) {
    if (vehicle.state === "depleted") return;
    if (kind === "charger") {
      if (!vehicle.waitingCharger) {
        vehicle.waitingCharger = true;
        vehicle.waitingSince = this.time;
      }
      this.updateChargerQueues();
      return;
    }

    const task = this.taskById.get(vehicle.activeTask);
    if (!task) {
      vehicle.state = "idle";
      return;
    }
    const lineIndex = kind === "pickup" ? task.originIndex : task.destinationIndex;
    if (this.dockOwners[lineIndex] === null) {
      this.claimDock(vehicle, lineIndex, kind);
      return;
    }
    if (vehicle.waitingDock !== lineIndex) {
      vehicle.waitingDock = lineIndex;
      vehicle.waitingSince = this.time;
      this.emit("dock", `${vehicle.id} 在 ${LINES[lineIndex].id} 线排队停靠`, vehicle.id);
    }
  }

  claimDock(vehicle, lineIndex, kind) {
    const task = this.taskById.get(vehicle.activeTask);
    if (!task) return;
    this.dockOwners[lineIndex] = vehicle.id;
    vehicle.waitingDock = null;
    vehicle.waitingSince = null;
    if (kind === "pickup") {
      vehicle.state = "loading";
      vehicle.serviceRemaining = task.serviceTime;
      task.stage = "loading";
      this.emit("dock", `${vehicle.id} 停靠 ${task.origin} 线，开始装载 ${task.id}`, vehicle.id);
    } else {
      vehicle.state = "unloading";
      vehicle.serviceRemaining = CONFIG.unloadingTime;
      task.stage = "unloading";
      this.emit("dock", `${vehicle.id} 停靠 ${task.destination} 线，开始卸载 ${task.id}`, vehicle.id);
    }
  }

  finishService(vehicle) {
    const task = this.taskById.get(vehicle.activeTask);
    if (!task) {
      vehicle.state = "idle";
      return;
    }
    const wasPickup = vehicle.state === "loading";
    this.releaseDock(vehicle);

    if (wasPickup) {
      task.stage = "to_dropoff";
      const route = routeBetween(vehicle.s, task.dropoffS);
      vehicle.state = "to_dropoff";
      vehicle.targetS = task.dropoffS;
      vehicle.routeRemaining = route.distance;
      vehicle.routeDirection = route.direction;
      this.emit("transit", `${vehicle.id} 载货前往 ${task.destination} 线`, vehicle.id);
      return;
    }

    task.stage = "done";
    task.completedAt = this.time;
    vehicle.completed += 1;
    vehicle.activeTask = null;
    vehicle.queue = vehicle.queue.filter((id) => id !== task.id);
    if (vehicle.state !== "depleted") vehicle.state = "idle";
    this.emit("complete", `${task.id} 已交付至 ${task.destination} 线`, vehicle.id);
    if (vehicle.queue.length > 0) this.startNextTask(vehicle);
  }

  updateDockQueues() {
    for (let lineIndex = 0; lineIndex < this.dockOwners.length; lineIndex += 1) {
      const owner = this.vehicleById.get(this.dockOwners[lineIndex]);
      if (owner && !["loading", "unloading"].includes(owner.state)) {
        this.dockOwners[lineIndex] = null;
      }
      if (this.dockOwners[lineIndex] !== null) continue;
      const candidates = this.vehicles
        .filter((vehicle) => vehicle.waitingDock === lineIndex && vehicle.state !== "depleted")
        .sort((a, b) => (
          b.priorities.docking - a.priorities.docking ||
          (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity) ||
          a.id.localeCompare(b.id)
        ));
      const winner = candidates[0];
      if (!winner) continue;
      const kind = winner.state === "to_pickup" ? "pickup" : "dropoff";
      this.claimDock(winner, lineIndex, kind);
    }
  }

  startChargingTrip(vehicle) {
    if (vehicle.state === "depleted" || vehicle.waitingCharger) return;
    const route = routeBetween(vehicle.s, CONFIG.chargerS);
    vehicle.state = "to_charger";
    vehicle.targetS = CONFIG.chargerS;
    vehicle.routeRemaining = route.distance;
    vehicle.routeDirection = route.direction;
    vehicle.waitingCharger = false;
    this.emit("charge", `${vehicle.id} 电量 ${Math.round(vehicle.battery)}%，前往充电位`, vehicle.id);
  }

  updateChargerQueues() {
    for (let slot = 0; slot < this.chargerOwners.length; slot += 1) {
      const owner = this.vehicleById.get(this.chargerOwners[slot]);
      if (owner && owner.state !== "charging") this.chargerOwners[slot] = null;
      if (this.chargerOwners[slot] !== null) continue;
      const candidates = this.vehicles
        .filter((vehicle) => vehicle.waitingCharger && vehicle.state !== "depleted")
        .sort((a, b) => (
          b.priorities.charging - a.priorities.charging ||
          (a.waitingSince ?? Infinity) - (b.waitingSince ?? Infinity) ||
          a.id.localeCompare(b.id)
        ));
      const winner = candidates[0];
      if (!winner) continue;
      this.chargerOwners[slot] = winner.id;
      winner.chargerSlot = slot;
      winner.waitingCharger = false;
      winner.waitingSince = null;
      winner.state = "charging";
      this.emit("charge", `${winner.id} 接入 ${slot + 1} 号充电位`, winner.id);
    }
  }

  releaseCharger(vehicle) {
    if (vehicle.chargerSlot !== null) this.chargerOwners[vehicle.chargerSlot] = null;
    vehicle.chargerSlot = null;
    vehicle.waitingCharger = false;
    if (vehicle.state !== "depleted") vehicle.state = "idle";
    vehicle.routeRemaining = 0;
    vehicle.targetS = null;
  }

  releaseDock(vehicle) {
    for (let index = 0; index < this.dockOwners.length; index += 1) {
      if (this.dockOwners[index] === vehicle.id) this.dockOwners[index] = null;
    }
    vehicle.waitingDock = null;
  }

  drainBattery(vehicle, amount) {
    if (vehicle.state === "depleted" || amount <= 0) return;
    vehicle.battery = Math.max(0, vehicle.battery - amount);
    if (vehicle.battery <= 0) this.depleteVehicle(vehicle);
  }

  depleteVehicle(vehicle) {
    if (vehicle.state === "depleted") return;
    vehicle.battery = 0;
    vehicle.state = "depleted";
    this.releaseDock(vehicle);
    this.releaseCharger(vehicle);
    vehicle.state = "depleted";
    const assigned = [
      ...(vehicle.activeTask ? [vehicle.activeTask] : []),
      ...vehicle.queue
    ];
    for (const taskId of assigned) {
      const task = this.taskById.get(taskId);
      if (!task || task.stage === "done") continue;
      task.stage = "waiting";
      task.assignedVehicle = null;
      task.assignedAt = null;
      task.attempt += 1;
    }
    vehicle.queue = [];
    vehicle.activeTask = null;
    vehicle.routeRemaining = 0;
    vehicle.targetS = null;
    this.emit("empty", `${vehicle.id} 电量耗尽，任务退回待派区`, vehicle.id);
  }

  updateHeat(dt) {
    const decay = Math.max(0, 1 - dt * 0.22);
    for (let index = 0; index < this.heat.length; index += 1) {
      this.heat[index] *= decay;
    }
    for (const vehicle of this.vehicles) {
      if (vehicle.state === "depleted") continue;
      const bin = Math.round((vehicle.s / CONFIG.ringLength) * this.heat.length) % this.heat.length;
      const weight = vehicle.waitingDock !== null || vehicle.waitingCharger ? 1.8 : 0.52;
      this.heat[bin] = Math.min(1.8, this.heat[bin] + weight * dt);
    }
    for (let index = 0; index < this.dockOwners.length; index += 1) {
      const bin = Math.round((LINES[index].s / CONFIG.ringLength) * this.heat.length) % this.heat.length;
      const queueLength = this.vehicles.filter((vehicle) => vehicle.waitingDock === index).length;
      if (queueLength > 0) this.heat[bin] = Math.min(1.8, this.heat[bin] + queueLength * 0.45 * dt);
    }
  }

  evaluateDeadline() {
    if (this.finished) return;
    const completed = this.completedTasks.length;
    const required = this.requiredCompleted;
    const reserve = this.reserveVehicles.length;
    if (completed >= required && reserve >= 1) {
      this.finish("success", `完成 ${completed}/${this.tasks.length} 件，并保留 ${reserve} 辆备用车`);
      return;
    }
    if (completed < required) {
      const depleted = this.vehicles.filter((vehicle) => vehicle.state === "depleted").length;
      const suffix = depleted > 0 ? `，${depleted} 辆车电量耗尽` : "";
      this.finish("failure", `三分钟内仅完成 ${completed}/${required} 件任务${suffix}`);
      return;
    }
    this.finish("failure", "任务达标，但没有留下可用的备用车辆");
  }

  finish(status, reason) {
    if (this.finished) return;
    this.finished = true;
    this.result = {
      status,
      reason,
      seed: this.seed,
      time: this.time,
      completed: this.completedTasks.length,
      totalTasks: this.tasks.length,
      required: this.requiredCompleted,
      reserveVehicles: this.reserveVehicles.map((vehicle) => vehicle.id),
      depletedVehicles: this.vehicles
        .filter((vehicle) => vehicle.state === "depleted")
        .map((vehicle) => vehicle.id),
      taskSequence: this.tasks.map((task) => `${task.id}:${task.origin}>${task.destination}`)
    };
    this.emit(
      status === "success" ? "success" : "failure",
      status === "success" ? `任务成功：${reason}` : `任务失败：${reason}`
    );
  }
}

export function dispatchAuto(sim, {
  vehicleLimit = 4,
  maxQueued = 1,
  minBattery = 24
} = {}) {
  if (sim.finished) return 0;
  let assigned = 0;
  const eligible = sim.vehicles
    .slice(0, vehicleLimit)
    .filter((vehicle) => vehicle.state !== "depleted");

  for (const task of sim.waitingTasks) {
    const candidates = eligible
      .filter((vehicle) => vehicle.queue.length < maxQueued)
      .filter((vehicle) => vehicle.battery >= minBattery || vehicle.queue.length === 0);
    if (candidates.length === 0) break;
    candidates.sort((a, b) => (
      b.battery - a.battery ||
      a.queue.length - b.queue.length ||
      a.index - b.index
    ));
    const vehicle = candidates[0];
    if (sim.assignTask(task.id, vehicle.id).ok) assigned += 1;
  }

  for (const vehicle of eligible) {
    const charging = vehicle.battery < 42 ? 2 : 1;
    if (vehicle.priorities.charging !== charging) {
      sim.setPriority(vehicle.id, "charging", charging);
    }
  }
  return assigned;
}

export function runAutoScenario({
  seed = "RING-305",
  initialBattery = null,
  incidentCount = 2,
  dispatchEvery = 0.5,
  vehicleLimit = 4,
  maxQueued = 1,
  minBattery = 24
} = {}) {
  const sim = new CargoSimulation({ seed, initialBattery, incidentCount });
  while (!sim.finished) {
    dispatchAuto(sim, { vehicleLimit, maxQueued, minBattery });
    sim.advance(Math.min(dispatchEvery, CONFIG.duration - sim.time));
  }
  return sim;
}
