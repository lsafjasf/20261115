export const LANES = [
  {
    id: "powder",
    code: "01",
    name: "粉雪道",
    subtitle: "松软层",
    targetThickness: 46,
    targetHardness: 32,
    tolerance: 7,
    color: "#cfe8f5",
    accent: "#79c7d9",
  },
  {
    id: "race",
    code: "02",
    name: "竞速道",
    subtitle: "压雪层",
    targetThickness: 54,
    targetHardness: 58,
    tolerance: 7,
    color: "#d9e7ed",
    accent: "#f2b561",
  },
  {
    id: "hardpack",
    code: "03",
    name: "硬雪道",
    subtitle: "冰状层",
    targetThickness: 62,
    targetHardness: 78,
    tolerance: 7,
    color: "#c3dce6",
    accent: "#ec725f",
  },
];

export const DEFAULT_CONTROLS = {
  water: 62,
  air: 66,
  angle: 34,
  spraying: false,
};

export const OPENING_WINDOW = 360;
const MAX_THICKNESS_FACTOR = 1.24;

export const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const smoothstep = (edge0, edge1, value) => {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
};

const idealWetness = (hardness) => clamp((hardness - 20) / 76, 0.04, 0.9);

const createLaneState = (lane) => ({
  id: lane.id,
  thickness: 0,
  hardness: 0,
  ice: 0,
  quality: 1,
  meltLoss: 0,
  certified: false,
  wasCertified: false,
  lastDeposit: 0,
});

export function createSimulation(options = {}) {
  const lanes = LANES.map(createLaneState);
  const state = {
    time: 0,
    remaining: OPENING_WINDOW,
    phase: "preparing",
    hasOpened: false,
    activeLane: 0,
    controls: { ...DEFAULT_CONTROLS, ...(options.controls || {}) },
    environment: {
      temperature: -8.4,
      humidity: 68,
      wind: 4.2,
      windAngle: -24,
      warmFront: {
        active: false,
        elapsed: 0,
        duration: options.warmDuration || 12,
        intensity: 0,
      },
    },
    lanes,
    warmFronts: 0,
    eventQueue: [],
    nextEventId: 0,
    snapshotSerial: 0,
  };

  if (options.seed !== undefined) {
    state.time = (Number(options.seed) % 37) * 0.1;
  }
  return state;
}

export function addEvent(state, type, message, detail = {}) {
  state.eventQueue.push({
    id: ++state.nextEventId,
    type,
    message,
    time: state.time,
    ...detail,
  });
}

export function drainEvents(state) {
  const events = state.eventQueue;
  state.eventQueue = [];
  return events;
}

export function setControl(state, key, value) {
  if (!(key in DEFAULT_CONTROLS)) return false;
  if (key === "spraying") {
    state.controls.spraying = Boolean(value);
  } else {
    state.controls[key] = clamp(Number(value), key === "angle" ? 12 : 0, key === "angle" ? 66 : 100);
  }
  return true;
}

export function setControlValues(state, controls) {
  for (const [key, value] of Object.entries(controls)) {
    setControl(state, key, value);
  }
}

export function selectLane(state, index) {
  const next = clamp(Math.round(Number(index)), 0, LANES.length - 1);
  if (next === state.activeLane && Number.isFinite(next)) return false;
  state.activeLane = next;
  addEvent(state, "lane-select", `已切换至${LANES[next].name}`, { lane: next });
  return true;
}

export function toggleSpray(state, forced) {
  const next =
    typeof forced === "boolean" ? forced : !state.controls.spraying;
  if (next === state.controls.spraying) return next;
  state.controls.spraying = next;
  addEvent(
    state,
    next ? "spray-start" : "spray-stop",
    next ? "雪炮泵组已启动" : "雪炮已暂停",
    { lane: state.activeLane },
  );
  return next;
}

export function getForecast(state, laneIndex = state.activeLane) {
  const lane = LANES[clamp(laneIndex, 0, LANES.length - 1)];
  const { water, air, angle } = state.controls;
  const { temperature, humidity, wind } = state.environment;
  const warm = state.environment.warmFront.intensity;

  const wetness = clamp(
    0.12 +
      (water / 100) * 0.78 -
      (air / 100) * 0.5 +
      (temperature + 10) * 0.032 +
      (humidity - 65) * 0.0028 +
      warm * 0.018,
    0,
    1,
  );

  const preferredAngle = 30.5 + wind * 1.1 + laneIndex * 0.9;
  const angleMatch = clamp(1 - Math.abs(angle - preferredAngle) / 45, 0.2, 1);
  const dryLoss = clamp((wind / 12) * (1 - wetness) * 0.32, 0, 0.35);
  const catchRate = clamp(
    angleMatch * (0.5 + wetness * 0.65) * (1 - dryLoss),
    0.08,
    0.98,
  );
  const producedHardness = clamp(20 + wetness * 76 + (angleMatch - 0.8) * 4, 12, 98);
  const ideal = idealWetness(lane.targetHardness);
  const oversaturation = Math.max(0, wetness - ideal - 0.1);
  const quality = clamp(
    1 -
      Math.abs(wetness - ideal) * 0.82 -
      oversaturation * 1.35 -
      (1 - angleMatch) * 0.3,
    0.04,
    1,
  );
  const iceRate =
    smoothstep(ideal + 0.11, 0.96, wetness) * 0.66 +
    Math.max(0, temperature + 2) * 0.012;
  const depositRate =
    (water / 100) * 12.8 * catchRate * (state.controls.spraying ? 1 : 0);

  return {
    laneIndex,
    wetness,
    hardness: producedHardness,
    quality,
    catchRate,
    iceRate,
    preferredAngle,
    dryLoss,
    depositRate,
    hardnessError: producedHardness - lane.targetHardness,
  };
}

function updateEnvironment(state, dt) {
  const environment = state.environment;
  const front = environment.warmFront;
  if (front.active) {
    front.elapsed = Math.min(front.duration, front.elapsed + dt);
    front.intensity = smoothstep(0, 1, front.elapsed / front.duration);
    if (front.elapsed >= front.duration && !front.settled) {
      front.settled = true;
      state.phase = state.hasOpened ? "testing" : "preparing";
      addEvent(
        state,
        "warm-front-peak",
        `暖锋抵达：气温 ${environment.temperature.toFixed(1)}°C`,
        { temperature: environment.temperature },
      );
    }
  }

  const drift = Math.sin(state.time * 0.19) * 0.07;
  const slowDrift = Math.sin(state.time * 0.041 + 1.2) * 0.21;
  environment.temperature = clamp(
    -8.4 + slowDrift + drift + front.intensity * 5.7,
    -16,
    2,
  );
  environment.humidity = clamp(
    68 +
      Math.sin(state.time * 0.092 + 0.5) * 2.4 +
      Math.sin(state.time * 0.21) * 0.55 +
      front.intensity * 7.5,
    36,
    99,
  );
  environment.wind = clamp(
    4.2 +
      Math.sin(state.time * 0.12 + 2.1) * 1.15 +
      Math.sin(state.time * 0.31) * 0.28 +
      front.intensity * 0.9,
    1.2,
    11.5,
  );
  environment.windAngle =
    -24 + Math.sin(state.time * 0.047) * 9 - front.intensity * 5;
}

function updateLanes(state, dt) {
  const activeForecast = getForecast(state, state.activeLane);
  const heatStress = Math.max(0, state.environment.temperature + 5.6);
  const front = state.environment.warmFront;

  state.lanes.forEach((laneState, laneIndex) => {
    const lane = LANES[laneIndex];
    const maxThickness = lane.targetThickness * MAX_THICKNESS_FACTOR;
    const forecast =
      laneIndex === state.activeLane
        ? activeForecast
        : getForecast(state, laneIndex);
    let deposit = 0;

    if (
      state.controls.spraying &&
      laneIndex === state.activeLane &&
      laneState.thickness < maxThickness
    ) {
      deposit = Math.min(forecast.depositRate * dt, maxThickness - laneState.thickness);
      const previousMass = laneState.thickness;
      laneState.thickness += deposit;
      if (deposit > 0) {
        const hardnessBlend = previousMass > 0 ? clamp(deposit * 0.3, 0, 0.92) : 1;
        const qualityBlend = previousMass > 0 ? clamp(deposit * 0.42, 0, 0.95) : 1;
        laneState.hardness +=
          (forecast.hardness - laneState.hardness) * hardnessBlend;
        laneState.quality +=
          (forecast.quality - laneState.quality) * qualityBlend;
        laneState.ice = clamp(
          laneState.ice + forecast.iceRate * deposit * 0.02,
          0,
          1,
        );
        laneState.lastDeposit = deposit;
      }
    } else {
      laneState.lastDeposit = 0;
    }

    if (heatStress > 0 && laneState.thickness > 0) {
      const exposed = clamp(front.intensity + heatStress / 5.7, 0, 1);
      const melt = heatStress * 0.048 * dt * exposed;
      laneState.thickness = Math.max(0, laneState.thickness - melt);
      laneState.meltLoss += melt;
      const surfaceStress = front.active && !front.settled ? 0.19 : 0.065;
      const qualityStress = front.active && !front.settled ? 0.019 : 0.004;
      laneState.hardness = clamp(
        laneState.hardness - heatStress * surfaceStress * dt * exposed,
        8,
        98,
      );
      laneState.quality = clamp(
        laneState.quality - heatStress * qualityStress * dt * exposed,
        0.04,
        1,
      );
      laneState.ice = clamp(
        laneState.ice - heatStress * 0.003 * dt * exposed,
        0,
        1,
      );
    }

    const thicknessOk = laneState.thickness >= lane.targetThickness - 0.05;
    const hardnessOk =
      laneState.thickness > 0 &&
      Math.abs(laneState.hardness - lane.targetHardness) <= lane.tolerance;
    const iceOk = laneState.ice <= 0.38;
    const qualityOk = laneState.quality >= 0.56;
    const nowCertified = thicknessOk && hardnessOk && iceOk && qualityOk;

    if (nowCertified && !laneState.certified) {
      addEvent(state, "lane-certified", `${lane.name}已通过验收`, {
        lane: laneIndex,
        hardness: laneState.hardness,
      });
    } else if (!nowCertified && laneState.wasCertified) {
      addEvent(state, "lane-revoked", `${lane.name}雪质跌破标准`, {
        lane: laneIndex,
        reason: !thicknessOk
          ? "厚度不足"
          : !hardnessOk
            ? "硬度偏离"
            : !iceOk
              ? "结冰超标"
              : "雪质下降",
      });
    }
    laneState.certified = nowCertified;
    if (nowCertified) laneState.wasCertified = true;
  });

  const allCertified = state.lanes.every((laneState) => laneState.certified);
  if (front.active && !front.settled) {
    state.phase = "warming";
  } else if (allCertified && !state.hasOpened) {
    state.hasOpened = true;
    state.phase = "open";
    addEvent(state, "opening-ready", "三条雪道全部就绪，雪场可以开门", {
      certified: state.lanes.map((laneState) => laneState.certified),
    });
  } else if (allCertified) {
    state.phase = "open";
  } else if (state.hasOpened) {
    state.phase = "testing";
  } else if (front.settled) {
    state.phase = "preparing";
  }
}

export function triggerWarmFront(state) {
  const front = state.environment.warmFront;
  if (front.active && !front.settled) {
    addEvent(state, "warm-front-blocked", "暖锋测试正在进行");
    return false;
  }
  front.active = true;
  front.settled = false;
  front.elapsed = 0;
  front.intensity = 0.12;
  state.warmFronts += 1;
  state.phase = "warming";
  addEvent(state, "warm-front", "暖锋压测已启动：气温与湿度快速上升", {
    count: state.warmFronts,
  });
  return true;
}

export function stepSimulation(state, dt) {
  const safeDt = clamp(Number(dt) || 0, 0, 0.25);
  if (safeDt <= 0) return state;
  state.time += safeDt;
  state.remaining = Math.max(0, state.remaining - safeDt);
  updateEnvironment(state, safeDt);
  updateLanes(state, safeDt);
  state.snapshotSerial += 1;
  return state;
}

export function advanceSimulation(state, seconds, controls) {
  if (controls) setControlValues(state, controls);
  let remaining = clamp(Number(seconds) || 0, 0, 180);
  while (remaining > 0) {
    const dt = Math.min(1 / 30, remaining);
    stepSimulation(state, dt);
    remaining -= dt;
  }
  return state;
}

export function getLaneStatus(state, laneIndex) {
  const lane = LANES[laneIndex];
  const laneState = state.lanes[laneIndex];
  const thicknessOk = laneState.thickness >= lane.targetThickness - 0.05;
  const hardnessOk =
    laneState.thickness > 0 &&
    Math.abs(laneState.hardness - lane.targetHardness) <= lane.tolerance;
  const iceOk = laneState.ice <= 0.38;
  const qualityOk = laneState.quality >= 0.56;
  let issue = "就绪";
  if (!thicknessOk) issue = "厚度不足";
  else if (!hardnessOk) issue = "硬度偏离";
  else if (!iceOk) issue = "结冰超标";
  else if (!qualityOk) issue = "雪质下降";
  return {
    ...lane,
    ...laneState,
    thicknessPct: clamp(
      (laneState.thickness / lane.targetThickness) * 100,
      0,
      150,
    ),
    hardnessError: laneState.thickness
      ? laneState.hardness - lane.targetHardness
      : null,
    thicknessOk,
    hardnessOk,
    iceOk,
    qualityOk,
    issue,
  };
}

export function getSnapshot(state) {
  const laneStatuses = LANES.map((_, index) => getLaneStatus(state, index));
  const certifiedCount = laneStatuses.filter((lane) => lane.certified).length;
  const averageQuality =
    laneStatuses.reduce(
      (total, lane) =>
        total + (lane.thickness > 0 ? lane.quality : 1),
      0,
    ) / LANES.length;
  return {
    time: state.time,
    remaining: state.remaining,
    phase: state.phase,
    success: state.hasOpened && certifiedCount === LANES.length,
    hasOpened: state.hasOpened,
    certifiedCount,
    activeLane: state.activeLane,
    controls: { ...state.controls },
    environment: {
      ...state.environment,
      warmFront: { ...state.environment.warmFront },
    },
    forecast: getForecast(state),
    averageQuality,
    warmFronts: state.warmFronts,
    lanes: laneStatuses,
  };
}
