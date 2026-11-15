export const WORLD = Object.freeze({ width: 1120, height: 680 });

export const CHECKPOINTS = Object.freeze([
  { x: 284, y: 324, label: "01" },
  { x: 452, y: 205, label: "02" },
  { x: 628, y: 351, label: "03" },
  { x: 812, y: 204, label: "04" },
  { x: 1024, y: 344, label: "05" }
]);

export const START_SLOTS = Object.freeze([
  { x: 102, y: 308 },
  { x: 92, y: 344 },
  { x: 102, y: 380 }
]);

export function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function distanceSquared(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function buildObstacles(random) {
  const obstacles = [];
  let attempts = 0;
  while (obstacles.length < 8 && attempts < 500) {
    attempts += 1;
    const radius = 15 + random() * 18;
    const candidate = {
      x: 260 + random() * 760,
      y: 75 + random() * 530,
      radius
    };
    const clearOfCheckpoints = CHECKPOINTS.every(
      (checkpoint) => distanceSquared(candidate, checkpoint) > 92 ** 2
    );
    const clearOfStarts = START_SLOTS.every(
      (slot) => distanceSquared(candidate, slot) > 118 ** 2
    );
    const clearOfOthers = obstacles.every(
      (item) => distanceSquared(candidate, item) > (radius + item.radius + 42) ** 2
    );
    if (!clearOfCheckpoints || !clearOfStarts || !clearOfOthers) continue;

    const shape = Array.from({ length: 9 }, (_, index) => {
      const angle = (index / 9) * Math.PI * 2;
      const scale = 0.78 + random() * 0.34;
      return { x: Math.cos(angle) * radius * scale, y: Math.sin(angle) * radius * scale };
    });
    obstacles.push({ ...candidate, shape, phase: random() * Math.PI * 2 });
  }
  return obstacles;
}

export function generateWorld(seedText) {
  const seed = hashString(String(seedText).trim().toUpperCase());
  const random = mulberry32(seed);
  const gyres = Array.from({ length: 3 }, () => ({
    x: 260 + random() * 760,
    y: 90 + random() * 500,
    radius: 105 + random() * 95,
    strength: (random() < 0.5 ? -1 : 1) * (24 + random() * 23)
  }));

  return {
    seed,
    seedText: String(seedText).trim().toUpperCase(),
    flow: {
      angle: (random() - 0.5) * 0.42,
      base: 9 + random() * 8,
      phaseA: random() * Math.PI * 2,
      phaseB: random() * Math.PI * 2,
      pulse: 2.5 + random() * 3.5,
      gyres
    },
    obstacles: buildObstacles(random),
    checkpoints: CHECKPOINTS,
    starts: START_SLOTS
  };
}

export function currentAt(world, x, y, time) {
  const { flow } = world;
  let vx = Math.cos(flow.angle) * flow.base;
  let vy = Math.sin(flow.angle) * flow.base;
  vx += Math.sin(y * 0.017 + time * 0.27 + flow.phaseA) * flow.pulse;
  vy += Math.cos(x * 0.013 + time * 0.21 + flow.phaseB) * flow.pulse;
  vx += Math.cos(x * 0.007 - y * 0.003 + time * 0.16) * 2.8;

  for (const gyre of flow.gyres) {
    const dx = x - gyre.x;
    const dy = y - gyre.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) continue;
    const influence = Math.exp(-(distance * distance) / (gyre.radius * gyre.radius * 1.35));
    vx += (-dy / distance) * gyre.strength * influence;
    vy += (dx / distance) * gyre.strength * influence;
  }
  return { x: vx, y: vy, strength: Math.hypot(vx, vy) };
}
