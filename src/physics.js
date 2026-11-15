// 确定性物理核心：吊臂旋转 + 钢索长度 + 悬挂单摆。
// 所有运算仅依赖 Number 与传入输入，禁止 Date/Math.random，保证回放逐位一致。

export const DT = 1 / 60;

export const PX_PER_M = 30;

export const CONFIG = {
  g: 9.81 * PX_PER_M,
  base: { x: 120, y: 440 },
  boomPivot: { x: 120, y: 150 },
  boomLength: 180,
  minCable: 40,
  maxCable: 235,
  minAngle: -1.05,
  maxAngle: 1.05,
  boxMass: 120,
  boxW: 44,
  boxH: 44,
  maxTension: 2400,
  groundY: 440,
  target: { x: 262, y: 440, w: 70, h: 4 },
  obstacle: { x: 236, y: 392, w: 28, h: 48 },
  maxBoomSpeed: 0.9,
  maxCableSpeed: 150,
};

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function tipPosition(angle) {
  return {
    x: CONFIG.boomPivot.x + CONFIG.boomLength * Math.cos(angle),
    y: CONFIG.boomPivot.y + CONFIG.boomLength * Math.sin(angle),
  };
}

export function cargoPosition(angle, length, swing) {
  const anchor = tipPosition(angle);
  return {
    x: anchor.x + length * Math.sin(swing),
    y: anchor.y + length * Math.cos(swing),
  };
}

// 锚点（钢索竖直向下悬挂点）加速度，由吊臂角加速度/角速度与放缆加速度解析得到。
function anchorAcceleration(angle, angVel, angAcc) {
  const L = CONFIG.boomLength;
  const cx = CONFIG.boomPivot.x;
  const cy = CONFIG.boomPivot.y;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const ax = cx + L * c;
  const ay = cy + L * s;
  const ddx = -L * (s * angAcc + c * angVel * angVel);
  const ddy = L * (c * angAcc - s * angVel * angVel);
  return { x: ddx, y: ddy, ax, ay };
}

export function createInitialState() {
  const angle = 0.7;
  const length = 90;
  const swing = 0;
  const cargo = cargoPosition(angle, length, swing);
  return {
    t: 0,
    frame: 0,
    angle,
    angVel: 0,
    length,
    lenVel: 0,
    swing,
    swingVel: 0,
    cargoX: cargo.x,
    cargoY: cargo.y,
    cargoVx: 0,
    cargoVy: 0,
    tension: CONFIG.boxMass * 9.81,
    onGround: false,
    airTime: 0,
    maxAirTime: 0,
    maxTensionSeen: CONFIG.boxMass * 9.81,
    events: [],
    finished: false,
    result: null,
  };
}

function boxRect(state) {
  return {
    x: state.cargoX - CONFIG.boxW / 2,
    y: state.cargoY - CONFIG.boxH / 2,
    w: CONFIG.boxW,
    h: CONFIG.boxH,
  };
}

function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function pushEvent(state, type, message) {
  if (state.events.length && state.events[state.events.length - 1].type === type) return;
  state.events.push({ frame: state.frame, t: state.t, type, message });
}

const DEFAULT_INPUT = {
  boomTargetVel: 0,
  cableTargetVel: 0,
  brake: 0,
  brakeCurve: [
    { v: 0, b: 0 },
    { v: 1, b: 0.25 },
    { v: 2, b: 0.6 },
    { v: 3, b: 1 },
  ],
};

export function curveAt(curve, v) {
  const speed = Math.abs(v);
  if (speed <= curve[0].v) return curve[0].b;
  for (let i = 1; i < curve.length; i++) {
    if (speed <= curve[i].v) {
      const p0 = curve[i - 1];
      const p1 = curve[i];
      const k = (speed - p0.v) / (p1.v - p0.v);
      return p0.b + (p1.b - p0.b) * k;
    }
  }
  return curve[curve.length - 1].b;
}

function rateLimited(current, target, maxRate, dt) {
  const delta = clamp(target - current, -maxRate * dt, maxRate * dt);
  return current + delta;
}

function checkSolidCollision(state) {
  if (state.finished) return false;
  const rect = boxRect(state);
  if (aabbOverlap(rect, CONFIG.obstacle)) {
    pushEvent(state, "collision", `货箱撞击障碍物 @t=${state.t.toFixed(2)}s`);
    state.finished = true;
    state.result = "collision";
    return true;
  }
  const overTarget =
    state.cargoX > CONFIG.target.x - CONFIG.boxW / 2 &&
    state.cargoX < CONFIG.target.x + CONFIG.target.w + CONFIG.boxW / 2;
  const floor = { x: -9999, y: CONFIG.groundY, w: 20000, h: 4 };
  if (!overTarget && aabbOverlap(rect, floor) && state.cargoVy / PX_PER_M > 1.5) {
    pushEvent(state, "collision", `重落地冲击 @t=${state.t.toFixed(2)}s`);
    state.finished = true;
    state.result = "hard-landing";
    return true;
  }
  return false;
}

export function step(state, rawInput) {
  if (state.finished) return state;
  const input = { ...DEFAULT_INPUT, ...rawInput };
  if (!input.brakeCurve) input.brakeCurve = DEFAULT_INPUT.brakeCurve;
  const dt = DT;

  const prevAngVel = state.angVel;
  const prevLenVel = state.lenVel;
  const targetAngVel = clamp(input.boomTargetVel, -CONFIG.maxBoomSpeed, CONFIG.maxBoomSpeed);
  const targetLenVel = clamp(input.cableTargetVel, -CONFIG.maxCableSpeed, CONFIG.maxCableSpeed);
  state.angVel = rateLimited(state.angVel, targetAngVel, 0.8, dt);
  state.lenVel = rateLimited(state.lenVel, targetLenVel, 120, dt);
  const angAcc = clamp((targetAngVel - prevAngVel) * 4, -0.8, 0.8);
  const lenAcc = clamp((targetLenVel - prevLenVel) * 4, -120, 120);
  state.angle = clamp(state.angle + state.angVel * dt, CONFIG.minAngle, CONFIG.maxAngle);
  state.length = clamp(state.length + state.lenVel * dt, CONFIG.minCable, CONFIG.maxCable);

  const anchor = anchorAcceleration(
    state.angle, state.angVel, angAcc,
  );
  const g = CONFIG.g;
  const L = Math.max(state.length, 1);
  const brake = clamp(input.brake + curveAt(input.brakeCurve, state.swingVel), 0, 1);
  const sx = Math.sin(state.swing);
  const cs = Math.cos(state.swing);
  const tangentX = cs;
  const tangentY = -sx;

  const swingAcc =
    -(anchor.x * tangentX + anchor.y * tangentY + g * sx) / L
    - 2 * (state.lenVel / L) * state.swingVel
    - brake * 1.8 * state.swingVel;
  state.swingVel += swingAcc * dt;
  state.swing += state.swingVel * dt;

  state.tension =
    CONFIG.boxMass * (
      (g * cs
        - lenAcc
        + state.lenVel * state.lenVel / L
        + L * state.swingVel * state.swingVel
        - anchor.x * sx
        - anchor.y * cs) / PX_PER_M
    );
  state.tension = Math.max(0, state.tension);
  state.maxTensionSeen = Math.max(state.maxTensionSeen, state.tension);
  if (state.tension > CONFIG.maxTension) {
    pushEvent(state, "overload", `张力 ${state.tension.toFixed(0)}N 超过额定 ${CONFIG.maxTension}N`);
  }

  const cargo = cargoPosition(state.angle, state.length, state.swing);
  state.cargoVx = (cargo.x - state.cargoX) / dt;
  state.cargoVy = (cargo.y - state.cargoY) / dt;
  state.cargoX = cargo.x;
  state.cargoY = cargo.y;

  const groundContact = state.cargoY + CONFIG.boxH / 2 >= CONFIG.groundY - 0.5;
  if (groundContact) {
    state.cargoY = CONFIG.groundY - CONFIG.boxH / 2;
    if (!state.onGround) {
      const vxMps = Math.abs(state.cargoVx / PX_PER_M);
      const inside =
        state.cargoX > CONFIG.target.x &&
        state.cargoX < CONFIG.target.x + CONFIG.target.w;
      if (inside) {
        pushEvent(state, "success", `平稳落入目标区 @t=${(state.t + dt).toFixed(2)}s`);
        if (Math.abs(state.swingVel) < 0.35 && vxMps < 1.2) {
          state.result = "success";
          state.finished = true;
        }
      }
    }
    state.onGround = true;
    state.swingVel = 0;
    state.swing = 0;
    state.airTime = 0;
  } else {
    state.onGround = false;
    state.airTime += dt;
    state.maxAirTime = Math.max(state.maxAirTime, state.airTime);
  }

  checkSolidCollision(state);
  state.frame += 1;
  state.t = state.frame * dt;
  return state;
}

export function cargoSpeed(state) {
  return Math.hypot(state.cargoVx, state.cargoVy);
}

export { boxRect };
