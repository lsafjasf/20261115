export const DT = 1 / 120;
export const WORLD = Object.freeze({
  width: 1000,
  height: 650,
  top: 44,
  bottom: 620,
  finishY: 180,
  gates: [
    { y: 420, left: 150, right: 650, label: "01" },
    { y: 300, left: 430, right: 860, label: "02" }
  ]
});

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, amount) => {
  if (value < target) return Math.min(value + amount, target);
  return Math.max(value - amount, target);
};

function wrapAngle(angle) {
  let wrapped = angle % TAU;
  if (wrapped > Math.PI) wrapped -= TAU;
  if (wrapped < -Math.PI) wrapped += TAU;
  return wrapped;
}

function makeCar(x, y, role) {
  return {
    x,
    y,
    angle: -Math.PI / 2,
    vx: 0,
    vy: 0,
    role,
    damage: 0,
    finished: false,
    gates: [false, false],
    gateMisses: [false, false],
    anchor: false,
    throttle: 0,
    steer: 0
  };
}

export function createInitialState() {
  return {
    step: 0,
    elapsed: 0,
    status: "live",
    cars: [makeCar(390, 565, "driver"), makeCar(560, 565, "anchor")],
    cable: {
      target: 170,
      length: 170,
      stretch: 0,
      slack: 0,
      tension: 0,
      damage: 0,
      payout: 0,
      audioHz: 110
    },
    events: [],
    gatePasses: 0,
    finishCount: 0,
    success: false,
    failure: false
  };
}

export function normalizeInput(input = {}) {
  const throttle = clamp(Number(input.throttle) || 0, -1, 1);
  const steer = clamp(Number(input.steer) || 0, -1, 1);
  const payout = clamp(Number(input.payout) || 0, -1, 1);
  return {
    throttle,
    steer,
    payout,
    anchor: Boolean(input.anchor)
  };
}

function integrateCar(car, dt, kind) {
  const speed = Math.hypot(car.vx, car.vy);
  const forwardX = Math.cos(car.angle);
  const forwardY = Math.sin(car.angle);
  const forwardSpeed = car.vx * forwardX + car.vy * forwardY;
  let lateralX = car.vx - forwardX * forwardSpeed;
  let lateralY = car.vy - forwardY * forwardSpeed;
  const lateralGrip = kind === "driver" ? 4.8 : 2.1;
  lateralX *= Math.max(0, 1 - lateralGrip * dt);
  lateralY *= Math.max(0, 1 - lateralGrip * dt);
  car.vx = forwardX * forwardSpeed + lateralX;
  car.vy = forwardY * forwardSpeed + lateralY;

  const drag = car.anchor ? 7.6 : kind === "driver" ? 0.42 : 0.72;
  const damping = Math.exp(-drag * dt);
  car.vx *= damping;
  car.vy *= damping;

  const maxSpeed = kind === "driver" ? 360 : 300;
  if (speed > maxSpeed) {
    car.vx = (car.vx / speed) * maxSpeed;
    car.vy = (car.vy / speed) * maxSpeed;
  }

  car.x += car.vx * dt;
  car.y += car.vy * dt;
}

function applyCable(carA, carB, cable, dt) {
  const dx = carB.x - carA.x;
  const dy = carB.y - carA.y;
  const distance = Math.max(0.001, Math.hypot(dx, dy));
  const nx = dx / distance;
  const ny = dy / distance;
  const stretch = distance - cable.target;
  const separationVelocity =
    (carB.vx - carA.vx) * nx + (carB.vy - carA.vy) * ny;

  cable.length = distance;
  cable.stretch = Math.max(0, stretch);
  cable.slack = Math.max(0, -stretch);
  cable.payout = cable.target;

  if (stretch <= 0) {
    cable.tension = 0;
    cable.audioHz = 110;
    return;
  }

  const springAcceleration = stretch * 4.15 + Math.max(0, separationVelocity) * 0.42;
  cable.tension = Math.min(2200, stretch * 19.5 + Math.abs(separationVelocity) * 2.2);
  cable.audioHz = 128 + Math.min(1, cable.tension / 1450) * 590;

  carA.vx += nx * springAcceleration * dt;
  carA.vy += ny * springAcceleration * dt;
  carB.vx -= nx * springAcceleration * dt;
  carB.vy -= ny * springAcceleration * dt;
}

function constrainCar(car) {
  const radius = 22;
  const left = 30 + radius;
  const right = WORLD.width - 30 - radius;
  const top = WORLD.top + radius;
  const bottom = WORLD.bottom - radius;

  if (car.x < left) {
    car.x = left;
    car.vx = Math.abs(car.vx) * 0.2;
  } else if (car.x > right) {
    car.x = right;
    car.vx = -Math.abs(car.vx) * 0.2;
  }

  if (car.y < top) {
    car.y = top;
    car.vy = Math.abs(car.vy) * 0.2;
  } else if (car.y > bottom) {
    car.y = bottom;
    car.vy = -Math.abs(car.vy) * 0.2;
  }
}

function checkGates(state, previous) {
  const events = [];
  for (let carIndex = 0; carIndex < 2; carIndex += 1) {
    const car = state.cars[carIndex];
    for (let gateIndex = 0; gateIndex < WORLD.gates.length; gateIndex += 1) {
      if (car.gates[gateIndex]) continue;
      const gate = WORLD.gates[gateIndex];
      const crossed = previous[carIndex].y >= gate.y && car.y < gate.y;
      if (!crossed) continue;
      if (car.x >= gate.left && car.x <= gate.right) {
        car.gates[gateIndex] = true;
        state.gatePasses += 1;
        events.push({
          type: "gate",
          car: carIndex,
          gate: gateIndex,
          text: `${carIndex === 0 ? "车 A" : "车 B"} 通过闸门 ${gate.label}`
        });
      } else if (!car.gateMisses[gateIndex]) {
        car.gateMisses[gateIndex] = true;
        events.push({
          type: "miss",
          car: carIndex,
          gate: gateIndex,
          text: `${carIndex === 0 ? "车 A" : "车 B"} 错过闸门 ${gate.label}，倒车可重试`
        });
      }
    }
    if (!car.finished && car.y <= WORLD.finishY) {
      car.finished = true;
      state.finishCount += 1;
      events.push({
        type: "finish",
        car: carIndex,
        text: `${carIndex === 0 ? "车 A" : "车 B"} 抵达终点`
      });
    }
  }
  return events;
}

function increaseDamage(state, carA, carB, dt) {
  const overTension = Math.max(0, state.cable.tension - 850);
  if (overTension > 0) {
    const damageRate = (overTension / 900) * 15;
    carA.damage = Math.min(100, carA.damage + damageRate * dt);
    carB.damage = Math.min(100, carB.damage + damageRate * dt);
    state.cable.damage = Math.max(carA.damage, carB.damage);
  }
  return Math.max(carA.damage, carB.damage);
}

export function stepSimulation(state, rawInput) {
  if (state.status !== "live") return state;
  const input = normalizeInput(rawInput);
  const [carA, carB] = state.cars;
  const previous = state.cars.map((car) => ({ x: car.x, y: car.y }));

  carA.throttle = input.throttle;
  carA.steer = input.steer;
  carB.payout = input.payout;
  carB.anchor = input.anchor;

  state.cable.target = clamp(state.cable.target + input.payout * 68 * DT, 92, 290);

  const speed = Math.hypot(carA.vx, carA.vy);
  const steeringAuthority = 0.35 + Math.min(1, speed / 150) * 0.65;
  carA.angle = wrapAngle(carA.angle + input.steer * 2.55 * steeringAuthority * DT);

  const forwardX = Math.cos(carA.angle);
  const forwardY = Math.sin(carA.angle);
  const drive = input.throttle >= 0 ? 355 : 190;
  if (input.throttle !== 0) {
    carA.vx += forwardX * input.throttle * drive * DT;
    carA.vy += forwardY * input.throttle * drive * DT;
  }

  if (input.anchor) {
    carB.vx *= Math.exp(-4.0 * DT);
    carB.vy *= Math.exp(-4.0 * DT);
  }

  applyCable(carA, carB, state.cable, DT);
  integrateCar(carA, DT, "driver");
  integrateCar(carB, DT, "anchor");
  constrainCar(carA);
  constrainCar(carB);

  const events = checkGates(state, previous);
  increaseDamage(state, carA, carB, DT);

  state.step += 1;
  state.elapsed = state.step * DT;
  if (events.length) state.events = events;

  if (carA.damage >= 100 || carB.damage >= 100) {
    state.failure = true;
    state.status = "failed";
    state.events = [{ type: "failure", text: "缆绳过载，车体损毁" }];
  } else if (
    state.gatePasses === 4 &&
    state.cars.every((car) => car.finished)
  ) {
    state.success = true;
    state.status = "success";
    state.events = [{ type: "success", text: "双车通过全部闸门并抵达终点" }];
  }
  return state;
}

export function cloneState(state) {
  return structuredClone(state);
}

export function snapshotState(state) {
  return {
    step: state.step,
    elapsed: state.elapsed,
    status: state.status,
    success: state.success,
    failure: state.failure,
    gatePasses: state.gatePasses,
    finishCount: state.finishCount,
    cars: state.cars.map((car) => ({
      x: car.x,
      y: car.y,
      angle: car.angle,
      vx: car.vx,
      vy: car.vy,
      damage: car.damage,
      finished: car.finished,
      gates: [...car.gates],
      anchor: car.anchor,
      throttle: car.throttle,
      steer: car.steer,
      payout: car.payout || 0
    })),
    cable: { ...state.cable }
  };
}
