export const CONFIG = Object.freeze({
  duration: 180,
  warningLevel: 0.68,
  dangerLevel: 0.91,
  waterStart: 0.2,
  tideStart: 0.41,
  tideRange: 0.59,
  seepCoefficient: 0.0025,
  openGateCoefficient: 0.033,
  pumpFlow: 0.009,
  pumpDrain: 2.45,
  vehicleStartX: 145,
  vehicleSafeX: 1132,
  gates: [
    { id: "A", name: "外港闸", shortName: "A 闸", x: 310, closeDuration: 6 },
    { id: "B", name: "煤仓闸", shortName: "B 闸", x: 520, closeDuration: 9 },
    { id: "C", name: "鱼市闸", shortName: "C 闸", x: 740, closeDuration: 12 },
    { id: "D", name: "内湾闸", shortName: "D 闸", x: 960, closeDuration: 15 },
  ],
});

export const VEHICLE_SCHEDULE = Object.freeze([
  { id: "港运-01", at: 0, speed: 38, lane: 0 },
  { id: "冷链-02", at: 8, speed: 34, lane: 1 },
  { id: "货车-03", at: 17, speed: 42, lane: 0 },
  { id: "驳运-04", at: 26, speed: 36, lane: 1 },
  { id: "集卡-05", at: 35, speed: 40, lane: 0 },
  { id: "冷藏-06", at: 44, speed: 33, lane: 1 },
  { id: "维修-07", at: 53, speed: 37, lane: 0 },
  { id: "夜班-08", at: 62, speed: 35, lane: 1 },
  { id: "末班-09", at: 70, speed: 31, lane: 0 },
  { id: "抢险-10", at: 76, speed: 34, lane: 1 },
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function stormIntensityAt(time) {
  const progress = clamp(time / CONFIG.duration, 0, 1);
  return clamp(
    0.24 + progress * 0.69 + Math.sin(time * 0.12) * 0.045 + Math.sin(time * 0.37) * 0.018,
    0,
    1,
  );
}

export function tideLevelAt(time) {
  const progress = clamp(time / CONFIG.duration, 0, 1);
  return CONFIG.tideStart + CONFIG.tideRange * Math.pow(progress, 1.12)
    + Math.sin(time * 0.075) * 0.014 * progress;
}

function addEvent(state, type, detail = {}) {
  state.events.push({ type, time: Number(state.time.toFixed(2)), ...detail });
}

function makeFailure(state, code, message, detail = {}) {
  if (state.status !== "running") {
    return;
  }
  state.status = "lost";
  state.fail = { code, message, ...detail };
  addEvent(state, "lost", { code, message });
}

function trapVehicle(state, vehicle, gate) {
  if (state.status !== "running" || vehicle.status === "safe") {
    return;
  }
  vehicle.status = "trapped";
  vehicle.trappedBy = gate.id;
  addEvent(state, "vehicle-trapped", {
    vehicleId: vehicle.id,
    gateId: gate.id,
  });
  makeFailure(
    state,
    "vehicle-trapped",
    `${vehicle.id} 被 ${gate.shortName} 夹住，撤离通道已阻断`,
    { gateId: gate.id, vehicleId: vehicle.id },
  );
}

export function createGame(options = {}) {
  const schedule = options.schedule ?? VEHICLE_SCHEDULE;
  const gates = CONFIG.gates.map((gate) => ({
    ...gate,
    progress: 0,
    state: "open",
  }));
  const state = {
    status: "ready",
    time: 0,
    water: CONFIG.waterStart,
    tide: tideLevelAt(0),
    storm: stormIntensityAt(0),
    power: 100,
    pumpOn: false,
    pumpFlow: 0,
    warning: false,
    gates,
    vehicles: schedule.map((vehicle) => ({
      ...vehicle,
      x: CONFIG.vehicleStartX,
      status: "pending",
      trappedBy: null,
    })),
    spawnCursor: 0,
    safeCount: 0,
    events: [],
    fail: null,
  };
  return state;
}

export function startGame(state) {
  if (state.status !== "ready") {
    return false;
  }
  state.status = "running";
  addEvent(state, "game-start");
  return true;
}

export function requestCloseGate(state, index) {
  if (state.status !== "running") {
    return { ok: false, message: "本局已经结束" };
  }
  const gate = state.gates[index];
  if (!gate) {
    return { ok: false, message: "没有这道闸门" };
  }
  if (gate.state !== "open") {
    return { ok: false, message: `${gate.shortName} 正在动作或已经关闭` };
  }
  if (state.gates.some((item) => item.state === "closing")) {
    return { ok: false, message: "卷扬机一次只能驱动一道闸门" };
  }
  const nextIndex = state.gates.findIndex((item) => item.state !== "closed");
  if (index !== nextIndex) {
    return { ok: false, message: "请按 A → B → C → D 的顺序关闭闸门" };
  }
  gate.state = "closing";
  addEvent(state, "gate-start", { gateId: gate.id });
  return { ok: true, message: `${gate.shortName} 开始落闸` };
}

export function setPump(state, enabled) {
  if (state.status !== "running") {
    return { ok: false, message: "本局已经结束" };
  }
  if (enabled && state.power <= 0.1) {
    state.pumpOn = false;
    return { ok: false, message: "泵站电池已经耗尽" };
  }
  if (state.pumpOn === enabled) {
    return { ok: true, message: enabled ? "水泵正在排水" : "水泵已停止" };
  }
  state.pumpOn = enabled;
  addEvent(state, enabled ? "pump-on" : "pump-off");
  return { ok: true, message: enabled ? "水泵启动，电量快速下降" : "水泵停止" };
}

export function togglePump(state) {
  return setPump(state, !state.pumpOn);
}

export function nextGateIndex(state) {
  return state.gates.findIndex((gate) => gate.state !== "closed");
}

export function allGatesClosed(state) {
  return state.gates.every((gate) => gate.state === "closed");
}

export function secondsRemaining(state) {
  return Math.max(0, CONFIG.duration - state.time);
}

function winGame(state) {
  if (state.status !== "running") {
    return;
  }
  state.status = "won";
  addEvent(state, "won", { time: Number(state.time.toFixed(2)) });
}

function finishAtTimeLimit(state) {
  if (!allGatesClosed(state)) {
    makeFailure(
      state,
      "timeout-gates",
      "三分钟潮峰已到，仍有闸门未关闭，海水越过警戒线",
    );
    return;
  }
  if (state.water >= CONFIG.warningLevel) {
    makeFailure(
      state,
      "timeout-water",
      "闸门已封死，但港区水位仍高于警戒线",
    );
    return;
  }
  makeFailure(
    state,
    "timeout-vehicles",
    "封闸完成，但仍有车辆没有抵达高处集结点",
  );
}

function step(state, dt) {
  state.time = Math.min(CONFIG.duration, state.time + dt);
  state.storm = stormIntensityAt(state.time);
  state.tide = tideLevelAt(state.time);

  for (const gate of state.gates) {
    if (gate.state !== "closing") {
      continue;
    }
    gate.progress = Math.min(1, gate.progress + dt / gate.closeDuration);
    if (gate.progress >= 1) {
      gate.state = "closed";
      addEvent(state, "gate-closed", { gateId: gate.id });
    }
  }

  while (
    state.spawnCursor < state.vehicles.length
    && state.time >= state.vehicles[state.spawnCursor].at
  ) {
    const vehicle = state.vehicles[state.spawnCursor];
    vehicle.status = "active";
    vehicle.x = CONFIG.vehicleStartX;
    state.spawnCursor += 1;
    addEvent(state, "vehicle-spawn", { vehicleId: vehicle.id });
  }

  for (const vehicle of state.vehicles) {
    if (vehicle.status !== "active") {
      continue;
    }
    vehicle.x += vehicle.speed * dt;
    if (vehicle.x >= CONFIG.vehicleSafeX) {
      vehicle.status = "safe";
      state.safeCount += 1;
      addEvent(state, "vehicle-safe", { vehicleId: vehicle.id });
    }
  }

  for (const gate of state.gates) {
    if (gate.progress < 0.015) {
      continue;
    }
    for (const vehicle of state.vehicles) {
      if (vehicle.status !== "active") {
        continue;
      }
      if (vehicle.x >= gate.x - 34 && vehicle.x <= gate.x + 28) {
        trapVehicle(state, vehicle, gate);
        return;
      }
    }
  }

  if (state.status !== "running") {
    return;
  }

  const openRatio = state.gates.reduce(
    (total, gate) => total + (1 - gate.progress),
    0,
  ) / state.gates.length;
  const pumpActive = state.pumpOn && state.power > 0;
  state.pumpFlow = pumpActive ? CONFIG.pumpFlow : 0;

  if (pumpActive) {
    state.power = Math.max(0, state.power - CONFIG.pumpDrain * dt);
    if (state.power <= 0) {
      state.pumpOn = false;
      state.pumpFlow = 0;
      addEvent(state, "battery-empty");
    }
  }

  const transfer = CONFIG.seepCoefficient + CONFIG.openGateCoefficient * openRatio;
  state.water = clamp(
    state.water + ((state.tide - state.water) * transfer - state.pumpFlow) * dt,
    0,
    1.2,
  );

  if (!state.warning && state.water >= CONFIG.warningLevel) {
    state.warning = true;
    addEvent(state, "warning", { water: Number(state.water.toFixed(3)) });
  }

  if (state.water >= CONFIG.dangerLevel) {
    makeFailure(
      state,
      "flooded",
      "港区水位冲过危险线，海水已经倒灌",
    );
    return;
  }

  const noPendingVehicles = state.spawnCursor >= state.vehicles.length;
  const allVehiclesSafe = state.vehicles.every((vehicle) => vehicle.status === "safe");
  if (
    allGatesClosed(state)
    && state.water < CONFIG.warningLevel
    && noPendingVehicles
    && allVehiclesSafe
  ) {
    winGame(state);
    return;
  }

  if (state.time >= CONFIG.duration) {
    finishAtTimeLimit(state);
  }
}

export function tick(state, elapsedSeconds) {
  if (state.status !== "running" || elapsedSeconds <= 0) {
    return;
  }
  let remaining = Math.min(elapsedSeconds, CONFIG.duration - state.time);
  while (remaining > 1e-7 && state.status === "running") {
    const dt = Math.min(remaining, 1 / 30);
    step(state, dt);
    remaining -= dt;
  }
}
