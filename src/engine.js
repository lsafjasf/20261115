// 浮筏吊机：与 DOM/Canvas 无关的纯物理与规则引擎（米、千克、秒，y 轴向上）。

export const PONTOON = {
  width: 8,
  deckY: 0.4,
  mass: 2200,
  inertia: 14000,
  stiffness: 260000,
  damping: 85000,
  capsizeAngle: 0.3,
};

export const CRANE = {
  baseX: 0,
  mastHeight: 2.3,
  boomMin: -1.45,
  boomMax: 1.45,
  trolleyMin: 1.4,
  trolleyMax: 7.2,
  cableLength: 2.8,
  trolleySpeed: 1.1,
  boomSpeed: 0.55,
  swingOmega: 2.4,
  swingDamping: 0.9,
  craneMass: 1500,
  attachRadius: 0.75,
};

export const BOX_SPEC = [
  { id: "light", mass: 300, size: 0.7, color: "#7fc97f" },
  { id: "medium", mass: 600, size: 0.8, color: "#fdbf6f" },
  { id: "heavy", mass: 1300, size: 0.95, color: "#fb6a6a" },
];

export const SHORE = { x: 5.0, deckY: 0.2 };
export const BARGE = { x: -6.5, deckY: 0.2 };

export const DEFAULT_INPUT = Object.freeze({
  boom: 0,
  trolley: 0,
 hook: false,
});

export function createState(options = {}) {
  const boxes = BOX_SPEC.map((spec, index) => ({
    ...spec,
    location: "barge",
    x: BARGE.x + 1.2 + (index - 1) * 1.2,
    y: BARGE.deckY + spec.size / 2,
    vx: 0,
  }));
  const state = {
    time: 0,
    tilt: 0,
    tiltVel: 0,
    boom: 0,
    trolley: 3.2,
    swing: 0,
    swingVel: 0,
    cable: CRANE.cableLength,
    hookOpen: true,
    boxes,
    status: "running",
    events: [],
    wave: { on: true, amp: 26000, period: 7.5, phase: 0 },
    ...options,
  };
  state.wave = { on: true, amp: 26000, period: 7.5, phase: 0, ...(options.wave || {}) };
  return state;
}

export function getHangingBox(state) {
  return state.boxes.find((box) => box.location === "hook") || null;
}

export function getLoadRatio(state) {
  const box = getHangingBox(state);
  return box ? box.mass / BOX_SPEC[BOX_SPEC.length - 1].mass : 0;
}

export function isOverloaded(state) {
  return getLoadRatio(state) >= 0.95;
}

export function effectiveBoom(state) {
  const ratio = getLoadRatio(state);
  const sag = 0.18 * ratio * Math.min(1, state.trolley / CRANE.trolleyMax);
  return state.boom - sag;
}

export function mastPoint(state) {
  const pivot = rotateWorld(state, CRANE.baseX, PONTOON.deckY);
  return { x: pivot.x, y: pivot.y + CRANE.mastHeight };
}

// 浮筏局部坐标（局部 x 向右、局部 y 向上）转世界坐标。
export function rotateWorld(state, localX, localY) {
  const cos = Math.cos(state.tilt);
  const sin = Math.sin(state.tilt);
  return {
    x: localX * cos - (localY - PONTOON.deckY) * sin,
    y: PONTOON.deckY + localX * sin + (localY - PONTOON.deckY) * cos,
  };
}

export function trolleyPoint(state) {
  const angle = effectiveBoom(state);
  const local = {
    x: CRANE.baseX - state.trolley * Math.sin(angle),
    y:
      PONTOON.deckY +
      CRANE.mastHeight +
      state.trolley * Math.cos(angle),
  };
  return rotateWorld(state, local.x, local.y);
}

export function hookPoint(state) {
  const trolley = trolleyPoint(state);
  // 摆角相对当前浮筏局部竖直方向，转换到世界系。
  const worldSwing = state.swing + state.tilt;
  return {
    x: trolley.x + state.cable * Math.sin(worldSwing),
    y: trolley.y - state.cable * Math.cos(worldSwing),
  };
}

// 给定世界系目标点，反解需要的吊臂角与小车行程（供 AI/测试自动操作）。
export function solveForTarget(state, targetX, targetY) {
  const mast = mastPoint(state);
  const cable = CRANE.cableLength;
  let angle = clamp(state.boom, CRANE.boomMin, CRANE.boomMax);
  let travel = clamp(state.trolley, CRANE.trolleyMin, CRANE.trolleyMax);
  // 自动操作以竖直吊索（零摆角）为目标，玩家平稳操作时摆也会衰减到这里。
  const swing = 0;
  for (let iter = 0; iter < 30; iter += 1) {
    const trolley = trolleyPoint({ ...state, boom: angle, trolley: travel });
    const worldSwing = state.tilt + swing;
    const hook = {
      x: trolley.x + cable * Math.sin(worldSwing),
      y: trolley.y - cable * Math.cos(worldSwing),
    };
    // 钩点竖直下方 cable 处即目标，反推小车世界坐标再转回浮筏局部。
    const requiredTrolley = {
      x: targetX - cable * Math.sin(worldSwing),
      y: targetY + cable * Math.cos(worldSwing),
    };
    const local = invertWorld(state, requiredTrolley.x, requiredTrolley.y);
    const localDx = local.x - CRANE.baseX;
    const localDy = local.y - (PONTOON.deckY + CRANE.mastHeight);
    const nextAngle = clamp(
      Math.atan2(-localDx, localDy),
      CRANE.boomMin,
      CRANE.boomMax
    );
    const nextTravel = clamp(
      Math.hypot(localDx, localDy),
      CRANE.trolleyMin,
      CRANE.trolleyMax
    );
    const error = Math.hypot(hook.x - targetX, hook.y - targetY);
    angle += (nextAngle - angle) * 0.6;
    travel += (nextTravel - travel) * 0.6;
    if (error < 0.002) break;
  }
  return { boom: angle, trolley: travel, swing };
}

export function invertWorld(state, worldX, worldY) {
  const cos = Math.cos(state.tilt);
  const sin = Math.sin(state.tilt);
  const dy = worldY - PONTOON.deckY;
  return {
    x: worldX * cos + dy * sin,
    y: PONTOON.deckY - worldX * sin + dy * cos,
  };
}

export function centerOfMass(state) {
  // 固定质量：浮筏自身中心 + 吊机基座处集中质量。
  const terms = [
    { x: 0, y: PONTOON.deckY, m: PONTOON.mass },
    { x: CRANE.baseX, y: PONTOON.deckY + 1.1, m: CRANE.craneMass },
  ];
  for (const box of state.boxes) {
    if (box.location === "hook") {
      const hook = hookPoint(state);
      terms.push({ x: hook.x, y: hook.y, m: box.mass });
    } else if (box.location === "deck") {
      terms.push({ x: box.x, y: box.y, m: box.mass });
    }
  }
  const total = terms.reduce((sum, term) => sum + term.m, 0);
  const x = terms.reduce((sum, term) => sum + term.m * term.x, 0) / total;
  const y = terms.reduce((sum, term) => sum + term.m * term.y, 0) / total;
  return { x, y, mass: total };
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function emit(state, type, detail = {}) {
  state.events.push({ type, time: state.time, ...detail });
}

function handleHookAction(state) {
  const hanging = getHangingBox(state);
  if (hanging) {
    const hook = hookPoint(state);
    const overShore = hook.x > SHORE.x - 0.3 && hook.y > 0;
    const overBarge = hook.x < BARGE.x + 2.4;
    const overPontoon = hook.x > -PONTOON.width / 2 && hook.x < PONTOON.width / 2;
    if (overShore) {
      hanging.location = "delivered";
      hanging.x = SHORE.x + 0.9;
      hanging.y = SHORE.deckY + hanging.size / 2;
      hanging.vx = 0;
      emit(state, "delivered", { boxId: hanging.id });
    } else if (overBarge || overPontoon) {
      hanging.location = overBarge ? "barge" : "deck";
      hanging.x = hook.x;
      hanging.y = overBarge ? BARGE.deckY + hanging.size / 2 : hook.y;
      emit(state, "dropped", { boxId: hanging.id, location: hanging.location });
    } else {
      hanging.location = "sunk";
      emit(state, "sunk", { boxId: hanging.id });
    }
    state.hookOpen = true;
    state.cable = CRANE.cableLength;
    state.swing = 0;
    state.swingVel = 0;
    return;
  }

  const hook = hookPoint(state);
  let nearest = null;
  let nearestDistance = Infinity;
  for (const box of state.boxes) {
    if (box.location === "delivered" || box.location === "sunk" || box.location === "hook") {
      continue;
    }
    const distance = Math.hypot(box.x - hook.x, box.y - hook.y);
    if (distance < CRANE.attachRadius && distance < nearestDistance) {
      nearest = box;
      nearestDistance = distance;
    }
  }
  if (nearest) {
    nearest.location = "hook";
    nearest.vx = 0;
    state.hookOpen = false;
    state.cable = CRANE.cableLength;
    state.swing = 0;
    state.swingVel = 0;
    emit(state, "attached", { boxId: nearest.id });
  } else {
    emit(state, "hookMiss");
  }
}

function tiltTorque(state) {
  const com = centerOfMass(state);
  // 世界系重心偏移即重力对浮筏中心的力臂；浪涌以正弦扭矩叠加。
  const gravityTorque = -com.mass * 9.81 * com.x;
  const restoring = -PONTOON.stiffness * state.tilt;
  const drag = -PONTOON.damping * state.tiltVel;
  let wave = 0;
  if (state.wave.on) {
    wave = state.wave.amp * Math.sin(
      (Math.PI * 2 * state.time) / state.wave.period + state.wave.phase
    );
  }
  return gravityTorque + restoring + drag + wave;
}

export function step(state, rawInput = DEFAULT_INPUT, dt = 1 / 60) {
  const input = { ...DEFAULT_INPUT, ...rawInput };
  state.time += dt;

  if (state.status !== "running") {
    // 终局后浮筏仍在水中自由衰减，便于观察回稳/倾覆后的姿态。
    if (state.status === "won") {
      state.tiltVel +=
        ((-PONTOON.stiffness * state.tilt - PONTOON.damping * state.tiltVel) /
          PONTOON.inertia) *
        dt;
      state.tilt += state.tiltVel * dt;
    }
    return state;
  }

  state.boom = clamp(
    state.boom + input.boom * CRANE.boomSpeed * dt,
    CRANE.boomMin,
    CRANE.boomMax
  );
  state.trolley = clamp(
    state.trolley + input.trolley * CRANE.trolleySpeed * dt,
    CRANE.trolleyMin,
    CRANE.trolleyMax
  );

  if (input.hook) {
    handleHookAction(state);
  }

  const hanging = getHangingBox(state);
  if (hanging) {
    const swingAccel =
      -CRANE.swingOmega * CRANE.swingOmega * Math.sin(state.swing) -
      CRANE.swingDamping * state.swingVel +
      0.55 * input.trolley * Math.cos(state.boom);
    state.swingVel += swingAccel * dt;
    state.swing += state.swingVel * dt;
    const hook = hookPoint(state);
    hanging.x = hook.x;
    hanging.y = hook.y;
  } else {
    state.swing += (0 - state.swing) * Math.min(1, 4 * dt);
    state.swingVel *= Math.max(0, 1 - 2 * dt);
  }

  const angularAccel = tiltTorque(state) / PONTOON.inertia;
  state.tiltVel += angularAccel * dt;
  state.tilt += state.tiltVel * dt;

  if (Math.abs(state.tilt) >= PONTOON.capsizeAngle) {
    state.tilt = Math.sign(state.tilt) * PONTOON.capsizeAngle;
    state.status = "capsized";
    emit(state, "capsize", { tilt: state.tilt });
  }

  if (state.boxes.every((box) => box.location === "delivered")) {
    state.status = "won";
    emit(state, "won");
  }
  return state;
}

export function drainEvents(state) {
  const events = state.events;
  state.events = [];
  return events;
}
