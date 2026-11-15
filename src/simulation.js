import { currentAt, generateWorld, hashString, START_SLOTS, WORLD } from "./world.js";

export const SIM_DT = 0.05;
export const SAMPLE_EVERY = 2;
export const MAX_TIME = 42;
export const THRUST_SPAN = 38;
export const CHECKPOINT_RADIUS = 28;

export const FLEET = Object.freeze([
  { id: "alpha", name: "信标 α", callsign: "A-01", color: "#63e8d4" },
  { id: "bravo", name: "信标 β", callsign: "B-02", color: "#ffc45e" },
  { id: "charlie", name: "信标 γ", callsign: "C-03", color: "#be8eff" }
]);

export const DEFAULT_CONFIGS = Object.freeze([
  {
    thrust: [0.58, 0.82, 0.48, 0.74, 0.52],
    threshold: 18
  },
  {
    thrust: [0.48, 0.76, 0.9, 0.62, 0.54],
    threshold: 24
  },
  {
    thrust: [0.7, 0.62, 0.86, 0.5, 0.7],
    threshold: 20
  }
]);

export function cloneConfigs(configs = DEFAULT_CONFIGS) {
  return configs.map((config) => ({
    thrust: config.thrust.map((value) => Number(value)),
    threshold: Number(config.threshold)
  }));
}

export function thrustAt(config, time) {
  const span = Math.min(Math.max(time / THRUST_SPAN, 0), 1) * (config.thrust.length - 1);
  const low = Math.floor(span);
  const high = Math.min(low + 1, config.thrust.length - 1);
  const mix = span - low;
  return config.thrust[low] * (1 - mix) + config.thrust[high] * mix;
}

function wrapAngle(angle) {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createBoats(configs) {
  return configs.map((config, index) => ({
    index,
    config: {
      thrust: config.thrust.map((value) => clamp(Number(value), 0.15, 1)),
      threshold: clamp(Number(config.threshold), 4, 55)
    },
    x: START_SLOTS[index].x,
    y: START_SLOTS[index].y,
    heading: -0.04,
    speed: 25,
    target: 0,
    completed: 0,
    collisions: 0,
    hull: 100,
    status: "sailing",
    finishTime: null,
    collisionCooldown: 0,
    tension: 0
  }));
}

export function obstacleAvoidance(world, boat) {
  let adjustment = 0;
  for (const obstacle of world.obstacles) {
    const dx = obstacle.x - boat.x;
    const dy = obstacle.y - boat.y;
    const distance = Math.hypot(dx, dy);
    const clearance = distance - obstacle.radius - 7;
    if (clearance > 82 || distance < 0.001) continue;
    const bearing = wrapAngle(Math.atan2(dy, dx) - boat.heading);
    if (Math.abs(bearing) > 1.18) continue;
    const urgency = (1 - Math.max(clearance, 0) / 82) ** 1.5;
    adjustment += -Math.sign(bearing || 1) * urgency * 0.72;
  }
  return clamp(adjustment, -0.9, 0.9);
}

export function steerBoat(world, boat, dt) {
  const checkpoint = world.checkpoints[Math.min(boat.target, world.checkpoints.length - 1)];
  if (!checkpoint || boat.target >= world.checkpoints.length) {
    boat.tension *= 0.92;
    return;
  }

  const desired = Math.atan2(checkpoint.y - boat.y, checkpoint.x - boat.x);
  const avoidance = obstacleAvoidance(world, boat);
  const error = wrapAngle(desired + avoidance - boat.heading);
  const threshold = (boat.config.threshold * Math.PI) / 180;
  const maxTurn = 1.28;
  let turn;
  if (Math.abs(error) > threshold) {
    turn = Math.sign(error) * maxTurn * clamp(Math.abs(error) / 0.82, 0.48, 1);
  } else {
    turn = clamp(error * 1.85, -maxTurn * 0.55, maxTurn * 0.55);
  }
  boat.heading = wrapAngle(boat.heading + turn * dt);
  boat.tension = clamp(Math.abs(error) / 1.25 + Math.max(0, avoidance), 0, 1);
}

function applyCollision(world, boat, obstacle, events, time) {
  if (boat.collisionCooldown > 0) return;
  const dx = boat.x - obstacle.x;
  const dy = boat.y - obstacle.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const minimum = obstacle.radius + 7;
  boat.x = obstacle.x + (dx / distance) * minimum;
  boat.y = obstacle.y + (dy / distance) * minimum;
  boat.heading = wrapAngle(boat.heading + (dx * Math.cos(boat.heading) - dy * Math.sin(boat.heading) < 0 ? -0.4 : 0.4));
  boat.speed *= 0.46;
  boat.hull = Math.max(0, boat.hull - 17);
  boat.collisions += 1;
  boat.collisionCooldown = 1.25;
  if (boat.hull <= 0) boat.status = "lost";
  events.push({
    type: "collision",
    time,
    boat: boat.index,
    x: boat.x,
    y: boat.y,
    obstacle: world.obstacles.indexOf(obstacle)
  });
}

function integrateBoat(world, boat, dt, time, events) {
  if (boat.status !== "sailing") return;
  boat.collisionCooldown = Math.max(0, boat.collisionCooldown - dt);
  steerBoat(world, boat, dt);

  const targetSpeed = 25 + thrustAt(boat.config, time) * 49;
  const response = 1 - Math.exp(-dt * 2.25);
  boat.speed += (targetSpeed - boat.speed) * response;
  const current = currentAt(world, boat.x, boat.y, time);
  const nextX = boat.x + Math.cos(boat.heading) * boat.speed * dt + current.x * dt;
  const nextY = boat.y + Math.sin(boat.heading) * boat.speed * dt + current.y * dt;
  boat.x = clamp(nextX, 20, WORLD.width - 20);
  boat.y = clamp(nextY, 28, WORLD.height - 24);

  for (const obstacle of world.obstacles) {
    if (Math.hypot(boat.x - obstacle.x, boat.y - obstacle.y) < obstacle.radius + 7) {
      applyCollision(world, boat, obstacle, events, time);
      break;
    }
  }

  const checkpoint = world.checkpoints[boat.target];
  if (checkpoint && boat.status === "sailing") {
    const reached = Math.hypot(boat.x - checkpoint.x, boat.y - checkpoint.y) < CHECKPOINT_RADIUS;
    if (reached) {
      events.push({
        type: "checkpoint",
        time,
        boat: boat.index,
        checkpoint: boat.target,
        x: checkpoint.x,
        y: checkpoint.y
      });
      boat.target += 1;
      if (boat.target === world.checkpoints.length) {
        boat.status = "finished";
        boat.finishTime = time;
      }
    }
  }
}

function snapshotBoat(world, boat, time) {
  const current = currentAt(world, boat.x, boat.y, time);
  return {
    x: Number(boat.x.toFixed(4)),
    y: Number(boat.y.toFixed(4)),
    heading: Number(boat.heading.toFixed(5)),
    speed: Number(boat.speed.toFixed(3)),
    currentX: Number(current.x.toFixed(3)),
    currentY: Number(current.y.toFixed(3)),
    tension: Number(boat.tension.toFixed(4)),
    completed: boat.target,
    collisions: boat.collisions,
    hull: boat.hull,
    status: boat.status
  };
}

function computeHash(frames) {
  let hash = 2166136261;
  const mix = (number) => {
    hash ^= Number(number) >>> 0;
    hash = Math.imul(hash, 16777619);
  };
  for (const frame of frames) {
    mix(Math.round(frame.time * 1000));
    for (const boat of frame.boats) {
      mix(Math.round(boat.x * 1000));
      mix(Math.round(boat.y * 1000));
      mix(Math.round(boat.heading * 10000));
      mix(Math.round(boat.speed * 100));
      mix(boat.completed);
      mix(boat.collisions);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

export function runSimulation(seedText, configs, options = {}) {
  const world = generateWorld(seedText);
  const boats = createBoats(cloneConfigs(configs));
  const frames = [];
  const events = [];
  let time = 0;
  let tick = 0;

  frames.push({ time: 0, boats: boats.map((boat) => snapshotBoat(world, boat, 0)) });
  while (time < (options.maxTime ?? MAX_TIME)) {
    time = Number((time + SIM_DT).toFixed(6));
    tick += 1;
    for (const boat of boats) integrateBoat(world, boat, SIM_DT, time, events);
    if (tick % SAMPLE_EVERY === 0) {
      frames.push({ time, boats: boats.map((boat) => snapshotBoat(world, boat, time)) });
    }
    const finished = boats.filter((boat) => boat.status === "finished").length;
    const settled = boats.every((boat) => boat.status !== "sailing");
    if (finished >= 2 && settled) break;
  }

  const fleet = boats.map((boat, index) => ({
    ...FLEET[index],
    completed: boat.target,
    finished: boat.status === "finished",
    status: boat.status,
    finishTime: boat.finishTime,
    collisions: boat.collisions,
    hull: boat.hull,
    pathLength: calculatePathLength(frames.map((frame) => frame.boats[index]))
  }));
  const finishedCount = fleet.filter((boat) => boat.finished).length;

  return {
    seedText: world.seedText,
    world,
    configs: cloneConfigs(configs),
    frames,
    events,
    duration: time,
    fleet,
    finishedCount,
    victory: finishedCount >= 2,
    hash: computeHash(frames)
  };
}

function calculatePathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return Number(total.toFixed(1));
}

export function environmentHash(seedText) {
  const world = generateWorld(seedText);
  const fingerprint = [
    world.seed,
    world.flow.angle.toFixed(4),
    world.flow.base.toFixed(4),
    world.flow.phaseA.toFixed(4),
    world.flow.phaseB.toFixed(4),
    world.flow.pulse.toFixed(4),
    ...world.flow.gyres.flatMap((gyre) => [
      gyre.x.toFixed(3),
      gyre.y.toFixed(3),
      gyre.radius.toFixed(3),
      gyre.strength.toFixed(3)
    ]),
    ...world.obstacles.flatMap((obstacle) => [
      obstacle.x.toFixed(3),
      obstacle.y.toFixed(3),
      obstacle.radius.toFixed(3)
    ])
  ].join("|");
  return hashString(fingerprint).toString(16).padStart(8, "0").toUpperCase();
}
