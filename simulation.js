export const COLS = 18;
export const ROWS = 11;
export const LAND_COLS = 15;
export const STORM_DURATION = 120;
export const WARMUP_TIME = 60;
export const FIXED_STEP = 0.1;
export const RESIDENTIAL_THRESHOLD = 0.5;
export const HOSPITAL_THRESHOLD = 0.36;
export const SUBSTATION_THRESHOLD = 0.48;
export const REQUIRED_RESIDENTIAL_RATIO = 0.7;

export const SEEDS = [
  {
    id: "0317",
    name: "WEST HARBOR FRONT",
    descriptor: "WESTWARD BURST / SINGLE PEAK",
    rain: [
      [0.2, 34, 23, 0.72],
      [0.12, 63, 18, 0.2],
    ],
    phase: 0.6,
  },
  {
    id: "0814",
    name: "TWIN-CORE LOW",
    descriptor: "STALLED LOW / DOUBLE PEAK",
    rain: [
      [0.18, 27, 15, 0.62],
      [0.18, 67, 18, 0.66],
    ],
    phase: 2.1,
  },
  {
    id: "1123",
    name: "NIGHT SQUALL",
    descriptor: "CONVECTION / LATE PEAK",
    rain: [
      [0.16, 76, 27, 0.92],
      [0.1, 39, 11, 0.22],
    ],
    phase: 4.4,
  },
];

const RESIDENTIAL_LAYOUT = [
  [1, 4],
  [4, 4],
  [7, 4],
  [10, 4],
  [13, 4],
  [1, 8],
  [4, 8],
  [7, 8],
  [10, 8],
  [13, 8],
];

export const BUILDINGS = [
  {
    id: "hospital",
    kind: "hospital",
    name: "City Hospital",
    short: "HOSP",
    c: 1,
    r: 1,
    w: 3,
    h: 2,
    threshold: HOSPITAL_THRESHOLD,
    floors: 5,
  },
  {
    id: "substation",
    kind: "substation",
    name: "East Substation",
    short: "PWR",
    c: 10,
    r: 1,
    w: 3,
    h: 2,
    threshold: SUBSTATION_THRESHOLD,
    floors: 2,
  },
  ...RESIDENTIAL_LAYOUT.map(([c, r], index) => ({
    id: `res-${String(index + 1).padStart(2, "0")}`,
    kind: "residential",
    name: `Residential Block ${String(index + 1).padStart(2, "0")}`,
    short: `R${String(index + 1).padStart(2, "0")}`,
    c,
    r,
    w: 2,
    h: 2,
    threshold: RESIDENTIAL_THRESHOLD,
    floors: index % 3 === 0 ? 6 : 4,
  })),
];

export const RESIDENTIAL_BUILDINGS = BUILDINGS.filter((b) => b.kind === "residential");

const ROOF_CELLS = new Map();
for (const building of BUILDINGS) {
  for (let r = building.r; r < building.r + building.h; r += 1) {
    for (let c = building.c; c < building.c + building.w; c += 1) {
      ROOF_CELLS.set(`${c},${r}`, building.id);
    }
  }
}

export const GATES = [
  { id: "g1", name: "West Gate", c: 3, r: 10, open: true },
  { id: "g2", name: "Central Gate", c: 8, r: 10, open: false },
  { id: "g3", name: "East Gate", c: 12, r: 10, open: false },
];

export const INITIAL_SANDBAGS = [
  { id: "b1", c: 3, r: 3 },
  { id: "b2", c: 6, r: 3 },
  { id: "b3", c: 9, r: 6 },
  { id: "b4", c: 12, r: 6 },
  { id: "b5", c: 6, r: 10 },
];

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(time, center, width) {
  const x = (time - center) / width;
  return Math.exp(-0.5 * x * x);
}

export function rainfallAt(sim, time = sim.time) {
  if (time >= STORM_DURATION) return 0.12;
  const seed = sim.config;
  let value = 0;
  for (const [base, center, width, amplitude] of seed.rain) {
    value += base + amplitude * gaussian(time, center, width);
  }
  value += 0.022 * Math.sin(time * 0.57 + seed.phase);
  value += 0.015 * Math.sin(time * 1.83 + seed.phase * 1.7);
  return Math.max(0.08, Math.min(1, value));
}

export function terrainAt(config, c, r) {
  const seedNoise = config._terrainNoise[r][c];
  const basinWest = 1.06 * Math.exp(-(((c - 3.2) ** 2) / 8.5 + ((r - 8.2) ** 2) / 4.6));
  const basinMid = 1.18 * Math.exp(-(((c - 8.9) ** 2) / 11 + ((r - 9.3) ** 2) / 3.8));
  const basinEast = 0.7 * Math.exp(-(((c - 13.8) ** 2) / 4.7 + ((r - 7.2) ** 2) / 8));
  const ridge = 0.34 * Math.exp(-(((c - 6.4) ** 2) / 4.8 + ((r - 3.4) ** 2) / 2.8));
  const base = 4.62 - c * 0.071;
  const scape = 0.17 * Math.sin(c * 0.78 + r * 0.51 + config.phase);
  return base + scape + ridge - basinWest - basinMid - basinEast + seedNoise * 0.12;
}

function buildConfig(seed) {
  const random = mulberry32(Number.parseInt(seed.id, 10) * 977 + 503);
  const terrainNoise = [];
  for (let r = 0; r < ROWS; r += 1) {
    const row = [];
    for (let c = 0; c < COLS; c += 1) {
      row.push(random() * 2 - 1);
    }
    terrainNoise.push(row);
  }
  return { ...seed, _terrainNoise: terrainNoise, _random: random };
}

export function createSimulation(seedId = SEEDS[0].id) {
  const source = SEEDS.find((item) => item.id === seedId) || SEEDS[0];
  const config = buildConfig(source);
  const terrain = [];
  const water = [];
  const flow = [];

  for (let r = 0; r < ROWS; r += 1) {
    const terrainRow = [];
    const waterRow = [];
    const flowRow = [];
    for (let c = 0; c < COLS; c += 1) {
      terrainRow.push(c > LAND_COLS ? 2.7 : terrainAt(config, c, r));
      waterRow.push(0);
      flowRow.push(0);
    }
    terrain.push(terrainRow);
    water.push(waterRow);
    flow.push(flowRow);
  }

  const sim = {
    seedId: source.id,
    config,
    time: 0,
    duration: STORM_DURATION,
    rainfall: rainfallAt({ config, time: 0 }, 0),
    riverStage: 2.78,
    riverRise: 0,
    terrain,
    water,
    flow,
    gates: GATES.map((gate, index) => ({ ...gate, open: index === 0 })),
    sandbags: INITIAL_SANDBAGS.map((bag) => ({ ...bag })),
    buildings: BUILDINGS.map((building) => ({ basement: 0, surface: 0, level: 0, pump: 0 })),
    accumulatedRain: 0,
    gateBackflow: 0,
    ended: false,
    revision: 0,
    lastAction: null,
  };

  const warmupSteps = Math.round(WARMUP_TIME / FIXED_STEP);
  for (let i = 0; i < warmupSteps; i += 1) {
    stepSimulation(sim, FIXED_STEP, { warmup: true });
  }
  sim.revision = 0;
  return sim;
}

function inFootprint(building, c, r) {
  return c >= building.c && c < building.c + building.w && r >= building.r && r < building.r + building.h;
}

function bagAt(sim, c, r) {
  return sim.sandbags.some((bag) => bag.c === c && bag.r === r);
}

function edgeBarrierFactor(sim, c1, r1, c2, r2) {
  const first = bagAt(sim, c1, r1);
  const second = bagAt(sim, c2, r2);
  if (first && second) return 0.05;
  if (first || second) return 0.2;
  return 1;
}

function applyRain(sim, dt) {
  const rain = sim.rainfall;
  const rainRate = 0.0058 * rain * dt;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < LAND_COLS; c += 1) {
      const canopy = sim.terrain[r][c] > 4.1 ? 0.76 : 1;
      const roof = ROOF_CELLS.has(`${c},${r}`) ? 0.34 : 1;
      sim.water[r][c] += rainRate * canopy * roof;
    }
  }
}

function applyLandFlow(sim, dt) {
  const transfers = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < LAND_COLS; c += 1) {
      const right = c + 1 < LAND_COLS ? c + 1 : -1;
      if (right >= 0) {
        const firstHead = sim.terrain[r][c] + sim.water[r][c];
        const secondHead = sim.terrain[r][right] + sim.water[r][right];
        const difference = firstHead - secondHead;
        if (Math.abs(difference) > 0.001) {
          const barrier = edgeBarrierFactor(sim, c, r, right, r);
          const capacity = Math.abs(difference) * 0.31 * barrier * dt;
          const sourceWater = difference > 0 ? sim.water[r][c] : sim.water[r][right];
          transfers.push({
            fromC: difference > 0 ? c : right,
            fromR: r,
            toC: difference > 0 ? right : c,
            toR: r,
            amount: Math.min(capacity, sourceWater * 0.28),
          });
        }
      }

      const below = r + 1 < ROWS ? r + 1 : -1;
      if (below >= 0) {
        const firstHead = sim.terrain[r][c] + sim.water[r][c];
        const secondHead = sim.terrain[below][c] + sim.water[below][c];
        const difference = firstHead - secondHead;
        if (Math.abs(difference) > 0.001) {
          const barrier = edgeBarrierFactor(sim, c, r, c, below);
          const capacity = Math.abs(difference) * 0.24 * barrier * dt;
          const sourceWater = difference > 0 ? sim.water[r][c] : sim.water[below][c];
          transfers.push({
            fromC: c,
            fromR: difference > 0 ? r : below,
            toC: c,
            toR: difference > 0 ? below : r,
            amount: Math.min(capacity, sourceWater * 0.22),
          });
        }
      }
    }
  }

  for (const transfer of transfers) {
    const amount = Math.max(0, transfer.amount);
    sim.water[transfer.fromR][transfer.fromC] = Math.max(0, sim.water[transfer.fromR][transfer.fromC] - amount);
    sim.water[transfer.toR][transfer.toC] += amount;
    sim.flow[transfer.toR][transfer.toC] += amount / Math.max(dt, 0.01);
  }
}

function applyDrains(sim, dt) {
  let backflow = 0;
  for (const gate of sim.gates) {
    if (!gate.open) continue;
    for (let r = Math.max(0, gate.r - 3); r <= Math.min(ROWS - 1, gate.r + 3); r += 1) {
      for (let c = Math.max(0, gate.c - 3); c <= Math.min(LAND_COLS - 1, gate.c + 3); c += 1) {
        const distance = Math.hypot(c - gate.c, r - gate.r);
        if (distance > 3.2) continue;
        const weight = (1 - distance / 3.4) ** 1.7;
        const gateHead = sim.terrain[gate.r][gate.c] + sim.water[gate.r][gate.c];
        const difference = gateHead - sim.riverStage;
        if (difference > 0.02) {
          const amount = Math.min(sim.water[r][c], difference * 0.082 * weight * dt);
          sim.water[r][c] -= amount;
        } else if (sim.riverStage - gateHead > 0.08 && r >= 8) {
          const amount = Math.min(0.035, (sim.riverStage - gateHead) * 0.035 * weight * dt);
          sim.water[r][c] += amount;
          backflow += amount;
        }
      }
    }
  }
  sim.gateBackflow = backflow;
}

function updateBuildingState(sim, dt) {
  for (let index = 0; index < sim.buildings.length; index += 1) {
    const building = BUILDINGS[index];
    const state = sim.buildings[index];
    const sample = sampleSurface(sim, building);
    state.surface = sample.average * 0.62 + sample.maximum * 0.38;

    const infiltration = state.surface > 0.04 ? state.surface * (0.0052 + Math.max(0, state.surface - 0.22) * 0.021) : 0;
    let removed = 0;
    if (state.basement > 0.002) {
      const pumpCapacity = building.kind === "residential" ? 0.0009 : 0.0044;
      removed = Math.min(state.basement, pumpCapacity * (state.surface > 0.55 ? 0.35 : 1) * dt);
    }
    state.basement = Math.max(0, Math.min(1.9, state.basement + infiltration * dt - removed));
    state.pump = removed / Math.max(dt, 0.01);

    if (infiltration > 0) {
      let extracted = Math.min(infiltration * dt * 0.24, sample.maximum);
      for (let r = building.r; r < building.r + building.h; r += 1) {
        for (let c = building.c; c < building.c + building.w; c += 1) {
          sim.water[r][c] = Math.max(0, sim.water[r][c] - extracted / (building.w * building.h));
        }
      }
    }

    state.level = Math.max(state.surface, state.basement * 0.68);
  }
}

function updateRiver(sim, dt) {
  sim.accumulatedRain += sim.rainfall * dt;
  const target = 2.82 + sim.rainfall * 0.38 + Math.min(0.5, sim.accumulatedRain * 0.0036);
  sim.riverStage += (target - sim.riverStage) * Math.min(1, dt * 0.12);
  sim.riverRise = Math.max(0, sim.riverStage - 3.05);
}

export function stepSimulation(sim, dt = FIXED_STEP, options = {}) {
  if (sim.ended || dt <= 0) return sim;
  const clamped = Math.min(dt, 0.25);
  sim.time = Math.min(sim.duration, sim.time + clamped);
  sim.rainfall = rainfallAt(sim, sim.time);
  sim.revision += 1;

  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      sim.flow[r][c] *= 0.55;
    }
  }

  updateRiver(sim, clamped);
  applyRain(sim, clamped);
  applyLandFlow(sim, clamped);
  applyDrains(sim, clamped);
  updateBuildingState(sim, clamped);

  if (sim.time >= sim.duration) {
    sim.ended = true;
  }
  if (!options.warmup) sim.revision = Math.max(1, sim.revision);
  return sim;
}

export function moveSandbag(sim, bagId, c, r) {
  if (sim.ended) return { ok: false, reason: "This storm event has ended" };
  const bag = sim.sandbags.find((item) => item.id === bagId);
  if (!bag) return { ok: false, reason: "Sandbag not found" };
  if (c < 0 || c >= LAND_COLS || r < 0 || r >= ROWS) {
    return { ok: false, reason: "Sandbags can only be placed on the city surface" };
  }
  const occupied = sim.sandbags.some((item) => item.id !== bagId && item.c === c && item.r === r);
  if (occupied) return { ok: false, reason: "A sandbag already occupies this cell" };
  if (bag.c === c && bag.r === r) return { ok: false, reason: "Sandbag has not moved" };

  bag.c = c;
  bag.r = r;
  sim.lastAction = { type: "sandbag", id: bagId, c, r, at: sim.time };
  sim.revision += 1;
  return { ok: true };
}

export function toggleGate(sim, gateId) {
  if (sim.ended) return { ok: false, reason: "This storm event has ended" };
  const gate = sim.gates.find((item) => item.id === gateId);
  if (!gate) return { ok: false, reason: "Drainage gate not found" };
  gate.open = !gate.open;
  sim.lastAction = { type: "gate", id: gateId, open: gate.open, at: sim.time };
  sim.revision += 1;
  return { ok: true, open: gate.open };
}

export function sampleSurface(sim, building) {
  let total = 0;
  let maximum = 0;
  let count = 0;
  for (let r = building.r - 1; r <= building.r + building.h; r += 1) {
    for (let c = building.c - 1; c <= building.c + building.w; c += 1) {
      const inside = c >= building.c && c < building.c + building.w && r >= building.r && r < building.r + building.h;
      if (inside || c < 0 || c >= LAND_COLS || r < 0 || r >= ROWS) continue;
      const depth = sim.water[r][c];
      total += depth;
      maximum = Math.max(maximum, depth);
      count += 1;
    }
  }
  return { average: total / Math.max(1, count), maximum };
}

export function getMetrics(sim) {
  const states = BUILDINGS.map((building, index) => {
    const state = sim.buildings[index];
    return {
      id: building.id,
      kind: building.kind,
      name: building.name,
      short: building.short,
      level: state.level,
      surface: state.surface,
      basement: state.basement,
      threshold: building.threshold,
      safe: state.level < building.threshold,
    };
  });

  const residential = states.filter((state) => state.kind === "residential");
  const safeCount = residential.filter((state) => state.safe).length;
  const safeRatio = safeCount / residential.length;
  const hospital = states.find((state) => state.id === "hospital");
  const substation = states.find((state) => state.id === "substation");
  const criticalSafe = hospital.safe && substation.safe;
  const residentialSafe = safeRatio >= REQUIRED_RESIDENTIAL_RATIO;

  return {
    states,
    residential,
    safeCount,
    residentialCount: residential.length,
    safeRatio,
    hospital,
    substation,
    criticalSafe,
    residentialSafe,
    success: criticalSafe && residentialSafe,
  };
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function fingerprint(sim) {
  let hash = 2166136261;
  const feed = (value) => {
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619);
  };

  feed(sim.seedId);
  feed(round(sim.time, 3));
  feed(round(sim.rainfall, 4));
  feed(round(sim.riverStage, 4));
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      feed(round(sim.water[r][c], 4));
    }
  }
  for (const gate of sim.gates) feed(`${gate.id}:${gate.open ? 1 : 0}`);
  for (const bag of [...sim.sandbags].sort((a, b) => a.id.localeCompare(b.id))) {
    feed(`${bag.id}:${bag.c}:${bag.r}`);
  }
  for (const state of sim.buildings) {
    feed(round(state.basement, 4));
    feed(round(state.surface, 4));
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getMapView(sim) {
  const digest = fingerprint(sim);
  return {
    kind: "map",
    sharedDigest: digest,
    water: sim.water.map((row) => row.slice()),
    gates: sim.gates.map((gate) => ({ id: gate.id, c: gate.c, r: gate.r, open: gate.open })),
    sandbags: sim.sandbags.map((bag) => ({ ...bag })),
    buildings: sim.buildings.map((state) => ({ ...state })),
    metrics: getMetrics(sim),
  };
}

export function getSectionView(sim) {
  const digest = fingerprint(sim);
  const columns = [];
  for (let c = 0; c < LAND_COLS; c += 1) {
    let total = 0;
    let maximum = 0;
    for (let r = 0; r < ROWS; r += 1) {
      total += sim.water[r][c];
      maximum = Math.max(maximum, sim.water[r][c]);
    }
    columns.push({
      c,
      depth: maximum * 0.68 + (total / ROWS) * 0.32,
      ground: sim.terrain[Math.min(ROWS - 1, Math.floor(ROWS * 0.62))][c],
    });
  }
  return {
    kind: "section",
    sharedDigest: digest,
    columns,
    gateBackflow: sim.gateBackflow,
    buildings: getMetrics(sim).states,
    metrics: getMetrics(sim),
  };
}

export function stormProgress(sim) {
  return Math.max(0, Math.min(1, sim.time / sim.duration));
}
