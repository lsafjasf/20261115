export const SIM = Object.freeze({
  duration: 720,
  ambientTemp: 22,
  ambientLight: 22,
  growthTarget: 100,
  stallBelow: 30,
  burnTemp: 45.5,
  lampPower: 132,
  rackMin: 0,
  rackMax: 2.4,
  heightMin: 0.35,
  heightMax: 1.05,
  dutyMin: 0.35,
  dutyMax: 1,
  darkEveryMin: 24,
  darkEveryMax: 70,
  darkForMin: 2,
  darkForMax: 10,
});

export const ROWS = Object.freeze([
  { id: "A", name: "左排", x: 0.4 },
  { id: "B", name: "中排", x: 1.2 },
  { id: "C", name: "右排", x: 2.0 },
]);

export const DEFAULT_CONTROLS = Object.freeze({
  rackX: 1.2,
  height: 0.62,
  duty: 0.78,
  darkEvery: 40,
  darkFor: 6,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const LIMITS = {
  rackX: [SIM.rackMin, SIM.rackMax],
  height: [SIM.heightMin, SIM.heightMax],
  duty: [SIM.dutyMin, SIM.dutyMax],
  darkEvery: [SIM.darkEveryMin, SIM.darkEveryMax],
  darkFor: [SIM.darkForMin, SIM.darkForMax],
};

export function createSimulation(overrides = {}) {
  const { controls: controlOverrides = {}, rows: rowOverrides = [], ...rest } = overrides;
  const controls = { ...DEFAULT_CONTROLS };
  for (const key of Object.keys(DEFAULT_CONTROLS)) {
    if (controlOverrides[key] !== undefined) {
      controls[key] = normalizeControl(key, controlOverrides[key], controls[key]);
    }
  }
  controls.darkFor = Math.min(controls.darkFor, controls.darkEvery - 1);

  return {
    status: "ready",
    time: 0,
    duration: rest.duration ?? SIM.duration,
    control: controls,
    rows: ROWS.map((definition, index) => ({
      ...definition,
      growth: clamp(finite(rowOverrides[index]?.growth, 0), 0, 100),
      temp: finite(rowOverrides[index]?.temp, SIM.ambientTemp + 1.1),
      peakTemp: finite(rowOverrides[index]?.temp, SIM.ambientTemp + 1.1),
      burned: Boolean(rowOverrides[index]?.burned),
      hotWarned: false,
      completedAt: null,
      dwell: 0,
    })),
    rackTemp: SIM.ambientTemp + 1.5,
    rackMoving: false,
    notifications: [],
    failReason: null,
  };
}

export function normalizeControl(key, value, fallback = DEFAULT_CONTROLS[key]) {
  const limits = LIMITS[key];
  if (!limits) return fallback;
  return clamp(finite(value, fallback), limits[0], limits[1]);
}

export function setControl(sim, key, value) {
  if (!(key in sim.control)) return sim;
  sim.control[key] = normalizeControl(key, value, sim.control[key]);
  sim.control.darkFor = Math.min(sim.control.darkFor, sim.control.darkEvery - 1);
  return sim;
}

export function moveRack(sim, delta) {
  return setControl(sim, "rackX", sim.control.rackX + delta);
}

export function startSimulation(sim) {
  if (sim.status === "ready" || sim.status === "paused") sim.status = "running";
  return sim;
}

export function pauseSimulation(sim) {
  if (sim.status === "running") sim.status = "paused";
  return sim;
}

export function getCycle(sim) {
  const every = Math.max(2, sim.control.darkEvery);
  const darkFor = Math.min(sim.control.darkFor, every - 1);
  const phase = ((sim.time + every - darkFor) % every + every) % every;
  const dark = phase < darkFor;
  return {
    dark,
    darkFor,
    every,
    phase,
    nextDark: dark ? 0 : every - phase,
    untilLight: dark ? darkFor - phase : 0,
  };
}

export function getLighting(sim, rowIndex, control = sim.control) {
  const row = sim.rows[rowIndex];
  const cycle = getCycle(sim);
  const height = control.height;
  const spread = 0.25 + height * 0.38;
  const distance = Math.abs(control.rackX - row.x);
  const coverage = clamp(1 - (distance / spread) ** 1.65, 0, 1);
  const heightFactor = clamp(1.12 - height * 0.62, 0.4, 0.95);
  const peak = SIM.lampPower * heightFactor * control.duty;
  const direct = cycle.dark ? 0 : peak * coverage;
  const shadow = clamp(1 - distance / 1.08, 0, 1);
  const shade = 1 - 0.72 * shadow;
  const ambient = SIM.ambientLight * shade;
  const ppfd = direct + ambient;
  return { direct, ambient, ppfd, coverage, spread, distance, shadow: 1 - shade, cycle };
}

export function getSnapshot(sim) {
  const lighting = sim.rows.map((_, index) => getLighting(sim, index));
  return {
    time: sim.time,
    remaining: Math.max(0, sim.duration - sim.time),
    status: sim.status,
    failReason: sim.failReason,
    rows: sim.rows.map((row, index) => ({
      ...row,
      ppfd: lighting[index].ppfd,
      direct: lighting[index].direct,
      shadow: lighting[index].shadow,
    })),
    cycle: getCycle(sim),
    controls: { ...sim.control },
    maxTemp: Math.max(...sim.rows.map((row) => row.temp)),
  };
}

export function consumeNotifications(sim) {
  if (!sim.notifications.length) return [];
  return sim.notifications.splice(0, sim.notifications.length);
}

function notify(sim, message, tone = "info") {
  sim.notifications.push({ message, tone, at: sim.time });
}

export function stepSimulation(sim, requestedDt) {
  if (sim.status !== "running") return sim;
  let remaining = Math.max(0, Math.min(10, finite(requestedDt, 0)));
  let elapsed = 0;

  while (remaining > 1e-8 && sim.status === "running") {
    const dt = Math.min(0.05, remaining);
    integrate(sim, dt);
    remaining -= dt;
    elapsed += dt;
    evaluateOutcome(sim);
  }
  return elapsed;
}

function integrate(sim, dt) {
  sim.time = Math.min(sim.duration, sim.time + dt);
  const cycle = getCycle(sim);

  for (let index = 0; index < sim.rows.length; index += 1) {
    const row = sim.rows[index];
    if (row.burned) continue;
    const light = getLighting(sim, index);
    const beforeGrowth = row.growth;

    if (light.ppfd > SIM.stallBelow) {
      const rate = (light.ppfd - SIM.stallBelow) * 0.023;
      row.growth = Math.min(SIM.growthTarget, row.growth + rate * dt);
    }

    const cooling = cycle.dark ? 0.15 : 0.016;
    const heating = light.direct * 0.0095;
    row.temp += (heating - (row.temp - SIM.ambientTemp) * cooling) * dt;
    row.peakTemp = Math.max(row.peakTemp, row.temp);
    row.dwell = light.direct > 30 ? row.dwell + dt : Math.max(0, row.dwell - dt * 2);

    if (!row.hotWarned && row.temp >= 42.5) {
      row.hotWarned = true;
      notify(sim, `${row.id} 排叶温偏高，移开灯架或等待暗周期`, "warning");
    }
    if (row.temp >= SIM.burnTemp) {
      row.temp = SIM.burnTemp;
      row.burned = true;
      notify(sim, `${row.id} 排叶片灼伤，本轮无法达标`, "danger");
    }
    if (beforeGrowth < SIM.growthTarget && row.growth >= SIM.growthTarget) {
      row.completedAt = sim.time;
      notify(sim, `${row.id} 排生长值达到 100%`, "success");
    }
  }

  const rackTarget = SIM.ambientTemp + 3 + sim.control.duty * 7 + (cycle.dark ? 0 : 2);
  sim.rackTemp += (rackTarget - sim.rackTemp) * 0.055 * dt;
}

function evaluateOutcome(sim) {
  if (sim.rows.some((row) => row.burned)) {
    sim.status = "failed";
    sim.failReason = "burn";
    return;
  }
  if (sim.rows.every((row) => row.growth >= SIM.growthTarget)) {
    sim.status = "won";
    sim.failReason = null;
    return;
  }
  if (sim.time >= sim.duration - 1e-6) {
    sim.status = "failed";
    sim.failReason = "timeout";
  }
}
