export const WORLD = {
  width: 2460,
  startX: 190,
  duration: 75,
  capacity: 100,
  batteryCapacity: 100,
  boatLength: 150,
  boatHeight: 62,
  baseSpeed: 226,
  acceleration: 255,
  reverseAcceleration: 190,
  drag: 1.85,
  dockReach: 82,
  processorReach: 96,
};

export const DOCKS = [
  {
    id: "north",
    x: 620,
    label: "北港码头",
    short: "A",
    volume: 38,
    mass: 21,
    accent: "#d9f36a",
  },
  {
    id: "market",
    x: 1230,
    label: "鱼市码头",
    short: "B",
    volume: 38,
    mass: 21,
    accent: "#ffc957",
  },
  {
    id: "east",
    x: 1840,
    label: "东湾码头",
    short: "C",
    volume: 38,
    mass: 21,
    accent: "#ff9d72",
  },
];

export const PROCESSOR = {
  x: 2295,
  label: "东岸处理点",
  short: "P",
};

export const RULES = {
  compactRate: 9.5,
  compactPower: 7.2,
  idlePower: 0.035,
  solidMassRatio: 0.55,
  leakBase: 0.045,
  leakSpeedFactor: 1.65,
  leakLoadFactor: 0.28,
  leakDockRecovery: 1.9,
  leakCompactCost: 0.42,
  warningLeak: 64,
  criticalLeak: 86,
  alarmLeak: 100,
  tideWarning: 22,
  tideCritical: 10,
};

export function createGameState() {
  return {
    mode: "menu",
    time: WORLD.duration,
    elapsed: 0,
    boat: {
      x: WORLD.startX,
      vx: 0,
      mass: 0,
      volume: 0,
      battery: WORLD.batteryCapacity,
      leak: 0,
      compacting: false,
      hasCompacted: false,
      dockedAt: null,
      tilt: 0,
    },
    docks: DOCKS.map((dock) => ({
      ...dock,
      collected: false,
      collectedAt: null,
      flash: 0,
    })),
    processor: {
      ...PROCESSOR,
      flash: 0,
      delivered: false,
    },
    stats: {
      peakLeak: 0,
      maxMass: 0,
      powerUsed: 0,
      collections: 0,
      compacts: 0,
      alarm: false,
      fullRejects: 0,
      lastFullReject: null,
    },
    effect: {
      toastUntil: 0,
      loading: 0,
      leakPulse: 0,
      success: 0,
      failReason: "",
    },
  };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function boatMaxSpeed(state) {
  const loadPenalty = state.boat.mass * 1.06;
  const leakPenalty = Math.max(0, state.boat.leak - RULES.warningLeak) * 0.28;
  return Math.max(82, WORLD.baseSpeed - loadPenalty - leakPenalty);
}
